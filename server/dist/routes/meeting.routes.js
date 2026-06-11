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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const db_1 = __importStar(require("../models/db"));
const livekit_service_1 = require("../services/livekit.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const logger_1 = require("../lib/logger");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
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
router.post('/create', async (req, res) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0].message });
            return;
        }
        const meetingTitle = parsed.data.title || 'Music Class';
        const meetingId = (0, uuid_1.v4)();
        let roomCode = generateRoomCode();
        let attempts = 0;
        let existing = await db_1.meetingQueries.findByCode(roomCode);
        while (existing && attempts < 5) {
            roomCode = generateRoomCode();
            existing = await db_1.meetingQueries.findByCode(roomCode);
            attempts++;
        }
        await db_1.meetingQueries.create(meetingId, roomCode, meetingTitle, req.user.userId, 100);
        const token = await livekit_service_1.livekitService.generateToken(roomCode, 'Teacher', req.user.userId, true);
        res.status(201).json({
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
        });
    }
    catch (error) {
        logger_1.logger.error('Create meeting error', { error });
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});
router.post('/schedule', async (req, res) => {
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
        res.status(201).json({
            meeting: {
                id: meetingId,
                room_code: roomCode,
                title: meetingTitle,
                is_active: true,
                scheduled_for: scheduledFor
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Schedule meeting error', { error });
        res.status(500).json({ error: 'Failed to schedule meeting' });
    }
});
router.post('/join', async (req, res) => {
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
        res.json({
            meeting: {
                id: meeting.id,
                room_code: meeting.room_code,
                title: meeting.title,
                is_active: true,
            },
            isHost: isTeacher,
            livekit: {
                token,
                url: livekit_service_1.livekitService.getServerUrl(),
                configured: livekit_service_1.livekitService.isConfigured(),
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Join meeting error', { error });
        res.status(500).json({ error: 'Failed to join meeting' });
    }
});
router.post('/end', async (req, res) => {
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
        const recordings = await db_1.recordingQueries.getByMeetingId(meeting.id);
        const activeRecording = recordings.find(r => r.status === 'recording');
        if (activeRecording) {
            try {
                await livekit_service_1.livekitService.stopRecording(activeRecording.egress_id);
                await db_1.recordingQueries.updateStatus('completed', activeRecording.egress_id);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            catch (err) {
                logger_1.logger.error('Failed to gracefully stop recording before ending room', { error: err });
            }
        }
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
        res.json({ meetings });
    }
    catch (error) {
        logger_1.logger.error('Get recent meetings error', { error });
        res.status(500).json({ error: 'Failed to get meetings' });
    }
});
router.get('/scheduled', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getScheduled(req.user.userId);
        res.json({ meetings });
    }
    catch (error) {
        logger_1.logger.error('Get scheduled meetings error', { error });
        res.status(500).json({ error: 'Failed to get scheduled meetings' });
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
router.post('/record/start', async (req, res) => {
    try {
        const { roomCode, publicUrl } = req.body;
        if (!roomCode || !publicUrl) {
            res.status(400).json({ error: 'Room code and publicUrl are required' });
            return;
        }
        const meeting = await db_1.meetingQueries.findByCode(roomCode);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        if (meeting.host_id !== req.user.userId) {
            res.status(403).json({ error: 'Only the host can start recording' });
            return;
        }
        const { egressId, fileUrl } = await livekit_service_1.livekitService.startRecording(roomCode, publicUrl);
        const recordingId = (0, uuid_1.v4)();
        await db_1.recordingQueries.create(recordingId, meeting.id, req.user.userId, egressId, 'recording', fileUrl);
        res.json({ message: 'Recording started', egressId, fileUrl });
    }
    catch (error) {
        logger_1.logger.error('Start recording error', { error });
        res.status(500).json({ error: error.message || 'Failed to start recording' });
    }
});
router.post('/record/stop', async (req, res) => {
    try {
        const { egressId, roomCode } = req.body;
        if (!egressId || !roomCode) {
            res.status(400).json({ error: 'Egress ID and roomCode are required' });
            return;
        }
        const meeting = await db_1.meetingQueries.findByCode(roomCode);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        try {
            await livekit_service_1.livekitService.stopRecording(egressId);
        }
        catch (err) {
            if (err.message && err.message.includes('EGRESS_COMPLETE')) {
                logger_1.logger.info(`Egress ${egressId} was already completed when trying to stop. Marking as complete.`);
            }
            else {
                throw err;
            }
        }
        await db_1.recordingQueries.updateStatus('completed', egressId);
        res.json({ message: 'Recording stopped' });
    }
    catch (error) {
        logger_1.logger.error('Stop recording error', { error });
        res.status(500).json({ error: error.message || 'Failed to stop recording' });
    }
});
router.delete('/recordings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const recording = await db_1.recordingQueries.findById(id);
        if (!recording) {
            res.status(404).json({ error: 'Recording not found' });
            return;
        }
        const meeting = await db_1.meetingQueries.findById(recording.meeting_id);
        if (!meeting || meeting.host_id !== req.user.userId) {
            res.status(403).json({ error: 'Only the meeting host can delete recordings' });
            return;
        }
        await db_1.recordingQueries.deleteById(id);
        res.json({ message: 'Recording deleted successfully' });
    }
    catch (error) {
        logger_1.logger.error('Delete recording error', { error });
        res.status(500).json({ error: 'Failed to delete recording' });
    }
});
async function syncStaleRecordings(recordings) {
    const stale = recordings.filter(r => r.status === 'recording');
    if (stale.length === 0)
        return;
    await Promise.all(stale.map(async (r) => {
        try {
            const status = await livekit_service_1.livekitService.getEgressStatus(r.egress_id);
            if (status === 'EGRESS_COMPLETE' || status === '3' || status === 'completed') {
                await db_1.recordingQueries.updateStatus('completed', r.egress_id);
                r.status = 'completed';
            }
            else if (status === 'EGRESS_FAILED' || status === '4' || status === 'EGRESS_ABORTED' || status === '5' || status === 'failed') {
                await db_1.recordingQueries.updateStatus('failed', r.egress_id);
                r.status = 'failed';
            }
        }
        catch {
            // Non-critical, skip
        }
    }));
}
router.get('/recordings/all', async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const recordings = await db_1.recordingQueries.getAllForUser(userId);
        await syncStaleRecordings(recordings);
        res.json({ recordings });
    }
    catch (error) {
        logger_1.logger.error('Get all recordings error', { error });
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});
router.get('/:id/recordings', async (req, res) => {
    try {
        const { id } = req.params;
        const allRecordings = await db_1.recordingQueries.getByMeetingId(id);
        const meeting = await db_1.meetingQueries.findById(id);
        const recordings = allRecordings.map(r => ({ ...r, host_id: meeting?.host_id, meeting_title: meeting?.title }));
        await syncStaleRecordings(recordings);
        res.json({ recordings });
    }
    catch (error) {
        logger_1.logger.error('Get recordings error', { error });
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});
exports.default = router;
//# sourceMappingURL=meeting.routes.js.map