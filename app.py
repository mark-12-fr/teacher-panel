import os
from flask import Flask, request, jsonify, redirect
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv

# Security kag Real-time Imports
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from flask_socketio import SocketIO, emit
from datetime import datetime, timezone

load_dotenv()

app = Flask(__name__)

# --- 1. SECURITY CONFIGURATION ---
# Gina-allow lang ang imo frontend port (5500)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Rate Limiter para iwas spam/bots
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per day", "100 per hour"],
    storage_uri="memory://"
)

# Content Security Policy para protektado sa scripts
csp = {
    'default-src': [
        '\'self\'', '*.supabase.co', '*.supabase.in', 'https://fonts.googleapis.com',
        'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'https://unpkg.com',
        'https://cdn.jsdelivr.net', 'https://ui-avatars.com'
    ]
}
Talisman(app, force_https=False, content_security_policy=csp)

# --- 2. SOCKET.IO & DATABASE SETUP ---
# Use threading mode so Supabase/httpx requests stay stable on Windows.
socketio = SocketIO(app, cors_allowed_origins="http://127.0.0.1:5500", async_mode="threading")

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- WEBSOCKET EVENTS ---
@socketio.on('connect')
def handle_connect():
    print("Client connected via WebSocket!")
    emit('realtime_notification', {'message': 'Real-time server connected!'})

@socketio.on('send_global_notice')
def handle_global_notice(data):
    emit('realtime_notification', {'message': f"New Notice: {data['notice_text']}"}, broadcast=True)

# --- AUTH & USER ROUTES ---
@app.route('/')
def home():
    return redirect("http://127.0.0.1:5501/login.html")

@app.route('/api/auth/check_email', methods=['GET'])
def check_email():
    email = request.args.get('email')
    try:
        response = supabase.table('profiles').select('*').eq('email', email).execute()
        return jsonify({"exists": len(response.data) > 0}), 200
    except Exception as e:
        print(f"Check email error: {e}")
        return jsonify({"error": "Server error"}), 400

@app.route('/api/auth/signup', methods=['POST'])
def signup():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    full_name = data.get('full_name')
    
    try:
        # 1. I-register ang user sa Supabase Auth
        response = supabase.auth.sign_up({"email": email, "password": password})
        
        if response.user:
            # 2. I-insert ang detalye sa 'profiles' table
            supabase.table('profiles').insert({
                "id": response.user.id,
                "full_name": full_name,
                "email": email
            }).execute()
            return jsonify({"message": "Success", "user_id": response.user.id}), 201
        else:
            return jsonify({"error": "Signup failed. User not created."}), 400
            
    except Exception as e:
        print(f"Signup Error: {str(e)}")
        return jsonify({"error": f"Signup failed: {str(e)}"}), 400

@app.route('/api/auth/google', methods=['GET'])
def google_login():
    try:
        res = supabase.auth.sign_in_with_oauth({"provider": 'google', "options": {"redirect_to": 'http://127.0.0.1:5500/index.html'}})
        return jsonify({"url": res.url}), 200
    except Exception as e:
        print(f"Google Login Error: {e}")
        return jsonify({"error": "OAuth Error"}), 400

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

