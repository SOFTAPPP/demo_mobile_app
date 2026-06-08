# 🎵 Sangeet Arghya — Nada Upasana Academy

## Online Music Class Meeting App

A cross-platform real-time video/audio meeting application built for Sangeet Arghya's online music classes. Supports up to **100 students** in a single meeting.

### Features
- ✅ Authentication (Login / Signup)
- ✅ Premium Dashboard with meeting management
- ✅ Group Video/Audio calls (up to 100 participants)
- ✅ Optimized audio for music (Opus 48kHz, no noise suppression)
- ✅ Cross-platform (Web + Android APK via Capacitor)

### Tech Stack
- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Node.js + Express + TypeScript
- **Media Server:** LiveKit (SFU for group calls)
- **Database:** SQLite
- **Mobile:** Capacitor 6

---

## Quick Start

### 1. Start the Backend Server
```bash
cd server
npm install
npm run dev
```

### 2. Start the Frontend
```bash
cd client
npm install
npm run dev
```

### 3. Open in Browser
Navigate to `http://localhost:5173`

---

## LiveKit Setup (for real video/audio)

1. Go to [LiveKit Cloud](https://cloud.livekit.io) → Sign up (free)
2. Create a project → Get API Key + Secret
3. Update `server/.env`:
```
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
```

**Without LiveKit credentials**, the app runs in **demo mode** with local camera preview and simulated participants.

---

## Project Structure
```
demo_mobile_app/
├── client/          # React + Vite frontend
│   ├── src/
│   │   ├── pages/       # Login, Signup, Dashboard, Meeting
│   │   ├── context/     # Auth context
│   │   ├── services/    # API service
│   │   ├── styles/      # CSS design system
│   │   └── types/       # TypeScript types
│   └── ...
├── server/          # Node.js + Express backend
│   ├── src/
│   │   ├── routes/      # Auth, Meeting API routes
│   │   ├── services/    # JWT, LiveKit services
│   │   ├── models/      # SQLite database
│   │   └── middleware/  # Auth middleware
│   └── ...
└── README.md
```
