// Fetches all repo data for the themes in data/themes.json and writes
//   data/stats.json           -> summary for every theme (downloads, stars, version, image, ...)
//   sitemap.xml               -> all pages (themes, projects, userstyle websites) for search engines
//   data/details/<id>.json    -> readme, roadmap (ROADMAP.md), releases, latest commits and sub styles (see fetchStyles)
//
// "projects": [{ "id": "plugin", "repo": ... }] in themes.json: extra repos shown on the page of that
// theme (no card of their own), stored like a theme under the id <theme id>-<project id>.
//
// Runs without dependencies on Node >= 18:  GH_TOKEN=... node .github/scripts/update-data.mjs
// If a request fails, the previous value is kept so the site never drops to 0.

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const DATA = new URL('data/', ROOT);
const DETAILS = new URL('details/', DATA);
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const API = 'https://api.github.com';
const MAX_RELEASES = 30;
const MAX_COMMITS = 30;

async function readJson(url, fallback) {
    try {
        return JSON.parse(await readFile(url, 'utf8'));
    } catch {
        return fallback;
    }
}

async function writeJson(url, data) {
    await writeFile(url, JSON.stringify(data, null, 4) + '\n');
}

async function request(url, accept = 'application/vnd.github+json') {
    const headers = { 'User-Agent': 'SpaceThemeBot', Accept: accept };
    if (url.startsWith(API)) {
        headers['X-GitHub-Api-Version'] = '2022-11-28';
        if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
}

// Returns null instead of throwing, so one broken source doesn't stop the whole run
async function tryRequest(url, accept) {
    try {
        return await request(url, accept);
    } catch (e) {
        console.warn(`  ! ${url} -> ${e.message}`);
        return null;
    }
}

async function exists(url) {
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        return res.ok;
    } catch {
        return false;
    }
}

function getPath(obj, path) {
    return path.split('.').reduce((o, key) => o?.[key], obj);
}

function parseRepo(url) {
    const match = /github\.com\/([^/]+)\/([^/#?]+)/.exec(url || '');
    return match ? { owner: match[1], name: match[2].replace(/\.git$/, '') } : null;
}

// GitHub renders relative links as-is, they would point to our own site otherwise.
// dir: folder of the markdown file, relative links start there ("/" links start at the repo root)
function absolutizeUrls(html, repo, branch, dir = '') {
    return html.replace(/(src|href)="([^"]+)"/g, (full, attr, value) => {
        if (/^([a-z]+:|#|\/\/)/i.test(value)) return full;
        const path = value.startsWith('/') ? value.slice(1) : `${dir ? `${dir}/` : ''}${value.replace(/^\.\//, '')}`;
        const base = attr === 'src'
            ? `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/`
            : `https://github.com/${repo.owner}/${repo.name}/blob/${branch}/`;
        return `${attr}="${base}${path}"`;
    });
}

// First readme image with "preview" in its alt text, otherwise one with "banner"
function findPreviewImage(html) {
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
        alt: /alt="([^"]*)"/.exec(tag)?.[1] || '',
        src: /data-canonical-src="([^"]+)"/.exec(tag)?.[1] || /src="([^"]+)"/.exec(tag)?.[1]
    }));
    for (const pattern of [/preview/i, /banner/i]) {
        const match = images.find(image => image.src && pattern.test(image.alt));
        if (match) return match.src;
    }
    return null;
}

function mapRelease(release, repo, branch) {
    const assets = (release.assets || []).map(asset => ({
        name: asset.name,
        size: asset.size,
        downloads: asset.download_count,
        url: asset.browser_download_url
    }));
    return {
        tag: release.tag_name,
        name: release.name || release.tag_name,
        date: release.published_at || release.created_at,
        prerelease: release.prerelease,
        url: release.html_url,
        downloads: assets.reduce((sum, asset) => sum + asset.downloads, 0),
        body: absolutizeUrls(release.body_html || '', repo, branch),
        assets
    };
}

