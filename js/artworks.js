// Steam-Custom-Artworks downloader (/artworks/)
//
// 1. Loads the file index of grid.zip (data/artworks.json, written by the update workflow)
// 2. Loads the owned games of a Steam profile through the nginx proxy (see nginx/api.conf)
// 3. Fetches only the files of the selected games with HTTP range requests and packs them into
//    a new, small grid.zip in the browser. The compressed data is copied as-is, nothing gets re-encoded.
//
// Steam and the zip can only be reached through the nginx proxy (no CORS, the Steam API needs a key),
// so the page does not work with a plain static server like VS Code Live Server.

const INDEX_URL = '/data/artworks.json';
const zipUrl = release => `/api/artworks/${encodeURIComponent(release)}/grid.zip`;
const PROXY_MISSING = 'The API proxy is not set up on this server (see nginx/api.conf). '
    + 'It does not work with a plain static server like VS Code Live Server.';
const STEAM_ID_OFFSET = 76561197960265728n;
const STEAM_CDN = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps';
const REQUEST_URL = 'https://github.com/SpaceTheme/Steam-Custom-Artworks/issues/new?template=ARTWORK.yml&app_id=';

// File names inside grid.zip: <appid>p.png, <appid>.png, <appid>_hero.png, <appid>_logo.png
const TYPES = [
    { id: 'cover', suffix: 'p', label: 'Cover' },
    { id: 'banner', suffix: '', label: 'Banner' },
    { id: 'hero', suffix: '_hero', label: 'Hero' },
    { id: 'logo', suffix: '_logo', label: 'Logo' }
];
const ARTWORK_FILE = /^(?:grid\/)?(\d+)(p|_hero|_logo)?\.png$/;

const MAX_GAP = 256 * 1024;          // merge ranges of files that are this close together
const MAX_CHUNK = 8 * 1024 * 1024;   // ...but keep single requests reasonably small
const HEADER_SLACK = 1024;           // room for the local header extra field
const PARALLEL_REQUESTS = 4;

const $ = id => document.getElementById(id);




/* Zip reading (range requests) */

// Without the proxy a static server answers with 404 (or a html page with 200 as SPA fallback).
// Errors from Steam itself (e.g. 401 for a wrong key) are html as well, so only 200 counts.
function isProxyMissing(res) {
    return res.status === 404 || (res.ok && (res.headers.get('Content-Type') || '').includes('text/html'));
}

// Retries a few times, the proxy can fail when GitHub's storage hiccups or DNS is slow
async function fetchRange(url, start, end, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
            if (res.status === 206) return res;
            if (isProxyMissing(res)) throw Object.assign(new Error(PROXY_MISSING), { final: true });
            throw new Error(`Range request failed (${res.status})`);
        } catch (e) {
            if (e.final || attempt >= attempts) throw e;
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }
}

async function readWithProgress(res, onBytes) {
    if (!res.body) return res.arrayBuffer();
    const reader = res.body.getReader();
    const parts = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        length += value.length;
        onBytes(value.length);
    }
    const buffer = new Uint8Array(length);
    let position = 0;
    for (const part of parts) {
        buffer.set(part, position);
        position += part.length;
    }
    return buffer.buffer;
}

function parseCentralDirectory(view, count) {
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
        if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Broken zip index');
        const nameLength = view.getUint16(p + 28, true);
        const extraLength = view.getUint16(p + 30, true);
        const commentLength = view.getUint16(p + 32, true);
        const nameBytes = new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLength);
        entries.push({
            name: new TextDecoder().decode(nameBytes),
            method: view.getUint16(p + 10, true),
            time: view.getUint16(p + 12, true),
            date: view.getUint16(p + 14, true),
            crc: view.getUint32(p + 16, true),
            compressedSize: view.getUint32(p + 20, true),
            size: view.getUint32(p + 24, true),
            offset: view.getUint32(p + 42, true),
            nameLength
        });
        p += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

// Index from data/artworks.json: Map<appid, { cover, banner, hero, logo }> with the zip entries
async function loadIndex() {
    try {
        const data = await ST.fetchJson(INDEX_URL);
        const games = new Map();
        for (const [appid, files] of Object.entries(data.games)) {
            const entries = {};
            files.forEach((file, i) => {
                if (!file) return;
                const [offset, compressedSize, size, crc, method, time, date] = file;
                const name = `${data.prefix}${appid}${data.suffixes[i]}.png`;
                entries[TYPES[i].id] = { name, offset, compressedSize, size, crc, method, time, date, nameLength: name.length };
            });
            games.set(Number(appid), entries);
        }
        return { url: zipUrl(data.tag), total: data.size, release: data.tag, games };
    } catch (e) {
        console.warn('data/artworks.json not available, reading the zip index directly', e);
        return loadZipIndex(zipUrl('latest'));
    }
}

