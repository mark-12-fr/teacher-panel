/**
 * api/push-notify.js — Vercel Serverless Function: Web Push Dispatcher 
 * ======================================================================
 * Purpose:
 *   Receives webhook POST requests from Supabase Database Webhooks and sends
 *   Web Push notifications to all subscribed teachers and facilitators affected
 *   by the database change.
 *
 * Triggered by:
 *   - INSERT / UPDATE / DELETE on the 'attendance' table
 *   - INSERT / UPDATE on the 'class_records' table
 *
 * Flow:
 *   1. Supabase fires a webhook → POST to this endpoint with the changed row
 *   2. This function looks up who needs to be notified (teacher + facilitators of that section)
 *   3. Fetches their push subscriptions from the push_subscriptions table
 *   4. Sends the push payload to each subscription via the web-push library
 *   5. Stale subscriptions (404/410 status from push server) are auto-deleted
 *
 * Security:
 *   - Optional PUSH_WEBHOOK_SECRET header check (x-mjr-secret) to reject unauthorized callers
 *
 * Environment Variables Required (Vercel):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PUSH_WEBHOOK_SECRET (optional — recommended for production)
 */

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// Configure web-push with VAPID credentials (must match the public key in mjr-notify.js)
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:mjrvertex@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// Use the service role key (bypasses RLS) to read push_subscriptions and look up names
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);


// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch all push subscriptions for the given list of notification targets.
 * Each target is a { user_type, user_id } pair.
 *
 * @param {Array<{user_type: string, user_id: string}>} targets
 * @returns {Promise<Array<{id: string, subscription: Object}>>}
 */
async function fetchSubscriptions(targets) {
    if (!targets.length) return [];
    const out = [];
    for (const t of targets) {
        const { data } = await supabase
            .from('push_subscriptions')
            .select('id, subscription')
            .eq('user_type', t.user_type)
            .eq('user_id', t.user_id);
        if (data) out.push(...data);
    }
    return out;
}

/**
 * Send the push payload to all provided subscriptions in parallel.
 * Automatically deletes stale/expired subscriptions (HTTP 404 or 410 from push server).
 *
 * @param {Array<{id: string, subscription: Object}>} subs - Subscription rows from Supabase
 * @param {Object} payload - Notification payload { title, body, tag, url }
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function sendAll(subs, payload) {
    const json = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map(s =>
        webpush.sendNotification(s.subscription, json).catch(err => {
            // 404/410 means the subscription is no longer valid — clean it up
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                return supabase.from('push_subscriptions').delete().eq('id', s.id).then(() => { throw err; });
            }
            throw err;
        })
    ));
    return {
        sent: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length
    };
}


// ══════════════════════════════════════════════════════════════════════════════
// NAME LOOKUP HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a facilitator's full name from their UUID.
 * Returns null if not found (notification will fall back to a generic message).
 *
 * @param {string} facilitatorId - UUID from the facilitators table
 * @returns {Promise<string|null>}
 */
async function nameOfFacilitator(facilitatorId) {
    if (!facilitatorId) return null;
    const { data } = await supabase
        .from('facilitators')
        .select('full_name')
        .eq('id', facilitatorId)
        .maybeSingle();
    return (data && data.full_name) || null;
}

/**
 * Resolve a student's full name from their UUID.
 * Returns null if not found.
 *
 * @param {string} studentId - UUID from the students table
 * @returns {Promise<string|null>}
 */
async function nameOfStudent(studentId) {
    if (!studentId) return null;
    const { data } = await supabase
        .from('students')
        .select('full_name')
        .eq('id', studentId)
        .maybeSingle();
    return (data && data.full_name) || null;
}


// ══════════════════════════════════════════════════════════════════════════════
// CHANGE DETECTION HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compare the new and old record rows to find which fields actually changed.
 * Skips metadata/foreign-key fields that don't need to appear in notifications.
 *
 * @param {string} table  - Table name (used for future per-table customization)
 * @param {Object} record - New record values
 * @param {Object} old    - Previous record values (null on INSERT)
 * @returns {Array<{key: string, before: *, after: *}>} List of changed fields
 */
function changedFieldsFor(table, record, old) {
    if (!old || !record) return [];
    const SKIP = new Set(['id', 'created_at', 'updated_at', 'section_id', 'student_id', 'date', 'section', 'subject', 'facilitator_id', 'teacher_id', 'quarter']);
    const changed = [];
    for (const k of Object.keys(record)) {
        if (SKIP.has(k)) continue;
        const a = record[k], b = old[k];
        if ((a == null && b == null) || a === b) continue;
        changed.push({ key: k, before: b, after: a });
    }
    return changed;
}

/**
 * Convert a raw database column key into a human-readable label for notifications.
 * Examples: "module_3" → "Module 3", "pt_1" → "Performance Task 1", "qe" → "Quarterly Exam"
 *
 * @param {string} k - Column key from the class_records table
 * @returns {string} Human-readable label
 */
function prettyField(k) {
    if (k.startsWith('module_'))    return 'Module ' + k.slice(7);
    if (k.startsWith('activity_'))  return 'Activity ' + k.slice(9);
    if (k.startsWith('pt_'))        return 'Performance Task ' + k.slice(3);
    if (k === 'qe')                 return 'Quarterly Exam';
    if (k === 'at')                 return 'Attendance/Talent';
    if (k === 'status')             return 'Status';
    if (k === 'remarks')            return 'Remarks';
    return k.replace(/_/g, ' ');
}


