/**
 * ai-assistant.js — AcadTrack AI Assistant Frontend Module
 * ===========================================================
 * Purpose:
 *   Handles the entire client-side behavior of the AI chat widget embedded
 *   in the teacher panel. This includes:
 *     - Rendering preset suggestion chips (quick-access queries)
 *     - Building structured class data context from Supabase data
 *     - Sending questions to the backend /api/ai-evaluate endpoint
 *     - Formatting and displaying the AI's markdown response as HTML
 *     - Persisting today's chat history in localStorage
 *     - Export toolbar (PDF, Excel, Word) in the chat header
 *
 * Dependencies:
 *   - ai-assistant.css    : Styles for the chat widget
 *   - export-utils.js     : MJR_exportPDF, MJR_exportExcel, MJR_exportDOCS
 *   - Supabase JS client  : window.supabaseClient (loaded by the host page)
 *   - Lucide icons        : window.lucide (loaded by the host page)
 *
 * Global functions exposed:
 *   window.MJR_API_URL           — resolved backend URL (localhost or Render)
 *   window.MJR_buildAIContext()  — builds the class data string sent to the AI
 *   window.MJR_callAIEvaluate()  — posts a question + context to the backend
 *   window.MJR_isEvaluationIntent() — detects if a query needs AI processing
 *   window.MJR_formatAIText()    — converts markdown to HTML for display
 *   window.MJR_warmUp()          — pings the backend to wake up the Render server
 *   window.MJR_clearChat()       — clears today's chat from localStorage
 *   window.sendSuggestedMessage() — fills the input and sends a preset query
 *   window.formatFacilitatorLogsHTML() — formats facilitator log data for display
 */