function mapCommit(commit) {
    const [title, ...rest] = commit.commit.message.split('\n');
    return {
        sha: commit.sha.slice(0, 7),
        title,
        body: rest.join('\n').trim(),
        date: commit.commit.author?.date || commit.commit.committer?.date,
        author: commit.author?.login || commit.commit.author?.name || 'unknown',
        avatar: commit.author?.avatar_url || null,
        url: commit.html_url
    };
}

function prettifyName(id) {
    return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

// The image set under "Social preview" in the repo settings (GitHub's generated card otherwise).
// Read from the og:image of the repo page, that needs no API request or token.
// GitHub's generated cards (opengraph.githubassets.com) are rate limited per visitor IP, so they
// go through the cache of the NAS instead (/api/og/..., see nginx/api.conf). That url also stays
// the same between runs, the GitHub one gets a new hash every time.
async function fetchSocialImage(repo) {
    const html = await tryRequest(`https://github.com/${repo.owner}/${repo.name}`, 'text/html');
    const url = /<meta property="og:image" content="([^"]+)"/.exec(html || '')?.[1] || null;
    return url?.startsWith('https://opengraph.githubassets.com/') ? `/api/og/${repo.owner}/${repo.name}` : url;
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
const STYLE_FILE = /\.(css|less|styl)$/i;

// "styles": { "path": "styles", "sites": { "<folder>": { "name", "url", "image" } } } in themes.json:
// every folder inside path is its own theme (e.g. one userstyle per website) with its own page,
// gallery (all images in the folder) and commits (only the ones that touched the folder)
async function fetchStyles(config, repo, base, branch, previous = []) {
    const tree = await tryRequest(`${base}/git/trees/${branch}?recursive=1`);
    if (!Array.isArray(tree?.tree)) return previous;

    const root = `${config.path.replace(/\/+$/, '')}/`;
    const raw = path => `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${encodeURI(path)}`;
    const github = (type, path) => `https://github.com/${repo.owner}/${repo.name}/${type}/${branch}/${encodeURI(path)}`;
    const dirs = tree.tree.filter(entry =>
        entry.type === 'tree' && entry.path.startsWith(root) && !entry.path.slice(root.length).includes('/'));

    const styles = [];
    for (const dir of dirs) {
        const id = dir.path.slice(root.length);
        const prev = previous.find(style => style.id === id);
        const files = tree.tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(`${dir.path}/`));
        const hasReadme = files.some(file => file.path.slice(dir.path.length + 1).match(/^readme(\.\w+)?$/i));

        const [commitList, readmeHtml] = await Promise.all([
            tryRequest(`${base}/commits?path=${encodeURIComponent(dir.path)}&per_page=${MAX_COMMITS}`),
            hasReadme ? tryRequest(`${base}/readme/${encodeURI(dir.path)}`, 'application/vnd.github.html') : null
        ]);

        const meta = config.sites?.[id] || {};
        const images = files
            .filter(file => IMAGE_FILE.test(file.path))
            .map(file => ({ src: raw(file.path), name: file.path.slice(dir.path.length + 1) }));
        const commits = commitList ? commitList.map(mapCommit) : prev?.commits || [];

        styles.push({
            id,
            name: meta.name || prettifyName(id),
            url: meta.url || null,
            folder: github('tree', dir.path),
            image: meta.image || images[0]?.src || null,
            images,
            files: files
                .filter(file => STYLE_FILE.test(file.path))
                .map(file => ({ name: file.path.slice(dir.path.length + 1), size: file.size, url: raw(file.path), html: github('blob', file.path) })),
            readme: readmeHtml ? absolutizeUrls(readmeHtml, repo, branch, dir.path) : hasReadme ? prev?.readme || null : null,
            commits,
            updated: commits[0]?.date || null
        });
    }
    return styles;
}

// "artworksIndex": "grid.zip" in themes.json: writes data/artworks.json with the file index of that
// release asset (Steam-Custom-Artworks). /artworks/ uses it to know which games have artworks and
// where their files are inside the zip, so the browser only has to download those byte ranges.
const ARTWORKS = new URL('artworks.json', DATA);
const ARTWORK_FILE = /^(.*?)(\d+)(p|_hero|_logo)?\.png$/;
const ARTWORK_SUFFIXES = ['p', '', '_hero', '_logo'];

