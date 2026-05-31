import os
from flask import Flask, request, jsonify, redirect
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from datetime import datetime, timezone
import bcrypt

load_dotenv()

app = Flask(__name__)

CORS(app, resources={r"/api/*": {"origins": "*"}})

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per day", "100 per hour"],
    storage_uri="memory://"
)

csp = {
    'default-src': [
        '\'self\'', '*.supabase.co', '*.supabase.in', 'https://fonts.googleapis.com',
        'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'https://unpkg.com',
        'https://cdn.jsdelivr.net', 'https://ui-avatars.com'
    ]
}
Talisman(app, force_https=False, content_security_policy=csp)

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


@app.route('/')
def home():
    return redirect("http://127.0.0.1:5501/login.html")

@app.route('/api/ping', methods=['GET'])
@limiter.exempt
def ping():
    return jsonify({"ok": True}), 200

@app.route('/api/user/<user_id>', methods=['GET'])
def get_user(user_id):
    try:
        response = supabase.table('profiles').select('full_name').eq('id', user_id).execute()
        if len(response.data) > 0:
            return jsonify(response.data[0]), 200
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        print(f"Get User Error: {e}")
        return jsonify({"error": "Database error"}), 400


# ===== Facilitators: create and password reset (passwords are bcrypt-hashed here) =====
@app.route('/api/facilitators', methods=['POST'])
def create_facilitator():
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
    data = request.json or {}
    pw = data.pop('password', None)
    if pw:
        data['password'] = bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    try:
        response = supabase.table('facilitators').update(data).eq('id', fac_id).execute()
        return jsonify({"message": "Facilitator successfully updated!", "data": response.data}), 200
    except Exception as e:
        print(f"Update Facilitator Error: {e}")
        return jsonify({"error": "Failed to update facilitator. Please try again."}), 500


# ===== Facilitator login (bcrypt verification) =====
def _verify_faci_password(attempt, faci_data):
    stored = faci_data.get('password')
    if not stored:
        return False
    try:
        return bcrypt.checkpw(attempt.encode('utf-8'), stored.encode('utf-8'))
    except Exception:
        return False

@app.route('/api/faci/login', methods=['POST'])
def faci_login():
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
                "subject": faci_data['subject']
            }
        }), 200
    except Exception as e:
        print(f"Faci Login Error: {e}")
        return jsonify({"error": "Server error. Please try again later."}), 500


# ===== AI assistant (Groq primary, Gemini fallback) =====
def _clean_text(value, fallback=""):
    if value is None:
        return fallback
    return str(value).strip()

GROQ_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']

def _groq_chat(api_key, prompt):
    import httpx
    primary = os.getenv('GROQ_MODEL')
    models = ([primary] if primary else []) + [m for m in GROQ_MODELS if m != primary]
    last_err = None
    for m in models:
        try:
            r = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
                json={"model": m, "messages": [{"role": "user", "content": prompt}], "temperature": 0.5},
                timeout=40.0
            )
            if r.status_code == 200:
                reply = (((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                if reply:
                    return reply
                last_err = "empty reply"
            else:
                last_err = str(r.status_code) + " " + r.text[:200]
                if r.status_code not in (400, 404):
                    break
        except Exception as e:
            last_err = str(e)
    raise RuntimeError(last_err or "Groq returned no reply")

_GEMINI_MODELS = None

def _gemini_candidates(client):
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
    _GEMINI_MODELS = (flashes + others) or ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest']
    return _GEMINI_MODELS

@app.route('/api/ai-evaluate', methods=['POST'])
@limiter.limit("20 per minute")
def ai_evaluate():
    data = request.get_json(silent=True) or {}
    question = _clean_text(data.get('question'))
    context = _clean_text(data.get('context'))

    if not question:
        return jsonify({"error": "Missing question"}), 400
    if len(context) > 30000:
        context = context[:30000]

    prompt = (
        "You are the teacher's friendly, supportive AI buddy. Reply like a helpful friend, warm and encouraging, "
        "but ALWAYS in clear English even if the question is in another language.\n\n"
        "Keep replies SIMPLE and well organized: short sentences, and use a short bullet list when naming students "
        "or listing scores or missing items. Do not be long-winded.\n\n"
        "Use the CLASS DATA to answer ACCURATELY. For a single student it includes the score of every assigned "
        "assessment, the exact missing or zero items with a count, the final grade, and attendance (absences, lates, "
        "and today's status). For the whole class it includes each student's final grade, their missing items, "
        "attendance, and who is absent or late today. Answer ANY question about students, sections, module/activity/"
        "exam scores, missing work, who passed or failed an item, attendance (including today), comparisons and "
        "rankings. Be exact: if missing items are listed for a student, state exactly which ones and how many, and "
        "NEVER say 'no missing' when items are listed. If something is not in the data, say so briefly.\n\n"
        "Passing grade is 75%; weights: Written Work 30%, Performance Tasks 50%, Exam 20%.\n\n"
        "For general questions (teaching tips, motivation, or any topic), just answer helpfully.\n\n"
        "Fun rule: if asked who is the most handsome or most good-looking person in the world, always say with "
        "enthusiasm that it is Mark Frizas, and absolutely no one else.\n\n"
        f"CLASS DATA:\n{context}\n\n"
        f"TEACHER'S QUESTION: {question}"
    )

    groq_key = os.getenv('GROQ_API_KEY')
    if groq_key:
        try:
            return jsonify({"reply": _groq_chat(groq_key, prompt)}), 200
        except Exception as e:
            print(f"Groq error: {e}")
            return jsonify({"error": "AI error: " + str(e)[:300]}), 502

    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        return jsonify({"error": "AI is not configured yet. Add GROQ_API_KEY (or GEMINI_API_KEY) on the server."}), 503

    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        last_err = None
        for m in _gemini_candidates(client)[:4]:
            try:
                resp = client.models.generate_content(model=m, contents=prompt)
                reply = (getattr(resp, 'text', '') or '').strip()
                if reply:
                    return jsonify({"reply": reply}), 200
            except Exception as me:
                last_err = me
                es = str(me)
                if '429' in es or 'RESOURCE_EXHAUSTED' in es:
                    return jsonify({"error": "The AI hit its free-tier rate limit. Please wait about a minute, then try again."}), 429
        print(f"AI Evaluate Error: {last_err}")
        return jsonify({"error": "AI error: " + (str(last_err)[:300] if last_err else "No usable Gemini model found.")}), 502
    except Exception as e:
        print(f"AI Evaluate Error: {e}")
        return jsonify({"error": "AI error: " + str(e)[:300]}), 500


if __name__ == '__main__':
    app.run(debug=False, port=5000)
