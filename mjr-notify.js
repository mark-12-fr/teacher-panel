/**
 * mjr-notify.js — AcadTrack In-App Notification & Web Push Module
 * =================================================================
 * Purpose:
 *   Manages all user-facing notifications in the teacher panel:
 *     1. In-app toast notifications — a slide-in banner shown inside the browser tab
 *     2. OS-level browser notifications — shown via the Notification API (requires permission)
 *     3. Web Push subscription setup — registers the browser with the push server
 *        so the teacher/facilitator can receive push notifications even when the
 *        tab is not active (requires a running service worker via mjr-sw.js)
 *
 * Global functions exposed:
 *   window.MJR_notify(opts)        — show a toast + optional OS notification
 *   window.MJR_markLocalSave()     — mark that the current user just saved data
 *   window.MJR_isLikelyOwnChange() — detect if a real-time update came from the current user
 *   window.MJR_setupPush(type, id) — register this browser for Web Push notifications
 *
 * How push works:
 *   1. mjr-notify.js subscribes the browser using VAPID (Web Push standard)
 *   2. The subscription is saved to Supabase (push_subscriptions table)
 *   3. When attendance or class records change, a Supabase webhook calls /api/push-notify
 *   4. /api/push-notify (Vercel function) sends the push via web-push library
 *   5. mjr-sw.js (service worker) receives the push and shows the OS notification
 */