# ==========================================
# --- SCHEDULE ROUTES ---
# ==========================================
@app.route('/api/schedules', methods=['GET', 'POST'])
def handle_schedules():
    if request.method == 'POST':
        data = request.json
        user_id = data.get('user_id')
        subject = data.get('subject')
        time = data.get('time')
        details = data.get('details')

        if not all([user_id, subject, time, details]):
            return jsonify({"error": "Missing data fields"}), 400

        try:
            response = supabase.table('schedules').insert({
                'user_id': user_id,
                'subject': subject,
                'time': time,
                'details': details
            }).execute()
            return jsonify({"message": "Schedule added!", "data": response.data}), 201
        except Exception as e:
            print(f"Insert Schedule Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'GET':
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({"error": "Missing user_id parameter"}), 400

        try:
            response = supabase.table('schedules').select('*').eq('user_id', user_id).order('created_at').execute()
            return jsonify({"data": response.data}), 200
        except Exception as e:
            print(f"Get Schedules Error: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/schedules/<schedule_id>', methods=['DELETE'])
def delete_schedule(schedule_id):
    try:
        supabase.table('schedules').delete().eq('id', schedule_id).execute()
        return jsonify({"message": "Schedule deleted"}), 200
    except Exception as e:
        print(f"Delete Schedule Error: {e}")
        return jsonify({"error": str(e)}), 500


# ==========================================
# --- NOTES ROUTES ---
# ==========================================
@app.route('/api/notes', methods=['GET', 'POST'])
def handle_notes():
    if request.method == 'POST':
        data = request.json
        user_id = data.get('user_id')
        content = data.get('content')

        if not user_id or not content:
            return jsonify({"error": "Missing data fields"}), 400

        try:
            response = supabase.table('notes').insert({
                'user_id': user_id,
                'content': content
            }).execute()
            return jsonify({"message": "Note added!", "data": response.data}), 201
        except Exception as e:
            print(f"Insert Note Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'GET':
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({"error": "Missing user_id parameter"}), 400

        try:
            response = supabase.table('notes').select('*').eq('user_id', user_id).order('created_at', desc=True).execute()
            return jsonify({"data": response.data}), 200
        except Exception as e:
            print(f"Get Notes Error: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/notes/<note_id>', methods=['DELETE'])
def delete_note(note_id):
    try:
        supabase.table('notes').delete().eq('id', note_id).execute()
        return jsonify({"message": "Note deleted"}), 200
    except Exception as e:
        print(f"Delete Note Error: {e}")
        return jsonify({"error": str(e)}), 500


# ==========================================
# --- NOTICES ROUTES ---
# ==========================================
@app.route('/api/notices', methods=['GET', 'POST'])
def handle_notices():
    if request.method == 'POST':
        data = request.json
        user_id = data.get('user_id')
        text = data.get('text')
        date = data.get('date')
        color = data.get('color', 'blue')

        if not all([user_id, text, date]):
            return jsonify({"error": "Missing data fields"}), 400

        try:
            response = supabase.table('notices').insert({
                'user_id': user_id,
                'text': text,
                'date': date,
                'color': color
            }).execute()
            
            socketio.emit('realtime_notification', {'message': f"New Notice Added: {text}"}, broadcast=True)
            return jsonify({"message": "Notice added!", "data": response.data}), 201
        except Exception as e:
            print(f"Insert Notice Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'GET':
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({"error": "Missing user_id parameter"}), 400

        try:
            response = supabase.table('notices').select('*').eq('user_id', user_id).order('created_at', desc=True).execute()
            return jsonify({"data": response.data}), 200
        except Exception as e:
            print(f"Get Notices Error: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/notices/<notice_id>', methods=['DELETE'])
def delete_notice(notice_id):
    try:
        supabase.table('notices').delete().eq('id', notice_id).execute()
        return jsonify({"message": "Notice deleted"}), 200
    except Exception as e:
        print(f"Delete Notice Error: {e}")
        return jsonify({"error": str(e)}), 500


# ==========================================
# --- SECTIONS ROUTES (WITH SEMESTER) ---
# ==========================================
@app.route('/api/sections', methods=['GET', 'POST'])
def handle_sections():
    if request.method == 'POST':
        data = request.json
        teacher_id = data.get('teacher_id')
        title = data.get('title')
        subject = data.get('subject')
        room = data.get('room')
        semester = data.get('semester', '1st Sem')

        if not all([teacher_id, title, subject, room]):
            return jsonify({"error": "Missing data fields"}), 400

        try:
            response = supabase.table('sections').insert({
                'teacher_id': teacher_id,
                'title': title,
                'subject': subject,
                'room': room,
                'semester': semester 
            }).execute()
            return jsonify({"message": "Section added!", "data": response.data}), 201
        except Exception as e:
            print(f"Insert Section Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'GET':
        teacher_id = request.args.get('teacher_id')
        if not teacher_id:
            return jsonify({"error": "Missing teacher_id parameter"}), 400

        try:
            response = supabase.table('sections').select('*, students(count)').eq('teacher_id', teacher_id).order('created_at', desc=True).execute()
            return jsonify({"data": response.data}), 200
        except Exception as e:
            print(f"Get Sections Error: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/sections/<section_id>', methods=['PUT', 'DELETE'])
def handle_single_section(section_id):
    if request.method == 'PUT':
        data = request.json
        if 'students' in data:
            del data['students']
            
        try:
            response = supabase.table('sections').update(data).eq('id', section_id).execute()
            return jsonify({"message": "Section updated!", "data": response.data}), 200
        except Exception as e:
            print(f"Update Section Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'DELETE':
        try:
            supabase.table('sections').delete().eq('id', section_id).execute()
            return jsonify({"message": "Section deleted"}), 200
        except Exception as e:
            print(f"Delete Section Error: {e}")
            return jsonify({"error": str(e)}), 500
        

# ==========================================
# --- STUDENTS ROUTES ---
# ==========================================
@app.route('/api/students', methods=['GET', 'POST'])
def handle_students():
    if request.method == 'POST':
        data = request.json
        section_id = data.get('section_id')
        id_no = data.get('id_no')
        full_name = data.get('full_name')
        gender = data.get('gender')

        if not all([section_id, id_no, full_name, gender]):
            return jsonify({"error": "Missing data fields"}), 400

        try:
            response = supabase.table('students').insert({
                'section_id': section_id,
                'id_no': id_no,
                'full_name': full_name,
                'gender': gender
            }).execute()
            return jsonify({"message": "Student added!", "data": response.data}), 201
        except Exception as e:
            print(f"Insert Student Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'GET':
        section_id = request.args.get('section_id')
        if not section_id:
            return jsonify({"error": "Missing section_id parameter"}), 400

        try:
            response = supabase.table('students').select('*').eq('section_id', section_id).order('created_at').execute()
            return jsonify({"data": response.data}), 200
        except Exception as e:
            print(f"Get Students Error: {e}")
            return jsonify({"error": str(e)}), 500

# ==========================================
# --- AI ASSISTANT ROUTE ---
# ==========================================
def _clean_text(value, fallback=""):
    if value is None:
        return fallback
    return str(value).strip()

def _clean_user_id(value):
    return _clean_text(value).replace('"', '').replace("'", "")

def _shorten(value, limit=90):
    text = _clean_text(value)
    if len(text) <= limit:
        return text
    return text[:limit - 3] + "..."

def _teacher_context(user_id):
    context = {
        "profile": {},
        "sections": [],
        "students": [],
        "schedules": [],
        "notes": [],
        "notices": []
    }

    if not user_id:
        return context

    try:
        profile_res = supabase.table('profiles').select('full_name').eq('id', user_id).limit(1).execute()
        if profile_res.data:
            context["profile"] = profile_res.data[0]
    except Exception as e:
        print(f"AI profile context error: {e}")

    try:
        sections_res = supabase.table('sections').select('id,title,subject,room,created_at').eq('teacher_id', user_id).order('created_at', desc=True).execute()
        sections = sections_res.data or []

        for section in sections:
            try:
                students_res = supabase.table('students').select('id,id_no,full_name,gender,section_id').eq('section_id', section.get('id')).order('full_name').execute()
                students = students_res.data or []
            except Exception as e:
                print(f"AI students context error: {e}")
                students = []

            section["student_count"] = len(students)
            for student in students:
                student["section_title"] = section.get("title", "")
                student["section_subject"] = section.get("subject", "")
                context["students"].append(student)

        context["sections"] = sections
    except Exception as e:
        print(f"AI sections context error: {e}")

    for table_name, order_desc in [('schedules', False), ('notes', True), ('notices', True)]:
        try:
            query = supabase.table(table_name).select('*').eq('user_id', user_id).order('created_at', desc=order_desc).limit(5)
            context[table_name] = query.execute().data or []
        except Exception as e:
            print(f"AI {table_name} context error: {e}")

    return context

def _format_sections(sections):
    if not sections:
        return "No sections are saved in your account yet."

    lines = []
    for section in sections[:8]:
        title = _shorten(section.get('title'), 40) or "Untitled Section"
        subject = _shorten(section.get('subject'), 35) or "No subject"
        room = _shorten(section.get('room'), 25) or "No room"
        count = section.get('student_count', 0)
        label = "student" if count == 1 else "students"
        lines.append(f"- {title} - {subject} | Room: {room} | {count} {label}")
    return "\n".join(lines)

def _format_students(students):
    if not students:
        return "No students are saved in your sections yet."

    lines = []
    for student in students[:12]:
        name = _shorten(student.get('full_name'), 45) or "Unnamed Student"
        id_no = _shorten(student.get('id_no'), 20) or "No ID"
        section = _shorten(student.get('section_title'), 35) or "No section"
        lines.append(f"- {name} | ID: {id_no} | Section: {section}")
    if len(students) > 12:
        lines.append(f"...and {len(students) - 12} more students.")
    return "\n".join(lines)

def _find_students(message, students):
    words = [word for word in message.lower().replace(",", " ").replace(".", " ").split() if len(word) >= 3]
    ignored = {"student", "students", "record", "records", "search", "find", "sino", "nga", "ang", "id"}
    words = [word for word in words if word not in ignored]

    if not words:
        return []

    matches = []
    for student in students:
        searchable = f"{student.get('full_name', '')} {student.get('id_no', '')}".lower()
        if any(word in searchable for word in words):
            matches.append(student)
    return matches

def _assistant_reply(message, context, page_name):
    lower = message.lower()
    sections = context["sections"]
    students = context["students"]
    schedules = context["schedules"]
    notes = context["notes"]
    notices = context["notices"]
    teacher_name = context["profile"].get("full_name") or "Teacher"

    total_sections = len(sections)
    total_students = len(students)

    if any(word in lower for word in ["help", "bulig", "ano mahimo", "commands", "guide"]):
        return (
            f"Good day, {teacher_name}.\n\n"
            "I can assist you with the following areas:\n"
            "- Dashboard summary\n"
            "- Sections and class details\n"
            "- Student lists and student records\n"
            "- Schedules\n"
            "- Notes\n"
            "- Notices and announcements\n"
            "- Attendance or performance status\n\n"
            "You may ask questions such as: 'How many students do I have?', 'Show my sections', or 'Find student Juan'."
        )

    if any(word in lower for word in ["section", "sections", "class", "classes", "subject", "room"]):
        return (
            "Class Summary\n\n"
            f"Total sections: {total_sections}\n"
            f"Total students: {total_students}\n\n"
            f"Section details:\n{_format_sections(sections)}"
        )

    if any(word in lower for word in ["student", "students", "learner", "record", "id no", "id_no", "sino"]):
        matches = _find_students(message, students)
        if matches:
            return "Student Search Results\n\n" + _format_students(matches)
        return (
            "Student Summary\n\n"
            f"Total students: {total_students}\n\n"
            f"Student records:\n{_format_students(students)}"
        )

    if any(word in lower for word in ["schedule", "schedules", "klase", "time", "oras"]):
        if not schedules:
            return "No schedules are saved in your dashboard yet."
        lines = []
        for item in schedules:
            subject = _shorten(item.get('subject'), 40) or "No subject"
            time = _shorten(item.get('time'), 25) or "No time"
            details = _shorten(item.get('details'), 60) or "No details"
            lines.append(f"- {subject} | Time: {time} | Details: {details}")
        return "Schedule Overview\n\n" + "\n".join(lines)

    if any(word in lower for word in ["note", "notes", "memo"]):
        if not notes:
            return "No notes are saved in your dashboard yet."
        lines = [f"- {_shorten(item.get('content'), 100)}" for item in notes]
        return "Recent Notes\n\n" + "\n".join(lines)

    if any(word in lower for word in ["notice", "notices", "announcement", "announcements", "pahibalo"]):
        if not notices:
            return "No notices are saved in your dashboard yet."
        lines = []
        for item in notices:
            text = _shorten(item.get('text'), 80)
            date = _shorten(item.get('date'), 35)
            lines.append(f"- {text} | Date: {date}")
        return "Recent Notices\n\n" + "\n".join(lines)

    if any(word in lower for word in ["attendance", "absent", "present", "late"]):
        return (
            "Attendance Status\n\n"
            "The attendance interface is available, but a dedicated attendance records table is not connected to the assistant yet.\n\n"
            f"Current available class data: {total_students} students across {total_sections} sections."
        )

    if any(word in lower for word in ["performance", "quiz", "exam", "test", "grade", "module", "assignment"]):
        return (
            "Performance Status\n\n"
            "The performance and class-record pages are available, but a dedicated grades or quizzes table is not connected to the assistant yet.\n\n"
            f"Current available class data: {total_sections} sections and {total_students} students."
        )

    page_note = f"Current page: {page_name}.\n" if page_name else ""
    return (
        f"{page_note}Good day, {teacher_name}.\n\n"
        "Here is your current account summary:\n"
        f"- Sections: {total_sections}\n"
        f"- Students: {total_students}\n"
        f"- Schedules: {len(schedules)}\n"
        f"- Notes: {len(notes)}\n"
        f"- Notices: {len(notices)}\n\n"
        "You may ask me to show your sections, list students, review your schedule, or check recent notices."
    )

@app.route('/api/chat', methods=['POST'])
@limiter.limit("30 per minute")
def ai_chat():
    data = request.get_json(silent=True) or {}
    message = _clean_text(data.get('message'))
    user_id = _clean_user_id(data.get('user_id') or data.get('teacher_id'))
    page_name = _clean_text(data.get('page') or data.get('path'))

    if not message:
        return jsonify({"error": "Missing message"}), 400

    if len(message) > 1000:
        return jsonify({"error": "Message is too long"}), 400

    try:
        context = _teacher_context(user_id)
        if data.get('teacher_name') and not context["profile"].get("full_name"):
            context["profile"]["full_name"] = _shorten(data.get('teacher_name'), 60)

        reply = _assistant_reply(message, context, page_name)
        return jsonify({"reply": reply}), 200
    except Exception as e:
        print(f"AI Chat Error: {e}")
        return jsonify({"error": "AI assistant server error"}), 500
        

# ==========================================
# --- DASHBOARD STATS ROUTE (UPDATED) ---
# ==========================================
@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    teacher_id = request.args.get('teacher_id')
    if not teacher_id:
        return jsonify({"error": "Missing teacher_id parameter"}), 400

    clean_teacher_id = teacher_id.strip().replace('"', '').replace("'", "")

    try:
        # 1. Get Sections
        sections_res = supabase.table('sections').select('id, title').eq('teacher_id', clean_teacher_id).execute()
        sections_data = sections_res.data
        total_sections = len(sections_data)
        
        # 2. Get Students Count
        total_students = 0
        section_titles = []
        if total_sections > 0:
            for sec in sections_data:
                section_titles.append(sec['title'])
                stud_res = supabase.table('students').select('id').eq('section_id', sec['id']).execute()
                total_students += len(stud_res.data)

        # 3. Get Today's Attendance base sa gin-submit sang Faci
        today_date = datetime.now().strftime("%d/%m/%Y") # DD/MM/YYYY format
        today_present = 0
        today_absent = 0
        
        if section_titles:
            # Pangitaon tanan nga attendance nga nagtugma sa section sang teacher kag sa petsa subong
            att_res = supabase.table('attendance').select('status').in_('section', section_titles).eq('date', today_date).execute()
            for record in att_res.data:
                if record['status'] == 'Present':
                    today_present += 1
                elif record['status'] == 'Absent':
                    today_absent += 1

        return jsonify({
            "total_sections": total_sections,
            "total_students": total_students,
            "today_present": today_present,
            "today_absent": today_absent,
            "top_performers": [], 
            "overview_data": [] 
        }), 200

    except Exception as e:
        print(f"Dashboard Stats Error: {e}")
        return jsonify({"error": str(e)}), 500

# ==========================================
# --- GET ATTENDANCE FOR TEACHER PANEL ---
# ==========================================
@app.route('/api/attendance', methods=['GET'])
def get_attendance():
    # GINDUGANG: I-require ang teacher_id
    teacher_id = request.args.get('teacher_id')
    if not teacher_id:
        return jsonify({"error": "Missing teacher_id parameter"}), 400

    try:
        # GINDUGANG: Kuhaon anay ang mga sections nga gina-uyatan sang teacher
        sections_res = supabase.table('sections').select('title').eq('teacher_id', teacher_id).execute()
        section_titles = [sec['title'] for sec in sections_res.data]

        # Kon wala sya section, matik empty ang list sang attendance
        if not section_titles:
            return jsonify({"data": []}), 200

        # GINDUGANG: Kuhaon lang ang attendance nga nagatugma sa section_titles sang teacher
        response = supabase.table('attendance').select('*').in_('section', section_titles).order('created_at', desc=True).execute()
        return jsonify({"data": response.data}), 200
    except Exception as e:
        print(f"Get Attendance Error: {e}")
        return jsonify({"error": str(e)}), 500

# ==========================================
# --- FACILITATOR SYNC ROUTE (NEW) ---
# ==========================================
@app.route('/api/facilitator/sync', methods=['POST'])
def receive_faci_data():
    """
    HANDA NA PARA SA FACI WEB.
    Diri ma-sud ang Modules, Exams, Activity, kag Attendance halin sa mga Facilitators.
    """
    data = request.get_json()
    print("Data received from Facilitator Web:", data)
    return jsonify({
        "status": "success",
        "message": "Data received successfully from Facilitator. Ready for processing."
    }), 200
    
# ==========================================
# --- FACILITATORS ROUTES (NEW) ---
# ==========================================
@app.route('/api/facilitators', methods=['GET', 'POST'])
def handle_facilitators():
    if request.method == 'POST':
        data = request.json
        teacher_id = data.get('teacher_id') # GINDUGANG
        full_name = data.get('full_name')
        section = data.get('section')
        subject = data.get('subject')
        account_id = data.get('account_id')
        temporary_password = data.get('temporary_password')

        # I-check kon kompleto ang data halin sa form
        if not all([teacher_id, full_name, section, subject, account_id, temporary_password]):
            return jsonify({"error": "Missing required fields"}), 400

        try:
            # I-save sa 'facilitators' table sa Supabase upod ang teacher_id
            response = supabase.table('facilitators').insert({
                'teacher_id': teacher_id, # GINDUGANG
                'full_name': full_name,
                'section': section,
                'subject': subject,
                'account_id': account_id,
                'temporary_password': temporary_password
            }).execute()
            
            return jsonify({"message": "Facilitator assigned successfully!", "data": response.data}), 201
            
        except Exception as e:
            print(f"Insert Facilitator Error: {e}")
            return jsonify({"error": str(e)}), 500

    elif request.method == 'GET':
        # GINDUGANG: I-require ang teacher_id
        teacher_id = request.args.get('teacher_id')
        if not teacher_id:
            return jsonify({"error": "Missing teacher_id parameter"}), 400

        try:
            # GINDUGANG: I-filter gamit ang teacher_id
            response = supabase.table('facilitators').select('*').eq('teacher_id', teacher_id).order('created_at', desc=True).execute()
            return jsonify({"data": response.data}), 200
        except Exception as e:
            print(f"Get Facilitators Error: {e}")
            return jsonify({"error": str(e)}), 500
        
# ==========================================
# --- FACILITATOR LOGIN ROUTE (NEW) ---
# ==========================================
@app.route('/api/faci/login', methods=['POST'])
def faci_login():
    data = request.json
    account_id = data.get('account_id')
    password = data.get('password')

    if not account_id or not password:
        return jsonify({"error": "Please enter both Account ID and Password."}), 400

    try:
        # Pangitaon ang facilitator sa database gamit ang Account ID
        response = supabase.table('facilitators').select('*').eq('account_id', account_id).execute()
        
        # Kon wala may nakita nga account
        if not response.data:
            return jsonify({"error": "Invalid Account ID."}), 401
        
        faci_data = response.data[0]
        
        # I-check kon nagatugma ang password
        if faci_data['temporary_password'] != password:
            return jsonify({"error": "Incorrect Password."}), 401
        
        # Kon sakto tanan, i-return ang success response dala ang details sang faci
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
    
# ==========================================
# --- FACILITATOR PRESENCE / HEARTBEAT ROUTE ---
# ==========================================
@app.route('/api/faci/presence', methods=['POST'])
@limiter.exempt
def faci_presence():
    data = request.get_json(silent=True) or {}
    faci_id = data.get('faci_id')
    if not faci_id:
        return jsonify({"error": "Missing faci_id"}), 400

    # online True -> Active (green); online False (logout) -> Inactive (gray)
    is_online = data.get('online', True)
    new_value = datetime.now(timezone.utc).isoformat() if is_online else None

    try:
        supabase.table('facilitators').update({'last_login': new_value}).eq('id', faci_id).execute()
        return jsonify({"status": "success", "last_login": new_value}), 200
    except Exception as e:
        print(f"Faci Presence Error: {e}")
        return jsonify({"error": str(e)}), 500

# ==========================================
# --- DELETE FACILITATOR ROUTE ---
# ==========================================
@app.route('/api/facilitators/<fac_id>', methods=['DELETE'])
def delete_facilitator(fac_id):
    try:
        # I-delete ang record sa 'facilitators' table gamit ang ID
        response = supabase.table('facilitators').delete().eq('id', fac_id).execute()
        
        return jsonify({"message": "Facilitator successfully deleted!"}), 200
        
    except Exception as e:
        print(f"Delete Facilitator Error: {e}")
        return jsonify({"error": "Failed to delete facilitator. Please try again."}), 500
    
# ==========================================
# --- SUBMIT ATTENDANCE ROUTE ---
# ==========================================
@app.route('/api/attendance/submit', methods=['POST'])
def submit_attendance():
    data = request.json # Ini nagabaton sang array sang mga estudyante halin sa frontend
    try:
        # I-insert diretso sa Supabase ang bilog nga listahan
        response = supabase.table('attendance').insert(data).execute()
        return jsonify({"message": "Attendance successfully saved to database!"}), 201
    except Exception as e:
        print(f"Attendance Submit Error: {e}")
        return jsonify({"error": str(e)}), 500

# ==========================================
# --- UPDATE/EDIT FACILITATOR ROUTE ---
# ==========================================
@app.route('/api/facilitators/<fac_id>', methods=['PUT'])
def update_facilitator(fac_id):
    data = request.json
    try:
        # I-update ang record sa 'facilitators' table gamit ang ID
        response = supabase.table('facilitators').update(data).eq('id', fac_id).execute()
        return jsonify({"message": "Facilitator successfully updated!", "data": response.data}), 200
    except Exception as e:
        print(f"Update Facilitator Error: {e}")
        return jsonify({"error": "Failed to update facilitator. Please try again."}), 500
    
# ==========================================
# --- SUBMIT CLASS RECORD SCORES ---
# ==========================================
@app.route('/api/record/submit', methods=['POST'])
def submit_record():
    data = request.json # Array sang mga estudyante kag ila scores
    if not data:
         return jsonify({"error": "No data provided"}), 400
         
    section = data[0].get('section')
    
    try:
        # Delete daan nga records sang section para i-overwrite (Upsert logic)
        supabase.table('class_records').delete().eq('section', section).execute()
        
        # Insert ang bag-o nga scores
        response = supabase.table('class_records').insert(data).execute()
        return jsonify({"message": "Class records successfully saved!"}), 201
    except Exception as e:
        print(f"Record Submit Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    socketio.run(app, debug=False, port=5000)