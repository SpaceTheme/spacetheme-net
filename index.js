document.addEventListener('DOMContentLoaded', () => {
    const pageContent = document.getElementById('page-content');
    const sections = Array.from(document.querySelectorAll('.section'));
    const navigatorPages = Array.from(document.querySelectorAll('.navigator-page'));
    const navLinks = Array.from(document.querySelectorAll('.nav-pages a'));
    let targetIndex = 0;
    let scrollBlocked = false;

    // Passt die Breite jeder Section an die Breite von #page-content an
    function resizeSections() {
        const width = pageContent.offsetWidth;
        sections.forEach(section => {
            section.style.minWidth = width + 'px';
            section.style.width = width + 'px';
        });
    }
    window.addEventListener('resize', resizeSections);
    resizeSections();

    function scrollToSection(index) {
        pageContent.scrollTo({
            left: index * pageContent.offsetWidth,
            behavior: 'smooth'
        });
        setActiveNavigator(index);
    }

    function setActiveNavigator(index) {
        navigatorPages.forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
    }

    pageContent.addEventListener('wheel', function(e) {
        if (scrollBlocked) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();

            const sectionWidth = pageContent.offsetWidth;
            const scrollLeft = pageContent.scrollLeft;
            const currentIndex = Math.round(scrollLeft / sectionWidth);

            let nextIndex = currentIndex;
            if (e.deltaY > 0 && currentIndex < sections.length - 1) {
                nextIndex++;
            } else if (e.deltaY < 0 && currentIndex > 0) {
                nextIndex--;
            }

            if (nextIndex !== currentIndex) {
                targetIndex = nextIndex;
                scrollToSection(targetIndex);
                scrollBlocked = true;
                setTimeout(() => {
                    scrollBlocked = false;
                }, 700); // Timeout in ms
            }
        }
    }, { passive: false });

    // Initial aktiv setzen
    setActiveNavigator(0);

    // Bei manuellem Scrollen die aktive Seite nur aktualisieren, wenn nicht blockiert
    pageContent.addEventListener('scroll', function() {
        if (scrollBlocked) return;
        const sectionWidth = pageContent.offsetWidth;
        const scrollLeft = pageContent.scrollLeft;
        const currentIndex = Math.round(scrollLeft / sectionWidth);
        setActiveNavigator(currentIndex);
    });

    // Klick auf Navigator-Page
    navigatorPages.forEach((el, i) => {
        el.addEventListener('click', () => {
            if (scrollBlocked) return;
            targetIndex = i;
            scrollToSection(targetIndex);
            scrollBlocked = true;
            setTimeout(() => {
                scrollBlocked = false;
            }, 700);
        });
    });

    // Supporter laden und anzeigen
    fetch('assets/data/supporter.json')
        .then(response => response.json())
        .then(data => {
            const supporterList = document.getElementById('supporter-list');
            data.users.forEach(user => {
                const userDiv = document.createElement('div');
                userDiv.className = 'user' + (user.member ? ' member' : '');
                userDiv.innerHTML = `
                    <img src="${user.image}" alt="${user.name}">
                    <span class="name">${user.name}</span>
                `;
                supporterList.appendChild(userDiv);
            });
        });

    // Downloads aus JSON holen und Platzhalter im HTML ersetzen
    fetch('assets/data/downloads.json')
        .then(response => response.json())
        .then(data => {
            const values = {};
            data.themes.forEach(theme => {
                const val = parseInt(theme.value) || 0;
                values[theme.name] = val;
            });

            // Platzhalter-Map vorbereiten
            const replacements = {
                '${downloads}': data.total_downloads || '0'
            };
            Object.keys(values).forEach(name => {
                replacements[`$\{downloads_${name}\}`] = values[name].toString();
            });

            // Alle Textknoten im Body ersetzen
            function replaceTextNodes(node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    let txt = node.textContent;
                    Object.entries(replacements).forEach(([key, value]) => {
                        txt = txt.replaceAll(key, value);
                    });
                    node.textContent = txt;
                } else {
                    node.childNodes.forEach(replaceTextNodes);
                }
            }
            replaceTextNodes(document.body);
        });

    let touchStartX = null;
    pageContent.addEventListener('touchstart', function(e) {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
        }
    });

    pageContent.addEventListener('touchend', function(e) {
        if (touchStartX === null || scrollBlocked) return;
        const touchEndX = e.changedTouches[0].clientX;
        const deltaX = touchEndX - touchStartX;
        const sectionWidth = pageContent.offsetWidth;
        const scrollLeft = pageContent.scrollLeft;
        const currentIndex = Math.round(scrollLeft / sectionWidth);

        let nextIndex = currentIndex;
        if (deltaX < -50 && currentIndex < sections.length - 1) {
            nextIndex++;
        } else if (deltaX > 50 && currentIndex > 0) {
            nextIndex--;
        }

        if (nextIndex !== currentIndex) {
            targetIndex = nextIndex;
            scrollToSection(targetIndex);
            scrollBlocked = true;
            setTimeout(() => {
                scrollBlocked = false;
            }, 700);
        }
        touchStartX = null;
    });
});