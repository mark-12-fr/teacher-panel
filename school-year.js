/*
 * MJR school year badge
 *
 * Renders the teacher's current school year inside the sidebar
 * (`#userSchoolYear`) on every page. Reads from a localStorage
 * cache first so the badge appears instantly with zero flash on
 * page navigation, then refreshes from Supabase in the background.
 *
 * Any page that loads section data may call
 * `window.MJR_setSchoolYear(value)` to keep the cache fresh even
 * when the Supabase round-trip hasn't finished yet.
 */
(function () {
    const CACHE_KEY = 'current_school_year';

    function applyVisible(el) {
        el.style.visibility = 'visible';
        el.style.opacity = '1';
        el.style.display = 'inline-block';
    }

    function render(value) {
        const el = document.getElementById('userSchoolYear');
        if (!el) return;
        const sy = (value || '').toString().trim();
        if (sy) {
            el.textContent = 'SY ' + sy;
            applyVisible(el);
        }
    }

    function setCache(value) {
        const sy = (value || '').toString().trim();
        if (!sy) return;
        if (localStorage.getItem(CACHE_KEY) !== sy) {
            localStorage.setItem(CACHE_KEY, sy);
        }
        render(sy);
    }

    window.MJR_setSchoolYear = setCache;

    function getSupabase() {
        if (typeof window.supabaseClient !== 'undefined' && window.supabaseClient) {
            return window.supabaseClient;
        }
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            return supabaseClient;
        }
        return null;
    }

    function getTeacherId() {
        const raw = localStorage.getItem('user_id');
        if (!raw) return null;
        return raw.replace(/['"]+/g, '').trim();
    }

    async function refresh() {
        try {
            const sb = getSupabase();
            const teacherId = getTeacherId();
            if (!sb || !teacherId) return;

            const { data } = await sb.from('sections')
                .select('school_year, created_at')
                .eq('teacher_id', teacherId)
                .not('school_year', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1);

            if (data && data.length > 0 && data[0].school_year) {
                setCache(data[0].school_year);
            }
        } catch (err) {
            /* silent — keep showing the cached value */
        }
    }

    function init() {
        render(localStorage.getItem(CACHE_KEY) || '');
        refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
