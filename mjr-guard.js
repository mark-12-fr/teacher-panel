/*
 * MJR client-side protection
 *
 * - Blocks the right-click context menu, F12, Ctrl+Shift+I/J/C, Ctrl+U,
 *   and Ctrl+S so casual users can't open DevTools or view source.
 * - Masks the address bar by replacing the entire path with a
 *   deterministic, daily-rotating token. The mapping is also stashed in
 *   localStorage so loader.html can resolve refreshes/back-navigation
 *   even across timezone boundaries.
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

    /* === 2. Mask the URL with a daily-rotating random path =============== */
    function tokenFor(date, page) {
        const seed = date + '|' + page;
        let h = 2166136261;
        for (let i = 0; i < seed.length; i++) {
            h ^= seed.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        const a = (h >>> 0).toString(36);
        const b = ((h ^ 0xdeadbeef) >>> 0).toString(36);
        return (a + b).slice(0, 12);
    }

    function rememberMapping(token, page) {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const raw = localStorage.getItem('mjr_url_map');
            const map = raw ? JSON.parse(raw) : {};
            // Drop entries that aren't from today so localStorage stays small.
            for (const k of Object.keys(map)) {
                if (!map[k] || map[k].date !== today) delete map[k];
            }
            map[token] = { page: page, date: today };
            localStorage.setItem('mjr_url_map', JSON.stringify(map));
        } catch (e) { /* ignore quota / parse errors */ }
    }

    try {
        const path = (window.location.pathname || '').toLowerCase();
        const fileMatch = path.match(/\/([^/]+)\.html?$/);
        const pageName = fileMatch ? fileMatch[1] : null;

        const SKIP = ['login', 'sign', 'loader'];
        if (pageName && SKIP.indexOf(pageName) === -1 && window.history && typeof window.history.replaceState === 'function') {
            const today = new Date().toISOString().slice(0, 10);
            const token = tokenFor(today, pageName);
            rememberMapping(token, pageName);
            window.history.replaceState({}, '', '/' + token + window.location.search);
        }
    } catch (e) {
        /* never let URL masking break the page */
    }
})();
