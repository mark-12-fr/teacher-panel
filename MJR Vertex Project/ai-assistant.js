(function () {
    let isSending = false;

    function injectAssistantStyles() {
        if (document.getElementById("mjr-ai-assistant-styles")) return;

        const style = document.createElement("style");
        style.id = "mjr-ai-assistant-styles";
        style.textContent = `
            .ai-floating-btn {
                width: 58px !important;
                height: 58px !important;
                border-radius: 50% !important;
                background: #0f6fec !important;
                color: #ffffff !important;
                border: none !important;
                box-shadow: 0 16px 36px rgba(15, 111, 236, 0.32) !important;
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
                z-index: 1200 !important;
            }

            .ai-floating-btn:hover {
                transform: translateY(-2px) !important;
                background: #0b5fd3 !important;
                box-shadow: 0 18px 42px rgba(15, 111, 236, 0.38) !important;
            }

            .ai-chat-widget {
                width: min(390px, calc(100vw - 32px)) !important;
                height: min(560px, calc(100vh - 120px)) !important;
                border-radius: 18px !important;
                background: #ffffff !important;
                border: 1px solid rgba(15, 23, 42, 0.08) !important;
                box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22) !important;
                overflow: hidden !important;
                transform: translateY(14px) scale(0.96) !important;
                opacity: 0 !important;
                pointer-events: none !important;
                transition: transform 0.22s ease, opacity 0.22s ease !important;
                z-index: 1199 !important;
            }

            .ai-chat-widget.active {
                transform: translateY(0) scale(1) !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }

            .ai-chat-header {
                min-height: 68px !important;
                padding: 14px 16px !important;
                background: #ffffff !important;
                color: #111827 !important;
                border-bottom: 1px solid #e5e7eb !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
            }

            .ai-chat-title {
                display: flex !important;
                align-items: center !important;
                gap: 11px !important;
                min-width: 0 !important;
            }

            .ai-chat-avatar {
                width: 38px !important;
                height: 38px !important;
                border-radius: 50% !important;
                background: linear-gradient(135deg, #0f6fec, #42a5f5) !important;
                color: #ffffff !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-weight: 800 !important;
                letter-spacing: 0 !important;
                box-shadow: 0 8px 20px rgba(15, 111, 236, 0.22) !important;
                flex: 0 0 auto !important;
            }

            .ai-chat-title-text {
                display: flex !important;
                flex-direction: column !important;
                line-height: 1.2 !important;
                min-width: 0 !important;
            }

            .ai-chat-title-text strong {
                font-size: 0.98rem !important;
                font-weight: 750 !important;
                color: #111827 !important;
            }

            .ai-chat-title-text span {
                margin-top: 3px !important;
                font-size: 0.76rem !important;
                color: #6b7280 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }

            .ai-chat-header button {
                width: 34px !important;
                height: 34px !important;
                border-radius: 50% !important;
                color: #64748b !important;
                background: #f3f4f6 !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: background 0.2s ease, color 0.2s ease !important;
            }

            .ai-chat-header button:hover {
                background: #e5e7eb !important;
                color: #111827 !important;
            }

            .ai-chat-body {
                background: #f5f7fb !important;
                padding: 16px !important;
                gap: 10px !important;
                scroll-behavior: smooth !important;
            }

            .chat-msg {
                max-width: 82% !important;
                padding: 10px 13px 8px !important;
                border-radius: 18px !important;
                font-size: 0.92rem !important;
                line-height: 1.45 !important;
                letter-spacing: 0 !important;
                word-break: break-word !important;
                animation: mjrAiMessageIn 0.18s ease both !important;
            }

            .chat-msg.user {
                align-self: flex-end !important;
                background: #0f6fec !important;
                color: #ffffff !important;
                border-bottom-right-radius: 6px !important;
                box-shadow: 0 8px 20px rgba(15, 111, 236, 0.18) !important;
            }

            .chat-msg.ai {
                align-self: flex-start !important;
                background: #ffffff !important;
                color: #111827 !important;
                border: 1px solid #e5e7eb !important;
                border-bottom-left-radius: 6px !important;
                box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06) !important;
            }

            .ai-message-text {
                white-space: pre-wrap !important;
            }

            .ai-message-time {
                margin-top: 5px !important;
                font-size: 0.68rem !important;
                line-height: 1 !important;
                text-align: right !important;
                opacity: 0.72 !important;
            }

            .chat-msg.ai .ai-message-time {
                color: #6b7280 !important;
            }

            .chat-msg.user .ai-message-time {
                color: rgba(255, 255, 255, 0.82) !important;
            }

            .ai-typing-dots {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                min-width: 42px !important;
                padding: 3px 1px !important;
            }

            .ai-typing-dots span {
                width: 7px !important;
                height: 7px !important;
                border-radius: 50% !important;
                background: #9ca3af !important;
                animation: mjrAiTyping 1s infinite ease-in-out !important;
            }

            .ai-typing-dots span:nth-child(2) {
                animation-delay: 0.15s !important;
            }

            .ai-typing-dots span:nth-child(3) {
                animation-delay: 0.3s !important;
            }

            .ai-chat-input-area {
                padding: 12px !important;
                background: #ffffff !important;
                border-top: 1px solid #e5e7eb !important;
                gap: 10px !important;
                align-items: center !important;
            }

            .ai-chat-input-area input {
                height: 42px !important;
                border-radius: 999px !important;
                border: 1px solid #e5e7eb !important;
                background: #f3f4f6 !important;
                color: #111827 !important;
                padding: 0 15px !important;
                font-size: 0.92rem !important;
                transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
            }

            .ai-chat-input-area input:focus {
                background: #ffffff !important;
                border-color: #0f6fec !important;
                box-shadow: 0 0 0 3px rgba(15, 111, 236, 0.12) !important;
            }

            .ai-chat-input-area button {
                width: 42px !important;
                height: 42px !important;
                border-radius: 50% !important;
                background: #0f6fec !important;
                color: #ffffff !important;
                border: none !important;
                flex: 0 0 auto !important;
                transition: transform 0.2s ease, background 0.2s ease, opacity 0.2s ease !important;
            }

            .ai-chat-input-area button:hover {
                background: #0b5fd3 !important;
                transform: translateY(-1px) !important;
            }

            .ai-chat-input-area button:disabled,
            .ai-chat-input-area input:disabled {
                opacity: 0.65 !important;
                cursor: not-allowed !important;
            }

            @keyframes mjrAiMessageIn {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
            }

            @keyframes mjrAiTyping {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
                40% { transform: translateY(-3px); opacity: 1; }
            }

            @media (max-width: 640px) {
                .ai-chat-widget {
                    right: 16px !important;
                    bottom: 90px !important;
                    width: calc(100vw - 32px) !important;
                    height: min(540px, calc(100vh - 118px)) !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function getApiUrl() {
        try {
            if (typeof API_URL !== "undefined" && API_URL) {
                return API_URL;
            }
        } catch (error) {
            // Fall back below.
        }
        return "http://127.0.0.1:5000";
    }

    function currentTimeLabel() {
        return new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function getChatBody() {
        return document.getElementById("aiChatBody");
    }

    function addChatMessage(text, type) {
        const chatBody = getChatBody();
        if (!chatBody) return null;

        const message = document.createElement("div");
        message.className = `chat-msg ${type}`;

        const content = document.createElement("div");
        content.className = "ai-message-text";
        content.textContent = text;
        message.appendChild(content);

        const timestamp = document.createElement("div");
        timestamp.className = "ai-message-time";
        timestamp.textContent = currentTimeLabel();
        message.appendChild(timestamp);

        chatBody.appendChild(message);
        chatBody.scrollTop = chatBody.scrollHeight;
        return message;
    }

    function removeTypingMessage() {
        const typing = document.getElementById("ai-typing-indicator");
        if (typing) {
            typing.remove();
        }
    }

    function setAssistantBusy(isBusy) {
        const input = document.getElementById("aiChatInput");
        const button = document.querySelector(".ai-chat-input-area button");

        if (input) {
            input.disabled = isBusy;
        }
        if (button) {
            button.disabled = isBusy;
        }
    }

    function professionalGreetingText() {
        const cachedName = (localStorage.getItem("cached_user_name") || "").trim();
        const firstName = cachedName.split(/\s+/)[0] || "";
        const teacherLabel = firstName && firstName.toLowerCase() !== "teacher" ? `Teacher ${firstName}` : "Teacher";

        return `Good day, ${teacherLabel}. I am your AI assistant. You may ask about your sections, students, schedules, notes, notices, attendance, or performance records.`;
    }

    function setProfessionalGreeting() {
        const greeting = document.getElementById("aiGreeting");
        if (!greeting) return;

        const message = professionalGreetingText();
        if (greeting.textContent !== message) {
            greeting.textContent = message;
        }
        greeting.style.whiteSpace = "pre-wrap";
    }

    function setupAssistantUi() {
        injectAssistantStyles();

        const headerTitle = document.querySelector(".ai-chat-header > div");
        if (headerTitle) {
            headerTitle.className = "ai-chat-title";
            headerTitle.innerHTML = `
                <span class="ai-chat-avatar">AI</span>
                <span class="ai-chat-title-text">
                    <strong>AI Assistant</strong>
                    <span>Student management support</span>
                </span>
            `;
        }

        const closeButton = document.querySelector(".ai-chat-header button");
        if (closeButton) {
            closeButton.setAttribute("aria-label", "Close AI assistant");
            closeButton.setAttribute("title", "Close");
        }

        setProfessionalGreeting();
        setTimeout(setProfessionalGreeting, 300);
        setTimeout(setProfessionalGreeting, 1200);

        const greeting = document.getElementById("aiGreeting");
        if (greeting && !greeting.dataset.professionalObserver) {
            greeting.dataset.professionalObserver = "true";
            const observer = new MutationObserver(setProfessionalGreeting);
            observer.observe(greeting, {
                childList: true,
                characterData: true,
                subtree: true
            });
        }

        const input = document.getElementById("aiChatInput");
        if (input) {
            input.placeholder = "Type your question...";
            input.setAttribute("aria-label", "Message the AI assistant");
            input.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    window.sendAIMessage();
                }
            });
        }
    }

    window.toggleAIChat = function () {
        const widget = document.getElementById("aiChatWidget");
        if (widget) {
            widget.classList.toggle("active");
        }
    };

    window.sendAIMessage = async function () {
        const input = document.getElementById("aiChatInput");
        const chatBody = getChatBody();
        if (!input || !chatBody) return;

        const text = input.value.trim();
        if (!text) return;
        if (isSending) return;

        isSending = true;
        setAssistantBusy(true);
        addChatMessage(text, "user");
        input.value = "";

        const typing = addChatMessage("", "ai");
        if (typing) {
            typing.id = "ai-typing-indicator";
            typing.innerHTML = `
                <div class="ai-typing-dots" aria-label="Assistant is typing">
                    <span></span><span></span><span></span>
                </div>
            `;
        }

        try {
            const userId = (localStorage.getItem("user_id") || "").replace(/['"]+/g, "").trim();
            const teacherName = localStorage.getItem("cached_user_name") || "";

            const response = await fetch(`${getApiUrl()}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: text,
                    user_id: userId,
                    teacher_id: userId,
                    teacher_name: teacherName,
                    page: document.title,
                    path: window.location.pathname
                })
            });

            let data = {};
            try {
                data = await response.json();
            } catch (error) {
                data = {};
            }

            removeTypingMessage();

            if (!response.ok) {
                throw new Error(data.error || "AI assistant request failed");
            }

            addChatMessage(data.reply || "I did not receive a reply from the server.", "ai");
        } catch (error) {
            console.error("AI Chat Error:", error);
            removeTypingMessage();
            addChatMessage("I cannot connect to the AI assistant server. Please make sure app.py is running on port 5000.", "ai");
        } finally {
            isSending = false;
            setAssistantBusy(false);
            if (input) {
                input.focus();
            }
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupAssistantUi);
    } else {
        setupAssistantUi();
    }
})();
