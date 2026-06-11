import { Router, Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db, { recordingQueries, meetingQueries, Recording } from '../models/db';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { sanitizeBody } from '../middleware/validate';
import { s3Service, s3PublicUrl } from '../services/s3.service';
import { logger } from '../lib/logger';

const router = Router();
router.post('/clean-r2', async (req: Request, res: Response) => {
  try {
    const { ListMultipartUploadsCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
    const { s3Client, s3Bucket } = require('../services/s3.service');
    
    const listCommand = new ListMultipartUploadsCommand({ Bucket: s3Bucket });
    const { Uploads } = await s3Client.send(listCommand);
    
    let aborted = 0;
    if (Uploads && Uploads.length > 0) {
      for (const upload of Uploads) {
        if (upload.Key && upload.UploadId) {
          await s3Client.send(new AbortMultipartUploadCommand({
            Bucket: s3Bucket,
            Key: upload.Key,
            UploadId: upload.UploadId
          }));
          aborted++;
        }
      }
    }
    
    await db.execute('DELETE FROM recordings');
    
    res.json({ success: true, message: `Cleaned up ${aborted} multipart uploads and truncated recordings table.` });
  } catch (error) {
    logger.error('Cleanup failed', error);
    res.status(500).json({ error: 'Failed to cleanup' });
  }
});

router.use(authMiddleware);
router.use(sanitizeBody);

// Webhook for Egress
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    logger.info(`Received webhook event: ${event.event}`, event);

    if (event.event === 'egress_ended' && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const status = event.egressInfo.status;
      const duration = event.egressInfo.file?.duration || 0;
      const size = event.egressInfo.file?.size || 0;
      
      const dbStatus = status === 3 ? 'saved' : 'failed'; // 3 is EGRESS_COMPLETE
      
      await db.execute({
        sql: `UPDATE recordings SET status = ?, duration = ?, file_size = ? WHERE upload_id = ?`,
        args: [dbStatus, Math.floor(duration), size, egressId]
      });

      const recordingRes = await db.execute({
        sql: `SELECT m.room_code FROM recordings r JOIN meetings m ON r.meeting_id = m.id WHERE r.upload_id = ?`,
        args: [egressId]
      });
      
      if (recordingRes.rows.length > 0) {
        const roomCode = recordingRes.rows[0].room_code as string;
        const { io } = require('../index');
        io.to(roomCode).emit('recording:stopped');
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error', error);
    res.status(500).send('Error');
  }
});

const egressClient = new (require('livekit-server-sdk').EgressClient)(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

router.post('/start', requireRole('teacher'), async (req: AuthRequest, res: Response) => {
  const { roomCode } = req.body;
  if (!roomCode) return res.status(400).json({ error: 'roomCode is required' });

  const meeting = await meetingQueries.findByCode(roomCode);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.host_id !== req.user?.userId) return res.status(403).json({ error: 'Only host can record' });

  const existing = await recordingQueries.getOngoingRecordingsForMeeting(meeting.id);
  if (existing.length > 0) return res.status(400).json({ error: 'Recording already in progress' });

  const id = uuidv4();
  const dateStr = new Date().toISOString().split('T')[0];
  const storageKey = `recordings/${roomCode}/${dateStr}-${id}.mp4`;
  const userId = req.user.userId;

  // 1. Immediately emit socket event for instant UI feedback across all clients
  const { io } = require('../index');
  io.to(roomCode).emit('recording:started');

  // 2. Immediately send HTTP response
  res.json({ recordingId: id, storageKey, status: 'starting' });

  // 3. Do the heavy lifting in the background
  (async () => {
    try {
      const { EncodedFileOutput, S3Upload, EncodedFileType } = require('livekit-server-sdk');
      
      const fileOutput = new EncodedFileOutput({
        filepath: storageKey,
        fileType: EncodedFileType.MP4,
        output: {
          case: 's3',
          value: new S3Upload({
            accessKey: process.env.S3_ACCESS_KEY!,
            secret: process.env.S3_SECRET_KEY!,
            bucket: process.env.S3_BUCKET!,
            endpoint: process.env.S3_ENDPOINT!,
            region: 'auto',
            forcePathStyle: true,
          }),
        },
      });

      const info = await egressClient.startRoomCompositeEgress(
        roomCode,
        { file: fileOutput },
        { layout: 'grid' }
      );

      const egressId = info.egressId;

      // Now insert into DB since we have the real egressId
      await recordingQueries.createRecording({
        id,
        meeting_id: meeting.id,
        user_id: userId,
        egress_id: egressId,
        storage_provider: 'cloudflare_r2',
        storage_key: storageKey,
        upload_id: egressId,
        mime_type: 'video/mp4',
      });

    } catch (error) {
      logger.error('Background egress start failed', error);
      // Revert UI if it failed
      io.to(roomCode).emit('recording:stopped');
    }
  })();
});

router.post('/stop', async (req: AuthRequest, res: Response) => {
  const { recordingId, roomCode } = req.body;

  let recording: Recording | null = null;

  if (recordingId) {
    recording = await recordingQueries.getRecordingById(recordingId);
  }
  
  if (!recording && roomCode) {
    const meeting = await meetingQueries.findByCode(roomCode);
    if (meeting) {
      const ongoing = await recordingQueries.getOngoingRecordingsForMeeting(meeting.id);
      if (ongoing.length > 0) {
        recording = ongoing[0];
      }
    }
  }

  if (!recording) return res.status(404).json({ error: 'No active recording found' });
  if (recording.user_id !== req.user?.userId) return res.status(403).json({ error: 'Not authorized' });
  if (recording.status !== 'recording') return res.json({ success: true, recording });

  try {
    // 1. Immediately emit socket event to stop UI instantly
    const { io } = require('../index');
    const meeting = await meetingQueries.findById(recording.meeting_id);
    if (meeting) {
      io.to(meeting.room_code).emit('recording:stopped');
    }

    // 2. Respond instantly
    res.json({ success: true });

    // 3. Do heavy lifting in background
    (async () => {
      try {
        const egressIdToStop = recording.egress_id || recording.upload_id;
        if (egressIdToStop) {
          try {
            await egressClient.stopEgress(egressIdToStop);
          } catch (egressErr: any) {
            logger.warn('stopEgress warning (may already be stopped)', egressErr?.message);
          }
        }
        
        await recordingQueries.finalizeRecording(recording!.id, 'saved', 0, 0);
      } catch (bgError) {
        logger.error('Background egress stop failed', bgError);
      }
    })();
  } catch (error) {
    logger.error('Failed to stop egress recording', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stop recording' });
    }
  }
});

router.get('/my', async (req: AuthRequest, res: Response) => {
  try {
    const recordings = await recordingQueries.getRecordingsByUserId(req.user!.userId);
    const mapped = await Promise.all(
      recordings.map(async (r) => ({
        id: r.id,
        meetingId: r.meeting_id,
        meetingTitle: r.meeting_title,
        meetingRoomCode: r.meeting_room_code,
        status: r.status,
        duration: r.duration,
        fileSize: r.file_size,
        mimeType: r.mime_type,
        createdAt: r.created_at,
        endedAt: r.ended_at,
        downloadUrl: r.status === 'saved'
          ? await s3Service.getPresignedDownloadUrl(r.storage_key, 7200).catch(() => null)
          : null,
      }))
    );
    res.json({ success: true, data: { recordings: mapped } });
  } catch (error) {
    logger.error('Get my recordings error', { error });
    res.status(500).json({ error: 'Failed to get recordings', code: 'SERVER_ERROR' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const recordingId = req.params.id as string;
    const recording = await recordingQueries.getRecordingById(recordingId);

    if (!recording) {
      res.status(404).json({ error: 'Recording not found', code: 'ROOM_NOT_FOUND' });
      return;
    }

    if (recording.user_id !== req.user!.userId) {
      res.status(403).json({ error: 'Not authorized to delete this recording', code: 'NOT_HOST' });
      return;
    }

    const deleted = await recordingQueries.deleteRecording(recordingId, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Recording not found', code: 'ROOM_NOT_FOUND' });
      return;
    }

    res.json({ success: true, message: 'Recording deleted successfully' });
  } catch (error) {
    logger.error('Delete recording error', { error });
    res.status(500).json({ error: 'Failed to delete recording', code: 'SERVER_ERROR' });
  }
});

router.get('/:meetingId', async (req: AuthRequest, res: Response) => {
  const meetingId = req.params.meetingId as string;

  const meeting = await meetingQueries.findById(meetingId);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found', code: 'ROOM_NOT_FOUND' });
    return;
  }

  const isHost = meeting.host_id === req.user?.userId;
  const participants = await db.execute({
    sql: 'SELECT user_id FROM meeting_participants WHERE meeting_id = ? AND user_id = ?',
    args: [meetingId, req.user!.userId],
  });
  const isParticipant = participants.rows.length > 0;

  if (!isHost && !isParticipant) {
    res.status(403).json({ error: 'Not authorized to view these recordings', code: 'NOT_HOST' });
    return;
  }

  const recordings = await recordingQueries.getRecordingsByMeetingId(meetingId);

  const mapped = await Promise.all(
    recordings.map(async (r) => ({
      ...r,
      downloadUrl: r.status === 'saved' && s3PublicUrl
        ? await s3Service.getPresignedDownloadUrl(r.storage_key, 7200).catch(() => null)
        : null,
    }))
  );

  res.json({ success: true, data: { recordings: mapped } });
});

export default router;
