/*
 * MJR AI Assistant — shared UI polish layer
 *
 * Non-destructive enhancer for the AI assistant widget that already lives
 * inside every page. It adds a unified professional look (matching the
 * blue section tags), an avatar/subtitle header, animated typing dots,
 * smooth message animations, subtle timestamps, suggestion chips and
 * minor UX niceties — without replacing the page's own sendAIMessage()
 * or processSmartDBQuery() so each page keeps its existing behaviour.
 */
(function () {
    const ACCENT = '#1e40af';
    const ACCENT_SOFT = '#dbeafe';
    const ACCENT_HOVER = '#1d4ed8';

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

    function injectStyles() {
        if (document.getElementById('mjr-ai-assistant-styles')) return;
        const style = document.createElement('style');
        style.id = 'mjr-ai-assistant-styles';
        style.textContent = `
            .ai-floating-btn {
                position: fixed !important;
                bottom: 40px !important;
                right: 40px !important;
                width: 60px !important;
                height: 60px !important;
                border-radius: 50% !important;
                background: linear-gradient(135deg, #2563eb, ${ACCENT}) !important;
                color: #fff !important;
                border: none !important;
                box-shadow: 0 12px 28px rgba(30, 64, 175, 0.35) !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                z-index: 9998 !important;
                transition: transform 0.25s ease, box-shadow 0.25s ease !important;
            }
            .ai-floating-btn::after {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: 50%;
                box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.45);
                animation: mjrAiPulse 2.4s ease-out infinite;
                pointer-events: none;
            }
            .ai-floating-btn:hover {
                transform: translateY(-3px) scale(1.04) !important;
                box-shadow: 0 16px 36px rgba(30, 64, 175, 0.45) !important;
            }

            .ai-chat-widget {
                position: fixed !important;
                bottom: 110px !important;
                right: 40px !important;
                width: 380px !important;
                max-width: calc(100vw - 32px) !important;
                height: 560px !important;
                max-height: calc(100vh - 140px) !important;
                background: var(--card-bg) !important;
                border-radius: 18px !important;
                border: 1px solid var(--border-color) !important;
                box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22) !important;
                display: flex !important;
                flex-direction: column !important;
                z-index: 9999 !important;
                overflow: hidden !important;
                transform: translateY(14px) scale(0.96) !important;
                opacity: 0 !important;
                pointer-events: none !important;
                transform-origin: bottom right !important;
                transition: transform 0.25s ease, opacity 0.25s ease !important;
            }
            .ai-chat-widget.active {
                transform: translateY(0) scale(1) !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }

            .ai-chat-header {
                background: linear-gradient(135deg, #2563eb, ${ACCENT}) !important;
                color: #fff !important;
                padding: 14px 18px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 12px !important;
            }
            .ai-chat-title {
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                min-width: 0 !important;
            }
            .ai-chat-avatar {
                width: 38px !important;
                height: 38px !important;
                border-radius: 50% !important;
                background: rgba(255, 255, 255, 0.18) !important;
                color: #fff !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex: 0 0 auto !important;
                backdrop-filter: blur(4px) !important;
            }
            .ai-chat-avatar i,
            .ai-chat-avatar svg {
                width: 20px !important;
                height: 20px !important;
            }
            .ai-chat-title-text {
                display: flex !important;
                flex-direction: column !important;
                line-height: 1.25 !important;
                min-width: 0 !important;
            }
            .ai-chat-title-text strong {
                font-size: 0.98rem !important;
                font-weight: 700 !important;
            }
            .ai-chat-title-text span {
                display: inline-flex !important;
                align-items: center !important;
                gap: 6px !important;
                margin-top: 2px !important;
                font-size: 0.74rem !important;
                opacity: 0.85 !important;
                font-weight: 500 !important;
            }
            .ai-chat-title-text span::before {
                content: '';
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #22c55e;
                box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25);
                display: inline-block;
            }
            .ai-chat-header button {
                width: 32px !important;
                height: 32px !important;
                border-radius: 50% !important;
                background: rgba(255, 255, 255, 0.18) !important;
                color: #fff !important;
                border: none !important;
                cursor: pointer !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: background 0.2s ease !important;
            }
            .ai-chat-header button:hover {
                background: rgba(255, 255, 255, 0.3) !important;
            }

            .ai-chat-body {
                flex-grow: 1 !important;
                padding: 16px 14px !important;
                overflow-y: auto !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 12px !important;
                background: var(--input-bg) !important;
                scroll-behavior: smooth !important;
            }
            .ai-chat-body::-webkit-scrollbar { width: 6px; }
            .ai-chat-body::-webkit-scrollbar-track { background: transparent; }
            .ai-chat-body::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.5);
                border-radius: 10px;
            }

            .chat-msg {
                max-width: 88% !important;
                padding: 11px 15px !important;
                border-radius: 16px !important;
                font-size: 0.9rem !important;
                line-height: 1.5 !important;
                word-wrap: break-word !important;
                animation: mjrAiMsgIn 0.22s ease both !important;
            }
            .chat-msg.user {
                background: linear-gradient(135deg, #2563eb, ${ACCENT}) !important;
                color: #fff !important;
                align-self: flex-end !important;
                border-bottom-right-radius: 5px !important;
                box-shadow: 0 6px 16px rgba(30, 64, 175, 0.22) !important;
            }
            .chat-msg.ai {
                background: var(--card-bg) !important;
                color: var(--text-dark) !important;
                align-self: flex-start !important;
                border: 1px solid var(--border-color) !important;
                border-bottom-left-radius: 5px !important;
                box-shadow: 0 4px 12px var(--shadow-color) !important;
            }
            .ai-message-time {
                display: block;
                margin-top: 6px;
                font-size: 0.66rem;
                opacity: 0.7;
                text-align: right;
                font-weight: 500;
            }
            .chat-msg.user .ai-message-time { color: rgba(255, 255, 255, 0.85); }
            .chat-msg.ai .ai-message-time { color: var(--text-muted); }

            .ai-typing-dots {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 2px 4px;
            }
            .ai-typing-dots span {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: ${ACCENT};
                opacity: 0.55;
                animation: mjrAiTyping 1.1s infinite ease-in-out;
            }
            .ai-typing-dots span:nth-child(2) { animation-delay: 0.15s; }
            .ai-typing-dots span:nth-child(3) { animation-delay: 0.3s; }

            .ai-suggestions-container {
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
                margin-top: 4px !important;
                margin-bottom: 4px !important;
            }
            .ai-suggestion-chip {
                background: var(--card-bg) !important;
                color: var(--text-dark) !important;
                border: 1px solid var(--border-color) !important;
                padding: 10px 14px !important;
                border-radius: 12px !important;
                font-size: 0.83rem !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                text-align: left !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                box-shadow: 0 2px 6px var(--shadow-color) !important;
                max-width: 92% !important;
                align-self: flex-start !important;
            }
            .ai-suggestion-chip:hover {
                background: ${ACCENT_SOFT} !important;
                color: ${ACCENT} !important;
                border-color: ${ACCENT_SOFT} !important;
                transform: translateY(-1px) !important;
                box-shadow: 0 6px 14px rgba(30, 64, 175, 0.18) !important;
            }
            .ai-suggestion-chip i { color: ${ACCENT}; flex: 0 0 auto; }

            .ai-chat-input-area {
                padding: 12px 14px !important;
                background: var(--card-bg) !important;
                border-top: 1px solid var(--border-color) !important;
                display: flex !important;
                gap: 10px !important;
                align-items: center !important;
            }
            .ai-chat-input-area input {
                flex-grow: 1 !important;
                padding: 11px 16px !important;
                border: 1px solid var(--border-color) !important;
                border-radius: 999px !important;
                outline: none !important;
                font-size: 0.9rem !important;
                background: var(--input-bg) !important;
                color: var(--text-dark) !important;
                transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
            }
            .ai-chat-input-area input:focus {
                border-color: ${ACCENT} !important;
                box-shadow: 0 0 0 3px rgba(30, 64, 175, 0.15) !important;
            }
            .ai-chat-input-area button {
                background: linear-gradient(135deg, #2563eb, ${ACCENT}) !important;
                color: #fff !important;
                border: none !important;
                width: 40px !important;
                height: 40px !important;
                border-radius: 50% !important;
                cursor: pointer !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                transition: transform 0.2s ease, background 0.2s ease, opacity 0.2s ease !important;
                flex: 0 0 auto !important;
            }
            .ai-chat-input-area button:hover:not(:disabled) {
                transform: scale(1.06) !important;
                background: ${ACCENT_HOVER} !important;
            }
            .ai-chat-input-area button:disabled,
            .ai-chat-input-area input:disabled {
                opacity: 0.55 !important;
                cursor: not-allowed !important;
            }

            @keyframes mjrAiMsgIn {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mjrAiTyping {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
                40% { transform: translateY(-4px); opacity: 1; }
            }
            @keyframes mjrAiPulse {
                0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.45); }
                70% { box-shadow: 0 0 0 16px rgba(37, 99, 235, 0); }
                100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
            }

            @media (max-width: 640px) {
                .ai-floating-btn { bottom: 90px !important; right: 20px !important; }
                .ai-chat-widget {
                    right: 16px !important;
                    bottom: 160px !important;
                    width: calc(100vw - 32px) !important;
                    height: min(540px, calc(100vh - 180px)) !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

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
        injectStyles();
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
