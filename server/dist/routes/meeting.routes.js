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
const db_1 = __importStar(require("../models/db"));
const livekit_service_1 = require("../services/livekit.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const index_1 = require("../index");
const router = (0, express_1.Router)();
// All meeting routes require authentication
router.use(auth_middleware_1.authMiddleware);
/**
 * Generate a 6-character room code
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
/**
 * POST /api/meetings/create
 * Teacher creates a new meeting room
 */
router.post('/create', async (req, res) => {
    try {
        const { title } = req.body;
        const meetingTitle = title || 'Music Class';
        const meetingId = (0, uuid_1.v4)();
        let roomCode = generateRoomCode();
        // Ensure unique room code
        let existing = await db_1.meetingQueries.findByCode(roomCode);
        while (existing) {
            roomCode = generateRoomCode();
            existing = await db_1.meetingQueries.findByCode(roomCode);
        }
        await db_1.meetingQueries.create(meetingId, roomCode, meetingTitle, req.user.userId, 100);
        // Generate LiveKit token for the host (teacher)
        const token = await livekit_service_1.livekitService.generateToken(roomCode, 'Teacher', // Will be replaced with actual name
        req.user.userId, true // isTeacher
        );
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
        console.error('Create meeting error:', error);
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});
/**
 * POST /api/meetings/schedule
 * Teacher schedules a new meeting room for a future date
 */
router.post('/schedule', async (req, res) => {
    try {
        const { title, scheduledFor } = req.body;
        const meetingTitle = title || 'Scheduled Music Class';
        if (!scheduledFor) {
            res.status(400).json({ error: 'scheduledFor date is required' });
            return;
        }
        const meetingId = (0, uuid_1.v4)();
        let roomCode = generateRoomCode();
        // Ensure unique room code
        let existing = await db_1.meetingQueries.findByCode(roomCode);
        while (existing) {
            roomCode = generateRoomCode();
            existing = await db_1.meetingQueries.findByCode(roomCode);
        }
        // Insert scheduled meeting into the database
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
        console.error('Schedule meeting error:', error);
        res.status(500).json({ error: 'Failed to schedule meeting' });
    }
});
/**
 * POST /api/meetings/join
 * Student joins an existing meeting
 */
router.post('/join', async (req, res) => {
    try {
        const { roomCode, displayName } = req.body;
        if (!roomCode) {
            res.status(400).json({ error: 'Room code is required' });
            return;
        }
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
        // Generate LiveKit token for the participant
        const token = await livekit_service_1.livekitService.generateToken(meeting.room_code, participantName, req.user.userId, isTeacher);
        // Record user as participant in this meeting
        try {
            await db_1.default.execute({
                sql: `INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)`,
                args: [meeting.id, req.user.userId]
            });
        }
        catch (dbError) {
            console.error('Failed to record meeting participant:', dbError);
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
        console.error('Join meeting error:', error);
        res.status(500).json({ error: 'Failed to join meeting' });
    }
});
/**
 * POST /api/meetings/end
 * Teacher ends a meeting
 */
router.post('/end', async (req, res) => {
    try {
        const { roomCode } = req.body;
        if (!roomCode) {
            res.status(400).json({ error: 'Room code is required' });
            return;
        }
        const cleanRoomCode = roomCode.toUpperCase();
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
        // Broadcast instantly to all participants via Socket.io for 0-latency teardown
        const { io } = await Promise.resolve().then(() => __importStar(require('../index')));
        io.to(cleanRoomCode).emit('meeting-ended');
        io.emit('meeting-ended-global', cleanRoomCode);
        // Find if there is an active recording
        const recordings = await db_1.recordingQueries.getByMeetingId(meeting.id);
        const activeRecording = recordings.find(r => r.status === 'recording');
        if (activeRecording) {
            try {
                await livekit_service_1.livekitService.stopRecording(activeRecording.egress_id);
                await db_1.recordingQueries.updateStatus('completed', activeRecording.egress_id);
                // Wait 2 seconds for LiveKit to gracefully finalize the MP4 upload before nuking the room
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            catch (err) {
                console.error('Failed to gracefully stop recording before ending room:', err);
            }
        }
        // Asynchronously tell LiveKit to kick everyone out and delete the room
        livekit_service_1.livekitService.endRoom(cleanRoomCode);
        res.json({ message: 'Meeting ended successfully' });
    }
    catch (error) {
        console.error('End meeting error:', error);
        res.status(500).json({ error: 'Failed to end meeting' });
    }
});
/**
 * GET /api/meetings/recent
 * Get recent meetings for the current user
 */
router.get('/recent', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getRecent(req.user.userId, req.user.userId);
        res.json({ meetings });
    }
    catch (error) {
        console.error('Get recent meetings error:', error);
        res.status(500).json({ error: 'Failed to get meetings' });
    }
});
/**
 * GET /api/meetings/scheduled
 * Get scheduled meetings for the current user
 */
router.get('/scheduled', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getScheduled(req.user.userId);
        res.json({ meetings });
    }
    catch (error) {
        console.error('Get scheduled meetings error:', error);
        res.status(500).json({ error: 'Failed to get scheduled meetings' });
    }
});
/**
 * GET /api/meetings/active
 * Get all active meetings
 */