async function fetchBytes(url, start, end) {
    const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}`, 'User-Agent': 'SpaceThemeBot' },
        signal: AbortSignal.timeout(60000)
    });
    if (res.status !== 206) throw new Error(`${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
}

async function updateArtworksIndex(assetName, releases) {
    const release = releases.find(r => !r.prerelease && r.assets.some(a => a.name === assetName));
    const asset = release?.assets.find(a => a.name === assetName);
    if (!asset) return;
    const previous = await readJson(ARTWORKS, null);
    if (previous?.tag === release.tag && previous?.size === asset.size) return;

    try {
        // End of central directory record is in the last 22 bytes (+ up to 64 KB comment)
        const tailStart = Math.max(0, asset.size - 65557);
        const tail = await fetchBytes(asset.url, tailStart, asset.size - 1);
        const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        if (eocd < 0) throw new Error('no zip index found');
        const count = tail.readUInt16LE(eocd + 10);
        const size = tail.readUInt32LE(eocd + 12);
        const offset = tail.readUInt32LE(eocd + 16);
        const directory = offset >= tailStart
            ? tail.subarray(offset - tailStart, offset - tailStart + size)
            : await fetchBytes(asset.url, offset, offset + size - 1);

        // games: { appid: [cover, banner, hero, logo] }, each [offset, compressed, size, crc, method, time, date] or 0
        const games = {};
        let prefix = '';
        for (let p = 0, i = 0; i < count; i++) {
            const nameLength = directory.readUInt16LE(p + 28);
            const next = p + 46 + nameLength + directory.readUInt16LE(p + 30) + directory.readUInt16LE(p + 32);
            const match = ARTWORK_FILE.exec(directory.toString('utf8', p + 46, p + 46 + nameLength));
            if (match) {
                prefix = match[1];
                games[match[2]] ||= [0, 0, 0, 0];
                games[match[2]][ARTWORK_SUFFIXES.indexOf(match[3] || '')] = [
                    directory.readUInt32LE(p + 42),   // local header offset
                    directory.readUInt32LE(p + 20),   // compressed size
                    directory.readUInt32LE(p + 24),   // size
                    directory.readUInt32LE(p + 16),   // crc32
                    directory.readUInt16LE(p + 10),   // method
                    directory.readUInt16LE(p + 12),   // time
                    directory.readUInt16LE(p + 14)    // date
                ];
            }
            p = next;
        }

        // Compact JSON, the file has a few thousand entries
        await writeFile(ARTWORKS, JSON.stringify({
            tag: release.tag,
            asset: assetName,
            size: asset.size,
            prefix,
            suffixes: ARTWORK_SUFFIXES,
            games
        }) + '\n');
        console.log(`  artworks index: ${Object.keys(games).length} games (${release.tag})`);
    } catch (e) {
        console.warn(`  ! artworks index -> ${e.message}`);
    }
}

// ROADMAP.md task lists -> [{ title, tasks: [{ text, done, tasks: [...] }] }], one section per heading.
// Indented tasks become sub tasks: "- [x] Task", "  - [ ] Sub task"
function parseRoadmap(markdown) {
    const sections = [];
    const stack = [];
    let section = null;
    for (const line of markdown.split(/\r?\n/)) {
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
            section = { title: heading[1], tasks: [] };
            sections.push(section);
            stack.length = 0;
            continue;
        }
        const task = /^(\s*)[-*+]\s*\[( |x|X)\]\s*(.*)$/.exec(line);
        if (!task) continue;
        if (!section) sections.push(section = { title: '', tasks: [] });
        const indent = task[1].replace(/\t/g, '    ').length;
        const item = { text: task[3].trim(), done: task[2] !== ' ', tasks: [] };
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        (stack.length ? stack[stack.length - 1].item.tasks : section.tasks).push(item);
        stack.push({ indent, item });
    }
    return sections.filter(s => s.tasks.length);
}

