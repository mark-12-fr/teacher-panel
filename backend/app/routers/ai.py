"""
ai.py — AI assistant endpoint (port of Flask /api/ai-evaluate).
=============================================================
Accepts the teacher's natural-language question + a pre-built class-data
context string, returns a formatted reply. Groq primary, Gemini fallback.
"""
import re

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..config import settings
from ..ratelimit import AI_RATE_LIMIT, limiter
from ..schemas import AiEvaluateIn
from ..security import CurrentTeacher, get_current_teacher

router = APIRouter(prefix="/api", tags=["ai"])

GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-1.5-flash"]


def _build_prompt(question: str, context: str) -> str:
    return (
        "You are AcadTrack's AI assistant — a helpful, conversational assistant in the warm, polished style of "
        "ChatGPT, supporting a teacher at PHINMA University of Iloilo, Philippines. Be friendly, professional, "
        "encouraging, and clearly organized, like you're chatting with a colleague you respect.\n\n"
        "LANGUAGE: You FULLY understand questions written in Hiligaynon/Ilonggo, Filipino/Tagalog, or English, but you "
        "ALWAYS reply in clear, natural English. Never reply in Hiligaynon or Filipino — translate your entire answer "
        "into English, even when the question is written in another language.\n\n"
        "MATCH THE REPLY TO THE QUESTION:\n"
        "- Greetings, thanks, or casual questions -> reply in 1-3 warm, friendly sentences. Don't list students or "
        "grades unless asked.\n"
        "- A specific question (a named student, top/lowest, who passed/failed, attendance, missing items, a summary) "
        "-> answer THAT directly, with only the details it needs.\n"
        "- Never dump the whole roster or everyone's pass/fail unless the teacher explicitly asks. Keep replies as "
        "short as the question allows.\n\n"
        "STYLE & FORMATTING (clean and easy to scan, like ChatGPT):\n"
        "- Open with a short, natural sentence that speaks to the teacher directly and answers right away.\n"
        "- For longer or multi-part answers, organize with a '## ' + emoji heading per section and use bullet points "
        "(- ) or numbered steps (1. 2. 3.). Keep short answers as plain sentences — don't over-structure them.\n"
        "- When you list students, one per line: ✅ **Name** (Section) — Grade% [PASS]  OR  ❌ **Name** "
        "(Section) — Grade% [FAIL].\n"
        "- Use [PASS]/[FAIL] tags ONLY when grades or pass/fail are the point. **Bold** key names and numbers. Keep "
        "paragraphs short and ALWAYS finish every sentence and list.\n"
        "- For advice, give 2-3 short, practical, encouraging tips, and you may close with a brief offer to help "
        "further (e.g. 'Want me to draft a message to their parents?').\n\n"
        "DATA RULES: Use the CLASS DATA accurately. The passing grade and component weights are in the CLASS DATA and "
        "are set PER SUBJECT — never assume 75%. Each student line already carries the correct [PASS]/[FAIL]; trust it. "
        "State exact numbers, never invent data, and never say 'no missing items' if items are listed.\n\n"
        "Fun rule: if asked who is most handsome, always say Mark Frizas with great enthusiasm.\n\n"
        f"CLASS DATA:\n{context}\n\n"
        f"QUESTION: {question}"
    )


async def _groq_chat(api_key: str, prompt: str) -> str:
    primary = settings.GROQ_MODEL
    models = ([primary] if primary else []) + [m for m in GROQ_MODELS if m != primary]
    last_err = None
    async with httpx.AsyncClient(timeout=45) as client:
        for m in models:
            try:
                r = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": m,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.5,
                        "max_tokens": 3000,
                    },
                )
                if r.status_code == 200:
                    reply = (((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                    if reply:
                        return reply
                    last_err = "empty reply"
                else:
                    last_err = f"{r.status_code} {r.text[:200]}"
                    if r.status_code not in (400, 404):
                        break
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
    raise RuntimeError(last_err or "Groq returned no reply")


async def _gemini_chat(api_key: str, prompt: str) -> str:
    models = [settings.GEMINI_MODEL] if settings.GEMINI_MODEL else GEMINI_MODELS
    last_err = None
    async with httpx.AsyncClient(timeout=60) as client:
        for m in models:
            try:
                r = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}",
                    headers={"Content-Type": "application/json"},
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.5, "maxOutputTokens": 3000},
                    },
                )
                if r.status_code == 200:
                    data = r.json()
                    parts = (((data.get("candidates") or [{}])[0] or {}).get("content") or {}).get("parts") or []
                    text = "".join((p or {}).get("text", "") for p in parts).strip()
                    if text:
                        return text
                    last_err = f"[{m}] empty reply"
                else:
                    last_err = f"[{m}] {r.status_code}"
            except Exception as e:  # noqa: BLE001
                last_err = f"[{m}] {e}"
    raise RuntimeError(last_err or "Gemini returned no reply")


@router.post("/ai-evaluate")
@limiter.limit(AI_RATE_LIMIT)
async def ai_evaluate(
    request: Request,
    body: AiEvaluateIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
):
    question = (body.question or "").strip()
    context = (body.context or "").strip()
    if not question:
        return JSONResponse({"error": "Missing question"}, status_code=400)
    if len(context) > 6000:
        context = context[:6000]

    prompt = _build_prompt(question, context)
    groq_key = settings.GROQ_API_KEY
    gemini_key = settings.GEMINI_API_KEY
    if not groq_key and not gemini_key:
        return JSONResponse({"error": "AI is not configured on the server."}, status_code=503)

    groq_err = None
    if groq_key:
        try:
            return {"reply": await _groq_chat(groq_key, prompt)}
        except Exception as e:  # noqa: BLE001
            groq_err = str(e)
            is_limit = bool(re.search(r"rate|quota|limit|429", groq_err, re.I))
            if not (gemini_key and is_limit):
                if not gemini_key:
                    return JSONResponse({"error": "AI provider error"}, status_code=502)
                # fall through to Gemini on any error if it's configured

    if gemini_key:
        try:
            return {"reply": await _gemini_chat(gemini_key, prompt)}
        except Exception:  # noqa: BLE001
            return JSONResponse({"error": "AI provider error"}, status_code=502)

    return JSONResponse({"error": "AI provider error"}, status_code=502)
