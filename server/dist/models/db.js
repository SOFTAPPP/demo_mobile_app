"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingQueries = exports.userQueries = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const DB_PATH = path_1.default.join(__dirname, '..', '..', 'data', 'app.db');
// Ensure data directory exists
const fs_1 = __importDefault(require("fs"));
const dataDir = path_1.default.dirname(DB_PATH);
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
const db = new better_sqlite3_1.default(DB_PATH);
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
// User queries
exports.userQueries = {
    create: db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
    findByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
    findById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    getAll: db.prepare(`SELECT id, name, email, role, avatar_color, created_at FROM users`),
};
// Meeting queries
exports.meetingQueries = {
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
exports.default = db;
//# sourceMappingURL=db.js.map