(function () {

    /**
     * Preset suggestion chips displayed at the bottom of the chat.
     * Each entry has an icon (Font Awesome class), a display label,
     * and the query string that gets sent to the AI when clicked.
     */
    const SUGGESTIONS = [
        { icon: 'fa-solid fa-star',                  label: 'Top Students',               query: 'Top students' },
        { icon: 'fa-solid fa-user-xmark',            label: "Today's Absences",           query: 'Who is absent today?' },
        { icon: 'fa-solid fa-chart-line',            label: 'Failing Students',           query: 'Failing students' },
        { icon: 'fa-solid fa-chart-pie',             label: 'Class Summary',              query: 'Class summary' },
        { icon: 'fa-solid fa-trophy',                label: 'Honor Roll',                 query: 'Show honor roll students' },
        { icon: 'fa-solid fa-medal',                 label: 'Perfect Attendance',         query: 'Who has perfect attendance?' },
        { icon: 'fa-solid fa-chart-line',            label: 'Most Improved',              query: 'Most improved students' },
        { icon: 'fa-solid fa-calendar-check',        label: 'Monthly Attendance',         query: 'Monthly attendance summary' },
        { icon: 'fa-solid fa-triangle-exclamation',  label: 'At-Risk Students',           query: 'Show me students at risk of failing' },
        { icon: 'fa-solid fa-envelope-open-text',    label: 'Parent Message',             query: 'Draft a message for parents of failing students' },
        { icon: 'fa-solid fa-clipboard-list',        label: 'Remediation Plan',           query: 'Suggest remediation plan for failing students' },
        { icon: 'fa-solid fa-calendar-week',         label: 'Attendance Pattern',         query: 'Attendance pattern analysis' },
        { icon: 'fa-solid fa-code-compare',          label: 'Section Comparison',         query: 'Compare all sections' },
        { icon: 'fa-solid fa-arrow-trend-up',        label: 'Grade Prediction',           query: 'Predict final grades for all students' },
        { icon: 'fa-solid fa-file-lines',            label: 'Weekly Summary',             query: 'Generate weekly summary report' },
        { icon: 'fa-solid fa-list-check',            label: 'Missing Requirements',       query: 'Who has missing requirements?' },
        { icon: 'fa-solid fa-calendar-days',         label: 'My Schedule',                query: 'What is my schedule?' },
        { icon: 'fa-solid fa-users',                 label: 'Total Population',           query: 'How many students do I have?' },
        { icon: 'fa-solid fa-chalkboard-user',       label: 'Assigned Facilitators',      query: 'Who are my facilitators?' },
        { icon: 'fa-solid fa-file-circle-question',  label: 'Missing Requirements Guide', query: 'How to check missing requirements?' },
        { icon: 'fa-solid fa-magnifying-glass-chart',label: 'Check Student Grade Guide',  query: "How to check a student's grade?" }
    ];


    // ══════════════════════════════════════════════════════════════════════════
    // UI SETUP — HEADER, SUGGESTIONS, INPUT WIRING
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Enhances the AI chat header with the assistant avatar, title, and
     * export toolbar (PDF / Excel / Word buttons).
     * Runs once per page load; guarded by a data attribute to prevent duplicates.
     */
    function enhanceHeader() {
        const header = document.querySelector('.ai-chat-header');
        if (!header || header.dataset.mjrEnhanced === 'true') return;

        const titleWrap = header.querySelector('div');
        if (titleWrap) {
            titleWrap.className = 'ai-chat-title';
            titleWrap.innerHTML = `
                <span class="ai-chat-avatar"><i data-lucide="brain"></i></span>
                <span class="ai-chat-title-text">
                    <strong>AI Assistant</strong>
                    <span>Online &middot; Student support</span>
                </span>
            `;
        }

        // Inject export buttons (PDF, Excel, Word) before the close button
        const closeBtn = header.querySelector('button');
        if (closeBtn && !header.querySelector('.ai-export-toolbar')) {
            const toolbar = document.createElement('div');
            toolbar.className = 'ai-export-toolbar';
            toolbar.innerHTML = `
                <button class="ai-export-btn ai-export-pdf" title="Export as PDF" onclick="if(typeof window.MJR_exportPDF==='function')window.MJR_exportPDF()">
                    <i class="fa-solid fa-file-pdf"></i>
                </button>
                <button class="ai-export-btn ai-export-excel" title="Export as Excel" onclick="if(typeof window.MJR_exportExcel==='function')window.MJR_exportExcel()">
                    <i class="fa-solid fa-file-excel"></i>
                </button>
                <button class="ai-export-btn ai-export-docs" title="Export as Word Doc" onclick="if(typeof window.MJR_exportDOCS==='function')window.MJR_exportDOCS()">
                    <i class="fa-solid fa-file-word"></i>
                </button>
            `;
            header.insertBefore(toolbar, closeBtn);
        }

        header.dataset.mjrEnhanced = 'true';

        // Re-render Lucide icons after injecting the brain icon
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            try { window.lucide.createIcons(); } catch (e) {}
        }
    }

    /**
     * Inserts the scrollable suggestion chip row into the chat body.
     * Only runs once per widget instance (guarded by class presence check).
     * Each chip calls sendSuggestedMessage() when clicked.
     */
    function ensureSuggestions() {
        const chatBody = document.getElementById('aiChatBody');
        if (!chatBody) return;
        if (chatBody.querySelector('.ai-suggestions-container')) return;

        const container = document.createElement('div');
        container.className = 'ai-suggestions-container';
        container.id = 'aiSuggestions';

        SUGGESTIONS.forEach(s => {
            const chip = document.createElement('div');
            chip.className = 'ai-suggestion-chip';
            chip.innerHTML = `<i class="${s.icon}"></i> ${s.label}`;
            chip.addEventListener('click', () => {
                if (typeof window.sendSuggestedMessage === 'function') {
                    window.sendSuggestedMessage(s.query);
                } else {
                    // Fallback: manually fill the input and trigger the send function
                    const input = document.getElementById('aiChatInput');
                    if (input) input.value = s.query;
                    if (typeof window.sendAIMessage === 'function') window.sendAIMessage();
                }
            });
            container.appendChild(chip);
        });

        chatBody.appendChild(container);
    }

    /**
     * Defines window.sendSuggestedMessage if the host page hasn't defined it.
     * Fills the chat input with the given message and triggers sendAIMessage().
     */
    function defineSuggestedMessageHelper() {
        if (typeof window.sendSuggestedMessage === 'function') return;
        window.sendSuggestedMessage = function (msg) {
            const input = document.getElementById('aiChatInput');
            if (input) input.value = msg;
            if (typeof window.sendAIMessage === 'function') window.sendAIMessage();
        };
    }


    // ══════════════════════════════════════════════════════════════════════════
    // FACILITATOR LOG FORMATTER
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Fetches the most recent time-in/time-out log for each facilitator
     * and builds an HTML string listing their attendance status.
     * Used when the teacher asks "Who are my facilitators?" in the AI chat.
     *
     * @param {Array}  facilitators - Array of facilitator objects from Supabase
     * @param {Object} sb           - Optional Supabase client override
     * @returns {Promise<string>}   HTML string of facilitator log cards
     */
    async function formatFacilitatorLogsHTML(facilitators, sb) {
        const client = sb || (typeof window.supabaseClient !== 'undefined' ? window.supabaseClient : null);
        if (!facilitators || facilitators.length === 0) {
            return "You haven't assigned any facilitators yet.";
        }

        const latestByFaci = {};
        if (client) {
            // Fetch the latest log entry per facilitator in parallel
            const results = await Promise.all(facilitators.map(f =>
                client.from('facilitator_logs')
                    .select('facilitator_id, time_in, time_out')
                    .eq('facilitator_id', f.id)
                    .order('time_in', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                    .then(r => (r && r.data) || null)
                    .catch(() => null)
            ));
            results.forEach(log => {
                if (log) latestByFaci[log.facilitator_id] = log;
            });
        }

        // Format a UTC timestamp to a readable local date/time string
        const fmt = ts => ts ? new Date(ts).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        }) : null;

        let res = "<strong>Facilitators Logs:</strong><ul class='ai-list' style='list-style:none; padding-left:0;'>";
        facilitators.forEach(f => {
            const log = latestByFaci[f.id];
            const timeIn = log && log.time_in
                ? fmt(log.time_in)
                : '<span style="color:#ef4444;">No record</span>';

            // Consider a facilitator "currently active" if they signed in and either haven't signed out,
            // or signed out less than 60 seconds ago (handles clock skew on save)
            const stillActive = log && log.time_in &&
                (!log.time_out || (Date.now() - new Date(log.time_out).getTime()) < 60000);
            const timeOut = stillActive
                ? '<span style="color:#10b981;">Currently Active</span>'
                : (log && log.time_out
                    ? fmt(log.time_out)
                    : '<span style="color:#f59e0b;">Not signed out</span>');

            res += `<li style="margin-bottom:12px; background:rgba(0,0,0,0.03); padding:12px; border-radius:8px;">
                👤 <strong>${f.full_name}</strong> <span style="font-size:0.85rem; color:var(--text-muted);">(${f.section || 'Unassigned'})</span><br>
                <div style="font-size:0.85rem; margin-top:8px; display:flex; flex-direction:column; gap:5px;">
                    <span><i class="fa-solid fa-arrow-right-to-bracket" style="color:#10b981; width:16px;"></i> Time In: <strong>${timeIn}</strong></span>
                    <span><i class="fa-solid fa-arrow-right-from-bracket" style="color:#ef4444; width:16px;"></i> Time Out: <strong>${timeOut}</strong></span>
                </div>
            </li>`;
        });
        res += "</ul>";
        return res;
    }

    window.formatFacilitatorLogsHTML = formatFacilitatorLogsHTML;


    // ══════════════════════════════════════════════════════════════════════════
    // API CONFIGURATION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Resolve the backend API base URL depending on the environment.
     * - Local development: Flask running on port 5000
     * - Production: Render-hosted backend
     */
    const MJR_API_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://127.0.0.1:5000'
        : 'https://teacher-panel-d1kw.onrender.com';
    window.MJR_API_URL = MJR_API_URL;


    // ══════════════════════════════════════════════════════════════════════════
    // TEXT FORMATTING UTILITIES
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Escape HTML special characters to prevent XSS when rendering user/AI content.
     * @param {string} s - Raw string to escape
     * @returns {string} HTML-safe string
     */
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function applyStatusBadges(html) {
        return html
            .replace(/\[PASS\]/g, '<span class="ai-status-badge ai-status-pass">PASS</span>')
            .replace(/\[FAIL\]/g, '<span class="ai-status-badge ai-status-fail">FAIL</span>')
            .replace(/\b(PASSING)\b/g, '<span class="ai-status-badge ai-status-pass">PASSING</span>')
            .replace(/\b(FAILING)\b/g, '<span class="ai-status-badge ai-status-fail">FAILING</span>');
    }


    function formatAIText(text) {
        let html = escapeHtml(text)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = applyStatusBadges(html);
        const lines = html.split('\n');
        let out = '', inList = false;
        lines.forEach(line => {
            const t = line.trim();
            if (/^###\s+/.test(t)) {
                if (inList) { out += '</ul>'; inList = false; }
                out += '<div class="ai-subheader">' + t.replace(/^###\s+/, '') + '</div>';
            } else if (/^##\s+/.test(t)) {
                if (inList) { out += '</ul>'; inList = false; }
                out += '<div class="ai-section-header">' + t.replace(/^##\s+/, '') + '</div>';
            } else if (/^[-*•]\s+/.test(t)) {
                if (!inList) { out += "<ul class='ai-list'>"; inList = true; }
                out += '<li>' + t.replace(/^[-*•]\s+/, '') + '</li>';
            } else {
                if (inList) { out += '</ul>'; inList = false; }
                if (t) out += '<p>' + t + '</p>';
            }
        });
        if (inList) out += '</ul>';
        return out || escapeHtml(text);
    }
    window.MJR_formatAIText = formatAIText;


    // ══════════════════════════════════════════════════════════════════════════
    // INTENT DETECTION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Determines whether a query requires AI processing (vs. a simple static reply).
     * Matches keywords in English, Hiligaynon/Ilonggo, and Filipino/Tagalog.
     * Used by the host page to decide whether to call the backend or handle locally.
     *
     * @param {string} q - The teacher's raw query string
     * @returns {boolean} True if the query should be routed to the AI backend
     */
    function isEvaluationIntent(q) {
        return /evaluate|analy|improve|suggest|recommend|advice|advis|next step|what should|remedial|focus|weak|strength|ano.{0,8}dapat|missing|kulang|wala.{0,6}pasa|wala.{0,6}kuha|absent|present|late|attendance|score|grade|exam|module|activity|performance|pasa|bagsak|fail|pass|kumusta|kamusta|pila|how many|who is|sin-?o|top|highest|lowest|rank|at.?risk|risk.*fail|parent.*message|message.*parent|draft.*message|draft.*parent|remediation|remediation plan|pattern|trend|compare|section comparison|predict|prediction|weekly|monthly|summary report|generate.*report|weekly summary|missing requirement|sin-?o.*wala|pila.*absent|pila.*late|pila.*fail|pila.*pass|palya|nagapalya|nakapalya|grade.*sang|kantidad|listahan|mga.*estudyante|estudyante.*nga|taas.*grado|manugsulat|rekomendasyon|bulig|suliran|kulang.*sang|wala.*sang|ngaa.*bagsak|pwede.*mag|ano.*mangin|honor.?roll|honor list|perfect.*attendance|perfect attendance|wala.*absent|zero.*absent|most.*improv|improv.*most|nag.?improv|progress.*student|monthly.*attendance|attendance.*month|monthly.*summary|month.*summary/i.test(q || '');
    }
    window.MJR_isEvaluationIntent = isEvaluationIntent;


    // ══════════════════════════════════════════════════════════════════════════
    // BACKEND API CALL
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Posts the teacher's question and class context to the /api/ai-evaluate endpoint.
     * Includes a 60-second timeout and one automatic retry on transient failures.
     * Rate-limit (429) responses are surfaced with a friendly message.
     *
     * @param {string} question - The teacher's question
     * @param {string} context  - Class data string built by buildAIContext()
     * @returns {Promise<string>} HTML-formatted AI reply, or an error message string
     */
    async function callAIEvaluate(question, context) {
        const payload = JSON.stringify({ question: question, context: context });
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const controller = new AbortController();
                // Abort the fetch if the backend doesn't respond within 60 seconds
                const timer = setTimeout(function () { controller.abort(); }, 60000);
                const res = await fetch(MJR_API_URL + '/api/ai-evaluate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    signal: controller.signal
                });
                clearTimeout(timer);
                const data = await res.json().catch(() => ({}));
                if (res.ok) return formatAIText(data.reply || 'No analysis available.');
                if (res.status === 429) return escapeHtml(data.error || 'Please wait a moment and try again.');
                // First attempt failed — retry once before giving up
                if (attempt === 0) continue;
                return escapeHtml(data.error || 'The AI assistant is unavailable right now.');
            } catch (e) {
                if (attempt === 0) { await new Promise(r => setTimeout(r, 1200)); continue; }
                return 'The server is waking up and took too long. Please send your question again.';
            }
        }
    }
    window.MJR_callAIEvaluate = callAIEvaluate;

    /**
     * Sends a lightweight GET ping to the backend to wake up the Render free-tier server.
     * Called on page load so the server is warmed up before the teacher sends a question.
     * Failures are silently ignored — this is a best-effort optimization only.
     */
    function warmUpBackend() {
        try { fetch(MJR_API_URL + '/api/ping', { method: 'GET', cache: 'no-store' }).catch(function () {}); }
        catch (e) {}
    }
    window.MJR_warmUp = warmUpBackend;


    // ══════════════════════════════════════════════════════════════════════════
    // CONTEXT BUILDER
    // Compiles all relevant class data (students, grades, attendance) into a
    // structured text string that the AI can reason over.
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Builds the full class data context string sent to the AI.
     * Performs grade calculation, attendance summarization, and query-specific
     * analysis (at-risk, section comparison, honor roll, etc.) before packaging
     * everything as a plain-text string for the AI prompt.
     *
     * Grade formula: Written Work (30%) + Performance Tasks (50%) + Exam (20%)
     * Passing grade: 75%
     *
     * @param {string} query   - The teacher's question (used to include extra context)
     * @param {Object} data    - Object with { students, sections, records, attendance }
     * @returns {string}       Plain-text class data string (max ~4500 chars on the backend)
     */
    function buildAIContext(query, data) {
        const students = (data && data.students) || [];
        const sections = (data && data.sections) || [];
        const records = (data && data.records) || [];
        const attendance = (data && data.attendance) || [];

        // Assessment key classifiers — determines which fields count toward which grade component
        const isAssess = k => k.startsWith('module_') || k.startsWith('activity_') || k.startsWith('pt_') || k === 'qe' || k === 'at';
        const pretty = k => {
            if (k.startsWith('module_')) return 'Module ' + k.slice(7);
            if (k.startsWith('activity_')) return 'Activity ' + k.slice(9);
            if (k.startsWith('pt_')) return 'Performance Task ' + k.slice(3);
            if (k === 'qe') return 'Exam';
            if (k === 'at') return 'AT';
            return k;
        };
        const isEmpty = v => v === null || v === undefined || v === "" || Number(v) === 0;

        // Build a set of "active" (has at least one non-zero score) assessment keys per section
        const activeBySection = {};
        records.forEach(r => {
            const sid = r.section_id;
            if (!activeBySection[sid]) activeBySection[sid] = new Set();
            Object.keys(r).forEach(k => { if (isAssess(k) && Number(r[k]) > 0) activeBySection[sid].add(k); });
        });

        /**
         * Calculates a student's final grade and identifies missing/zero items.
         * Merges all record rows for the student, then applies the grade weights.
         */
        const analyze = st => {
            const recs = records.filter(r => r.student_id === st.id);
            const merged = recs.reduce((acc, c) => { Object.keys(c).forEach(k => { if (c[k] !== null && c[k] !== undefined && c[k] !== "") acc[k] = c[k]; }); return acc; }, {});
            let totalWW = 0, totalPT = 0; const totalQE = Number(merged.qe) || 0;
            for (const k in merged) {
                if (k.startsWith('module_') || k.startsWith('activity_') || k === 'at') totalWW += Number(merged[k]) || 0;
                if (k.startsWith('pt_')) totalPT += Number(merged[k]) || 0;
            }
            // Cap each component at 100 before applying weights
            const ww = Math.round(Math.min(totalWW, 100)), pt = Math.round(Math.min(totalPT, 100)), qe = Math.round(Math.min((totalQE / 50) * 100, 100));
            // Dynamic per-subject weights (set by the teacher in the Grading System,
            // loaded into window.MJR_SUBJECT_CFG by the host page). Falls back to the
            // classic 30/50/20 when no config is loaded.
            const _sec = sections.find(x => x.id === st.section_id) || {};
            const grade = (typeof window !== 'undefined' && window.MJR_finalGrade)
                ? window.MJR_finalGrade(merged, _sec.subject, 100)
                : Math.round(ww * 0.3 + pt * 0.5 + qe * 0.2);
            const active = Array.from(activeBySection[st.section_id] || []);
            const missing = active.filter(k => isEmpty(merged[k])).map(pretty);
            const att = attendance.filter(a => (a.student_name || '').toLowerCase() === (st.full_name || '').toLowerCase());
            const abs = att.filter(a => a.status === 'Absent').length, late = att.filter(a => a.status === 'Late').length;
            return { merged, active, ww, pt, qe, grade, missing, abs, late };
        };

        // Build today's date in multiple formats to match whatever format the DB stores dates in
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const todays = [
            pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear(),
            now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
            pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + '/' + now.getFullYear()
        ];
        const isToday = d => d && todays.indexOf(String(d).trim()) !== -1;

        // Extract a student name from the query (e.g. "grade ni Juan" → "Juan")
        const nameExtracted = (String(query).split(/ni |of |si |kay |for |para /)[1] || '').replace('?', '').trim();
        const s = nameExtracted ? students.find(st => (st.full_name || '').toLowerCase().includes(nameExtracted)) : null;

        // Student names are stored "Lastname, Firstname"; the internal comma
        // confuses the AI's comma-separated lists (it counts each half as its own
        // person, e.g. "Cadiz, Mishle" → 2). Replace the comma with a space.
        const cleanNm = v => String(v == null ? '' : v).replace(/\s*,\s*/g, ' ').trim();

        // ── Individual student context (when query targets a specific student) ──
        if (s) {
            const a = analyze(s);
            const sec = sections.find(x => x.id === s.section_id) || {};
            const scoreLines = a.active.map(k => {
                const v = a.merged[k];
                return pretty(k) + ': ' + ((v === null || v === undefined || v === '') ? 'none' : v);
            });
            const tAtt = attendance.filter(x => (x.student_name || '').toLowerCase() === (s.full_name || '').toLowerCase() && isToday(x.date));
            const todayStatus = tAtt.length ? tAtt[0].status : 'no record for today';
            return `STUDENT: ${cleanNm(s.full_name)}\nSection: ${sec.title || 'N/A'} | Subject: ${sec.subject || 'N/A'}\nFinal grade: ${a.grade}% (${a.grade >= 75 ? 'PASSING' : 'FAILING'}; passing is 75%)\nWritten Work total: ${a.ww}% | Performance Tasks total: ${a.pt}% | Exam: ${a.qe}%\nScores per assigned assessment: ${scoreLines.join('; ') || 'none recorded'}\nMissing/zero items (count ${a.missing.length}): ${a.missing.length ? a.missing.join(', ') : 'none'}\nAttendance: ${a.abs} absences, ${a.late} lates | Today: ${todayStatus}`;
        }

        // ── Today's attendance snapshot ────────────────────────────────────────
        const todayAbsent = [], todayLate = [];
        attendance.forEach(x => {
            if (isToday(x.date)) {
                if (x.status === 'Absent') todayAbsent.push(cleanNm(x.student_name));
                else if (x.status === 'Late') todayLate.push(cleanNm(x.student_name));
            }
        });

        // ── Per-student grade summary (base context for all class-wide queries) ─
        const lines = students.map(st => {
            const a = analyze(st);
            const sec = sections.find(x => x.id === st.section_id) || {};
            const missStr = a.missing.length ? (a.missing.length > 8 ? a.missing.slice(0, 8).join('/') + ' +' + (a.missing.length - 8) : a.missing.join('/')) : 'none';
            return `${cleanNm(st.full_name)} (${sec.title || 'N/A'}): Final ${a.grade}% [${a.grade >= 75 ? 'PASS' : 'FAIL'}] | Missing(${a.missing.length}): ${missStr} | TotalAbsences-allDates ${a.abs}, TotalLates ${a.late}`;
        });

        const q = (query || '').toLowerCase();
        let extraContext = '';

        // ── At-Risk Students: failing grade AND 3+ absences ────────────────────
        if (/at.?risk|risk.*fail|posible.*fail/.test(q)) {
            const atRisk = students.filter(st => { const a = analyze(st); return a.grade < 75 && a.abs >= 3; });
            extraContext += `\n\nAT-RISK STUDENTS (grade below 75 AND 3+ absences, count=${atRisk.length}):\n` +
                (atRisk.map(st => { const a = analyze(st); const sec = sections.find(x => x.id === st.section_id) || {}; return `- ${cleanNm(st.full_name)} (${sec.title || 'N/A'}): grade=${a.grade}%, absences=${a.abs}, missing=${a.missing.length} items`; }).join('\n') || 'None found.');
        }

        // ── Section Comparison: average grade, pass/fail counts, top student ──
        if (/compare|section.*comparison|comparison.*section/.test(q)) {
            const sectionAvgs = sections.map(sec => {
                const ss = students.filter(st => st.section_id === sec.id);
                if (!ss.length) return null;
                const grades = ss.map(st => analyze(st).grade);
                const avg = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
                const passing = grades.filter(g => g >= 75).length;
                const failing = grades.filter(g => g < 75).length;
                const topStudent = ss.map(st => ({ name: cleanNm(st.full_name), grade: analyze(st).grade })).sort((a, b) => b.grade - a.grade)[0];
                return `- ${sec.title || 'N/A'} (${sec.subject || 'N/A'}): avg=${avg}%, passing=${passing}, failing=${failing}, total=${ss.length}, top student=${topStudent ? topStudent.name + ' ' + topStudent.grade + '%' : 'N/A'}`;
            }).filter(Boolean);
            extraContext += `\n\nSECTION COMPARISON:\n${sectionAvgs.join('\n') || 'No sections yet.'}`;
        }

        // ── Attendance Pattern: absences grouped by day of week ───────────────
        if (/pattern|trend|always.*absent|day.*absent/.test(q)) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const absByDay = {};
            attendance.filter(a => a.status === 'Absent').forEach(a => {
                const d = new Date(a.date);
                if (!isNaN(d.getTime())) { const day = dayNames[d.getDay()]; absByDay[day] = (absByDay[day] || 0) + 1; }
            });
            const dayPattern = Object.entries(absByDay).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}: ${c} absences`).join(', ');
            const topAbsent = students.map(st => { const a = analyze(st); return { name: cleanNm(st.full_name), abs: a.abs }; })
                .filter(x => x.abs > 0).sort((a, b) => b.abs - a.abs).slice(0, 10)
                .map(x => `${x.name} (${x.abs} absences)`);
            extraContext += `\n\nATTENDANCE PATTERNS:\nAbsences by day of week: ${dayPattern || 'no data'}\nMost absent students: ${topAbsent.join('; ') || 'none'}`;
        }

        // ── Weekly Summary: last 7 days attendance + overall grade snapshot ───
        if (/weekly|summary report|generate.*report|weekly summary/.test(q)) {
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const recentAtt = attendance.filter(a => { const d = new Date(a.date); return !isNaN(d.getTime()) && d >= sevenDaysAgo; });
            const weeklyAbsent = recentAtt.filter(a => a.status === 'Absent').length;
            const weeklyLate = recentAtt.filter(a => a.status === 'Late').length;
            const failingCount = students.filter(st => analyze(st).grade < 75).length;
            const passingCount = students.filter(st => analyze(st).grade >= 75).length;
            const avgGrade = students.length ? Math.round(students.reduce((sum, st) => sum + analyze(st).grade, 0) / students.length) : 0;
            extraContext += `\n\nWEEKLY SUMMARY (last 7 days):\nAttendance: ${weeklyAbsent} absence records, ${weeklyLate} late records\nGrades: ${passingCount} passing, ${failingCount} failing, class average=${avgGrade}%\nTotal students: ${students.length} across ${sections.length} section(s)`;
        }

        // ── Honor Roll: students with 90%+ final grade ─────────────────────────
        if (/honor.?roll|honor list|grade.*90|above.*90/.test(q)) {
            const honorRoll = students
                .map(st => ({ st, a: analyze(st), sec: sections.find(x => x.id === st.section_id) || {} }))
                .filter(({ a }) => a.grade >= 90)
                .sort((a, b) => b.a.grade - a.a.grade);
            extraContext += `\n\nHONOR ROLL (grade 90%+, count=${honorRoll.length}):\n` +
                (honorRoll.map(({ st, a, sec }) => `- ${cleanNm(st.full_name)} (${sec.title || 'N/A'}): ${a.grade}%`).join('\n') || 'No students with 90%+ yet.');
        }

        // ── Perfect Attendance: zero absences and zero lates ──────────────────
        if (/perfect.*attendance|perfect attendance|wala.*absent|zero.*absent/.test(q)) {
            const perfect = students.filter(st => { const a = analyze(st); return a.abs === 0 && a.late === 0; });
            const nearPerfect = students.filter(st => { const a = analyze(st); return a.abs === 0 && a.late > 0; });
            extraContext += `\n\nPERFECT ATTENDANCE (0 absences, 0 lates, count=${perfect.length}):\n` +
                (perfect.map(st => { const sec = sections.find(x => x.id === st.section_id) || {}; return `- ${cleanNm(st.full_name)} (${sec.title || 'N/A'})`; }).join('\n') || 'None found.');
            if (nearPerfect.length) {
                extraContext += `\n\nNEAR-PERFECT (0 absences but has lates, count=${nearPerfect.length}):\n` +
                    nearPerfect.map(st => { const a = analyze(st); const sec = sections.find(x => x.id === st.section_id) || {}; return `- ${cleanNm(st.full_name)} (${sec.title || 'N/A'}): ${a.late} late(s)`; }).join('\n');
            }
        }

        // ── Monthly Attendance Summary: grouped by calendar month ─────────────
        if (/monthly|month.*attendance|attendance.*month|monthly.*summary|month.*summary/.test(q)) {
            const monthMap = {};
            attendance.forEach(a => {
                if (!a.date) return;
                const d = new Date(a.date);
                if (isNaN(d.getTime())) return;
                const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                const monthName = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                if (!monthMap[key]) monthMap[key] = { name: monthName, absent: 0, late: 0, present: 0 };
                if (a.status === 'Absent') monthMap[key].absent++;
                else if (a.status === 'Late') monthMap[key].late++;
                else monthMap[key].present++;
            });
            const monthSummary = Object.entries(monthMap)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([, m]) => `- ${m.name}: ${m.absent} absences, ${m.late} lates, ${m.present} present`);
            extraContext += `\n\nMONTHLY ATTENDANCE SUMMARY (${monthSummary.length} month(s)):\n` + (monthSummary.join('\n') || 'No attendance records yet.');
        }

        // ── Most Improved: compare early vs. recent module scores ─────────────
        if (/most.*improv|improv.*most|nag.?improv|progress.*student/.test(q)) {
            const improved = students.map(st => {
                const recs = records.filter(r => r.student_id === st.id);
                const merged = recs.reduce((acc, c) => { Object.keys(c).forEach(k => { if (c[k] !== null && c[k] !== undefined && c[k] !== '') acc[k] = c[k]; }); return acc; }, {});
                const moduleKeys = Object.keys(merged).filter(k => k.startsWith('module_')).sort((a, b) => (parseInt(a.replace('module_', '')) || 0) - (parseInt(b.replace('module_', '')) || 0));
                if (moduleKeys.length < 2) return null;
                const half = Math.ceil(moduleKeys.length / 2);
                const earlyAvg = moduleKeys.slice(0, half).reduce((s, k) => s + (Number(merged[k]) || 0), 0) / half;
                const recentAvg = moduleKeys.slice(half).reduce((s, k) => s + (Number(merged[k]) || 0), 0) / (moduleKeys.length - half);
                const improvement = recentAvg - earlyAvg;
                const sec = sections.find(x => x.id === st.section_id) || {};
                const a = analyze(st);
                return { name: cleanNm(st.full_name), section: sec.title || 'N/A', early: Math.round(earlyAvg), recent: Math.round(recentAvg), diff: Math.round(improvement), grade: a.grade };
            }).filter(x => x && x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 10);
            extraContext += `\n\nMOST IMPROVED STUDENTS (early vs recent module scores, count=${improved.length}):\n` +
                (improved.map(x => `- ${x.name} (${x.section}): early avg=${x.early}pts → recent avg=${x.recent}pts (+${x.diff}pts) | final grade=${x.grade}%`).join('\n') || 'Not enough module data to determine improvement yet.');
        }

        // ── Grade Prediction: current grade + potential if missing items submitted ─
        if (/predict|prediction|final grade.*all|all.*final grade/.test(q)) {
            const predictions = students.map(st => {
                const a = analyze(st);
                const sec = sections.find(x => x.id === st.section_id) || {};
                // Rough estimate: each missing item is worth ~3 points if submitted
                const potential = Math.min(100, a.grade + a.missing.length * 3);
                return `- ${cleanNm(st.full_name)} (${sec.title || 'N/A'}): current=${a.grade}% [${a.grade >= 75 ? 'PASS' : 'FAIL'}], potential if missing submitted=~${potential}% [${potential >= 75 ? 'PASS' : 'FAIL'}], missing=${a.missing.length} items`;
            });
            extraContext += `\n\nGRADE PREDICTIONS (current vs potential if all missing items submitted):\n${predictions.join('\n') || 'No data.'}`;
        }

        // ── Final context string sent to the AI ───────────────────────────────
        // IMPORTANT: "ABSENT TODAY" and "LATE TODAY" use semicolons as separators.
        // The AI must use ONLY this list for today-specific queries, not the per-student allDates totals.
        return `CLASS DATA (passing grade 75%; weights: Written Work 30%, Performance Tasks 50%, Exam 20%). ${sections.length} section(s), ${students.length} student(s).\nToday's date: ${todays[0]}.\nABSENT TODAY (count=${todayAbsent.length}): ${todayAbsent.length ? todayAbsent.join('; ') : 'none'}.\nLATE TODAY (count=${todayLate.length}): ${todayLate.length ? todayLate.join('; ') : 'none'}.\nIMPORTANT: For "who is absent today" / "how many absent today", use ONLY the ABSENT TODAY list above (each name is one student, separated by ';'). Do NOT use the per-student TotalAbsences-allDates numbers below for "today".\nPer-student (these totals are across ALL dates, not today):\n${lines.join('\n') || 'No students yet.'}${extraContext}`;
    }
    window.MJR_buildAIContext = buildAIContext;


    // ══════════════════════════════════════════════════════════════════════════
    // TYPING INDICATOR
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Watches the chat body for the typing indicator element and replaces
     * its content with the animated three-dot pulse (CSS-animated dots).
     * Uses MutationObserver so it works regardless of when the indicator is injected.
     */
    function watchTypingIndicator() {
        const chatBody = document.getElementById('aiChatBody');
        if (!chatBody || chatBody.dataset.mjrObserved === 'true') return;
        chatBody.dataset.mjrObserved = 'true';

        const observer = new MutationObserver(mutations => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (!(node instanceof HTMLElement)) return;
                    if (node.id === 'ai-typing-indicator') {
                        node.innerHTML = '<span class="ai-typing-dots"><span></span><span></span><span></span></span>';
                    }
                });
            });
        });
        observer.observe(chatBody, { childList: true });
    }

    /**
     * Wires the send button's disabled state to the input field content.
     * The send button is disabled when the input is empty to prevent empty submissions.
     * Also improves the default placeholder text.
     */
    function wireInputUx() {
        const input = document.getElementById('aiChatInput');
        const sendBtn = document.querySelector('.ai-chat-input-area button');
        if (!input || !sendBtn || input.dataset.mjrWired === 'true') return;
        input.dataset.mjrWired = 'true';

        const refresh = () => { sendBtn.disabled = input.value.trim().length === 0; };
        input.addEventListener('input', refresh);
        refresh();

        if (!input.placeholder || input.placeholder === 'Ask anything...') {
            input.placeholder = 'Ask anything... (e.g. "Top students")';
        }
    }

    /**
     * Auto-focuses the chat input whenever the AI widget is opened.
     * Watches the 'active' class on the widget via MutationObserver.
     * The 220ms delay allows the open animation to finish before focusing.
     */
    function wireToggleAutoFocus() {
        const widget = document.getElementById('aiChatWidget');
        if (!widget || widget.dataset.mjrFocusWired === 'true') return;
        widget.dataset.mjrFocusWired = 'true';

        const observer = new MutationObserver(() => {
            if (widget.classList.contains('active')) {
                const input = document.getElementById('aiChatInput');
                if (input) setTimeout(() => input.focus(), 220);
            }
        });
        observer.observe(widget, { attributes: true, attributeFilter: ['class'] });
    }


    // ══════════════════════════════════════════════════════════════════════════
    // CHAT PERSISTENCE — localStorage
    // Saves and restores today's conversation so it survives page navigation.
    // Chat is automatically cleared at midnight (keyed by today's date stamp).
    // ══════════════════════════════════════════════════════════════════════════

    /** Returns the localStorage key for this user's chat history. */
    function chatStoreKey() {
        const who = localStorage.getItem('user_id') || localStorage.getItem('faci_id') || 'guest';
        return 'mjr_chat_' + who;
    }

    /** Returns today's date as a "YYYY-M-D" string used to expire stale chats. */
    function todayStamp() {
        const d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    /**
     * Serializes all chat messages (role + innerHTML) to localStorage.
     * Skips the typing indicator, greeting element, and suggestion chips.
     */
    function saveChat() {
        const chatBody = document.getElementById('aiChatBody');
        if (!chatBody) return;
        const msgs = [];
        chatBody.querySelectorAll('.chat-msg').forEach(el => {
            if (el.id === 'ai-typing-indicator' || el.id === 'aiGreeting') return;
            if (el.classList.contains('ai-suggestions-container')) return;
            msgs.push({ role: el.classList.contains('user') ? 'user' : 'ai', html: el.innerHTML });
        });
        try {
            localStorage.setItem(chatStoreKey(), JSON.stringify({ date: todayStamp(), msgs: msgs }));
        } catch (e) {}
    }

    /**
     * Restores today's saved chat messages back into the chat body on page load.
     * If the saved date doesn't match today, the stale entry is removed and the
     * chat starts fresh. Messages are inserted before the suggestion chips.
     */
    function restoreChat() {
        const chatBody = document.getElementById('aiChatBody');
        if (!chatBody || chatBody.dataset.mjrRestored === 'true') return;
        chatBody.dataset.mjrRestored = 'true';

        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(chatStoreKey()) || 'null'); } catch (e) {}

        if (!saved || saved.date !== todayStamp() || !Array.isArray(saved.msgs) || saved.msgs.length === 0) {
            // Clear expired (previous day) chat so it doesn't linger
            if (saved && saved.date !== todayStamp()) {
                try { localStorage.removeItem(chatStoreKey()); } catch (e) {}
            }
            return;
        }

        const suggestions = chatBody.querySelector('.ai-suggestions-container');
        saved.msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'chat-msg ' + (m.role === 'user' ? 'user' : 'ai');
            div.innerHTML = m.html;
            if (suggestions) chatBody.insertBefore(div, suggestions);
            else chatBody.appendChild(div);
        });
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    /**
     * Sets up a MutationObserver that auto-saves the chat to localStorage
     * 400ms after any change in the chat body (debounced to avoid excessive writes).
     */
    function watchChatPersistence() {
        const chatBody = document.getElementById('aiChatBody');
        if (!chatBody || chatBody.dataset.mjrPersist === 'true') return;
        chatBody.dataset.mjrPersist = 'true';

        let saveTimer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveChat, 400);
        });
        observer.observe(chatBody, { childList: true, subtree: true });
    }

    /** Public function to manually clear this user's chat history from localStorage. */
    window.MJR_clearChat = function () {
        try { localStorage.removeItem(chatStoreKey()); } catch (e) {}
    };


    // ══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Main setup function — runs all widget initializers in order.
     * Guards against running if the AI widget element is not on the current page.
     */
    function setup() {
        if (!document.getElementById('aiChatWidget')) return;
        warmUpBackend();                // Wake up the Render backend early
        enhanceHeader();                // Add avatar, title, and export buttons to the header
        ensureSuggestions();            // Render suggestion chips in the chat body
        defineSuggestedMessageHelper(); // Ensure sendSuggestedMessage() is available globally
        watchTypingIndicator();         // Replace typing indicator with animated dots
        restoreChat();                  // Reload today's saved conversation
        watchChatPersistence();         // Start auto-saving future messages
        wireInputUx();                  // Enable/disable send button based on input content
        wireToggleAutoFocus();          // Focus input when the chat widget is opened
    }

    // Run setup after the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }
})();
