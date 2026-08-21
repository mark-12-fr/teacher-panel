"use client";

// Floating AI assistant widget (port of ai-assistant.js + the pages' chat
// handlers). Rendered once by TeacherShell so it appears on every teacher page.
// Deterministic questions are answered locally (numbers match the dashboard);
// open-ended ones go to the backend /api/ai-evaluate with a compiled context.
import { useEffect, useRef, useState } from "react";
import { processSmartDBQuery, loadAIData, escapeHtml, type AIData } from "@/lib/ai";
import "@/app/ai-assistant.css";

type Msg = { role: "user" | "ai"; html: string; typing?: boolean };

const SUGGESTIONS: { icon: string; label: string; query: string }[] = [
  { icon: "fa-solid fa-star", label: "Top Students", query: "Top students" },
  { icon: "fa-solid fa-user-xmark", label: "Today's Absences", query: "Who is absent today?" },
  { icon: "fa-solid fa-chart-line", label: "Failing Students", query: "Failing students" },
  { icon: "fa-solid fa-hand-holding-heart", label: "Who Needs Help", query: "Which students need help?" },
  { icon: "fa-solid fa-chart-pie", label: "Class Summary", query: "Class summary" },
  { icon: "fa-solid fa-percent", label: "Attendance Rate", query: "What is our attendance rate?" },
  { icon: "fa-solid fa-trophy", label: "Honor Roll", query: "Show honor roll students" },
  { icon: "fa-solid fa-medal", label: "Perfect Attendance", query: "Who has perfect attendance?" },
  { icon: "fa-solid fa-chart-line", label: "Most Improved", query: "Most improved students" },
  { icon: "fa-solid fa-calendar-check", label: "Monthly Attendance", query: "Monthly attendance summary" },
  { icon: "fa-solid fa-triangle-exclamation", label: "At-Risk Students", query: "Show me students at risk of failing" },
  { icon: "fa-solid fa-envelope-open-text", label: "Parent Message", query: "Draft a message for parents of failing students" },
  { icon: "fa-solid fa-clipboard-list", label: "Remediation Plan", query: "Suggest remediation plan for failing students" },
  { icon: "fa-solid fa-code-compare", label: "Section Comparison", query: "Compare all sections" },
  { icon: "fa-solid fa-arrow-trend-up", label: "Grade Prediction", query: "Predict final grades for all students" },
  { icon: "fa-solid fa-file-lines", label: "Weekly Summary", query: "Generate weekly summary report" },
  { icon: "fa-solid fa-list-check", label: "Missing Requirements", query: "Who has missing requirements?" },
  { icon: "fa-solid fa-calendar-days", label: "My Schedule", query: "What is my schedule?" },
  { icon: "fa-solid fa-users", label: "Total Population", query: "How many students do I have?" },
  { icon: "fa-solid fa-chalkboard-user", label: "Assigned Facilitators", query: "Who are my facilitators?" },
];

const TYPING_HTML = '<span class="ai-typing-dots"><span></span><span></span><span></span></span>';
const GREETING =
  "Hi there! 👋 I'm your AcadTrack assistant. Ask me about your students, grades, attendance, top or struggling students, missing requirements, or a quick class summary. Tip: you can scope a question to a section or term — e.g. \"top students in HUMSS 1\" or \"Q2 grades\". I understand Hiligaynon, Filipino, and English.";

function chatKey() {
  const who = (typeof localStorage !== "undefined" && localStorage.getItem("cached_user_name")) || "teacher";
  return "mjr_chat_" + who;
}
function todayStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

