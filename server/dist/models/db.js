"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordingQueries = exports.meetingQueries = exports.userQueries = exports.initializeDatabase = void 0;
const client_1 = require("@libsql/client");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const url = process.env.TURSO_DATABASE_URL || 'file:../../data/app.db';
const authToken = process.env.TURSO_AUTH_TOKEN;
// If using local file fallback, ensure data directory exists
if (url.startsWith('file:')) {
    const DB_PATH = path_1.default.join(__dirname, '..', '..', 'data', 'app.db');
    const dataDir = path_1.default.dirname(DB_PATH);
    if (!fs_1.default.existsSync(dataDir)) {
        fs_1.default.mkdirSync(dataDir, { recursive: true });
    }
}
const db = (0, client_1.createClient)({ url, authToken });
const initializeDatabase = async () => {
    // Create users table
    await db.execute(`
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
    await db.execute(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      room_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      host_id TEXT NOT NULL,
      max_participants INTEGER DEFAULT 100,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      scheduled_for TEXT,
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (host_id) REFERENCES users(id)
    )
  `);
    // Simple migration to add scheduled_for if the table already existed (SQLite ignores if it exists with try/catch, but libsql execute might throw. Let's do a safe try-catch)
    try {
        await db.execute(`ALTER TABLE meetings ADD COLUMN scheduled_for TEXT;`);
    }
    catch (e) {
        // Column already exists, ignore
    }
    try {
        await db.execute(`ALTER TABLE meetings ADD COLUMN is_deleted INTEGER DEFAULT 0;`);
    }
    catch (e) {
        // Column already exists, ignore
    }
    try {
        await db.execute(`ALTER TABLE recordings ADD COLUMN user_id TEXT DEFAULT '';`);
    }
    catch (e) {
        // Column already exists, ignore
    }
    // Create meeting participants table
    await db.execute(`
    CREATE TABLE IF NOT EXISTS meeting_participants (
      meeting_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (meeting_id, user_id),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
    // Create recordings table
    await db.execute(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      egress_id TEXT NOT NULL,
      status TEXT DEFAULT 'recording',
      file_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    )
  `);
    // Add Performance Indices
    const indices = [
        `CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings(host_id);`,
        `CREATE INDEX IF NOT EXISTS idx_meetings_room_code ON meetings(room_code);`,
        `CREATE INDEX IF NOT EXISTS idx_meetings_scheduled ON meetings(scheduled_for);`,
        `CREATE INDEX IF NOT EXISTS idx_meetings_active ON meetings(is_active, is_deleted);`,
        `CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);`,
        `CREATE INDEX IF NOT EXISTS idx_recordings_egress ON recordings(egress_id);`,
    ];
    for (const q of indices) {
        await db.execute(q);
    }
};
exports.initializeDatabase = initializeDatabase;
// User queries
exports.userQueries = {
    create: async (id, name, email, password_hash, role, avatar_color) => {
        await db.execute({
            sql: `INSERT INTO users (id, name, email, password_hash, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [id, name, email, password_hash, role, avatar_color]
        });
    },
    findByEmail: async (email) => {
        const res = await db.execute({ sql: `SELECT * FROM users WHERE email = ?`, args: [email] });
        return res.rows[0];
    },
    findById: async (id) => {
        const res = await db.execute({ sql: `SELECT * FROM users WHERE id = ?`, args: [id] });
        return res.rows[0];
    },
    getAll: async () => {
        const res = await db.execute(`SELECT id, name, email, role, avatar_color, created_at FROM users`);
        return res.rows;
    },
};
// Meeting queries
exports.meetingQueries = {
    create: async (id, room_code, title, host_id, max_participants) => {
        await db.execute({
            sql: `INSERT INTO meetings (id, room_code, title, host_id, max_participants) VALUES (?, ?, ?, ?, ?)`,
            args: [id, room_code, title, host_id, max_participants]
        });
    },
    schedule: async (id, room_code, title, host_id, max_participants, scheduled_for) => {
        await db.execute({
            sql: `INSERT INTO meetings (id, room_code, title, host_id, max_participants, scheduled_for) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [id, room_code, title, host_id, max_participants, scheduled_for]
        });
    },
    findByCode: async (room_code) => {
        const res = await db.execute({ sql: `SELECT * FROM meetings WHERE room_code = ? AND is_deleted = 0`, args: [room_code] });
        return res.rows[0];
    },
    findById: async (id) => {
        const res = await db.execute({ sql: `SELECT * FROM meetings WHERE id = ?`, args: [id] });
        return res.rows[0];
    },
    getActiveByHost: async (host_id) => {
        const res = await db.execute({ sql: `SELECT * FROM meetings WHERE host_id = ? AND is_active = 1 AND scheduled_for IS NULL AND is_deleted = 0`, args: [host_id] });
        return res.rows;
    },
    getRecent: async (host_id, user_id) => {
        const res = await db.execute({
            sql: `
        SELECT DISTINCT m.* FROM meetings m
        LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id
        WHERE m.is_deleted = 0 AND ((m.host_id = ? AND (m.scheduled_for IS NULL OR m.is_active = 0)) 
           OR (mp.user_id = ?))
        ORDER BY m.created_at DESC
        LIMIT 10
      `,
            args: [host_id, user_id]
        });
        return res.rows;
    },
    getScheduled: async (host_id) => {
        const res = await db.execute({
            sql: `SELECT * FROM meetings WHERE host_id = ? AND is_active = 1 AND scheduled_for IS NOT NULL AND is_deleted = 0 ORDER BY scheduled_for ASC`,
            args: [host_id]
        });
        return res.rows;
    },
    endMeeting: async (room_code) => {
        await db.execute({
            sql: `UPDATE meetings SET is_active = 0, ended_at = datetime('now') WHERE room_code = ?`,
            args: [room_code]
        });
    },
    getActive: async () => {
        const res = await db.execute(`SELECT * FROM meetings WHERE is_active = 1 AND scheduled_for IS NULL AND is_deleted = 0`);
        return res.rows;
    },
    deleteMeeting: async (id, host_id) => {
        await db.execute({
            sql: `UPDATE meetings SET is_deleted = 1 WHERE id = ? AND host_id = ?`,
            args: [id, host_id]
        });
    },
};
// Recording queries
exports.recordingQueries = {
    create: async (id, meeting_id, user_id, egress_id, status, file_url) => {
        // Legacy support: We ignore user_id entirely and save an empty string since recordings are tied to the meeting
        await db.execute({
            sql: `INSERT INTO recordings (id, meeting_id, user_id, egress_id, status, file_url) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [id, meeting_id, '', egress_id, status, file_url]
        });
    },
    updateStatus: async (status, egress_id) => {
        await db.execute({
            sql: `UPDATE recordings SET status = ? WHERE egress_id = ?`,
            args: [status, egress_id]
        });
    },
    getByMeetingId: async (meeting_id) => {
        const res = await db.execute({
            sql: `SELECT * FROM recordings WHERE meeting_id = ? ORDER BY created_at DESC`,
            args: [meeting_id]
        });
        return res.rows;
    },
    getAllForUser: async (user_id) => {
        const res = await db.execute({
            sql: `
        SELECT DISTINCT r.*, m.title as meeting_title, m.created_at as meeting_date, m.host_id
        FROM recordings r
        JOIN meetings m ON r.meeting_id = m.id
        LEFT JOIN meeting_participants mp ON m.id = mp.meeting_id AND mp.user_id = ?
        WHERE m.host_id = ? OR mp.user_id = ? OR r.user_id = ?
        ORDER BY r.created_at DESC
      `,
            args: [user_id, user_id, user_id, user_id]
        });
        return res.rows;
    },
    deleteById: async (id) => {
        await db.execute({ sql: `DELETE FROM recordings WHERE id = ?`, args: [id] });
    },
    findById: async (id) => {
        const res = await db.execute({ sql: `SELECT * FROM recordings WHERE id = ?`, args: [id] });
        return res.rows[0];
    },
};
exports.default = db;
//# sourceMappingURL=db.js.map