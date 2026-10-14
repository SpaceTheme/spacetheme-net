document.addEventListener('DOMContentLoaded', () => {
    const track = document.getElementById('sections');
    const sections = Array.from(track.querySelectorAll('.section'));
    const navigator = document.getElementById('navigator');
    const SCROLL_LOCK = 800; // ms, a bit longer than the slide transition
    let current = 0;
    let locked = false;

    const dots = sections.map((section, i) => {
        const dot = document.createElement('button');
        dot.setAttribute('aria-label', section.querySelector('h1')?.textContent.trim() || 'Home');
        dot.addEventListener('click', () => goTo(i));
        navigator.appendChild(dot);
        return dot;
    });

    // Only the content slides, the background video stays in place
    function goTo(index, animate = true) {
        index = Math.max(0, Math.min(sections.length - 1, index));
        if (index === current && animate) return;
        current = index;

        track.style.transition = animate ? '' : 'none';
        track.style.transform = `translateX(-${index * 100}%)`;
        if (!animate) {
            void track.offsetWidth; // apply the position before the transition comes back
            track.style.transition = '';
        }
        dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
        sections.forEach((section, i) => section.inert = i !== index);
        history.replaceState(null, '', index ? `#${sections[index].id}` : location.pathname);

        if (animate) {
            locked = true;
            setTimeout(() => locked = false, SCROLL_LOCK);
        }
    }

    // A section (or the supporter list) with its own scrollbar scrolls first
    function canScroll(target, deltaY) {
        for (let el = target; el && el !== track; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (!/(auto|scroll)/.test(style.overflowY) || el.scrollHeight <= el.clientHeight) continue;
            if (deltaY > 0 && Math.ceil(el.scrollTop + el.clientHeight) < el.scrollHeight) return true;
            if (deltaY < 0 && el.scrollTop > 0) return true;
        }
        return false;
    }

    track.addEventListener('wheel', e => {
        const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (canScroll(e.target, e.deltaY) && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
        e.preventDefault();
        if (locked || Math.abs(delta) < 4) return;
        goTo(current + (delta > 0 ? 1 : -1));
    }, { passive: false });

    let touchStart = null;
    track.addEventListener('touchstart', e => {
        if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    track.addEventListener('touchend', e => {
        if (!touchStart || locked) return;
        const dx = e.changedTouches[0].clientX - touchStart.x;
        const dy = e.changedTouches[0].clientY - touchStart.y;
        touchStart = null;
        // Horizontal swipes only, vertical swipes scroll inside the section
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) goTo(current + (dx < 0 ? 1 : -1));
    });

    document.addEventListener('keydown', e => {
        if (locked || e.target.closest('input, textarea')) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(current + 1);
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(current - 1);
    });

    // Older browsers without overflow: clip scroll the container on #hash links
    const pageContent = document.getElementById('page-content');
    pageContent.addEventListener('scroll', () => pageContent.scrollLeft = pageContent.scrollTop = 0);

    const fromHash = sections.findIndex(section => `#${section.id}` === location.hash);
    current = -1;
    goTo(Math.max(fromHash, 0), false);

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.querySelector('.page-background')?.pause();
    }




    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
    }

    // One row like in the friends list of the SteamTheme, the newest supporter is highlighted
    function renderUser(user, index, users) {
        const name = escapeHtml(user.name);
        const latest = index === users.length - 1;
        return `
            <div class="user${latest ? ' latest' : ''}" title="${name}">
                <img src="${escapeHtml(user.image)}" alt="" loading="lazy">
                <div class="user-text">
                    <span class="name">${name}</span>
                    <span class="user-meta">${latest ? 'Newest supporter' : `Supporter #${index + 1}`}</span>
                </div>
            </div>`;
    }

    // The list keeps the order of supporter.json, the Ko-fi workflow appends new supporters at the end
    fetch('data/supporter.json', { cache: 'no-cache' })
        .then(response => response.json())
        .then(data => {
            const users = data.users;
            document.getElementById('supporter-list').innerHTML = users.map(renderUser).join('');
            document.getElementById('supporter-count').textContent = users.length;
            document.getElementById('wall-count').textContent = users.length;
            document.getElementById('supporter-group').hidden = !users.length;

            const latest = users[users.length - 1];
            if (latest) {
                document.getElementById('latest-avatar').src = latest.image;
                document.getElementById('latest-name').textContent = latest.name;
                document.getElementById('latest-supporter').hidden = false;
            }
        });

    // <b data-stat="total_downloads">, data-stat="themes.installer.version", ... (numbers get formatted)
    Promise.all([
        fetch('data/stats.json', { cache: 'no-cache' }).then(response => response.json()),
        fetch('data/themes.json', { cache: 'no-cache' }).then(response => response.json()).catch(() => [])
    ]).then(([data, themes]) => {
        data.theme_count = themes.filter(theme => !theme.hidden).length || null;
        document.querySelectorAll('[data-stat]').forEach(el => {
            const value = el.dataset.stat.split('.').reduce((obj, key) => obj?.[key], data);
            const num = typeof value === 'number' ? value : Number.NaN;
            el.textContent = Number.isFinite(num) ? num.toLocaleString('en-US') : value || '–';
        });
    });
});
