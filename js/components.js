// Shared helpers for all subpages: component loading, templating, formatting and icons.
// Templates in /components use {{key}} (escaped) and {{{key}}} (raw HTML).

const ST = (() => {
    const componentCache = new Map();
    const FALLBACK_IMAGE = '/assets/themes.webp';

    const iconPaths = {
        download: '<path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/>',
        star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
        tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
        fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7m-6 4v6"/>',
        issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6m6 0h6"/>',
        book: '<path d="M4 4h5a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zm16 0h-5a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h6z"/>',
        license: '<path d="M12 3v18M5 21h14M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zm14 0-3 7a3 3 0 0 0 6 0z"/>',
        status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        back: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
        external: '<path d="M14 4h6v6m0-6-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
        file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
        image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
        check: '<path d="m5 12 5 5 9-10"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        chevronLeft: '<path d="m15 6-6 6 6 6"/>',
        chevronRight: '<path d="m9 6 6 6-6 6"/>',
        flag: '<path d="M5 21V4m0 0h12l-2.5 4.5L17 13H5"/>',
        plugin: '<path d="M9 2v6m6-6v6M6 8h12v4a6 6 0 0 1-12 0zm6 10v4"/>',
        heart: '<path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z"/>',
        artworks: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'
    };

    function icon(name) {
        if (name === 'github') {
            return '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.01 8.01 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A8 8 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
        }
        return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function fill(template, data) {
        return template.replace(/\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g, (_, raw, escaped) =>
            raw ? (data[raw] ?? '') : escapeHtml(data[escaped] ?? ''));
    }

    function loadComponent(name) {
        if (!componentCache.has(name)) {
            componentCache.set(name, fetch(`/components/${name}.html`).then(res => {
                if (!res.ok) throw new Error(`Component ${name}: ${res.status}`);
                return res.text();
            }));
        }
        return componentCache.get(name);
    }

    async function render(name, data = {}) {
        return fill(await loadComponent(name), data);
    }

    // no-cache = revalidate with nginx ETag, so new workflow data shows up immediately
    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json();
    }

    async function mountNavbar() {
        const placeholder = document.querySelector('[data-component="navbar"]');
        if (!placeholder) return;
        placeholder.outerHTML = await render('navbar', { year: new Date().getFullYear() });

        const path = location.pathname.replace(/index\.html$/, '');
        document.querySelectorAll('#navbar .nav-pages a').forEach(link => {
            const linkPath = new URL(link.href).pathname;
            const active = link.origin === location.origin && (linkPath === '/' ? path === '/' : path.startsWith(linkPath));
            link.classList.toggle('active', active);
        });
    }

    function formatNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num.toLocaleString('en-US') : '0';
    }

    function formatDate(value) {
        if (!value) return '–';
        return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function timeAgo(value) {
        if (!value) return '–';
        const seconds = (new Date(value) - Date.now()) / 1000;
        const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
        const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        for (const [unit, size] of units) {
            if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
        }
        return 'just now';
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
    }

    // Images from GitHub can disappear, fall back to the generic themes image
    // data-fallback-src (e.g. the readme preview) first, then the generic themes image
    function applyImageFallbacks(root) {
        root.querySelectorAll('img[data-fallback]').forEach(img => {
            const useFallback = () => {
                const next = img.dataset.fallbackSrc;
                if (next && !img.src.endsWith(next)) {
                    delete img.dataset.fallbackSrc;
                    img.src = next;
                    return;
                }
                if (img.src.endsWith(FALLBACK_IMAGE)) return;
                img.src = FALLBACK_IMAGE;
                img.classList.add('is-fallback');
            };
            if (img.complete && img.naturalWidth === 0) useFallback();
            img.addEventListener('error', useFallback);
        });
    }

    // "SteamTheme" -> Steam + Theme, "Steam Custom Artworks" -> Steam Custom + Artworks
    function splitTitle(name) {
        const split = /theme$/i.test(name) && name.length > 5 ? name.length - 5 : name.lastIndexOf(' ') + 1;
        return { titleLight: name.slice(0, split), titleBold: name.slice(split) };
    }

    function previewImage(src, alt, fallbackSrc) {
        const fallback = fallbackSrc && fallbackSrc !== src ? ` data-fallback-src="${escapeHtml(fallbackSrc)}"` : '';
        return `<img src="${escapeHtml(src || FALLBACK_IMAGE)}" alt="${escapeHtml(alt)}" loading="lazy" data-fallback${fallback}>`;
    }

    // Value with icon; the label is shown below the value on the featured card (library style)
    function metaItem(iconName, label, value) {
        return `<span class="meta-item" title="${escapeHtml(label)}">${icon(iconName)}<span><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></span></span>`;
    }

    // Everything the card and the details view need, built from themes.json + stats.json
    function themeView(theme, stat = {}) {
        const badges = [];
        if (theme.featured) badges.push('<span class="badge status-featured">Featured</span>');
        if (theme.status) {
            badges.push(`<span class="badge status-${escapeHtml(theme.status.toLowerCase())}">${escapeHtml(theme.status)}</span>`);
        }
        // GitHub social preview (repo settings) first, the readme preview only as fallback
        const image = theme.image || stat.socialImage || stat.image || FALLBACK_IMAGE;
        const version = stat.version || '–';
        const downloads = formatNumber(stat.downloads || 0);
        const stars = formatNumber(stat.stars || 0);

        return {
            id: theme.id,
            href: `/themes/?id=${encodeURIComponent(theme.id)}`,
            name: theme.name,
            ...splitTitle(theme.name),
            // Repo description from GitHub, themes.json as fallback
            description: stat.description || theme.description || '',
            image,
            preview: previewImage(image, `${theme.name} preview`, stat.image),
            repo: theme.repo || '#',
            download: theme.download || theme.repo || '#',
            version,
            downloads,
            stars,
            badges: badges.join(''),
            tags: (theme.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(''),
            classes: theme.featured ? 'featured' : '',
            meta: [
                metaItem('tag', 'Version', version),
                metaItem('download', 'Downloads', downloads),
                metaItem('star', 'Stars', stars),
                stat.styles ? metaItem('globe', 'Websites', `${stat.styles} ${stat.styles === 1 ? 'website' : 'websites'}`) : ''
            ].join(''),
            iconBack: icon('back'),
            iconArrow: icon('chevronRight')
        };
    }

    return {
        icon, escapeHtml, fill, render, fetchJson, mountNavbar, applyImageFallbacks, themeView,
        splitTitle, previewImage, metaItem, FALLBACK_IMAGE,
        formatNumber, formatDate, timeAgo, formatSize
    };
})();
