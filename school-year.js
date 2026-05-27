/*
 * MJR school year badge
 *
 * Displays the teacher's current school year inside the sidebar
 * (`#userSchoolYear`) on every page. Reads the value from the most
 * recent section the teacher owns, falls back to a localStorage
 * cache so the label appears instantly on subsequent navigations
 * without flashing empty.
 */
(function () {
    const CACHE_KEY = 'current_school_year';

    function render(value) {
        const el = document.getElementById('userSchoolYear');
        if (!el) return;
        if (value) {
            el.textContent = 'SY ' + value;
            el.style.visibility = 'visible';
        } else {
            el.textContent = '';
            el.style.visibility = 'hidden';
        }
    }

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
                const sy = data[0].school_year;
                if (localStorage.getItem(CACHE_KEY) !== sy) {
                    localStorage.setItem(CACHE_KEY, sy);
                }
                render(sy);
            }
        } catch (err) {
            /* silent — keep showing the cached value */
        }
    }

    render(localStorage.getItem(CACHE_KEY) || '');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refresh);
    } else {
        refresh();
    }
})();
