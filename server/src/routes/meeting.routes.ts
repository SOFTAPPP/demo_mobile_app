import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db, { meetingQueries, recordingQueries } from '../models/db';
import { livekitService } from '../services/livekit.service';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';

const router = Router();

router.use(authMiddleware);

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const createSchema = z.object({
  title: z.string().max(100).optional(),
});

const joinSchema = z.object({
  roomCode: z.string().min(1).max(10),
  displayName: z.string().max(50).optional(),
});

const scheduleSchema = z.object({
  title: z.string().max(100).optional(),
  scheduledFor: z.string().min(1),
});

const endSchema = z.object({
  roomCode: z.string().min(1).max(10),
});

router.post('/create', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const meetingTitle = parsed.data.title || 'Music Class';
    const meetingId = uuidv4();
    let roomCode = generateRoomCode();

    let attempts = 0;
    let existing = await meetingQueries.findByCode(roomCode);
    while (existing && attempts < 5) {
      roomCode = generateRoomCode();
      existing = await meetingQueries.findByCode(roomCode);
      attempts++;
    }

    await meetingQueries.create(meetingId, roomCode, meetingTitle, req.user!.userId, 100);

    const token = await livekitService.generateToken(
      roomCode,
      'Teacher',
      req.user!.userId,
      true
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
    logger.error('Create meeting error', { error });
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

router.post('/schedule', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { scheduledFor } = parsed.data;
    const meetingTitle = parsed.data.title || 'Scheduled Music Class';

    const meetingId = uuidv4();
    let roomCode = generateRoomCode();

    let attempts = 0;
    let existing = await meetingQueries.findByCode(roomCode);
    while (existing && attempts < 5) {
      roomCode = generateRoomCode();
      existing = await meetingQueries.findByCode(roomCode);
      attempts++;
    }

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
    logger.error('Schedule meeting error', { error });
    res.status(500).json({ error: 'Failed to schedule meeting' });
  }
});

router.post('/join', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { roomCode, displayName } = parsed.data;

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

    const token = await livekitService.generateToken(
      meeting.room_code,
      participantName,
      req.user!.userId,
      isTeacher
    );

    try {
      await db.execute({
        sql: `INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)`,
        args: [meeting.id, req.user!.userId]
      });
    } catch (dbError) {
      logger.error('Failed to record meeting participant', { error: dbError });
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
    logger.error('Join meeting error', { error });
    res.status(500).json({ error: 'Failed to join meeting' });
  }
});

router.post('/end', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = endSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const cleanRoomCode = parsed.data.roomCode.toUpperCase();
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

    const { io } = await import('../index');
    io.to(cleanRoomCode).emit('meeting-ended');
    io.emit('meeting-ended-global', cleanRoomCode);

    const recordings = await recordingQueries.getByMeetingId(meeting.id);
    const activeRecording = recordings.find(r => r.status === 'recording');

    if (activeRecording) {
      try {
        await livekitService.stopRecording(activeRecording.egress_id);
        await recordingQueries.updateStatus('completed', activeRecording.egress_id);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        logger.error('Failed to gracefully stop recording before ending room', { error: err });
      }
    }

    livekitService.endRoom(cleanRoomCode);

    res.json({ message: 'Meeting ended successfully' });
  } catch (error) {
    logger.error('End meeting error', { error });
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

router.get('/recent', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getRecent(req.user!.userId, req.user!.userId);
    res.json({ meetings });
  } catch (error) {
    logger.error('Get recent meetings error', { error });
    res.status(500).json({ error: 'Failed to get meetings' });
  }
});

router.get('/scheduled', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getScheduled(req.user!.userId);
    res.json({ meetings });
  } catch (error) {
    logger.error('Get scheduled meetings error', { error });
    res.status(500).json({ error: 'Failed to get scheduled meetings' });
  }
});

router.get('/active', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getActive();
    res.json({ meetings });
  } catch (error) {
    logger.error('Get active meetings error', { error });
    res.status(500).json({ error: 'Failed to get active meetings' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const meeting = await meetingQueries.findById(id as string);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id === req.user!.userId) {
      await meetingQueries.deleteMeeting(id as string, req.user!.userId);
      res.json({ message: 'Meeting removed from dashboard successfully' });
    } else {
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
    logger.error('Delete meeting error', { error });
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

router.post('/record/start', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomCode, publicUrl } = req.body;
    if (!roomCode || !publicUrl) {
      res.status(400).json({ error: 'Room code and publicUrl are required' });
      return;
    }

    const meeting = await meetingQueries.findByCode(roomCode);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.host_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the host can start recording' });
      return;
    }

    let finalPublicUrl = publicUrl;
    if (publicUrl.includes('localhost') || !publicUrl.startsWith('http')) {
      finalPublicUrl = process.env.CLIENT_URL || 'https://demo-mobile-app-liart.vercel.app';
    }

    const { egressId, fileUrl } = await livekitService.startRecording(roomCode, finalPublicUrl);

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
    logger.error('Start recording error', { error });
    res.status(500).json({ error: error.message || 'Failed to start recording' });
  }
});

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
        logger.info(`Egress ${egressId} was already completed when trying to stop. Marking as complete.`);
      } else {
        throw err;
      }
    }

    await recordingQueries.updateStatus('completed', egressId);

    res.json({ message: 'Recording stopped' });
  } catch (error: any) {
    logger.error('Stop recording error', { error });
    res.status(500).json({ error: error.message || 'Failed to stop recording' });
  }
});

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
    logger.error('Delete recording error', { error });
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

async function syncStaleRecordings(recordings: any[]) {
  const stale = recordings.filter(r => r.status === 'recording');
  if (stale.length === 0) return;

  await Promise.all(stale.map(async (r) => {
    try {
      const status = await livekitService.getEgressStatus(r.egress_id);
      if (status === 'EGRESS_COMPLETE' || status === '3' || status === 'completed') {
        await recordingQueries.updateStatus('completed', r.egress_id);
        r.status = 'completed';
      } else if (status === 'EGRESS_FAILED' || status === '4' || status === 'EGRESS_ABORTED' || status === '5' || status === 'failed') {
        await recordingQueries.updateStatus('failed', r.egress_id);
        r.status = 'failed';
      }
    } catch {
      // Non-critical, skip
    }
  }));
}

router.get('/recordings/all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const recordings = await recordingQueries.getAllForUser(userId);
    await syncStaleRecordings(recordings);
    res.json({ recordings });
  } catch (error) {
    logger.error('Get all recordings error', { error });
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

router.get('/:id/recordings', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const allRecordings = await recordingQueries.getByMeetingId(id as string);
    const meeting = await meetingQueries.findById(id as string);

    const recordings = allRecordings.map(r => ({ ...r, host_id: meeting?.host_id, meeting_title: meeting?.title }));
    await syncStaleRecordings(recordings);
    res.json({ recordings });
  } catch (error) {
    logger.error('Get recordings error', { error });
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

export default router;
