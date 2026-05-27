/*
 * MJR AI Assistant — shared UI behaviour layer.
 *
 * Visual styling lives in ai-assistant.css (loaded in <head>) so the
 * polished look is applied during the initial render with no flash.
 * This file only handles DOM enhancements: header avatar/subtitle,
 * suggestion chip injection, animated typing dots, focus & disabled
 * states, and the formatFacilitatorLogsHTML helper used by each
 * page's processSmartDBQuery.
 *
 * The page-level sendAIMessage / processSmartDBQuery is never
 * overridden — each page keeps its own behaviour.
 */
(function () {
    const SUGGESTIONS = [
        { icon: 'fa-solid fa-star', label: 'Top Students', query: 'Top students' },
        { icon: 'fa-solid fa-user-xmark', label: "Today's Absences", query: 'Who is absent today?' },
        { icon: 'fa-solid fa-chart-line', label: 'Failing Students', query: 'Failing students' },
        { icon: 'fa-solid fa-chart-pie', label: 'Class Summary', query: 'Class summary' },
        { icon: 'fa-solid fa-calendar-days', label: 'My Schedule', query: 'What is my schedule?' },
        { icon: 'fa-solid fa-users', label: 'Total Population', query: 'How many students do I have?' },
        { icon: 'fa-solid fa-chalkboard-user', label: 'Assigned Facilitators', query: 'Who are my facilitators?' },
        { icon: 'fa-solid fa-file-circle-question', label: 'Missing Requirements Guide', query: 'How to check missing requirements?' },
        { icon: 'fa-solid fa-magnifying-glass-chart', label: 'Check Student Grade Guide', query: "How to check a student's grade?" }
    ];

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
        header.dataset.mjrEnhanced = 'true';

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            try { window.lucide.createIcons(); } catch (e) { /* ignore */ }
        }
    }

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
                    const input = document.getElementById('aiChatInput');
                    if (input) input.value = s.query;
                    if (typeof window.sendAIMessage === 'function') window.sendAIMessage();
                }
            });
            container.appendChild(chip);
        });

        chatBody.appendChild(container);
    }

    function defineSuggestedMessageHelper() {
        if (typeof window.sendSuggestedMessage === 'function') return;
        window.sendSuggestedMessage = function (msg) {
            const input = document.getElementById('aiChatInput');
            if (input) input.value = msg;
            if (typeof window.sendAIMessage === 'function') window.sendAIMessage();
        };
    }

    async function formatFacilitatorLogsHTML(facilitators, sb) {
        const client = sb || (typeof window.supabaseClient !== 'undefined' ? window.supabaseClient : null);
        if (!facilitators || facilitators.length === 0) {
            return "You haven't assigned any facilitators yet.";
        }

        const latestByFaci = {};
        if (client) {
            try {
                const faciIds = facilitators.map(f => f.id);
                const { data } = await client.from('facilitator_logs')
                    .select('facilitator_id, time_in, time_out')
                    .in('facilitator_id', faciIds)
                    .order('time_in', { ascending: false });
                (data || []).forEach(log => {
                    if (!latestByFaci[log.facilitator_id]) latestByFaci[log.facilitator_id] = log;
                });
            } catch (err) {
                console.error('formatFacilitatorLogsHTML: log fetch failed', err);
            }
        }

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

    function setup() {
        if (!document.getElementById('aiChatWidget')) return;
        enhanceHeader();
        ensureSuggestions();
        defineSuggestedMessageHelper();
        watchTypingIndicator();
        wireInputUx();
        wireToggleAutoFocus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }
})();
