import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { meetingQueries, Meeting } from '../models/db';
import { livekitService } from '../services/livekit.service';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// All meeting routes require authentication
router.use(authMiddleware);

/**
 * Generate a 6-character room code
 */
function generateRoomCode(): string {
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
router.post('/create', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title } = req.body;
    const meetingTitle = title || 'Music Class';
    const meetingId = uuidv4();
    let roomCode = generateRoomCode();

    // Ensure unique room code
    let existing = meetingQueries.findByCode.get(roomCode);
    while (existing) {
      roomCode = generateRoomCode();
      existing = meetingQueries.findByCode.get(roomCode);
    }

    meetingQueries.create.run(meetingId, roomCode, meetingTitle, req.user!.userId, 100);

    // Generate LiveKit token for the host (teacher)
    const token = await livekitService.generateToken(
      roomCode,
      'Teacher', // Will be replaced with actual name
      req.user!.userId,
      true // isTeacher
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
        url: livekitService.getServerUrl(),
        configured: livekitService.isConfigured(),
      },
    });
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

/**
 * POST /api/meetings/join
 * Student joins an existing meeting
 */
router.post('/join', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomCode, displayName } = req.body;

    if (!roomCode) {
      res.status(400).json({ error: 'Room code is required' });
      return;
    }

    const meeting = meetingQueries.findByCode.get(roomCode.toUpperCase()) as Meeting | undefined;
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found. Check the room code.' });
      return;
    }

    if (!meeting.is_active) {
      res.status(410).json({ error: 'This meeting has ended.' });
      return;
    }

    const isTeacher = meeting.host_id === req.user!.userId;
    const participantName = displayName || (isTeacher ? 'Teacher' : 'Student');

    // Generate LiveKit token for the participant
    const token = await livekitService.generateToken(
      meeting.room_code,
      participantName,
      req.user!.userId,
      isTeacher
    );

    // Record user as participant in this meeting
    try {
      db.prepare(`
        INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id)
        VALUES (?, ?)
      `).run(meeting.id, req.user!.userId);
    } catch (dbError) {
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
        url: livekitService.getServerUrl(),
        configured: livekitService.isConfigured(),
      },
    });
  } catch (error) {
    console.error('Join meeting error:', error);
    res.status(500).json({ error: 'Failed to join meeting' });
  }
});

/**
 * POST /api/meetings/end
 * Teacher ends a meeting
 */
router.post('/end', (req: AuthRequest, res: Response): void => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) {
      res.status(400).json({ error: 'Room code is required' });
      return;
    }
    const cleanRoomCode = roomCode.toUpperCase();
    const meeting = meetingQueries.findByCode.get(cleanRoomCode) as Meeting | undefined;

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the host can end the meeting' });
      return;
    }

    meetingQueries.endMeeting.run(cleanRoomCode);
    
    // Asynchronously tell LiveKit to kick everyone out and delete the room
    livekitService.endRoom(cleanRoomCode);
    
    res.json({ message: 'Meeting ended successfully' });
  } catch (error) {
    console.error('End meeting error:', error);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

/**
 * GET /api/meetings/recent
 * Get recent meetings for the current user
 */
router.get('/recent', (req: AuthRequest, res: Response): void => {
  try {
    const meetings = meetingQueries.getRecent.all(req.user!.userId, req.user!.userId);
    res.json({ meetings });
  } catch (error) {
    console.error('Get recent meetings error:', error);
    res.status(500).json({ error: 'Failed to get meetings' });
  }
});

/**
 * GET /api/meetings/active
 * Get all active meetings
 */
router.get('/active', (req: AuthRequest, res: Response): void => {
  try {
    const meetings = meetingQueries.getActive.all();
    res.json({ meetings });
  } catch (error) {
    console.error('Get active meetings error:', error);
    res.status(500).json({ error: 'Failed to get active meetings' });
  }
});

/**
 * DELETE /api/meetings/:id
 * Teacher deletes a meeting
 */
router.delete('/:id', (req: AuthRequest, res: Response): void => {
  try {
    const { id } = req.params;
    const meeting = meetingQueries.findById.get(id) as Meeting | undefined;

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id === req.user!.userId) {
      // Host: delete the meeting and all participant records
      db.prepare('DELETE FROM meeting_participants WHERE meeting_id = ?').run(id);
      meetingQueries.deleteMeeting.run(id, req.user!.userId);
      res.json({ message: 'Meeting deleted successfully' });
    } else {
      // Participant: just remove this meeting from their own history
      const result = db.prepare('DELETE FROM meeting_participants WHERE meeting_id = ? AND user_id = ?').run(id, req.user!.userId);
      if (result.changes === 0) {
        res.status(403).json({ error: 'Only the host can delete this meeting' });
        return;
      }
      res.json({ message: 'Meeting removed from history' });
    }
  } catch (error) {
    console.error('Delete meeting error:', error);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

export default router;
