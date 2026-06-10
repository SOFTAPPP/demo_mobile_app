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
    let existing = await meetingQueries.findByCode(roomCode);
    while (existing) {
      roomCode = generateRoomCode();
      existing = await meetingQueries.findByCode(roomCode);
    }

    await meetingQueries.create(meetingId, roomCode, meetingTitle, req.user!.userId, 100);

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
    let existing = await meetingQueries.findByCode(roomCode);
    while (existing) {
      roomCode = generateRoomCode();
      existing = await meetingQueries.findByCode(roomCode);
    }

    // Insert scheduled meeting into the database
    await meetingQueries.schedule(meetingId, roomCode, meetingTitle, req.user!.userId, 100, scheduledFor);

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

    const meeting = await meetingQueries.findByCode(roomCode.toUpperCase());
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
      await db.execute({
        sql: `INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)`,
        args: [meeting.id, req.user!.userId]
      });
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
    const meeting = await meetingQueries.findByCode(cleanRoomCode);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the host can end the meeting' });
      return;
    }

    await meetingQueries.endMeeting(cleanRoomCode);
    
    // Broadcast instantly to all participants via Socket.io for 0-latency teardown
    const { io } = await import('../index');
    io.to(cleanRoomCode).emit('meeting-ended');
    io.emit('meeting-ended-global', cleanRoomCode); 

    // Find if there is an active recording
    const recordings = await recordingQueries.getByMeetingId(meeting.id);
    const activeRecording = recordings.find(r => r.status === 'recording');
    
    if (activeRecording) {
      try {
        await livekitService.stopRecording(activeRecording.egress_id);
        await recordingQueries.updateStatus('completed', activeRecording.egress_id);
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
router.get('/recent', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getRecent(req.user!.userId, req.user!.userId);
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
router.get('/scheduled', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getScheduled(req.user!.userId);
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
router.get('/active', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getActive();
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
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const meeting = await meetingQueries.findById(id as string);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id === req.user!.userId) {
      // Host: Soft delete the meeting so it disappears from the Dashboard list
      // We purposefully DO NOT delete meeting_participants so students can still view the cloud recording!
      await meetingQueries.deleteMeeting(id as string, req.user!.userId);
      res.json({ message: 'Meeting removed from dashboard successfully' });
    } else {
      // Participant: just remove this meeting from their own history
      const result = await db.execute({
        sql: 'DELETE FROM meeting_participants WHERE meeting_id = ? AND user_id = ?',
        args: [id as string, req.user!.userId]
      });
      if (result.rowsAffected === 0) {
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

    const meeting = await meetingQueries.findByCode(roomCode);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    const { egressId, fileUrl } = await livekitService.startRecording(roomCode);
    
    // Save recording to DB
    const recordingId = uuidv4();
    await recordingQueries.create(
      recordingId,
      meeting.id,
      req.user!.userId,
      egressId,
      'recording',
      fileUrl
    );

    res.json({ message: 'Recording started', egressId, fileUrl });
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
    const { egressId, roomCode } = req.body;
    if (!egressId || !roomCode) {
      res.status(400).json({ error: 'Egress ID and roomCode are required' });
      return;
    }

    const meeting = await meetingQueries.findByCode(roomCode);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    try {
      await livekitService.stopRecording(egressId);
    } catch (err: any) {
      if (err.message && err.message.includes('EGRESS_COMPLETE')) {
        console.log(`[Recording] Egress ${egressId} was already completed when trying to stop. Marking as complete.`);
      } else {
        throw err;
      }
    }
    
    // Update DB status
    await recordingQueries.updateStatus('completed', egressId);

    res.json({ message: 'Recording stopped' });
  } catch (error: any) {
    console.error('Stop recording error:', error);
    res.status(500).json({ error: error.message || 'Failed to stop recording' });
  }
});

/**
 * DELETE /api/meetings/recordings/:id
 * Teacher deletes a recording
 */
router.delete('/recordings/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const recording = await recordingQueries.findById(id as string);
    
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const meeting = await meetingQueries.findById(recording.meeting_id);
    if (!meeting || meeting.host_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the meeting host can delete recordings' });
      return;
    }

    await recordingQueries.deleteById(id as string);
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
router.get('/recordings/all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const recordings = await recordingQueries.getAllForUser(userId);

    // Sync stale recordings
    for (const r of recordings) {
      if (r.status === 'recording') {
        const status = await livekitService.getEgressStatus(r.egress_id);
        if (status === 'EGRESS_COMPLETE' || status === '3' || status === 'completed') {
          await recordingQueries.updateStatus('completed', r.egress_id);
          r.status = 'completed';
        } else if (status === 'EGRESS_FAILED' || status === '4' || status === 'EGRESS_ABORTED' || status === '5' || status === 'failed') {
          await recordingQueries.updateStatus('failed', r.egress_id);
          r.status = 'failed';
        }
      }
    }

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
router.get('/:id/recordings', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    
    const allRecordings = await recordingQueries.getByMeetingId(id as string);
    const meeting = await meetingQueries.findById(id as string);
    
    // Return all recordings for this meeting
    const recordings = allRecordings.map(r => ({ ...r, host_id: meeting?.host_id, meeting_title: meeting?.title }));
      
    // Sync stale recordingss
    for (const r of recordings) {
      if (r.status === 'recording') {
        const status = await livekitService.getEgressStatus(r.egress_id);
        if (status === 'EGRESS_COMPLETE' || status === '3' || status === 'completed') {
          await recordingQueries.updateStatus('completed', r.egress_id);
          r.status = 'completed';
        } else if (status === 'EGRESS_FAILED' || status === '4' || status === 'EGRESS_ABORTED' || status === '5' || status === 'failed') {
          await recordingQueries.updateStatus('failed', r.egress_id);
          r.status = 'failed';
        }
      }
    }

    res.json({ recordings });
  } catch (error) {
    console.error('Get recordings error:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

export default router;