// Fallback: reads the central directory of the zip itself with range requests
async function loadZipIndex(url) {
    const probe = await fetchRange(url, 0, 0);
    const total = Number(probe.headers.get('Content-Range')?.split('/')[1]);
    if (!total) throw new Error('Unknown zip size');

    // End of central directory record: 22 bytes + up to 64 KB comment at the end of the file
    const tailStart = Math.max(0, total - 65557);
    const tail = new DataView(await (await fetchRange(url, tailStart, total - 1)).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('Zip index not found');

    const count = tail.getUint16(eocd + 10, true);
    const directorySize = tail.getUint32(eocd + 12, true);
    const directoryOffset = tail.getUint32(eocd + 16, true);
    if (directoryOffset === 0xffffffff) throw new Error('Zip64 is not supported');

    const directory = directoryOffset >= tailStart
        ? new DataView(tail.buffer, directoryOffset - tailStart, directorySize)
        : new DataView(await (await fetchRange(url, directoryOffset, directoryOffset + directorySize - 1)).arrayBuffer());

    const games = new Map();
    for (const entry of parseCentralDirectory(directory, count)) {
        const match = ARTWORK_FILE.exec(entry.name);
        if (!match) continue;
        const appid = Number(match[1]);
        const type = TYPES.find(t => t.suffix === (match[2] || ''));
        if (!games.has(appid)) games.set(appid, {});
        games.get(appid)[type.id] = entry;
    }
    return { url, total, release: null, games };
}




/* Zip writing */

function localHeader(entry, nameBytes) {
    const view = new DataView(new ArrayBuffer(30));
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entry.method, true);
    view.setUint16(10, entry.time, true);
    view.setUint16(12, entry.date, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.compressedSize, true);
    view.setUint32(22, entry.size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    return view.buffer;
}

function centralHeader(entry, nameBytes, offset) {
    const view = new DataView(new ArrayBuffer(46));
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, entry.time, true);
    view.setUint16(14, entry.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.compressedSize, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, offset, true);
    return view.buffer;
}

function endRecord(count, directorySize, directoryOffset) {
    const view = new DataView(new ArrayBuffer(22));
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, directoryOffset, true);
    return view.buffer;
}

// Neighbouring files are fetched together, so 100 games need a handful of requests instead of 400
function groupIntoChunks(entries, total) {
    const chunks = [];
    for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
        const start = entry.offset;
        const end = Math.min(total - 1, entry.offset + 30 + entry.nameLength + HEADER_SLACK + entry.compressedSize);
        const last = chunks[chunks.length - 1];
        if (last && start - last.end <= MAX_GAP && end - last.start <= MAX_CHUNK) {
            last.end = Math.max(last.end, end);
            last.entries.push(entry);
        } else {
            chunks.push({ start, end, entries: [entry] });
        }
    }
    return chunks;
}

// Compressed data of an entry, read from the local file header inside a fetched chunk
async function entryData(entry, chunk, buffer, url) {
    let view = new DataView(buffer);
    let position = entry.offset - chunk.start;
    if (view.getUint32(position, true) !== 0x04034b50) throw new Error(`Broken file in zip: ${entry.name}`);
    let dataStart = position + 30 + view.getUint16(position + 26, true) + view.getUint16(position + 28, true);

    // Very unusual: the local extra field was bigger than expected, fetch this file on its own
    if (dataStart + entry.compressedSize > buffer.byteLength) {
        const headerSize = dataStart - position;
        const own = await (await fetchRange(url, entry.offset, entry.offset + headerSize + entry.compressedSize - 1)).arrayBuffer();
        return new Uint8Array(own, headerSize, entry.compressedSize);
    }
    return new Uint8Array(buffer, dataStart, entry.compressedSize);
}

