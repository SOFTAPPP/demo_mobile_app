"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const db_1 = __importStar(require("../models/db"));
const livekit_service_1 = require("../services/livekit.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validate_1 = require("../middleware/validate");
const logger_1 = require("../lib/logger");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(validate_1.sanitizeBody);
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto_1.default.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(bytes[i] % chars.length);
    }
    return code;
}
function generateShortRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto_1.default.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(bytes[i] % chars.length);
    }
    return code;
}
const createSchema = zod_1.z.object({
    title: zod_1.z.string().max(100).optional(),
});
const joinSchema = zod_1.z.object({
    roomCode: zod_1.z.string().min(1).max(10),
    displayName: zod_1.z.string().max(50).optional(),
});
const scheduleSchema = zod_1.z.object({
    title: zod_1.z.string().max(100).optional(),
    scheduledFor: zod_1.z.string().min(1),
});
const endSchema = zod_1.z.object({
    roomCode: zod_1.z.string().min(1).max(10),
});
router.post('/create', (0, auth_middleware_1.requireRole)('teacher'), async (req, res) => {
    const startTime = Date.now();
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' });
            return;
        }
        const meetingTitle = parsed.data.title || 'Music Class';
        const meetingId = (0, uuid_1.v4)();
        let roomCode = generateShortRoomCode();
        let attempts = 0;
        let existing = await db_1.meetingQueries.findByCode(roomCode);
        while (existing && attempts < 5) {
            roomCode = generateShortRoomCode();
            existing = await db_1.meetingQueries.findByCode(roomCode);
            attempts++;
        }
        if (existing) {
            res.status(500).json({ error: 'Failed to generate unique room code. Please try again.', code: 'ROOM_CODE_COLLISION' });
            return;
        }
        await db_1.meetingQueries.create(meetingId, roomCode, meetingTitle, req.user.userId, 100);
        const token = await livekit_service_1.livekitService.generateToken(roomCode, 'Teacher', req.user.userId, true);
        const endTime = Date.now();
        logger_1.logger.info(`[API] POST /meetings/create took ${endTime - startTime}ms`);
        res.status(201).json({
            success: true,
            data: {
                meeting: {
                    id: meetingId,
                    room_code: roomCode,
                    title: meetingTitle,
                    is_active: true,
                },
                livekit: {
                    token,
                    url: livekit_service_1.livekitService.getServerUrl(),
                    configured: livekit_service_1.livekitService.isConfigured(),
                },
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Create meeting error', { error });
        res.status(500).json({ error: 'Failed to create meeting', code: 'SERVER_ERROR' });
    }
});
router.post('/schedule', (0, auth_middleware_1.requireRole)('teacher'), async (req, res) => {
    const startTime = Date.now();
    try {
        const parsed = scheduleSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0].message });
            return;
        }
        const { scheduledFor } = parsed.data;
        const meetingTitle = parsed.data.title || 'Scheduled Music Class';
        const meetingId = (0, uuid_1.v4)();
        let roomCode = generateRoomCode();
        let attempts = 0;
        let existing = await db_1.meetingQueries.findByCode(roomCode);
        while (existing && attempts < 5) {
            roomCode = generateRoomCode();
            existing = await db_1.meetingQueries.findByCode(roomCode);
            attempts++;
        }
        await db_1.meetingQueries.schedule(meetingId, roomCode, meetingTitle, req.user.userId, 100, scheduledFor);
        const endTime = Date.now();
        logger_1.logger.info(`[API] POST /meetings/schedule took ${endTime - startTime}ms`);
        res.status(201).json({
            success: true,
            data: {
                meeting: {
                    id: meetingId,
                    room_code: roomCode,
                    title: meetingTitle,
                    is_active: true,
                    scheduled_for: scheduledFor
                }
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Schedule meeting error', { error });
        res.status(500).json({ error: 'Failed to schedule meeting' });
    }
});
router.post('/join', async (req, res) => {
    const startTime = Date.now();
    try {
        const parsed = joinSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0].message });
            return;
        }
        const { roomCode, displayName } = parsed.data;
        const meeting = await db_1.meetingQueries.findByCode(roomCode.toUpperCase());
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found. Check the room code.' });
            return;
        }
        if (!meeting.is_active) {
            res.status(410).json({ error: 'This meeting has ended.' });
            return;
        }
        const isTeacher = meeting.host_id === req.user.userId;
        const participantName = displayName || (isTeacher ? 'Teacher' : 'Student');
        const token = await livekit_service_1.livekitService.generateToken(meeting.room_code, participantName, req.user.userId, isTeacher);
        try {
            await db_1.default.execute({
                sql: `INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)`,
                args: [meeting.id, req.user.userId]
            });
        }
        catch (dbError) {
            logger_1.logger.error('Failed to record meeting participant', { error: dbError });
        }
        let isRecording = false;
        let recordingElapsed = 0;
        try {
            const ongoingRecordings = await db_1.default.execute({
                sql: `SELECT (strftime('%s', 'now') - strftime('%s', started_at)) as elapsed FROM recordings WHERE meeting_id = ? AND status = 'recording'`,
                args: [meeting.id]
            });
            if (ongoingRecordings.rows.length > 0) {
                isRecording = true;
                recordingElapsed = Math.max(0, Number(ongoingRecordings.rows[0].elapsed || 0));
            }
        }
        catch (recError) {
            logger_1.logger.error('Failed to query ongoing recordings on join', { error: recError });
        }
        const endTime = Date.now();
        logger_1.logger.info(`[API] POST /meetings/join took ${endTime - startTime}ms`);
        res.json({
            success: true,
            data: {
                meeting: {
                    id: meeting.id,
                    room_code: meeting.room_code,
                    title: meeting.title,
                    is_active: true,
                    isRecording,
                    recordingElapsed,
                },
                isHost: isTeacher,
                livekit: {
                    token,
                    url: livekit_service_1.livekitService.getServerUrl(),
                    configured: livekit_service_1.livekitService.isConfigured(),
                },
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Join meeting error', { error });
        res.status(500).json({ error: 'Failed to join meeting' });
    }
});
router.post('/end', (0, auth_middleware_1.requireRole)('teacher'), async (req, res) => {
    try {
        const parsed = endSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0].message });
            return;
        }
        const cleanRoomCode = parsed.data.roomCode.toUpperCase();
        const meeting = await db_1.meetingQueries.findByCode(cleanRoomCode);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        if (meeting.host_id !== req.user.userId) {
            res.status(403).json({ error: 'Only the host can end the meeting' });
            return;
        }
        await db_1.meetingQueries.endMeeting(cleanRoomCode);
        const { io } = await Promise.resolve().then(() => __importStar(require('../index')));
        io.to(cleanRoomCode).emit('meeting-ended');
        io.emit('meeting-ended-global', cleanRoomCode);
        livekit_service_1.livekitService.endRoom(cleanRoomCode);
        res.json({ message: 'Meeting ended successfully' });
    }
    catch (error) {
        logger_1.logger.error('End meeting error', { error });
        res.status(500).json({ error: 'Failed to end meeting' });
    }
});
router.get('/recent', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getRecent(req.user.userId, req.user.userId);
        res.json({ success: true, data: { meetings } });
    }
    catch (error) {
        logger_1.logger.error('Get recent meetings error', { error });
        res.status(500).json({ error: 'Failed to get meetings', code: 'SERVER_ERROR' });
    }
});
router.get('/scheduled', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getScheduled(req.user.userId);
        res.json({ success: true, data: { meetings } });
    }
    catch (error) {
        logger_1.logger.error('Get scheduled meetings error', { error });
        res.status(500).json({ error: 'Failed to get scheduled meetings', code: 'SERVER_ERROR' });
    }
});
router.get('/active', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getActive();
        res.json({ meetings });
    }
    catch (error) {
        logger_1.logger.error('Get active meetings error', { error });
        res.status(500).json({ error: 'Failed to get active meetings' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const meeting = await db_1.meetingQueries.findById(id);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        if (meeting.host_id === req.user.userId) {
            await db_1.meetingQueries.deleteMeeting(id, req.user.userId);
            res.json({ message: 'Meeting removed from dashboard successfully' });
        }
        else {
            const result = await db_1.default.execute({
                sql: 'DELETE FROM meeting_participants WHERE meeting_id = ? AND user_id = ?',
                args: [id, req.user.userId]
            });
            if (result.rowsAffected === 0) {
                res.status(403).json({ error: 'Only the host can delete this meeting' });
                return;
            }
            res.json({ message: 'Meeting removed from history' });
        }
    }
    catch (error) {
        logger_1.logger.error('Delete meeting error', { error });
        res.status(500).json({ error: 'Failed to delete meeting' });
    }
});
exports.default = router;
//# sourceMappingURL=meeting.routes.js.map