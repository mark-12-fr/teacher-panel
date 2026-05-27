/*
 * MJR client-side protection
 *
 * - Blocks the right-click context menu, F12, Ctrl+Shift+I/J/C, Ctrl+U,
 *   and Ctrl+S so casual users can't open DevTools or view source.
 * - Appends a daily-rotating hash token to the URL so links look
 *   different every day. The pathname (and .html extension) stay
 *   intact, so refresh, back, and direct navigation keep working.
 */
(function () {
    /* === 1. Block context menu and devtools shortcuts ===================== */
    function block(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        return false;
    }

    document.addEventListener('contextmenu', block, { capture: true });

    document.addEventListener('keydown', function (e) {
        const key = (e.key || '').toLowerCase();
        if (e.keyCode === 123 || key === 'f12') return block(e);
        if ((e.ctrlKey || e.metaKey) && key === 'u') return block(e);
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
            return block(e);
        }
        if ((e.ctrlKey || e.metaKey) && key === 's') return block(e);
    }, { capture: true });

    /* === 2. Append a daily-rotating hash token =========================== */
    try {
        const path = (window.location.pathname || '').toLowerCase();
        const skip = /(^|\/)(login|sign)\.html?$/.test(path) || path === '/' || path.endsWith('/login') || path.endsWith('/sign');

        if (!skip && window.history && typeof window.history.replaceState === 'function') {
            const seed = new Date().toISOString().slice(0, 10) + '|' + path;
            let h = 2166136261;
            for (let i = 0; i < seed.length; i++) {
                h ^= seed.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            const a = (h >>> 0).toString(36);
            const b = ((h ^ 0xdeadbeef) >>> 0).toString(36);
            const token = (a + b).slice(0, 12);
            window.history.replaceState({}, '', window.location.pathname + window.location.search + '#' + token);
        }
    } catch (e) {
        /* never let URL masking break the page */
    }
})();