async function fetchRoadmap(rootFiles, repo, branch, previous) {
    if (!Array.isArray(rootFiles)) return previous || null;
    const file = rootFiles.find(f => f.type === 'file' && /^roadmap(\.md)?$/i.test(f.name));
    if (!file) return null;
    const markdown = await tryRequest(`https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${encodeURI(file.path)}`, 'text/plain');
    return typeof markdown === 'string' ? parseRoadmap(markdown) : previous || null;
}

// GitHub only keeps the clones of the last 14 days, so every finished day is added up once:
// clonesCounted = { total, until: last counted day }. Today is skipped, its count is not final yet.
// Needs a GH_TOKEN with access to the traffic of the repo, without it the old total is kept.
function countClones(clones, previous) {
    const counted = { total: previous?.clonesCounted?.total ?? previous?.sources?.clones ?? 0, until: previous?.clonesCounted?.until || null };
    if (!clones?.clones) return counted;
    const today = new Date().toISOString().slice(0, 10);
    for (const { timestamp, count } of [...clones.clones].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
        const day = timestamp.slice(0, 10);
        if (day >= today || (counted.until && day <= counted.until)) continue;
        counted.total += count;
        counted.until = day;
    }
    return counted;
}

async function updateTheme(theme, previous) {
    const repo = parseRepo(theme.repo);
    const detailsUrl = new URL(`${theme.id}.json`, DETAILS);
    const prevDetails = await readJson(detailsUrl, null);
    const prevSources = previous?.sources || {};
    const sources = {};

    console.log(`- ${theme.id}`);
    const info = repo ? await tryRequest(`${API}/repos/${repo.owner}/${repo.name}`) : null;

    if (info) {
        const branch = info.default_branch;
        const base = `${API}/repos/${repo.owner}/${repo.name}`;

        const [releaseList, commitList, readmeHtml, rootFiles, clones] = await Promise.all([
            tryRequest(`${base}/releases?per_page=100`, 'application/vnd.github.html+json'),
            tryRequest(`${base}/commits?per_page=${MAX_COMMITS}`),
            tryRequest(`${base}/readme`, 'application/vnd.github.html'),
            tryRequest(`${base}/contents/?ref=${branch}`),
            TOKEN ? tryRequest(`${base}/traffic/clones`) : null
        ]);

        const releases = releaseList
            ? releaseList.filter(r => !r.draft).map(r => mapRelease(r, repo, branch))
            : prevDetails?.releases || [];
        const commits = commitList ? commitList.map(mapCommit) : prevDetails?.commits || [];
        const readme = readmeHtml ? absolutizeUrls(readmeHtml, repo, branch) : prevDetails?.readme || null;

        sources.releases = releaseList ? releases.reduce((sum, r) => sum + r.downloads, 0) : prevSources.releases || 0;
        const clonesCounted = countClones(clones, previous);
        sources.clones = clonesCounted.total;

        for (const source of theme.downloadSources || []) {
            const res = await tryRequest(source.url, 'application/json');
            const value = parseInt(getPath(res, source.path || 'count'));
            sources[source.name] = Number.isFinite(value) ? value : prevSources[source.name] || 0;
        }

        // "changelog": "commits" in themes.json -> repo is updated via commits, releases are legacy
        const useCommits = theme.changelog === 'commits' || !releases.length;
        const latest = useCommits
            ? commits[0] && { tag: commits[0].sha, date: commits[0].date }
            : releases.find(r => !r.prerelease) || releases[0];
        let image = theme.image && await exists(theme.image) ? theme.image : null;
        image ||= readme && findPreviewImage(readme);
        image ||= `https://opengraph.githubassets.com/1/${repo.owner}/${repo.name}`;

        const styles = theme.styles ? await fetchStyles(theme.styles, repo, base, branch, prevDetails?.styles) : undefined;
        if (theme.artworksIndex && releaseList) await updateArtworksIndex(theme.artworksIndex, releases);
        const socialImage = await fetchSocialImage(repo) || previous?.socialImage || null;

        const roadmap = await fetchRoadmap(rootFiles, repo, branch, prevDetails?.roadmap);

        await writeJson(detailsUrl, {
            readme,
            roadmap: roadmap || undefined,
            releases: releases.slice(0, MAX_RELEASES),
            commits,
            styles
        });

        return {
            repo: `${repo.owner}/${repo.name}`,
            image,
            socialImage,
            changelog: useCommits ? 'commits' : 'releases',
            version: latest?.tag || null,
            versionDate: latest?.date || null,
            updated: info.pushed_at,
            description: info.description?.trim() || null,
            license: info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : null,
            stars: info.stargazers_count,
            forks: info.forks_count,
            issues: info.open_issues_count,
            downloads: Object.values(sources).reduce((sum, value) => sum + value, 0),
            sources,
            clonesCounted,
            styles: styles?.length
        };
    }

    // Repo unreachable (private, deleted, rate limit, ...): keep the old data if we have it
    if (previous) return previous;
    await writeJson(detailsUrl, { readme: null, releases: [], commits: [] });
    return {
        repo: repo ? `${repo.owner}/${repo.name}` : null,
        image: theme.image || null,
        changelog: 'commits',
        version: null,
        versionDate: null,
        updated: null,
        license: null,
        stars: 0,
        forks: 0,
        issues: 0,
        downloads: 0,
        sources: {}
    };
}

