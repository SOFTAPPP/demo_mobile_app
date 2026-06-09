import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { meetingQueries, recordingQueries, Meeting } from '../models/db';
import { livekitService } from '../services/livekit.service';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { io } from '../index';

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
 * POST /api/meetings/schedule
 * Teacher schedules a new meeting room for a future date
 */
router.post('/schedule', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, scheduledFor } = req.body;
    const meetingTitle = title || 'Scheduled Music Class';
    
    if (!scheduledFor) {
      res.status(400).json({ error: 'scheduledFor date is required' });
      return;
    }

    const meetingId = uuidv4();
    let roomCode = generateRoomCode();

    // Ensure unique room code
    let existing = meetingQueries.findByCode.get(roomCode);
    while (existing) {
      roomCode = generateRoomCode();
      existing = meetingQueries.findByCode.get(roomCode);
    }

    // Insert scheduled meeting into the database
    meetingQueries.schedule.run(meetingId, roomCode, meetingTitle, req.user!.userId, 100, scheduledFor);

    res.status(201).json({
      meeting: {
        id: meetingId,
        room_code: roomCode,
        title: meetingTitle,
        is_active: true,
        scheduled_for: scheduledFor
      }
    });
  } catch (error) {
    console.error('Schedule meeting error:', error);
    res.status(500).json({ error: 'Failed to schedule meeting' });
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
router.post('/end', async (req: AuthRequest, res: Response): Promise<void> => {
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
    
    // Broadcast instantly to all participants via Socket.io for 0-latency teardown
    const { io } = await import('../index');
    io.to(cleanRoomCode).emit('meeting-ended');
    io.emit('meeting-ended-global', cleanRoomCode); 

    // Find if there is an active recording
    const recordings = recordingQueries.getByMeetingId.all(meeting.id) as any[];
    const activeRecording = recordings.find(r => r.status === 'recording');
    
    if (activeRecording) {
      try {
        await livekitService.stopRecording(activeRecording.egress_id);
        recordingQueries.updateStatus.run('completed', activeRecording.egress_id);
        // Wait 2 seconds for LiveKit to gracefully finalize the MP4 upload before nuking the room
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error('Failed to gracefully stop recording before ending room:', err);
      }
    }

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
 * GET /api/meetings/scheduled
 * Get scheduled meetings for the current user
 */
router.get('/scheduled', (req: AuthRequest, res: Response): void => {
  try {
    const meetings = meetingQueries.getScheduled.all(req.user!.userId);
    res.json({ meetings });
  } catch (error) {
    console.error('Get scheduled meetings error:', error);
    res.status(500).json({ error: 'Failed to get scheduled meetings' });
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
      // Host: Soft delete the meeting so it disappears from the Dashboard list
      // We purposefully DO NOT delete meeting_participants so students can still view the cloud recording!
      meetingQueries.deleteMeeting.run(id, req.user!.userId);
      res.json({ message: 'Meeting removed from dashboard successfully' });
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

/**
 * POST /api/meetings/record/start
 * Host starts recording the meeting
 */
router.post('/record/start', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) {
      res.status(400).json({ error: 'Room code is required' });
      return;
    }

    const meeting = meetingQueries.findByCode.get(roomCode) as Meeting | undefined;
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the host can start recording' });
      return;
    }

    const { egressId, fileUrl } = await livekitService.startRecording(roomCode);
    
    // Save recording to DB
    const recordingId = uuidv4();
    recordingQueries.create.run(
      recordingId,
      meeting.id,
      egressId,
      'recording',
      fileUrl
    );

    res.json({ message: 'Recording started', egressId, fileUrl });
    io.to(roomCode).emit('recording-started', { egressId });
  } catch (error: any) {
    console.error('Start recording error:', error);
    res.status(500).json({ error: error.message || 'Failed to start recording' });
  }
});

/**
 * POST /api/meetings/record/stop
 * Host stops recording the meeting
 */
router.post('/record/stop', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { egressId } = req.body;
    if (!egressId) {
      res.status(400).json({ error: 'Egress ID is required' });
      return;
    }

    await livekitService.stopRecording(egressId);
    
    // Update DB status
    recordingQueries.updateStatus.run('completed', egressId);

    res.json({ message: 'Recording stopped' });
    
    // Find the roomCode by looking up the meeting or egress ID
    // We can emit to all since the room is usually specific, but we'll emit to the roomCode
    // A simple hack is just to broadcast to everyone, or get the meeting.
    // For now, let's just do a generic broadcast since it's a demo
    io.emit('recording-stopped', { egressId });
  } catch (error: any) {
    console.error('Stop recording error:', error);
    res.status(500).json({ error: error.message || 'Failed to stop recording' });
  }
});

/**
 * DELETE /api/meetings/recordings/:id
 * Teacher deletes a recording
 */
router.delete('/recordings/:id', (req: AuthRequest, res: Response): void => {
  try {
    const { id } = req.params;
    const recording = recordingQueries.findById.get(id) as any;
    
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const meeting = meetingQueries.findById.get(recording.meeting_id) as any;
    
    if (meeting.host_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the host can delete this recording' });
      return;
    }

    recordingQueries.deleteById.run(id);
    res.json({ message: 'Recording deleted successfully' });
  } catch (error) {
    console.error('Delete recording error:', error);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

/**
 * GET /api/meetings/recordings/all
 * Fetch all recordings for a user
 */
router.get('/recordings/all', (req: AuthRequest, res: Response): void => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const recordings = recordingQueries.getAllForUser.all(userId, userId);
    res.json({ recordings });
  } catch (error) {
    console.error('Get all recordings error:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

/**
 * GET /api/meetings/:id/recordings
 * Fetch recordings for a specific meeting
 */
router.get('/:id/recordings', (req: AuthRequest, res: Response): void => {
  try {
    const { id } = req.params;
    const recordings = recordingQueries.getByMeetingId.all(id);
    res.json({ recordings });
  } catch (error) {
    console.error('Get recordings error:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

export default router;