// Plain text of an HTML message — for the Copy button and the follow-up history
// sent to the model (so it never sees our markup).
function stripHtml(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, "");
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || (d as any).innerText || "").replace(/\n{3,}/g, "\n\n").trim();
}

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const dataRef = useRef<AIData | null>(null);
  const dataAt = useRef(0); // when dataRef was last loaded (ms)
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restored = useRef(false);
  const genRef = useRef(0); // bumped on every send/stop so a stale async result is discarded
  const abortRef = useRef<AbortController | null>(null);
  const recogRef = useRef<any>(null);

  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);

  // Restore today's saved conversation (expires at midnight).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(chatKey()) || "null");
      if (saved && saved.date === todayStamp() && Array.isArray(saved.msgs) && saved.msgs.length) {
        setMessages(saved.msgs);
      } else if (saved && saved.date !== todayStamp()) {
        localStorage.removeItem(chatKey());
      }
    } catch {}
  }, []);

  // Persist (debounced) whenever messages change (skip the typing indicator).
  useEffect(() => {
    const real = messages.filter((m) => !m.typing);
    const t = setTimeout(() => {
      try {
        localStorage.setItem(chatKey(), JSON.stringify({ date: todayStamp(), msgs: real }));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [messages]);

  // Auto-scroll + focus.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 220);
  }, [open]);

  // Stop any in-flight recognition when the widget unmounts.
  useEffect(() => () => { try { recogRef.current?.stop(); } catch {} }, []);

  // Recent conversation (plain text) so the model can answer follow-ups.
  function buildHistory(): string {
    return messages
      .filter((m) => !m.typing)
      .slice(-6)
      .map((m) => (m.role === "user" ? "Teacher: " : "Assistant: ") + stripHtml(m.html))
      .join("\n");
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const gen = ++genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const history = buildHistory();
    setMessages((m) => [...m, { role: "user", html: escapeHtml(q) }, { role: "ai", html: TYPING_HTML, typing: true }]);
    try {
      // Reload the class data if we've never loaded it or it's older than 30s,
      // so answers reflect recent edits while rapid follow-ups reuse the cache.
      if (!dataRef.current || Date.now() - dataAt.current > 30000) {
        dataRef.current = await loadAIData();
        dataAt.current = Date.now();
      }
      if (gen !== genRef.current) return; // stopped/cleared while loading
      const answer = await processSmartDBQuery(q, dataRef.current, { history, signal: controller.signal });
      if (gen !== genRef.current) return; // stopped/cleared while answering
      if (!answer) { setMessages((m) => m.filter((x) => !x.typing)); return; } // cancelled
      setMessages((m) => m.filter((x) => !x.typing).concat({ role: "ai", html: answer }));
    } catch {
      if (gen !== genRef.current) return;
      setMessages((m) =>
        m.filter((x) => !x.typing).concat({ role: "ai", html: "I'm sorry, I encountered an error while retrieving your records. Please try again." })
      );
    } finally {
      if (gen === genRef.current) {
        setBusy(false);
        abortRef.current = null;
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }

  // Cancel the in-flight request (abort the network + discard the result).
  function stop() {
    genRef.current++;
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    setMessages((m) => m.filter((x) => !x.typing));
    setBusy(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function clearChat() {
    genRef.current++;
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    setMessages([]);
    setBusy(false);
    try { localStorage.removeItem(chatKey()); } catch {}
  }

  async function copyMsg(i: number, html: string) {
    const text = stripHtml(html);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {}
    }
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
  }

  function toggleMic() {
    if (!speechSupported) return;
    if (listening) {
      try { recogRef.current?.stop(); } catch {}
      setListening(false);
      return;
    }
    try {
      const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const r = new SR();
      r.lang = "fil-PH"; // Filipino/Taglish; the teacher can still type Hiligaynon/English
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e: any) => {
        let t = "";
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        setInput(t);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      recogRef.current = r;
      setListening(true);
      r.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <>
      <button className="ai-floating-btn" onClick={() => setOpen((o) => !o)} title="Ask AI Assistant">
        <i className="fa-solid fa-brain" style={{ fontSize: 24 }} />
      </button>

      <div className={`ai-chat-widget${open ? " active" : ""}`} aria-hidden={!open}>
        <div className="ai-chat-header">
          <div className="ai-chat-title">
            <span className="ai-chat-avatar"><i className="fa-solid fa-brain" /></span>
            <span className="ai-chat-title-text">
              <strong>AI Assistant</strong>
              <span>Online · Student support</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {messages.length > 0 && (
              <button onClick={clearChat} title="Clear conversation">
                <i className="fa-solid fa-trash-can" />
              </button>
            )}
            <button onClick={() => setOpen(false)} title="Close">
              <i className="fa-solid fa-times" />
            </button>
          </div>
        </div>

        <div className="ai-chat-body" ref={bodyRef}>
          <div className="chat-msg ai">{GREETING}</div>

          {messages.map((m, i) =>
            m.typing ? (
              <div key={i} className="chat-msg ai" dangerouslySetInnerHTML={{ __html: m.html }} />
            ) : m.role === "ai" ? (
              <div key={i} className="chat-msg ai">
                <div dangerouslySetInnerHTML={{ __html: m.html }} />
                <button className="ai-copy-btn" onClick={() => copyMsg(i, m.html)} title="Copy answer">
                  <i className={`fa-solid ${copiedIdx === i ? "fa-check" : "fa-copy"}`} /> {copiedIdx === i ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <div key={i} className="chat-msg user" dangerouslySetInnerHTML={{ __html: m.html }} />
            )
          )}

          {messages.length === 0 && (
            <div className="ai-suggestions-container">
              {SUGGESTIONS.map((s) => (
                <div key={s.label} className="ai-suggestion-chip" onClick={() => send(s.query)}>
                  <i className={s.icon} /> {s.label}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ai-chat-input-area">
          {speechSupported && (
            <button
              type="button"
              className={`ai-mic-btn${listening ? " listening" : ""}`}
              onClick={toggleMic}
              disabled={busy}
              title={listening ? "Stop listening" : "Speak your question"}
            >
              <i className="fa-solid fa-microphone" style={{ fontSize: 14 }} />
            </button>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            placeholder='Ask anything... (e.g. "Top students in HUMSS 1")'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className="ai-stop-btn" onClick={stop} title="Stop">
              <i className="fa-solid fa-stop" style={{ fontSize: 14 }} />
            </button>
          ) : (
            <button type="button" onClick={() => send(input)} disabled={!input.trim()} title="Send">
              <i className="fa-solid fa-paper-plane" style={{ fontSize: 14 }} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