// Static pages + one url per theme page, same urls as the links on the website (js/themes.js)
const SITE = 'https://spacetheme.net';

async function writeSitemap(themes, stats) {
    const day = value => value ? value.slice(0, 10) : null;
    const urls = [
        { loc: '/' }, { loc: '/themes/' }, { loc: '/artworks/', lastmod: day(stats['steam-custom-artworks']?.versionDate) }
    ];
    for (const theme of themes.filter(t => !t.hidden)) {
        const page = `/themes/?id=${encodeURIComponent(theme.id)}`;
        urls.push({ loc: page, lastmod: day(stats[theme.id]?.updated) });
        for (const project of theme.projects || []) {
            urls.push({ loc: `${page}&project=${encodeURIComponent(project.id)}`, lastmod: day(stats[`${theme.id}-${project.id}`]?.updated) });
        }
        if (theme.styles) {
            const details = await readJson(new URL(`${theme.id}.json`, DETAILS), {});
            for (const style of details.styles || []) {
                urls.push({ loc: `${page}&style=${encodeURIComponent(style.id)}`, lastmod: day(style.updated) });
            }
        }
    }
    const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    await writeFile(new URL('sitemap.xml', ROOT), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map(u => `    <url><loc>${xml(SITE + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`),
        '</urlset>',
        ''
    ].join('\n'));
}

async function main() {
    const themes = await readJson(new URL('themes.json', DATA), []);
    const statsUrl = new URL('stats.json', DATA);
    const prevStats = await readJson(statsUrl, {});
    const prevThemes = prevStats.themes && !Array.isArray(prevStats.themes) ? prevStats.themes : {};

    if (!TOKEN) console.warn('No GH_TOKEN set: 60 requests/hour limit and no clone stats.');
    await mkdir(DETAILS, { recursive: true });

    const stats = {};
    for (const theme of themes) {
        stats[theme.id] = await updateTheme(theme, prevThemes[theme.id]);
        for (const project of theme.projects || []) {
            const id = `${theme.id}-${project.id}`;   // same id as projectTheme() in js/themes.js
            stats[id] = await updateTheme({ ...project, id }, prevThemes[id]);
        }
    }

    // Remove detail files of themes that were deleted from themes.json
    for (const file of await readdir(DETAILS)) {
        if (file.endsWith('.json') && !stats[file.slice(0, -5)]) await rm(new URL(file, DETAILS));
    }

    const result = {
        updated: prevStats.updated || null,
        total_downloads: Object.values(stats).reduce((sum, s) => sum + s.downloads, 0),
        total_stars: Object.values(stats).reduce((sum, s) => sum + s.stars, 0),
        themes: stats
    };

    // Only touch the timestamp when something actually changed, avoids empty commits
    const changed = JSON.stringify({ ...result, updated: null }) !== JSON.stringify({ ...prevStats, updated: null });
    if (changed || !result.updated) result.updated = new Date().toISOString();
    await writeJson(statsUrl, result);
    await writeSitemap(themes, stats);

    console.log(`Total downloads: ${result.total_downloads}, stars: ${result.total_stars}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
