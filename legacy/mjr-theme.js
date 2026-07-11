/*
 * MJR cross-device theme sync (teacher-panel)
 *
 * Each page already applies the dashboard theme from
 * localStorage['dashboard_theme'] (a no-flash <head> snippet) and toggles it
 * via that page's own toggleTheme(), which flips <html data-theme> and the
 * sidebar button. That is PER-DEVICE only.
 *
 * This shared script makes the choice follow the teacher to any device / login
 * by mirroring it to their profiles row (profiles.theme, keyed by
 * id = user_id):
 *
 *   - PULL on load : read profiles.theme and, if it differs from what is
 *                    applied, apply it (data-theme + localStorage + the
 *                    sidebar button label).
 *   - PUSH on change: a MutationObserver watches <html data-theme>; when the
 *                    teacher toggles, it debounces and writes profiles.theme.
 *
 * It never breaks the existing behaviour: if the 'theme' column does not exist
 * yet, or the network is down, every Supabase call fails silently and the page
 * keeps working exactly as before (local-only theme).
 */
(function () {
    var THEME_KEY = 'dashboard_theme';
    var applying = false;   // true while WE apply a pulled value, so the
                            // observer does not echo it straight back to the DB
    var pushTimer = null;
    var lastKnown = null;   // last value read-from / written-to the server

    function getSupabase() {
        if (typeof window.supabaseClient !== 'undefined' && window.supabaseClient) {
            return window.supabaseClient;
        }
        try {
            if (typeof supabaseClient !== 'undefined' && supabaseClient) return supabaseClient;
        } catch (e) {}
        return null;
    }

    function getUserId() {
        try { return localStorage.getItem('user_id'); } catch (e) { return null; }
    }

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    // Keep the sidebar toggle's icon + label consistent with each page's own
    // toggleTheme(): dark -> sun icon + "Light Mode", light -> moon + "Dark Mode".
    function syncToggleButton(theme) {
        var icon = document.getElementById('themeIcon');
        var text = document.getElementById('themeText');
        var isDark = theme === 'dark';
        if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
    }

    // Apply a theme the same way the pages do, but guarded so our own change is
    // not mistaken for a user toggle by the observer.
    function applyTheme(theme) {
        applying = true;
        try {
            var root = document.documentElement;
            if (theme === 'dark') root.setAttribute('data-theme', 'dark');
            else root.removeAttribute('data-theme');
            try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
            syncToggleButton(theme);
        } finally {
            // Observer callbacks are microtasks; this macrotask releases the
            // guard only after they have run, so the pulled value never echoes.
            setTimeout(function () { applying = false; }, 0);
        }
    }

    function pushTheme(theme) {
        var sb = getSupabase();
        var userId = getUserId();
        if (!sb || !userId) return;
        if (theme === lastKnown) return;   // nothing changed since last sync
        lastKnown = theme;
        try {
            var q = sb.from('profiles').update({ theme: theme }).eq('id', userId);
            if (q && typeof q.then === 'function') {
                q.then(function () {}, function () {});   // swallow (e.g. missing column)
            }
        } catch (e) {}
    }

    function schedulePush() {
        if (applying) return;              // our own apply, not a user toggle
        var theme = currentTheme();
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(function () { pushTheme(theme); }, 400);
    }

    function pull() {
        var sb = getSupabase();
        var userId = getUserId();
        if (!sb || !userId) return;
        try {
            var q = sb.from('profiles').select('theme').eq('id', userId).maybeSingle();
            if (!q || typeof q.then !== 'function') return;
            q.then(function (res) {
                if (!res || res.error || !res.data) return;
                var t = res.data.theme;
                if (t !== 'dark' && t !== 'light') return;   // no server preference yet
                lastKnown = t;                                // don't echo it back
                if (t !== currentTheme()) {
                    applyTheme(t);
                } else {
                    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
                }
            }, function () {});
        } catch (e) {}
    }

    function observe() {
        if (typeof MutationObserver !== 'function') return;
        var obs = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                if (muts[i].attributeName === 'data-theme') { schedulePush(); break; }
            }
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // supabaseClient is created by each page's own inline script, which may run
    // a moment after this deferred file. Wait briefly for it before pulling.
    function whenReady(cb, tries) {
        if ((getSupabase() && getUserId()) || tries <= 0) { cb(); return; }
        setTimeout(function () { whenReady(cb, tries - 1); }, 150);
    }

    function init() {
        observe();                          // catch toggles even if the DB is unreachable
        whenReady(pull, 20);                // ~3s grace for supabaseClient to appear
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
