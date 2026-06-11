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
      user_id TEXT NOT NULL,
      egress_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'recording',
      storage_provider TEXT NOT NULL DEFAULT 'cloudflare_r2',
      storage_key TEXT NOT NULL,
      upload_id TEXT,
      parts_json TEXT DEFAULT '[]',
      file_size INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      mime_type TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
    // Add Performance Indices
    const indices = [
        `CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings(host_id);`,
        `CREATE INDEX IF NOT EXISTS idx_meetings_room_code ON meetings(room_code);`,
        `CREATE INDEX IF NOT EXISTS idx_meetings_scheduled ON meetings(scheduled_for);`,
        `CREATE INDEX IF NOT EXISTS idx_meetings_active ON meetings(is_active, is_deleted);`,
        `CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);`
    ];
    for (const q of indices) {
        await db.execute(q);
    }
    // Safe migrations for recordings table - add ALL columns that may not exist in older DBs
    const recordingsMigrations = [
        `ALTER TABLE recordings ADD COLUMN egress_id TEXT NOT NULL DEFAULT '';`,
        `ALTER TABLE recordings ADD COLUMN status TEXT NOT NULL DEFAULT 'recording';`,
        `ALTER TABLE recordings ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'cloudflare_r2';`,
        `ALTER TABLE recordings ADD COLUMN storage_key TEXT NOT NULL DEFAULT '';`,
        `ALTER TABLE recordings ADD COLUMN upload_id TEXT;`,
        `ALTER TABLE recordings ADD COLUMN parts_json TEXT DEFAULT '[]';`,
        `ALTER TABLE recordings ADD COLUMN file_size INTEGER DEFAULT 0;`,
        `ALTER TABLE recordings ADD COLUMN duration INTEGER DEFAULT 0;`,
        `ALTER TABLE recordings ADD COLUMN mime_type TEXT;`,
        `ALTER TABLE recordings ADD COLUMN started_at TEXT DEFAULT (datetime('now'));`,
        `ALTER TABLE recordings ADD COLUMN ended_at TEXT;`,
        `ALTER TABLE recordings ADD COLUMN created_at TEXT DEFAULT (datetime('now'));`,
    ];
    for (const migration of recordingsMigrations) {
        try {
            await db.execute(migration);
        }
        catch (e) {
            // Column already exists — this is expected for existing databases
        }
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
exports.recordingQueries = {
    async createRecording(recording) {
        await db.execute({
            sql: `INSERT INTO recordings (id, meeting_id, user_id, egress_id, storage_provider, storage_key, upload_id, mime_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [recording.id, recording.meeting_id, recording.user_id, recording.egress_id, recording.storage_provider, recording.storage_key, recording.upload_id || null, recording.mime_type || null],
        });
    },
    async getRecordingById(id) {
        const { rows } = await db.execute({ sql: `SELECT * FROM recordings WHERE id = ?`, args: [id] });
        return rows.length > 0 ? rows[0] : null;
    },
    async getRecordingsByMeetingId(meetingId) {
        const { rows } = await db.execute({ sql: `SELECT * FROM recordings WHERE meeting_id = ? ORDER BY created_at DESC`, args: [meetingId] });
        return rows;
    },
    async updateRecordingParts(id, partsJson) {
        await db.execute({
            sql: `UPDATE recordings SET parts_json = ? WHERE id = ?`,
            args: [partsJson, id],
        });
    },
    async finalizeRecording(id, status, duration, fileSize) {
        await db.execute({
            sql: `UPDATE recordings SET status = ?, duration = ?, file_size = ?, ended_at = datetime('now') WHERE id = ?`,
            args: [status, duration, fileSize, id],
        });
    },
    async getOngoingRecordingsForMeeting(meetingId) {
        const { rows } = await db.execute({
            sql: `SELECT * FROM recordings WHERE meeting_id = ? AND status = 'recording'`,
            args: [meetingId],
        });
        return rows;
    },
    async getRecordingsByUserId(userId) {
        const { rows } = await db.execute({
            sql: `SELECT r.*, m.title as meeting_title, m.room_code as meeting_room_code
            FROM recordings r
            JOIN meetings m ON r.meeting_id = m.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC`,
            args: [userId],
        });
        return rows;
    },
    async deleteRecording(id, userId) {
        const result = await db.execute({
            sql: `DELETE FROM recordings WHERE id = ? AND user_id = ?`,
            args: [id, userId],
        });
        return result.rowsAffected > 0;
    }
};
exports.default = db;
//# sourceMappingURL=db.js.map