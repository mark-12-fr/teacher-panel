   # 🎓 Teacher Management Portal
**A Modern, AI-Powered Dashboard for Academic Excellence**

The **Teacher Management Portal** is a high-performance web application designed specifically for educators at PHINMA University of Iloilo. It streamlines classroom management, attendance tracking, and student performance analytics through a clean, intuitive, and mobile-responsive interface.

---

## ✨ Key Features

*   **Glassmorphic Dashboard**: A professional UI featuring modern glassmorphism effects and consistent layout spacing for a premium user experience.
*   **Real-Time Analytics**: Visualizes student performance and section data using dynamic charts and data visualizations.
*   **AI Assistant Integration**: Features an embedded AI assistant capable of answering complex queries regarding student records, attendance trends, and module submissions.
*   **Live Database Sync**: Built with Supabase to ensure that teacher data and facilitator updates are synchronized in real-time.
*   **Progressive Web App (PWA)**: Installable on mobile devices with a custom splash screen and offline-ready manifest configuration.

---

## 🛠️ Tech Stack

*   **Frontend**: React 18, Next.js 14 (TypeScript)
*   **Backend**: FastAPI (Python, async)
*   **Database**: Supabase (PostgreSQL) with Real-time capabilities
*   **AI**: Groq (primary) + Gemini (fallback)
*   **Hosting**: Vercel (Frontend), Render (Backend)

---

## 📁 Project Structure

```
teacher-panel/
├── frontend/      # Next.js frontend (React + TypeScript)
├── backend/       # FastAPI backend (Python)
├── api/           # Vercel serverless functions
├── config/        # Deployment configs (Render, DEPLOY.md)
├── database/      # SQL schemas / migrations
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
*   Node.js 18+
*   Python 3.11+
*   Supabase Account & Project Keys

### Installation
1. **Clone the repository**:
   ```bash
   git clone https://github.com/mark-12-fr/teacher-panel.git
