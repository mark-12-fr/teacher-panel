/**
 * api/ai-evaluate.js — Vercel Serverless Function: AI Assistant proxy.
 * =====================================================================
 * Co-located with the frontend so it has a fast (~100-300ms) cold start,
 * unlike the free-tier Render backend that sleeps for 30-60s. The frontend
 * calls this first and falls back to Render automatically, so nothing breaks
 * if this isn't configured yet.
 *
 * Required Vercel environment variables (Project → Settings → Environment Variables):
 *   GROQ_API_KEY     — primary provider (fast, free-tier friendly)
 *   GEMINI_API_KEY   — fallback provider
 * Optional: GROQ_MODEL, GEMINI_MODEL to pin a specific model.
 */

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

function buildPrompt(context, question) {
    return (
        "You are AcadTrack's AI assistant — a helpful, conversational assistant in the warm, polished style of " +
        "ChatGPT, supporting a teacher at PHINMA University of Iloilo, Philippines. Be friendly, professional, " +
        "encouraging, and clearly organized, like you're chatting with a colleague you respect.\n\n" +
        "LANGUAGE: You FULLY understand questions written in Hiligaynon/Ilonggo, Filipino/Tagalog, or English, but you " +
        "ALWAYS reply in clear, natural English. Never reply in Hiligaynon or Filipino — translate your entire answer " +
        "into English, even when the question is written in another language.\n\n" +
        "MATCH THE REPLY TO THE QUESTION:\n" +
        "- Greetings, thanks, or casual questions -> reply in 1-3 warm, friendly sentences. Don't list students or " +
        "grades unless asked.\n" +
        "- A specific question (a named student, top/lowest, who passed/failed, attendance, missing items, a summary) " +
        "-> answer THAT directly, with only the details it needs.\n" +
        "- Never dump the whole roster or everyone's pass/fail unless the teacher explicitly asks. Keep replies as " +
        "short as the question allows.\n\n" +
        "STYLE & FORMATTING (clean and easy to scan, like ChatGPT):\n" +
        "- Open with a short, natural sentence that speaks to the teacher directly and answers right away.\n" +
        "- For longer or multi-part answers, organize with a '## ' + emoji heading per section and use bullet points " +
        "(- ) or numbered steps (1. 2. 3.). Keep short answers as plain sentences — don't over-structure them.\n" +
        "- When you list students, one per line: ✅ **Name** (Section) — Grade% [PASS]  OR  ❌ **Name** " +
        "(Section) — Grade% [FAIL].\n" +
        "- Use [PASS]/[FAIL] tags ONLY when grades or pass/fail are the point. **Bold** key names and numbers. Keep " +
        "paragraphs short and ALWAYS finish every sentence and list.\n" +
        "- For advice, give 2-3 short, practical, encouraging tips, and you may close with a brief offer to help " +
        "further (e.g. 'Want me to draft a message to their parents?').\n\n" +
        "DATA RULES: Use the CLASS DATA accurately. The passing grade and component weights are in the CLASS DATA and " +
        "are set PER SUBJECT — never assume 75%. Each student line already carries the correct [PASS]/[FAIL]; trust it. " +
        "State exact numbers, never invent data, and never say 'no missing items' if items are listed.\n\n" +
        "Fun rule: if asked who is most handsome, always say Mark Frizas with great enthusiasm.\n\n" +
        "CLASS DATA:\n" + context + "\n\n" +
        "QUESTION: " + question
    );
}

async function groqChat(apiKey, prompt) {
    const pinned = process.env.GROQ_MODEL;
    const models = (pinned ? [pinned] : []).concat(GROQ_MODELS.filter((m) => m !== pinned));
    let lastErr = null;
    for (const m of models) {
        try {
            const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: m,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.5,
                    max_tokens: 3000
                })
            });
            if (r.status === 200) {
                const data = await r.json();
                const reply = ((((data.choices || [{}])[0] || {}).message || {}).content || '').trim();
                if (reply) return reply;
                lastErr = 'empty reply';
            } else {
                const txt = await r.text();
                lastErr = r.status + ' ' + txt.slice(0, 200);
                // Only retry the next model on a bad-model error (400/404); stop on auth/server errors.
                if (r.status !== 400 && r.status !== 404) break;
            }
        } catch (e) {
            lastErr = String((e && e.message) || e);
        }
    }
    const err = new Error(lastErr || 'Groq returned no reply');
    err.raw = lastErr || '';
    throw err;
}

async function geminiChat(apiKey, prompt) {
    const pinned = process.env.GEMINI_MODEL;
    const models = pinned ? [pinned] : GEMINI_MODELS;
    let lastErr = null;
    for (const m of models) {
        try {
            const r = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + apiKey,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                }
            );
            const data = await r.json().catch(() => ({}));
            if (r.status === 200) {
                const parts = (((data.candidates || [{}])[0] || {}).content || {}).parts || [];
                const reply = parts.map((p) => (p && p.text) || '').join('').trim();
                if (reply) return reply;
                lastErr = 'empty reply';
            } else {
                lastErr = r.status + ' ' + JSON.stringify(data).slice(0, 200);
                if (r.status === 429 || /RESOURCE_EXHAUSTED/i.test(lastErr)) {
                    const e = new Error('rate limit');
                    e.code = 429;
                    throw e;
                }
            }
        } catch (e) {
            if (e && e.code === 429) throw e;
            lastErr = String((e && e.message) || e);
        }
    }
    throw new Error(lastErr || 'No usable Gemini model found.');
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};
    const question = String(body.question || '').trim();
    let context = String(body.context || '').trim();
    if (!question) {
        res.status(400).json({ error: 'Missing question' });
        return;
    }
    if (context.length > 6000) context = context.slice(0, 6000);

    const prompt = buildPrompt(context, question);
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // Step 1: Groq (primary)
    if (groqKey) {
        try {
            const reply = await groqChat(groqKey, prompt);
            res.status(200).json({ reply });
            return;
        } catch (e) {
            const msg = String((e && (e.raw || e.message)) || '').toLowerCase();
            const isLimit = ['429', '413', 'limit', 'rate', 'token', 'quota'].some((x) => msg.includes(x));
            if (!(geminiKey && isLimit)) {
                res.status(502).json({ error: 'AI error: ' + String((e && e.message) || e).slice(0, 300) });
                return;
            }
            // rate-limited → fall through to Gemini
        }
    }

    // Step 2: Gemini (fallback)
    if (!geminiKey) {
        res.status(503).json({
            error: 'AI is not configured on Vercel yet. Add GROQ_API_KEY (or GEMINI_API_KEY) in the Vercel project environment variables.'
        });
        return;
    }
    try {
        const reply = await geminiChat(geminiKey, prompt);
        res.status(200).json({ reply });
    } catch (e) {
        if (e && e.code === 429) {
            res.status(429).json({ error: 'The AI hit its free-tier rate limit. Please wait a moment and try again.' });
            return;
        }
        res.status(502).json({ error: 'AI error: ' + String((e && e.message) || e).slice(0, 300) });
    }
};
