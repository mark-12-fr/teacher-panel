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

async function nameOfFacilitator(facilitatorId) {
    if (!facilitatorId) return null;
    const { data } = await supabase
        .from('facilitators')
        .select('full_name')
        .eq('id', facilitatorId)
        .maybeSingle();
    return (data && data.full_name) || null;
}

async function nameOfStudent(studentId) {
    if (!studentId) return null;
    const { data } = await supabase
        .from('students')
        .select('full_name')
        .eq('id', studentId)
        .maybeSingle();
    return (data && data.full_name) || null;
}

async function nameOfTeacher(teacherId) {
    if (!teacherId) return null;
    const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', teacherId)
        .maybeSingle();
    return (data && data.full_name) || null;
}

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

    const table = body.table;
    const type = body.type || body.eventType;
    const record = body.record || body.new || null;
    const old = body.old_record || body.old || null;
    const data = record || old;

    if (!table || !data) return res.status(200).json({ skipped: 'no payload' });

    const targets = [];
    let title = 'MJR Update';
    let body_text = '';
    let url = '/';

    try {
        if (table === 'attendance') {
            const { data: section } = await supabase
                .from('sections')
                .select('teacher_id, id, title, subject')
                .eq('title', data.section)
                .maybeSingle();
            if (section && section.teacher_id) {
                targets.push({ user_type: 'teacher', user_id: section.teacher_id });
                url = '/attendance(2).html?id=' + section.id;
            }

            const { data: facis } = await supabase
                .from('facilitators')
                .select('account_id')
                .eq('section', data.section)
                .not('account_id', 'is', null);
            (facis || []).forEach(f => targets.push({ user_type: 'faci', user_id: f.account_id }));

            const sectionLabel = data.section || (section && section.title) || 'section';
            const student = data.student_name || (await nameOfStudent(data.student_id)) || 'a student';
            const status = data.status || (type === 'DELETE' ? 'cleared' : 'updated');
            const faciName = await nameOfFacilitator(data.facilitator_id);

            title = '🗓️ Attendance · ' + sectionLabel;
            const who = faciName ? (faciName + ' marked ') : '';
            const dateLabel = data.date ? ' on ' + data.date : '';
            body_text = who + student + ' as ' + status + dateLabel
                      + (data.remarks ? ' — ' + data.remarks : '');
        } else if (table === 'class_records') {
            const { data: section } = await supabase
                .from('sections')
                .select('teacher_id, id, title, subject')
                .eq('id', data.section_id)
                .maybeSingle();
            if (!section) return res.status(200).json({ skipped: 'unknown section_id' });

            if (section.teacher_id) targets.push({ user_type: 'teacher', user_id: section.teacher_id });

            const { data: facis } = await supabase
                .from('facilitators')
                .select('account_id')
                .eq('section', section.title)
                .not('account_id', 'is', null);
            (facis || []).forEach(f => targets.push({ user_type: 'faci', user_id: f.account_id }));

            const student = await nameOfStudent(data.student_id);
            const changed = changedFieldsFor(table, record, old);

            title = '📘 Class Record · ' + (section.title || 'section');

            if (changed.length === 1) {
                const c = changed[0];
                const beforeLabel = (c.before === null || c.before === undefined || c.before === '') ? '—' : c.before;
                body_text = (student || 'A student') + ': ' + prettyField(c.key)
                          + ' ' + beforeLabel + ' → ' + c.after;
            } else if (changed.length > 1) {
                body_text = (student || 'A student') + ' — ' + changed.length + ' scores updated ('
                          + changed.slice(0, 3).map(c => prettyField(c.key)).join(', ')
                          + (changed.length > 3 ? '…' : '') + ')';
            } else {
                body_text = (type === 'INSERT' ? 'New scores submitted' : 'Scores updated')
                          + (student ? ' for ' + student : '')
                          + (section.subject ? ' · ' + section.subject : '');
            }

            url = '/class-record(2).html?id=' + section.id;
        } else {
            return res.status(200).json({ skipped: 'unhandled table: ' + table });
        }

        if (!targets.length) return res.status(200).json({ skipped: 'no targets' });

        const subs = await fetchSubscriptions(targets);
        if (!subs.length) return res.status(200).json({ skipped: 'no subscriptions', targets: targets.length });

        const result = await sendAll(subs, { title, body: body_text, tag: table + ':' + (data.section_id || data.section || ''), url });
        return res.status(200).json({ ok: true, targets: targets.length, subs: subs.length, title, body: body_text, ...result });
    } catch (err) {
        console.error('push-notify error', err);
        return res.status(500).json({ error: err.message });
    }
};
