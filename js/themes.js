// /themes/          -> overview of all themes
// /themes/?id=steam -> details of one theme (see details.js)
// /themes/?id=userstyles&style=sc-wiki-api -> page of one sub style (one website of the userstyles)
// Query parameters instead of /themes/steam so nginx needs no rewrite rules.

async function renderOverview(root, themes, stats) {
    const visible = themes.filter(theme => !theme.hidden);
    const renderCards = list => Promise.all(list.map(theme => ST.render('themesCard', ST.themeView(theme, stats.themes?.[theme.id]))));
    const featured = await renderCards(visible.filter(theme => theme.featured));
    const others = await renderCards(visible.filter(theme => !theme.featured));

    root.innerHTML = `
        <div class="page">
            <header class="themes-header">
                <h1>Themes</h1>
                <p class="section-desciption">Themes with a dark, modular design for the apps you use every day. Each theme has its own page with previews, changes and installation instructions.</p>
                <div class="summary">
                    <span class="pill"><b>${ST.formatNumber(stats.total_downloads)}</b> Downloads</span>
                    <span class="pill"><b>${ST.formatNumber(stats.total_stars)}</b> Stars</span>
                    <span class="pill"><b>${visible.length}</b> Themes</span>
                </div>
            </header>
            ${featured.length ? `
                <h2 class="section-label">Featured</h2>
                <div class="theme-grid">${featured.join('')}</div>` : ''}
            <h2 class="section-label">All Themes <span class="count">(${others.length})</span></h2>
            <div class="theme-grid">${others.join('')}</div>
            ${stats.updated ? `<p class="data-updated">Data updated ${ST.timeAgo(stats.updated)}</p>` : ''}
        </div>`;
}

function renderMessage(root, title, text) {
    root.innerHTML = `
        <div class="page message">
            <h1>${ST.escapeHtml(title)}</h1>
            <p class="section-desciption">${ST.escapeHtml(text)}</p>
            <a class="btn" href="/themes/">${ST.icon('back')}<span>All Themes</span></a>
        </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('page-content');
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const styleId = params.get('style');

    ST.mountNavbar();

    try {
        const [themes, stats] = await Promise.all([
            ST.fetchJson('/data/themes.json'),
            ST.fetchJson('/data/stats.json').catch(() => ({ themes: {} }))
        ]);

        if (id) {
            const theme = themes.find(t => t.id === id);
            if (!theme) return renderMessage(root, 'Theme not found', `There is no theme with the id "${id}".`);
            if (styleId) await renderStylePage(root, theme, styleId, stats);
            else await renderDetails(root, theme, themes, stats);
        } else {
            await renderOverview(root, themes, stats);
        }
        ST.applyImageFallbacks(root);
    } catch (e) {
        console.error(e);
        renderMessage(root, 'Something went wrong', 'The theme data could not be loaded. Please try again later.');
    }
});
