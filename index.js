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
    fetch('src/supporter.json')
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

    // Download-Counter abfragen und anzeigen
    fetch('https://steambrew.app/api/v2/extern/download_count/zQndv1rI0FXLh3QTRgOL')
        .then(response => response.json())
        .then(data => {
            console.log('API Response:', data);
            const counter = document.getElementById('download-counter');
            if (data && typeof data.download_count !== 'undefined') {
                counter.innerHTML = `<br><br>${data.download_count} downloads`;
            } else {
                counter.innerHTML = 'No downloads';
            }
        })
        .catch(err => {
            console.error('API Error:', err);
            document.getElementById('download-counter').innerHTML = '<br><br>Error';
        });
});