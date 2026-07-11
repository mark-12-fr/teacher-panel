"use client";

// Floating AI assistant widget (port of ai-assistant.js + the pages' chat
// handlers). Rendered once by TeacherShell so it appears on every teacher page.
// Deterministic questions are answered locally (numbers match the dashboard);
// open-ended ones go to the backend /api/ai-evaluate with a compiled context.
import { useEffect, useRef, useState } from "react";
import { processSmartDBQuery, loadAIData, type AIData } from "@/lib/ai";
import "@/app/ai-assistant.css";

type Msg = { role: "user" | "ai"; html: string; typing?: boolean };

const SUGGESTIONS: { icon: string; label: string; query: string }[] = [
  { icon: "fa-solid fa-star", label: "Top Students", query: "Top students" },
  { icon: "fa-solid fa-user-xmark", label: "Today's Absences", query: "Who is absent today?" },
  { icon: "fa-solid fa-chart-line", label: "Failing Students", query: "Failing students" },
  { icon: "fa-solid fa-chart-pie", label: "Class Summary", query: "Class summary" },
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
  "Hi there! 👋 I'm your AcadTrack assistant. Ask me about your students, grades, attendance, top or struggling students, missing requirements, or a quick class summary. I understand Hiligaynon, Filipino, and English.";

function chatKey() {
  const who = (typeof localStorage !== "undefined" && localStorage.getItem("cached_user_name")) || "teacher";
  return "mjr_chat_" + who;
}
function todayStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const dataRef = useRef<AIData | null>(null);
  const dataAt = useRef(0); // when dataRef was last loaded (ms)
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

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

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", html: q }, { role: "ai", html: TYPING_HTML, typing: true }]);
    try {
      // Reload the class data if we've never loaded it or it's older than 30s,
      // so answers reflect recent edits while rapid follow-ups reuse the cache.
      if (!dataRef.current || Date.now() - dataAt.current > 30000) {
        dataRef.current = await loadAIData();
        dataAt.current = Date.now();
      }
      const answer = await processSmartDBQuery(q, dataRef.current);
      setMessages((m) => m.filter((x) => !x.typing).concat({ role: "ai", html: answer }));
    } catch {
      setMessages((m) =>
        m.filter((x) => !x.typing).concat({ role: "ai", html: "I'm sorry, I encountered an error while retrieving your records. Please try again." })
      );
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
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
          <button onClick={() => setOpen(false)} title="Close">
            <i className="fa-solid fa-times" />
          </button>
        </div>

        <div className="ai-chat-body" ref={bodyRef}>
          <div className="chat-msg ai">{GREETING}</div>

          {messages.map((m, i) =>
            m.typing ? (
              <div key={i} className="chat-msg ai" dangerouslySetInnerHTML={{ __html: m.html }} />
            ) : (
              <div key={i} className={`chat-msg ${m.role}`} dangerouslySetInnerHTML={{ __html: m.html }} />
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
          <input
            ref={inputRef}
            type="text"
            placeholder='Ask anything... (e.g. "Top students")'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(input);
            }}
            disabled={busy}
          />
          <button onClick={() => send(input)} disabled={busy || !input.trim()}>
            <i className="fa-solid fa-paper-plane" style={{ fontSize: 14 }} />
          </button>
        </div>
      </div>
    </>
  );
}