// ══════════════════════════════════════════════════════════════════════════════
// MAIN VERCEL HANDLER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Vercel serverless function handler.
 * Accepts GET (health check) or POST (Supabase webhook payload).
 *
 * Expected POST body (from Supabase webhook):
 *   {
 *     table: "attendance" | "class_records",
 *     type: "INSERT" | "UPDATE" | "DELETE",
 *     record: { ...new row values },
 *     old_record: { ...previous row values } (null on INSERT)
 *   }
 */
module.exports = async (req, res) => {
    // Health check — lets you verify the function is deployed and reachable
    if (req.method === 'GET') {
        return res.status(200).json({ ok: true, msg: 'mjr push-notify ready' });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'method not allowed' });
    }

    // ── Optional webhook secret validation ────────────────────────────────────
    // Set PUSH_WEBHOOK_SECRET in Vercel env to prevent unauthorized calls
    if (process.env.PUSH_WEBHOOK_SECRET) {
        const got = req.headers['x-mjr-secret'] || req.headers['X-Mjr-Secret'];
        if (got !== process.env.PUSH_WEBHOOK_SECRET) {
            return res.status(401).json({ error: 'bad secret' });
        }
    }

    // ── Parse the request body ─────────────────────────────────────────────────
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const table = body.table;
    const type = body.type || body.eventType;
    const record = body.record || body.new || null;
    const old = body.old_record || body.old || null;
    const data = record || old;  // Use whichever is available (DELETE only has old)

    if (!table || !data) return res.status(200).json({ skipped: 'no payload' });

    const targets = [];
    let title = 'MJR Update';
    let body_text = '';
    let url = '/';

    try {
        // ── Attendance table: notify teacher + facilitators of the section ─────
        if (table === 'attendance') {
            // Look up the section to find the teacher who owns it
            const { data: section } = await supabase
                .from('sections')
                .select('teacher_id, id, title, subject')
                .eq('title', data.section)
                .maybeSingle();
            if (section && section.teacher_id) {
                targets.push({ user_type: 'teacher', user_id: section.teacher_id });
                url = '/attendance(2).html?id=' + section.id;
            }

            // Also notify any facilitators assigned to the same section
            const { data: facis } = await supabase
                .from('facilitators')
                .select('account_id')
                .eq('section', data.section)
                .not('account_id', 'is', null);
            (facis || []).forEach(f => targets.push({ user_type: 'faci', user_id: f.account_id }));

            // Build the notification message
            const sectionLabel = data.section || (section && section.title) || 'section';
            const student = data.student_name || (await nameOfStudent(data.student_id)) || 'a student';
            const status = data.status || (type === 'DELETE' ? 'cleared' : 'updated');
            const faciName = await nameOfFacilitator(data.facilitator_id);

            title = '🗓️ Attendance · ' + sectionLabel;
            const who = faciName ? (faciName + ' marked ') : '';
            const dateLabel = data.date ? ' on ' + data.date : '';
            body_text = who + student + ' as ' + status + dateLabel
                      + (data.remarks ? ' — ' + data.remarks : '');

        // ── Class records table: notify teacher + facilitators of the section ──
        } else if (table === 'class_records') {
            // Look up the section by section_id (foreign key on class_records)
            const { data: section } = await supabase
                .from('sections')
                .select('teacher_id, id, title, subject')
                .eq('id', data.section_id)
                .maybeSingle();
            if (!section) return res.status(200).json({ skipped: 'unknown section_id' });

            if (section.teacher_id) targets.push({ user_type: 'teacher', user_id: section.teacher_id });

            // Also notify facilitators of this section
            const { data: facis } = await supabase
                .from('facilitators')
                .select('account_id')
                .eq('section', section.title)
                .not('account_id', 'is', null);
            (facis || []).forEach(f => targets.push({ user_type: 'faci', user_id: f.account_id }));

            const student = await nameOfStudent(data.student_id);
            const changed = changedFieldsFor(table, record, old);

            title = '📘 Class Record · ' + (section.title || 'section');

            // Craft a specific message based on how many fields changed
            if (changed.length === 1) {
                // Single field changed: show the exact before → after value
                const c = changed[0];
                const beforeLabel = (c.before === null || c.before === undefined || c.before === '') ? '—' : c.before;
                body_text = (student || 'A student') + ': ' + prettyField(c.key)
                          + ' ' + beforeLabel + ' → ' + c.after;
            } else if (changed.length > 1) {
                // Multiple fields changed: summarize with a count and first few field names
                body_text = (student || 'A student') + ' — ' + changed.length + ' scores updated ('
                          + changed.slice(0, 3).map(c => prettyField(c.key)).join(', ')
                          + (changed.length > 3 ? '…' : '') + ')';
            } else {
                // No specific diff (e.g. INSERT with no old record): generic message
                body_text = (type === 'INSERT' ? 'New scores submitted' : 'Scores updated')
                          + (student ? ' for ' + student : '')
                          + (section.subject ? ' · ' + section.subject : '');
            }

            url = '/class-record(2).html?id=' + section.id;

        } else {
            // Table not handled by this webhook — skip silently
            return res.status(200).json({ skipped: 'unhandled table: ' + table });
        }

        if (!targets.length) return res.status(200).json({ skipped: 'no targets' });

        // ── Fetch subscriptions and send push notifications ───────────────────
        const subs = await fetchSubscriptions(targets);
        if (!subs.length) return res.status(200).json({ skipped: 'no subscriptions', targets: targets.length });

        const result = await sendAll(subs, { title, body: body_text, tag: table + ':' + (data.section_id || data.section || ''), url });
        return res.status(200).json({ ok: true, targets: targets.length, subs: subs.length, title, body: body_text, ...result });

    } catch (err) {
        console.error('push-notify error', err);
        return res.status(500).json({ error: err.message });
    }
};
