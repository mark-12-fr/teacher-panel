""" 
app.py — AcadTrack Backend API
================================
Flask REST API server for the AcadTrack Teacher Panel.

Purpose:
    Serves as the backend for all authenticated operations:
    - Teacher profile lookup
    - Facilitator management (create, update, login)
    - AI assistant evaluation endpoint (Groq primary, Gemini fallback)

External Services:
    - Supabase  : PostgreSQL database (profiles, facilitators, sections, students, attendance, class_records)
    - Groq API  : Primary LLM provider using llama models for fast inference
    - Gemini API: Fallback LLM used when Groq hits rate/token limits

Security:
    - Passwords are bcrypt-hashed before storing — never stored as plain text
    - Flask-Talisman enforces Content Security Policy (CSP) headers
    - Flask-Limiter prevents abuse (300/day, 100/hour global; 20/min on AI endpoint)
    - CORS is restricted to /api/* routes only

Environment Variables Required (.env):
    SUPABASE_URL, SUPABASE_KEY, GROQ_API_KEY, GEMINI_API_KEY
    Optional: GROQ_MODEL (override default model), GEMINI_MODEL (override default model)
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from datetime import datetime, timezone
import bcrypt

# Load environment variables from .env file (only applies in local dev; Render uses its own env vars)
load_dotenv()

app = Flask(__name__)

# Allow cross-origin requests only on /api/* routes (frontend is on a different domain)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ── Rate Limiting ──────────────────────────────────────────────────────────────
# Global limits: 300 requests per day, 100 per hour per IP address
# Uses in-memory storage (resets on server restart); suitable for single-instance deploys
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per day", "100 per hour"],
    storage_uri="memory://"
)

# ── Content Security Policy ────────────────────────────────────────────────────
# Whitelists trusted CDN sources used by the frontend (fonts, icons, Supabase, chart libraries)
csp = {
    'default-src': [
        '\'self\'', '*.supabase.co', '*.supabase.in', 'https://fonts.googleapis.com',
        'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'https://unpkg.com',
        'https://cdn.jsdelivr.net', 'https://ui-avatars.com'
    ]
}
# force_https=False allows local development over HTTP while still applying CSP headers
Talisman(app, force_https=False, content_security_policy=csp)

# ── Supabase Client ────────────────────────────────────────────────────────────
# Reads credentials from environment variables; raises immediately if missing to prevent silent failures
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ══════════════════════════════════════════════════════════════════════════════
# HEALTH CHECK ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/')
def home():
    """Root health check — confirms the API server is running."""
    return jsonify({"status": "ok", "service": "AcadTrack API"}), 200


@app.route('/api/ping', methods=['GET'])
@limiter.exempt
def ping():
    """
    Lightweight ping endpoint used by the frontend to wake up the Render server.
    Exempt from rate limiting so the warm-up call never gets blocked.
    """
    return jsonify({"ok": True}), 200


# ══════════════════════════════════════════════════════════════════════════════
# USER PROFILE ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/user/<user_id>', methods=['GET'])
def get_user(user_id):
    """
    Fetch the full name of a teacher by their Supabase user ID.
    Used by the dashboard to display the logged-in teacher's name.

    Args:
        user_id (str): UUID of the teacher from the Supabase 'profiles' table.

    Returns:
        200: { full_name: str }
        404: { error: "User not found" }
        400: { error: "Database error" }
    """
    try:
        response = supabase.table('profiles').select('full_name').eq('id', user_id).execute()
        if len(response.data) > 0:
            return jsonify(response.data[0]), 200
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        print(f"Get User Error: {e}")
        return jsonify({"error": "Database error"}), 400


# ══════════════════════════════════════════════════════════════════════════════
# FACILITATOR MANAGEMENT ROUTES
# Facilitators are teacher assistants assigned to specific sections/subjects.
# Their passwords are always bcrypt-hashed before being stored in Supabase.
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/facilitators', methods=['POST'])
def create_facilitator():
    """
    Create a new facilitator account and assign them to a section.

    Expects JSON body:
        teacher_id (str): UUID of the teacher creating this facilitator
        full_name  (str): Facilitator's full name
        section    (str): Section they are assigned to
        subject    (str): Subject they handle
        account_id (str): Unique login ID chosen for the facilitator
        password   (str): Plain-text password (will be bcrypt-hashed before storing)

    Returns:
        201: { message, data }
        400: { error: "Missing required fields" }
        409: { error: "Account ID already taken" }
        500: { error: ... }
    """
    data = request.json or {}
    teacher_id = data.get('teacher_id')
    full_name = data.get('full_name')
    section = data.get('section')
    subject = data.get('subject')
    account_id = data.get('account_id')
    password = data.get('password')

    if not all([teacher_id, full_name, section, subject, account_id, password]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        response = supabase.table('facilitators').insert({
            'teacher_id': teacher_id,
            'full_name': full_name,
            'section': section,
            'subject': subject,
            'account_id': account_id,
            # Hash the password with bcrypt before storing — never store plain text
            'password': bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        }).execute()
        return jsonify({"message": "Facilitator assigned successfully!", "data": response.data}), 201
    except Exception as e:
        print(f"Insert Facilitator Error: {e}")
        if 'account_id' in str(e) or 'duplicate' in str(e).lower():
            return jsonify({"error": "That Account ID is already taken. Please use a different one."}), 409
        return jsonify({"error": str(e)}), 500


@app.route('/api/facilitators/<fac_id>', methods=['PUT'])
def update_facilitator(fac_id):
    """
    Update facilitator details. If a new password is included in the request,
    it is bcrypt-hashed before updating — the plain-text value is never stored.

    Args:
        fac_id (str): UUID of the facilitator row to update.

    Expects JSON body with any updatable fields (full_name, section, subject, password, etc.)

    Returns:
        200: { message, data }
        500: { error: ... }
    """
    data = request.json or {}
    # Pop the plain-text password so it doesn't get stored directly
    pw = data.pop('password', None)
    if pw:
        data['password'] = bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    try:
        response = supabase.table('facilitators').update(data).eq('id', fac_id).execute()
        return jsonify({"message": "Facilitator successfully updated!", "data": response.data}), 200
    except Exception as e:
        print(f"Update Facilitator Error: {e}")
        return jsonify({"error": "Failed to update facilitator. Please try again."}), 500


# ══════════════════════════════════════════════════════════════════════════════
# FACILITATOR AUTHENTICATION
# ══════════════════════════════════════════════════════════════════════════════

def _verify_faci_password(attempt, faci_data):
    """
    Verify a facilitator's login password against the stored bcrypt hash.

    Args:
        attempt   (str): Plain-text password entered during login.
        faci_data (dict): Facilitator row from Supabase, must contain 'password' (bcrypt hash).

    Returns:
        bool: True if the password matches, False otherwise.
    """
    stored = faci_data.get('password')
    if not stored:
        return False
    try:
        return bcrypt.checkpw(attempt.encode('utf-8'), stored.encode('utf-8'))
    except Exception:
        return False


@app.route('/api/faci/login', methods=['POST'])
def faci_login():
    """
    Authenticate a facilitator using their account_id and password.
    On success, updates their last_login timestamp and sets status to 'Active'.

    Expects JSON body:
        account_id (str): The unique login ID of the facilitator
        password   (str): Plain-text password to verify against the stored hash

    Returns:
        200: { message, faci: { id, full_name, section, subject, teacher_id } }
        400: { error: "Please enter both Account ID and Password." }
        401: { error: "Invalid Account ID." | "Incorrect Password." }
        500: { error: "Server error." }
    """
    data = request.json or {}
    account_id = data.get('account_id')
    password = data.get('password')

    if not account_id or not password:
        return jsonify({"error": "Please enter both Account ID and Password."}), 400

    try:
        response = supabase.table('facilitators').select('*').eq('account_id', account_id).execute()
        if not response.data:
            return jsonify({"error": "Invalid Account ID."}), 401

        faci_data = response.data[0]
        if not _verify_faci_password(password, faci_data):
            return jsonify({"error": "Incorrect Password."}), 401

        # Update login metadata — non-critical, failures are logged but not surfaced to the user
        try:
            supabase.table('facilitators').update({
                'last_login': datetime.now(timezone.utc).isoformat(),
                'status': 'Active'
            }).eq('id', faci_data['id']).execute()
        except Exception as e:
            print(f"Failed to update login status in backend: {e}")

        return jsonify({
            "message": "Login successful",
            "faci": {
                "id": faci_data['id'],
                "full_name": faci_data['full_name'],
                "section": faci_data['section'],
                "subject": faci_data['subject'],
                "teacher_id": faci_data.get('teacher_id')
            }
        }), 200
    except Exception as e:
        print(f"Faci Login Error: {e}")
        return jsonify({"error": "Server error. Please try again later."}), 500


# ══════════════════════════════════════════════════════════════════════════════
# AI ASSISTANT — HELPER FUNCTIONS
# Uses Groq as the primary LLM provider and Gemini as an automatic fallback
# when Groq hits rate limits or token quota.
# ══════════════════════════════════════════════════════════════════════════════

def _clean_text(value, fallback=""):
    """
    Safely convert any value to a stripped string.
    Returns fallback if the value is None.
    """
    if value is None:
        return fallback
    return str(value).strip()

GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']


def _groq_chat(api_key, prompt):
    """
    Send a prompt to the Groq API and return the text reply.
    Tries each model in GROQ_MODELS order (or the GROQ_MODEL env override first).
    Raises RuntimeError if all models fail or return empty replies.

    Args:
        api_key (str): Groq API key from the environment.
        prompt  (str): Full prompt string including class data and the teacher's question.

    Returns:
        str: The AI-generated reply text.

    Raises:
        RuntimeError: If no model returns a usable response.
    """
    import httpx
    primary = os.getenv('GROQ_MODEL')
    # Put the env-override model first, then fall through to the defaults
    models = ([primary] if primary else []) + [m for m in GROQ_MODELS if m != primary]
    last_err = None
    for m in models:
        try:
            r = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
                json={"model": m, "messages": [{"role": "user", "content": prompt}], "temperature": 0.5, "max_tokens": 3000},
                timeout=40.0
            )
            if r.status_code == 200:
                reply = (((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                if reply:
                    return reply
                last_err = "empty reply"
            else:
                last_err = str(r.status_code) + " " + r.text[:200]
                # Stop retrying on non-model errors (e.g. auth, server errors); only retry on 400/404 (bad model)
                if r.status_code not in (400, 404):
                    break
        except Exception as e:
            last_err = str(e)
    raise RuntimeError(last_err or "Groq returned no reply")


# Cached list of available Gemini models — populated once on first use to avoid repeated API calls
_GEMINI_MODELS = None


def _gemini_candidates(client):
    """
    Build and cache a prioritized list of available Gemini models.
    Flash (faster/cheaper) models are placed first.
    Respects a GEMINI_MODEL env override to pin a specific model.

    Args:
        client: An initialized google.genai.Client instance.

    Returns:
        list[str]: Model name strings to try in order.
    """
    global _GEMINI_MODELS
    if _GEMINI_MODELS is not None:
        return _GEMINI_MODELS
    override = os.getenv('GEMINI_MODEL')
    if override:
        _GEMINI_MODELS = [override]
        return _GEMINI_MODELS
    flashes, others = [], []
    try:
        for mm in client.models.list():
            nm = (getattr(mm, 'name', '') or '').split('/')[-1]
            actions = list(getattr(mm, 'supported_actions', None) or [])
            if nm and nm.lower().startswith('gemini') and (not actions or 'generateContent' in actions):
                (flashes if 'flash' in nm.lower() else others).append(nm)
    except Exception:
        pass
    # Default fallback names if the model list API fails
    _GEMINI_MODELS = (flashes + others) or ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest']
    return _GEMINI_MODELS


# ══════════════════════════════════════════════════════════════════════════════
# AI ASSISTANT — MAIN ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/ai-evaluate', methods=['POST'])
@limiter.limit("20 per minute")
def ai_evaluate():
    """
    Core AI assistant endpoint. Accepts a teacher's natural-language question
    and pre-built class data context, then returns a formatted AI analysis.

    Flow:
        1. Validate input (question is required; context is trimmed to 4500 chars)
        2. Build a structured system prompt with role, format rules, and grade weights
        3. Try Groq first (faster, free-tier friendly)
        4. If Groq hits a rate/token limit, automatically fall back to Gemini
        5. Return the formatted reply as JSON

    Rate Limit: 20 requests per minute per IP

    Expects JSON body:
        question (str): The teacher's question (supports English, Hiligaynon, Filipino)
        context  (str): Pre-built class data string from buildAIContext() on the frontend

    Returns:
        200: { reply: str }  — formatted HTML-ready markdown string
        400: { error: "Missing question" }
        429: { error: "Rate limit reached" }
        502: { error: "AI provider error" }
        503: { error: "AI not configured" }
    """
    data = request.get_json(silent=True) or {}
    question = _clean_text(data.get('question'))
    context = _clean_text(data.get('context'))

    if not question:
        return jsonify({"error": "Missing question"}), 400
    if len(context) > 6000:
        context = context[:6000]

    # Build the system prompt sent to the AI model.
    # Defines the assistant's role, strict response format, grading rules, and the class data.
    prompt = (
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

    groq_key = os.getenv('GROQ_API_KEY')
    gemini_key = os.getenv('GEMINI_API_KEY')
    groq_err = None

    # ── Step 1: Try Groq (primary provider) ───────────────────────────────────
    if groq_key:
        try:
            return jsonify({"reply": _groq_chat(groq_key, prompt)}), 200
        except Exception as e:
            groq_err = str(e)
            is_limit = any(x in groq_err for x in ['429', '413', 'limit', 'rate', 'token', 'quota'])
            if gemini_key and is_limit:
                # Groq is rate-limited — silently fall through to Gemini
                print(f"Groq limited — falling back to Gemini: {groq_err[:120]}")
            else:
                # Non-rate-limit error (e.g. bad key, model error) — return immediately
                print(f"Groq error: {groq_err}")
                return jsonify({"error": "The AI service is having trouble right now. Please try again in a moment."}), 502

    # ── Step 2: Gemini fallback ────────────────────────────────────────────────
    # Used when Groq hits rate/token limits, or when only a Gemini key is configured
    if not gemini_key:
        return jsonify({"error": "AI is not configured yet. Add GROQ_API_KEY (or GEMINI_API_KEY) on the server."}), 503

    try:
        from google import genai
        client = genai.Client(api_key=gemini_key)
        last_err = None
        # Try up to 4 Gemini models (flash models first for speed and cost efficiency)
        for m in _gemini_candidates(client)[:4]:
            try:
                resp = client.models.generate_content(model=m, contents=prompt)
                reply = (getattr(resp, 'text', '') or '').strip()
                if reply:
                    return jsonify({"reply": reply}), 200
            except Exception as me:
                last_err = me
                es = str(me)
                # Surface rate-limit errors immediately with a user-friendly message
                if '429' in es or 'RESOURCE_EXHAUSTED' in es:
                    return jsonify({"error": "The AI hit its free-tier rate limit. Please wait a moment and try again."}), 429
        print(f"Gemini error: {last_err}")
        return jsonify({"error": "The AI service is having trouble right now. Please try again in a moment."}), 502
    except Exception as e:
        print(f"AI Evaluate Error: {e}")
        return jsonify({"error": "The AI service is having trouble right now. Please try again in a moment."}), 500


if __name__ == '__main__':
    app.run(debug=False, port=5000)