async function buildZip(entries, index, onProgress) {
    const chunks = groupIntoChunks(entries, index.total);
    const bytesTotal = chunks.reduce((sum, chunk) => sum + chunk.end - chunk.start + 1, 0);
    let bytesLoaded = 0;
    const files = new Map();

    let next = 0;
    async function worker() {
        while (next < chunks.length) {
            const chunk = chunks[next++];
            const res = await fetchRange(index.url, chunk.start, chunk.end);
            const buffer = await readWithProgress(res, bytes => {
                bytesLoaded += bytes;
                onProgress(bytesLoaded, bytesTotal);
            });
            for (const entry of chunk.entries) files.set(entry, await entryData(entry, chunk, buffer, index.url));
        }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, chunks.length) }, worker));

    // Files go to the root of the zip, so it can be extracted straight into .../config/grid
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
        const nameBytes = new TextEncoder().encode(entry.name.replace(/^grid\//, ''));
        const header = localHeader(entry, nameBytes);
        const data = files.get(entry);
        parts.push(header, nameBytes, data);
        central.push(centralHeader(entry, nameBytes, offset), nameBytes);
        offset += header.byteLength + nameBytes.length + data.length;
    }
    const directorySize = central.reduce((sum, part) => sum + part.byteLength, 0);
    return new Blob([...parts, ...central, endRecord(entries.length, directorySize, offset)], { type: 'application/zip' });
}




/* Steam */

// SteamID64, profile links (/profiles/<id>, /id/<name>) or a plain custom URL name
function parseProfileInput(value) {
    const input = value.trim();
    const id = /(?:^|\/profiles\/)(\d{17})(?:\/|$)/.exec(input)?.[1];
    if (id) return { steamid: id };
    const vanity = /steamcommunity\.com\/id\/([\w-]{2,32})/.exec(input)?.[1] || /^[\w-]{2,32}$/.exec(input)?.[0];
    if (vanity) return { vanity };
    return null;
}

async function steamApi(path) {
    const res = await fetch(`/api/steam/${path}`);
    if (isProxyMissing(res)) throw new Error(PROXY_MISSING);
    if (res.status === 400) throw new Error('Invalid Steam profile.');
    if (res.status === 401 || res.status === 403) throw new Error('The Steam API key on the server is missing or invalid (see nginx/api.conf).');
    if (!res.ok) throw new Error('Steam could not be reached, please try again later.');
    return (await res.json()).response || {};
}

async function resolveSteamId(input) {
    const parsed = parseProfileInput(input);
    if (!parsed) throw new Error('Please enter a SteamID64, a profile link or your custom URL name.');
    if (parsed.steamid) return parsed.steamid;
    const result = await steamApi(`resolve?vanityurl=${encodeURIComponent(parsed.vanity)}`);
    if (result.success !== 1) throw new Error(`No Steam profile found for "${parsed.vanity}".`);
    return result.steamid;
}

async function loadSteamProfile(steamid) {
    const [owned, summary] = await Promise.all([
        steamApi(`owned-games?steamid=${steamid}`),
        steamApi(`summary?steamid=${steamid}`).catch(() => ({}))
    ]);
    if (!owned.games) {
        throw new Error('No games found. Make sure the game details of this profile are public (Privacy Settings → Game details).');
    }
    return { games: owned.games, player: summary.players?.[0] || null };
}




/* Page */

const state = {
    index: null,
    steamid: null,
    profileInput: null,
    games: [],
    selected: new Set(),
    types: new Set(TYPES.map(type => type.id)),
    filter: 'available',
    sort: 'name',
    query: ''
};

const indexPromise = loadIndex().then(index => {
    state.index = index;
    $('artwork-count').textContent = ST.formatNumber(index.games.size);
    if (index.release) $('artwork-version').textContent = index.release;
    return index;
});

