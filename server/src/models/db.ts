import Database from 'better-sqlite3';
import type { Database as DBType, Statement } from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: DBType = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'student',
    avatar_color TEXT DEFAULT '#7B2D26',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create meetings table
db.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    room_code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    host_id TEXT NOT NULL,
    max_participants INTEGER DEFAULT 100,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    FOREIGN KEY (host_id) REFERENCES users(id)
  )
`);

// Create meeting participants table
db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_participants (
    meeting_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (meeting_id, user_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  avatar_color: string;
  created_at: string;
}

export interface Meeting {
  id: string;
  room_code: string;
  title: string;
  host_id: string;
  max_participants: number;
  is_active: number;
  created_at: string;
  ended_at: string | null;
}

// User queries
export const userQueries: Record<string, Statement> = {
  create: db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  findByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  findById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  getAll: db.prepare(`SELECT id, name, email, role, avatar_color, created_at FROM users`),
};

// Meeting queries
export const meetingQueries: Record<string, Statement> = {
  create: db.prepare(`
    INSERT INTO meetings (id, room_code, title, host_id, max_participants)
    VALUES (?, ?, ?, ?, ?)
  `),
  findByCode: db.prepare(`SELECT * FROM meetings WHERE room_code = ?`),
  findById: db.prepare(`SELECT * FROM meetings WHERE id = ?`),
  getActiveByHost: db.prepare(`SELECT * FROM meetings WHERE host_id = ? AND is_active = 1`),
  getRecent: db.prepare(`
    SELECT DISTINCT m.* FROM meetings m
    LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id
    WHERE m.host_id = ? OR mp.user_id = ?
    ORDER BY m.created_at DESC
    LIMIT 10
  `),
  endMeeting: db.prepare(`UPDATE meetings SET is_active = 0, ended_at = datetime('now') WHERE room_code = ?`),
  getActive: db.prepare(`SELECT * FROM meetings WHERE is_active = 1`),
  deleteMeeting: db.prepare(`DELETE FROM meetings WHERE id = ? AND host_id = ?`),
};

export default db;
