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
        let existing = db_1.meetingQueries.findByCode.get(roomCode);
        while (existing) {
            roomCode = generateRoomCode();
            existing = db_1.meetingQueries.findByCode.get(roomCode);
        }
        db_1.meetingQueries.create.run(meetingId, roomCode, meetingTitle, req.user.userId, 100);
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
        let existing = db_1.meetingQueries.findByCode.get(roomCode);
        while (existing) {
            roomCode = generateRoomCode();
            existing = db_1.meetingQueries.findByCode.get(roomCode);
        }
        // Insert scheduled meeting into the database
        db_1.meetingQueries.schedule.run(meetingId, roomCode, meetingTitle, req.user.userId, 100, scheduledFor);
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
        const meeting = db_1.meetingQueries.findByCode.get(roomCode.toUpperCase());
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
            db_1.default.prepare(`
        INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id)
        VALUES (?, ?)
      `).run(meeting.id, req.user.userId);
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
        const meeting = db_1.meetingQueries.findByCode.get(cleanRoomCode);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        if (meeting.host_id !== req.user.userId) {
            res.status(403).json({ error: 'Only the host can end the meeting' });
            return;
        }
        db_1.meetingQueries.endMeeting.run(cleanRoomCode);
        // Broadcast instantly to all participants via Socket.io for 0-latency teardown
        const { io } = await Promise.resolve().then(() => __importStar(require('../index')));
        io.to(cleanRoomCode).emit('meeting-ended');
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
router.get('/recent', (req, res) => {
    try {
        const meetings = db_1.meetingQueries.getRecent.all(req.user.userId, req.user.userId);
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
router.get('/scheduled', (req, res) => {
    try {
        const meetings = db_1.meetingQueries.getScheduled.all(req.user.userId);
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
router.get('/active', (req, res) => {
    try {
        const meetings = db_1.meetingQueries.getActive.all();
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
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const meeting = db_1.meetingQueries.findById.get(id);
        if (!meeting) {
            res.status(404).json({ error: 'Meeting not found' });
            return;
        }
        if (meeting.host_id === req.user.userId) {
            // Host: delete the meeting and all participant records
            db_1.default.prepare('DELETE FROM meeting_participants WHERE meeting_id = ?').run(id);
            db_1.meetingQueries.deleteMeeting.run(id, req.user.userId);
            res.json({ message: 'Meeting deleted successfully' });
        }
        else {
            // Participant: just remove this meeting from their own history
            const result = db_1.default.prepare('DELETE FROM meeting_participants WHERE meeting_id = ? AND user_id = ?').run(id, req.user.userId);
            if (result.changes === 0) {
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
exports.default = router;
//# sourceMappingURL=meeting.routes.js.map