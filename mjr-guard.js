/*
 * MJR client-side protection
 *
 * - Blocks the right-click context menu, F12, Ctrl+Shift+I/J/C, and Ctrl+U
 *   so casual users can't open DevTools or view source from the page.
 * - Masks the actual filename in the address bar by replacing the path
 *   with a deterministic, daily-rotating token. The real HTML file
 *   stays loaded; navigation between pages still uses the original
 *   .html links, so refresh on a masked URL falls back to the Vercel
 *   rewrite (configured in vercel.json).
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
        // F12
        if (e.keyCode === 123 || key === 'f12') return block(e);
        // Ctrl+U → view-source
        if ((e.ctrlKey || e.metaKey) && key === 'u') return block(e);
        // Ctrl+Shift+I/J/C → devtools panels
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
            return block(e);
        }
        // Ctrl+S → save page
        if ((e.ctrlKey || e.metaKey) && key === 's') return block(e);
    }, { capture: true });

    /* === 2. Mask the URL with a daily-rotating random hash ==============
       We append a hash token rather than replacing the path so:
         * the browser back button still works,
         * refresh still resolves the real HTML file, and
         * vercel.json's cleanUrls strips the .html so the visible URL
           ends up looking like  /section#a8f4k9p3m21
    ===================================================================== */
    try {
        const path = (window.location.pathname || '').toLowerCase();
        const skip = /(^|\/)(login|sign)\.html?$/.test(path) || path === '/' || path.endsWith('/login') || path.endsWith('/sign');

        if (!skip && window.history && typeof window.history.replaceState === 'function') {
            const seed = new Date().toISOString().slice(0, 10) + '|' + path;
            let h = 2166136261;
            for (let i = 0; i < seed.length; i++) {
                h ^= seed.charCodeAt(i);
                h = (h * 16777619) >>> 0;
            }
            const token = (h.toString(36) + Math.abs(h ^ 0xdeadbeef).toString(36)).slice(0, 12);
            const cleanPath = path.replace(/\.html?$/i, '');
            window.history.replaceState({}, '', cleanPath + window.location.search + '#' + token);
        }
    } catch (e) {
        /* never let URL masking break the page */
    }
})();