router.get('/active', async (req, res) => {
    try {
        const meetings = await db_1.meetingQueries.getActive();
        res.json({ meetings });
    }
    catch (error) {
        console.error('Get active meetings error:', error);
        res.status(500).json({ error: 'Failed to get active meetings' });
    }
});
/**
 * DELETE /api/meetings/:id
 * Teacher deletes a meeting
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const meeting = await db_1.meetingQueries.findById(id);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        if (meeting.host_id === req.user.userId) {
            // Host: Soft delete the meeting so it disappears from the Dashboard list
            // We purposefully DO NOT delete meeting_participants so students can still view the cloud recording!
            await db_1.meetingQueries.deleteMeeting(id, req.user.userId);
            res.json({ message: 'Meeting removed from dashboard successfully' });
        }
        else {
            // Participant: just remove this meeting from their own history
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
        console.error('Delete meeting error:', error);
        res.status(500).json({ error: 'Failed to delete meeting' });
    }
});
/**
 * POST /api/meetings/record/start
 * Host starts recording the meeting
 */
router.post('/record/start', async (req, res) => {
    try {
        const { roomCode } = req.body;
        if (!roomCode) {
            res.status(400).json({ error: 'Room code is required' });
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
        const { egressId, fileUrl } = await livekit_service_1.livekitService.startRecording(roomCode);
        // Save recording to DB
        const recordingId = (0, uuid_1.v4)();
        await db_1.recordingQueries.create(recordingId, meeting.id, egressId, 'recording', fileUrl);
        res.json({ message: 'Recording started', egressId, fileUrl });
        index_1.io.to(roomCode).emit('recording-started', { egressId });
    }
    catch (error) {
        console.error('Start recording error:', error);
        res.status(500).json({ error: error.message || 'Failed to start recording' });
    }
});
/**
 * POST /api/meetings/record/stop
 * Host stops recording the meeting
 */
router.post('/record/stop', async (req, res) => {
    try {
        const { egressId } = req.body;
        if (!egressId) {
            res.status(400).json({ error: 'Egress ID is required' });
            return;
        }
        await livekit_service_1.livekitService.stopRecording(egressId);
        // Update DB status
        await db_1.recordingQueries.updateStatus('completed', egressId);
        res.json({ message: 'Recording stopped' });
        // Find the roomCode by looking up the meeting or egress ID
        // We can emit to all since the room is usually specific, but we'll emit to the roomCode
        // A simple hack is just to broadcast to everyone, or get the meeting.
        // For now, let's just do a generic broadcast since it's a demo
        index_1.io.emit('recording-stopped', { egressId });
    }
    catch (error) {
        console.error('Stop recording error:', error);
        res.status(500).json({ error: error.message || 'Failed to stop recording' });
    }
});
/**
 * DELETE /api/meetings/recordings/:id
 * Teacher deletes a recording
 */
router.delete('/recordings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const recording = await db_1.recordingQueries.findById(id);
        if (!recording) {
            res.status(404).json({ error: 'Recording not found' });
            return;
        }
        const meeting = await db_1.meetingQueries.findById(recording.meeting_id);
        if (meeting.host_id !== req.user.userId) {
            res.status(403).json({ error: 'Only the host can delete this recording' });
            return;
        }
        await db_1.recordingQueries.deleteById(id);
        res.json({ message: 'Recording deleted successfully' });
    }
    catch (error) {
        console.error('Delete recording error:', error);
        res.status(500).json({ error: 'Failed to delete recording' });
    }
});
/**
 * GET /api/meetings/recordings/all
 * Fetch all recordings for a user
 */
router.get('/recordings/all', async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const recordings = await db_1.recordingQueries.getAllForUser(userId, userId);
        res.json({ recordings });
    }
    catch (error) {
        console.error('Get all recordings error:', error);
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});
/**
 * GET /api/meetings/:id/recordings
 * Fetch recordings for a specific meeting
 */
router.get('/:id/recordings', async (req, res) => {
    try {
        const { id } = req.params;
        const recordings = await db_1.recordingQueries.getByMeetingId(id);
        res.json({ recordings });
    }
    catch (error) {
        console.error('Get recordings error:', error);
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});
exports.default = router;
//# sourceMappingURL=meeting.routes.js.map