import { Router, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db, { meetingQueries } from '../models/db';
import { livekitService } from '../services/livekit.service';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { sanitizeBody } from '../middleware/validate';
import { logger } from '../lib/logger';

const router = Router();

router.use(authMiddleware);
router.use(sanitizeBody);

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(bytes[i] % chars.length);
  }
  return code;
}

function generateShortRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(bytes[i] % chars.length);
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

router.post('/create', requireRole('teacher'), async (req: AuthRequest, res: Response): Promise<void> => {
  const startTime = Date.now();
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message, code: 'VALIDATION_ERROR' });
      return;
    }
    const meetingTitle = parsed.data.title || 'Music Class';
    const meetingId = uuidv4();
    let roomCode = generateShortRoomCode();

    let attempts = 0;
    let existing = await meetingQueries.findByCode(roomCode);
    while (existing && attempts < 5) {
      roomCode = generateShortRoomCode();
      existing = await meetingQueries.findByCode(roomCode);
      attempts++;
    }
    if (existing) {
      res.status(500).json({ error: 'Failed to generate unique room code. Please try again.', code: 'ROOM_CODE_COLLISION' });
      return;
    }

    await meetingQueries.create(meetingId, roomCode, meetingTitle, req.user!.userId, 100);

    const token = await livekitService.generateToken(
      roomCode,
      'Teacher',
      req.user!.userId,
      true
    );

    const endTime = Date.now();
    logger.info(`[API] POST /meetings/create took ${endTime - startTime}ms`);

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
          url: livekitService.getServerUrl(),
          configured: livekitService.isConfigured(),
        },
      },
    });
  } catch (error) {
    logger.error('Create meeting error', { error });
    res.status(500).json({ error: 'Failed to create meeting', code: 'SERVER_ERROR' });
  }
});

router.post('/schedule', requireRole('teacher'), async (req: AuthRequest, res: Response): Promise<void> => {
  const startTime = Date.now();
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

    const endTime = Date.now();
    logger.info(`[API] POST /meetings/schedule took ${endTime - startTime}ms`);

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
  } catch (error) {
    logger.error('Schedule meeting error', { error });
    res.status(500).json({ error: 'Failed to schedule meeting' });
  }
});

router.post('/join', async (req: AuthRequest, res: Response): Promise<void> => {
  const startTime = Date.now();
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

    let isRecording = false;
    let recordingElapsed = 0;
    try {
      const ongoingRecordings = await db.execute({
        sql: `SELECT (strftime('%s', 'now') - strftime('%s', started_at)) as elapsed FROM recordings WHERE meeting_id = ? AND status = 'recording'`,
        args: [meeting.id]
      });
      if (ongoingRecordings.rows.length > 0) {
        isRecording = true;
        recordingElapsed = Math.max(0, Number(ongoingRecordings.rows[0].elapsed || 0));
      }
    } catch (recError) {
      logger.error('Failed to query ongoing recordings on join', { error: recError });
    }

    const endTime = Date.now();
    logger.info(`[API] POST /meetings/join took ${endTime - startTime}ms`);

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
          url: livekitService.getServerUrl(),
          configured: livekitService.isConfigured(),
        },
      },
    });
  } catch (error) {
    logger.error('Join meeting error', { error });
    res.status(500).json({ error: 'Failed to join meeting' });
  }
});

router.post('/end', requireRole('teacher'), async (req: AuthRequest, res: Response): Promise<void> => {
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
    res.json({ success: true, data: { meetings } });
  } catch (error) {
    logger.error('Get recent meetings error', { error });
    res.status(500).json({ error: 'Failed to get meetings', code: 'SERVER_ERROR' });
  }
});

router.get('/scheduled', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await meetingQueries.getScheduled(req.user!.userId);
    res.json({ success: true, data: { meetings } });
  } catch (error) {
    logger.error('Get scheduled meetings error', { error });
    res.status(500).json({ error: 'Failed to get scheduled meetings', code: 'SERVER_ERROR' });
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

export default router;