function storage(key, value) {
    try {
        if (value === undefined) return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch {
        return null;
    }
}

function showError(message) {
    $('form-error').textContent = message;
    $('form-error').hidden = !message;
}

// Two "pages" on one url: the profile input and the library (?profile=...)
function showView(view) {
    $('start-view').hidden = view !== 'start';
    $('library-view').hidden = view !== 'library';
    document.getElementById('page-content').scrollTo({ top: 0 });
}

// Size of the selected artwork types of one game
function gameSize(appid) {
    const files = state.index.games.get(appid);
    if (!files) return -1;
    return TYPES.reduce((sum, type) => sum + (state.types.has(type.id) && files[type.id] ? files[type.id].compressedSize : 0), 0);
}

function selectedEntries() {
    const entries = [];
    for (const appid of state.selected) {
        const files = state.index.games.get(appid);
        for (const type of TYPES) {
            if (state.types.has(type.id) && files?.[type.id]) entries.push(files[type.id]);
        }
    }
    return entries;
}

function updateSummary() {
    const entries = selectedEntries();
    const size = entries.reduce((sum, entry) => sum + entry.compressedSize, 0);
    $('stat-selected').textContent = `${state.selected.size} games · ${ST.formatSize(size)}`;
    $('download-button').disabled = !entries.length;
    document.querySelectorAll('.game[data-appid]').forEach(card => {
        const selected = state.selected.has(Number(card.dataset.appid));
        card.classList.toggle('selected', selected);
        card.setAttribute('aria-pressed', selected);
    });
}

function updateSizes() {
    document.querySelectorAll('.game[data-appid]').forEach(card => {
        card.querySelector('.game-size').textContent = ST.formatSize(gameSize(Number(card.dataset.appid)));
    });
}

function sortGames() {
    const games = new Map(state.games.map(game => [game.appid, game]));
    const value = {
        name: card => 0,
        size: card => -gameSize(Number(card.dataset.id)),
        playtime: card => -(games.get(Number(card.dataset.id))?.playtime_forever || 0)
    }[state.sort];
    const cards = [...$('game-grid').children];
    cards.sort((a, b) => value(a) - value(b) || a.dataset.name.localeCompare(b.dataset.name));
    $('game-grid').append(...cards);
}

function applyFilter() {
    const query = state.query.toLowerCase();
    let visible = 0;
    document.querySelectorAll('.game').forEach(card => {
        const available = card.classList.contains('available');
        const matchesFilter = state.filter === 'all' || (state.filter === 'available') === available;
        const show = matchesFilter && card.dataset.name.includes(query);
        card.hidden = !show;
        if (show) visible++;
    });
    $('empty-message').hidden = visible > 0;
}

// Cards like the Steam library: cover image, check in the corner, size pill at the bottom
function renderGames() {
    $('game-grid').innerHTML = state.games.map(game => {
        const available = state.index.games.has(game.appid);
        const name = ST.escapeHtml(game.name || `App ${game.appid}`);
        const common = `data-id="${game.appid}" data-name="${name.toLowerCase()}" title="${name}"`;
        const cover = `
            <img src="${STEAM_CDN}/${game.appid}/library_600x900.jpg" alt="" loading="lazy" data-step="0">
            <span class="game-name">${name}</span>`;
        return available
            ? `<button class="game available" type="button" data-appid="${game.appid}" ${common} aria-pressed="false">
                    ${cover}
                    <span class="game-check" aria-hidden="true">${ST.icon('check')}</span>
                    <span class="game-size"></span>
               </button>`
            : `<div class="game missing" ${common}>
                    ${cover}
                    <a class="game-size game-request" href="${REQUEST_URL}${game.appid}">Request artwork</a>
               </div>`;
    }).join('');
    updateSizes();
    sortGames();
    applyFilter();
    updateSummary();
}

// Portrait capsule -> header image (with the name below) -> only the name
function handleImageError(e) {
    const img = e.target;
    const card = img.closest?.('.game');
    if (img.tagName !== 'IMG' || !card) return;
    if (img.dataset.step === '0') {
        img.dataset.step = '1';
        img.src = `${STEAM_CDN}/${card.dataset.id}/header.jpg`;
        card.classList.add('no-capsule');
    } else {
        img.remove();
        card.classList.add('no-image');
    }
}

function renderTypeToggles() {
    $('type-toggles').innerHTML = TYPES.map(type => `
        <label class="type-toggle">
            <input type="checkbox" value="${type.id}" checked>
            <span>${type.label}</span>
        </label>`).join('');
    $('type-toggles').addEventListener('change', e => {
        if (e.target.checked) state.types.add(e.target.value);
        else state.types.delete(e.target.value);
        updateSizes();
        if (state.sort === 'size') sortGames();
        updateSummary();
    });
}

function showProfile(steamid, player) {
    const accountId = (BigInt(steamid) - STEAM_ID_OFFSET).toString();
    $('profile').href = player?.profileurl || `https://steamcommunity.com/profiles/${steamid}`;
    $('profile-avatar').src = player?.avatarmedium || '/assets/favicon.svg';
    $('profile-name').textContent = player?.personaname || 'Steam profile';
    $('profile-id').textContent = steamid;
    $('grid-path').textContent = `Steam/userdata/${accountId}/config/grid`;
}

async function loadProfile(input, { push = true } = {}) {
    const button = $('steam-submit');
    showError('');
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
        const steamid = await resolveSteamId(input);
        const [{ games, player }] = await Promise.all([loadSteamProfile(steamid), indexPromise]);
        storage('artworks-profile', input.trim());

        state.steamid = steamid;
        state.profileInput = input.trim();
        state.games = games.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const available = state.games.filter(game => state.index.games.has(game.appid));
        state.selected = new Set(available.map(game => game.appid));

        showProfile(steamid, player);
        $('stat-owned').textContent = ST.formatNumber(state.games.length);
        $('stat-available').textContent = ST.formatNumber(available.length);
        const filter = $('filter');
        filter.options[0].textContent = `With artworks (${available.length})`;
        filter.options[1].textContent = `Without artworks (${state.games.length - available.length})`;
        filter.options[2].textContent = `All games (${state.games.length})`;
        renderGames();

        const url = `${location.pathname}?profile=${encodeURIComponent(state.profileInput)}`;
        if (push) history.pushState({ view: 'library' }, '', url);
        else history.replaceState({ view: 'library' }, '', url);
        showView('library');
    } catch (e) {
        console.error(e);
        showView('start');
        showError(e.message.startsWith('Range') || e.message.includes('zip')
            ? 'The artwork index could not be loaded, please try again later.'
            : e.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Load games';
    }
}

async function download() {
    const entries = selectedEntries();
    if (!entries.length) return;
    const button = $('download-button');
    button.disabled = true;
    $('progress').hidden = false;
    $('progress-label').textContent = `Downloading ${state.selected.size} artworks…`;

    try {
        const blob = await buildZip(entries, state.index, (loaded, total) => {
            $('progress-fill').style.width = `${(loaded / total) * 100}%`;
            $('progress-value').textContent = `${ST.formatSize(loaded)} / ${ST.formatSize(total)}`;
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'grid.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
        $('progress-label').textContent = 'Done! Extract grid.zip into your grid folder (see below).';
        $('progress-fill').style.width = '100%';
    } catch (e) {
        console.error(e);
        $('progress-label').textContent = e.message === PROXY_MISSING ? PROXY_MISSING : 'The download failed, please try again.';
    } finally {
        button.disabled = false;
    }
}

// Browser back/forward between the input and the library
function syncWithUrl() {
    const profile = new URLSearchParams(location.search).get('profile');
    if (!profile) return showView('start');
    $('steam-input').value = profile;
    if (state.steamid && state.profileInput === profile) showView('library');
    else loadProfile(profile, { push: false });
}

document.addEventListener('DOMContentLoaded', () => {
    ST.mountNavbar();
    renderTypeToggles();

    ST.fetchJson('/data/stats.json')
        .then(stats => {
            if ($('artwork-version').textContent === '–') {
                $('artwork-version').textContent = stats.themes?.['steam-custom-artworks']?.version || '–';
            }
        })
        .catch(() => {});
    indexPromise.catch(e => {
        console.error(e);
        showError(e.message === PROXY_MISSING ? PROXY_MISSING : 'The artwork index could not be loaded, please try again later.');
    });

    const saved = storage('artworks-profile');
    if (saved) $('steam-input').value = saved;
    syncWithUrl();
    window.addEventListener('popstate', syncWithUrl);

    $('steam-form').addEventListener('submit', e => {
        e.preventDefault();
        loadProfile($('steam-input').value);
    });
    $('change-profile').addEventListener('click', () => {
        if (history.state?.view === 'library' && history.length > 1) history.back();
        else {
            history.pushState(null, '', location.pathname);
            showView('start');
        }
    });

    $('game-grid').addEventListener('click', e => {
        const card = e.target.closest('.game.available');
        if (!card) return;
        const appid = Number(card.dataset.appid);
        if (state.selected.has(appid)) state.selected.delete(appid);
        else state.selected.add(appid);
        updateSummary();
    });
    $('game-grid').addEventListener('error', handleImageError, true);

    $('filter').addEventListener('change', e => {
        state.filter = e.target.value;
        applyFilter();
    });
    $('sort').addEventListener('change', e => {
        state.sort = e.target.value;
        sortGames();
    });
    $('search').addEventListener('input', e => {
        state.query = e.target.value.trim();
        applyFilter();
    });

    // Select all/none only affects the games that are currently visible
    function setVisibleSelection(selected) {
        document.querySelectorAll('.game.available:not([hidden])').forEach(card => {
            const appid = Number(card.dataset.appid);
            if (selected) state.selected.add(appid);
            else state.selected.delete(appid);
        });
        updateSummary();
    }
    $('select-all').addEventListener('click', () => setVisibleSelection(true));
    $('select-none').addEventListener('click', () => setVisibleSelection(false));

    $('download-button').addEventListener('click', download);
    $('copy-path').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('grid-path').textContent);
        } catch {
            // Clipboard is not available (e.g. http), the path is still selectable
        }
    });
});
