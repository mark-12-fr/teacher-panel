// Head-script that starts the dashboard's two API requests BEFORE the app's JS
// has even downloaded.
//
// Why: on a cold open the browser does JS download → parse → hydrate → React
// effect → THEN asks the API for data, so the network round-trips (connection
// setup, CORS preflight, the request itself) all sit AFTER hydration on the
// critical path. Kicking the requests off from an inline <script> in the HTML
// head overlaps them with the JS download, so by the time the dashboard mounts
// the data is usually already there (see `fetchStats` in dashboard/page.tsx,
// which consumes `window.__earlyDash`).
//
// Safe by construction: it only runs on /dashboard, only with a still-valid
// session already in localStorage, sends exactly what api() would (GET + Bearer
// token), and every failure resolves to `null` so the page transparently falls
// back to its normal request path (retries, 401 → /login handling and all).
//
// This is a plain string builder (no "use client"): it runs on the server at
// build time and the result is inlined into the document.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://njzvuwkepaasnsvuujgx.supabase.co";

// supabase-js persists the session under `sb-<project-ref>-auth-token`.
function sessionStorageKey(): string {
  try {
    return `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "";
  }
}

export function buildEarlyDashboardFetch(apiBase: string): string {
  const key = sessionStorageKey();
  if (!key || !apiBase) return "";
  return (
    "(function(){try{" +
    'if(location.pathname!=="/dashboard")return;' +
    `var raw=localStorage.getItem(${JSON.stringify(key)});if(!raw)return;` +
    "var s=JSON.parse(raw);" +
    // Skip when the token is (nearly) expired: supabase-js must refresh it first,
    // which only the normal path knows how to do.
    "if(!s||!s.access_token||(s.expires_at||0)<Date.now()/1000+60)return;" +
    'var d=new Date(),p=function(n){return(n<10?"0":"")+n};' +
    'var today=p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear();' +
    'var h={Authorization:"Bearer "+s.access_token},b=' +
    JSON.stringify(apiBase) +
    ";" +
    "var get=function(u){return fetch(b+u,{headers:h}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})};" +
    'window.__earlyDash={t:Date.now(),bulk:get("/api/dashboard-bulk?today="+encodeURIComponent(today)),faci:get("/api/facilitators")};' +
    "}catch(e){}})();"
  );
}
