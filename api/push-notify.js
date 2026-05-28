/*
 * /api/push-notify — Vercel serverless function
 *
 * Triggered by Supabase Database Webhooks on insert/update of
 * `attendance` and `class_records`. Looks up which user(s) to notify,
 * pulls their push subscriptions, and fans out OS-level push
 * notifications through Web Push.
 *
 * Required env vars on the Vercel project:
 *   VAPID_PUBLIC_KEY      — base64url public key, matches frontend
 *   VAPID_PRIVATE_KEY     — base64url private key (server only)
 *   VAPID_SUBJECT         — e.g. mailto:admin@yourdomain.com
 *   SUPABASE_URL          — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (server only)
 *   PUSH_WEBHOOK_SECRET   — optional shared secret. If set, requests
 *                           must include header x-mjr-secret matching it.
 */
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);

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

async function sendAll(subs, payload) {
    const json = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map(s =>
        webpush.sendNotification(s.subscription, json).catch(err => {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                // Subscription has expired or been unsubscribed — purge it.
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

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        return res.status(200).json({ ok: true, msg: 'mjr push-notify ready' });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'method not allowed' });
    }
    if (process.env.PUSH_WEBHOOK_SECRET) {
        const got = req.headers['x-mjr-secret'] || req.headers['X-Mjr-Secret'];
        if (got !== process.env.PUSH_WEBHOOK_SECRET) {
            return res.status(401).json({ error: 'bad secret' });
        }
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    // Supabase webhook payload shape:
    //   { type: 'INSERT'|'UPDATE'|'DELETE', table, record, old_record, schema }
    const table = body.table;
    const type = body.type || body.eventType;
    const record = body.record || body.new || null;
    const old = body.old_record || body.old || null;
    const data = record || old;

    if (!table || !data) return res.status(200).json({ skipped: 'no payload' });

    const targets = []; // [{ user_type, user_id }]
    let title = 'MJR Update';
    let body_text = '';
    let url = '/';

    try {
        if (table === 'attendance') {
            // Notify the teacher who owns the section.
            const { data: section } = await supabase
                .from('sections')
                .select('teacher_id, id, title, subject')
                .eq('title', data.section)
                .maybeSingle();
            if (section && section.teacher_id) {
                targets.push({ user_type: 'teacher', user_id: section.teacher_id });
                url = '/attendance(2).html?id=' + section.id;
            }

            // And notify the section's facilitators (so if a co-faci edits,
            // everyone else who owns this section hears it).
            const { data: facis } = await supabase
                .from('facilitators')
                .select('account_id')
                .eq('section', data.section)
                .not('account_id', 'is', null);
            (facis || []).forEach(f => targets.push({ user_type: 'faci', user_id: f.account_id }));

            title = 'Attendance — ' + (data.section || '');
            const status = data.status || (type === 'DELETE' ? 'cleared' : 'updated');
            body_text = (data.student_name || 'A student') + ': ' + status + (data.date ? ' (' + data.date + ')' : '');
        } else if (table === 'class_records') {
            const { data: section } = await supabase
                .from('sections')
                .select('teacher_id, id, title, subject')
                .eq('id', data.section_id)
                .maybeSingle();
            if (section) {
                if (section.teacher_id) targets.push({ user_type: 'teacher', user_id: section.teacher_id });

                const { data: facis } = await supabase
                    .from('facilitators')
                    .select('account_id')
                    .eq('section', section.title)
                    .not('account_id', 'is', null);
                (facis || []).forEach(f => targets.push({ user_type: 'faci', user_id: f.account_id }));

                title = 'Class Record — ' + (section.title || '');
                body_text = (type === 'INSERT' ? 'New scores submitted' : 'Scores updated')
                          + (section.subject ? ' for ' + section.subject : '');
                url = '/class-record(2).html?id=' + section.id;
            }
        } else {
            return res.status(200).json({ skipped: 'unhandled table: ' + table });
        }

        if (!targets.length) return res.status(200).json({ skipped: 'no targets' });

        const subs = await fetchSubscriptions(targets);
        if (!subs.length) return res.status(200).json({ skipped: 'no subscriptions', targets: targets.length });

        const result = await sendAll(subs, { title, body: body_text, tag: table + ':' + (data.section_id || data.section || ''), url });
        return res.status(200).json({ ok: true, targets: targets.length, subs: subs.length, ...result });
    } catch (err) {
        console.error('push-notify error', err);
        return res.status(500).json({ error: err.message });
    }
};
