// Error pages (components/errors/*.html) - no inline scripts, so the Content-Security-Policy can forbid them
document.getElementById('year').textContent = new Date().getFullYear();

document.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.assign('/');
});
document.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