(function () {
    // Guard against double-initialization if the script is loaded more than once
    if (window.MJR_notify) return;

    // VAPID public key — must match the VAPID_PUBLIC_KEY environment variable on the server
    const VAPID_PUBLIC_KEY = 'BFtf7OOJhwgFropnI9-gshc0TgwbPjy2-AEjdqs1s2kBLig70bcsTK_xsYY1P6f1eLxztvH_Fc0VUkMhbVHIp0g';

    const hasNotificationAPI = (typeof Notification !== 'undefined');
    let permissionGranted = hasNotificationAPI && Notification.permission === 'granted';
    let permissionRequested = false;


    // ══════════════════════════════════════════════════════════════════════════
    // NOTIFICATION PERMISSION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Request browser notification permission if not yet granted.
     * Browsers require a user gesture (click/keydown) before showing the permission
     * dialog — so this function must be triggered from a user interaction.
     *
     * @returns {Promise<boolean>} True if permission is granted, false otherwise.
     */
    function ensurePermission() {
        if (!hasNotificationAPI) return Promise.resolve(false);
        if (Notification.permission === 'granted') {
            permissionGranted = true;
            return Promise.resolve(true);
        }
        if (Notification.permission === 'denied' || permissionRequested) {
            return Promise.resolve(false);
        }
        permissionRequested = true;
        try {
            return Notification.requestPermission().then(p => {
                permissionGranted = p === 'granted';
                return permissionGranted;
            });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    /**
     * Trigger the permission request on the first user interaction (click, key, touch).
     * This satisfies the browser's requirement for a user gesture before prompting.
     * The listeners are one-shot and self-remove after firing.
     */
    function arm() {
        ensurePermission();
        document.removeEventListener('click', arm);
        document.removeEventListener('keydown', arm);
        document.removeEventListener('touchstart', arm);
    }
    document.addEventListener('click', arm, { once: true, passive: true });
    document.addEventListener('keydown', arm, { once: true });
    document.addEventListener('touchstart', arm, { once: true, passive: true });


    // ══════════════════════════════════════════════════════════════════════════
    // IN-APP TOAST NOTIFICATION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Inject the toast CSS styles into the document head (only once).
     * Styles are injected dynamically to keep this module self-contained.
     */
    function ensureToastStyles() {
        if (document.getElementById('mjrNotifyToastStyles')) return;
        const style = document.createElement('style');
        style.id = 'mjrNotifyToastStyles';
        style.textContent = `
            #mjrNotifyToast {
                position: fixed; top: 20px; right: 20px; max-width: 340px;
                background: #1e293b; color: #fff;
                border-left: 4px solid #3b82f6;
                padding: 14px 18px; border-radius: 12px;
                box-shadow: 0 12px 28px rgba(0,0,0,0.35);
                z-index: 100000;
                transform: translateY(-20px); opacity: 0;
                transition: opacity 0.25s ease, transform 0.25s ease;
                font-family: 'Inter', system-ui, sans-serif;
                pointer-events: auto;
            }
            #mjrNotifyToast.show { transform: translateY(0); opacity: 1; }
            #mjrNotifyToast .mjr-notify-title { font-weight: 700; margin-bottom: 4px; font-size: 0.95rem; }
            #mjrNotifyToast .mjr-notify-body  { font-size: 0.85rem; opacity: 0.9; line-height: 1.35; }
            @media (max-width: 640px) {
                #mjrNotifyToast { left: 16px; right: 16px; max-width: none; }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Display a slide-in toast banner at the top-right of the screen.
     * Re-uses the same DOM element to prevent stacking multiple toasts.
     * Auto-hides after 5.5 seconds.
     *
     * @param {string} title - Bold notification title line
     * @param {string} body  - Supporting detail text
     */
    function showToast(title, body) {
        ensureToastStyles();
        let toast = document.getElementById('mjrNotifyToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'mjrNotifyToast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = `
            <div class="mjr-notify-title">${title}</div>
            <div class="mjr-notify-body">${body}</div>
        `;
        // Force a reflow between removing and adding 'show' to restart the CSS transition
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');
        clearTimeout(toast._mjrHideTimer);
        toast._mjrHideTimer = setTimeout(() => toast.classList.remove('show'), 5500);
    }


    // ══════════════════════════════════════════════════════════════════════════
    // MAIN NOTIFY FUNCTION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Show a notification: always shows the in-app toast, and additionally
     * fires an OS-level browser notification if permission has been granted.
     *
     * @param {Object} opts
     * @param {string} opts.title - Notification title
     * @param {string} opts.body  - Notification body text
     * @param {string} opts.tag   - Deduplication tag (prevents duplicate OS notifications)
     */
    function notify(opts) {
        const title = (opts && opts.title) || 'MJR';
        const body  = (opts && opts.body)  || '';
        const tag   = (opts && opts.tag)   || 'mjr-notif';

        showToast(title, body);

        if (permissionGranted) {
            try {
                const n = new Notification(title, {
                    body: body,
                    tag: tag,
                    icon: '/logo-192.png',
                    badge: '/logo-192.png',
                    silent: true  // No sound — avoids disrupting the teacher mid-class
                });
                // Auto-close the OS notification after 6 seconds
                setTimeout(() => { try { n.close(); } catch (e) {} }, 6000);
            } catch (e) {}
        }
    }


    // ══════════════════════════════════════════════════════════════════════════
    // OWN-CHANGE DETECTION
    // Prevents showing a "someone updated data" notification when the current
    // user was the one who made the change (avoids redundant self-notifications).
    // ══════════════════════════════════════════════════════════════════════════

    let lastLocalSaveAt = 0;

    /** Call this immediately before saving data to Supabase to mark the timestamp. */
    function markLocalSave() { lastLocalSaveAt = Date.now(); }

    /**
     * Returns true if the most recent local save happened less than 2.5 seconds ago.
     * Used to suppress real-time subscription notifications that were triggered by
     * the current user's own save action.
     *
     * @returns {boolean}
     */
    function isLikelyOwnChange() { return (Date.now() - lastLocalSaveAt) < 2500; }


    // ══════════════════════════════════════════════════════════════════════════
    // WEB PUSH SUBSCRIPTION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Convert a URL-safe base64 string (VAPID key format) to a Uint8Array
     * as required by the Web Push API's applicationServerKey option.
     *
     * @param {string} base64String - URL-safe base64 encoded VAPID public key
     * @returns {Uint8Array}
     */
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }

    /**
     * Register this browser for Web Push notifications and save the subscription to Supabase.
     * - Registers the service worker (mjr-sw.js) if not already registered
     * - Subscribes to the push server using the VAPID public key
     * - Upserts the subscription in the push_subscriptions table (keyed by endpoint)
     * - Removes old/stale subscriptions for this user to avoid duplicate pushes
     *
     * Called after login with the user's type ('teacher' or 'faci') and their ID.
     *
     * @param {string} userType - 'teacher' or 'faci'
     * @param {string} userId   - The teacher's UUID or the facilitator's account_id
     */
    async function setupPush(userType, userId) {
        if (!userType || !userId) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        try {
            // Register the service worker that handles incoming push events
            const reg = await navigator.serviceWorker.register('/mjr-sw.js');
            await navigator.serviceWorker.ready;

            const ok = await ensurePermission();
            if (!ok) return;

            // Reuse an existing subscription if one already exists for this browser
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
            }

            const sb = (typeof window.supabaseClient !== 'undefined' && window.supabaseClient)
                    || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
            if (!sb) return;

            const cleanId = String(userId).replace(/['"]+/g, '').trim();
            const subscriptionJson = JSON.parse(JSON.stringify(sub));

            // Save or update this subscription in the database (conflict on endpoint = update)
            await sb.from('push_subscriptions').upsert({
                user_type: userType,
                user_id: cleanId,
                endpoint: sub.endpoint,
                subscription: subscriptionJson,
                updated_at: new Date().toISOString()
            }, { onConflict: 'endpoint' });

            // Remove any old subscriptions for this user that use a different endpoint
            // (e.g. after browser reinstall or subscription renewal)
            await sb.from('push_subscriptions')
                .delete()
                .eq('user_type', userType)
                .eq('user_id', cleanId)
                .neq('endpoint', sub.endpoint);
        } catch (err) {
            console.warn('Push subscription failed:', err);
        }
    }

    // ── Export public API ──────────────────────────────────────────────────────
    window.MJR_notify = notify;
    window.MJR_markLocalSave = markLocalSave;
    window.MJR_isLikelyOwnChange = isLikelyOwnChange;
    window.MJR_setupPush = setupPush;
})();
