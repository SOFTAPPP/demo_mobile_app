import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config';
import { logger } from './lib/logger';
import { initializeDatabase, meetingQueries } from './models/db';
import { livekitService } from './services/livekit.service';
import authRoutes from './routes/auth.routes';
import meetingRoutes from './routes/meeting.routes';
import recordingRoutes from './routes/recording.routes';
import { recordingQueries } from './models/db';
import { s3Service } from './services/s3.service';

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const io = new SocketIOServer(server, {
  cors: {
    origin: config.isProduction ? config.corsOrigins : true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 10000,
  transports: ['websocket', 'polling'],
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(cors({
  origin: config.isProduction ? config.corsOrigins : true,
  credentials: true,
  maxAge: 86400, // Cache preflight requests for 24 hours to speed up mobile APIs
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`[API] ${req.method} ${req.originalUrl} took ${duration}ms`);
  });
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    livekit_configured: !!(config.livekit.apiKey && config.livekit.apiSecret),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/recordings', recordingRoutes);

const hostDisconnectTimers = new Map<string, NodeJS.Timeout>();

const socketRateLimits = new Map<string, { count: number; resetAt: number }>();
const SOCKET_RATE_WINDOW = 5000;
const SOCKET_RATE_MAX = 30;

function checkSocketRate(socketId: string): boolean {
  const now = Date.now();
  const entry = socketRateLimits.get(socketId);
  if (!entry || now > entry.resetAt) {
    socketRateLimits.set(socketId, { count: 1, resetAt: now + SOCKET_RATE_WINDOW });
    return true;
  }
  if (entry.count >= SOCKET_RATE_MAX) return false;
  entry.count++;
  return true;
}

const SOCKET_EVENTS = {
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  MEETING_ENDED: 'meeting-ended',
  MEETING_ENDED_GLOBAL: 'meeting-ended-global',
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_STARTED: 'recording:started',
  RECORDING_STOPPED: 'recording:stopped',
} as const;

io.on('connection', (socket) => {
  logger.debug(`Socket connected: ${socket.id}`);

  socket.use(([event], next) => {
    if (!checkSocketRate(socket.id)) {
      return next(new Error('Rate limit exceeded'));
    }
    next();
  });

  socket.on(SOCKET_EVENTS.JOIN_ROOM, (payload: any) => {
    // Fallback for older clients sending just a string
    const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
    const isHost = typeof payload === 'object' ? payload?.isHost : false;

    if (typeof roomCode !== 'string' || roomCode.length > 20) return;
    
    socket.join(roomCode);
    logger.debug(`${socket.id} joined room ${roomCode}`);

    if (isHost) {
      socket.data.isHost = true;
      socket.data.roomCode = roomCode;

      // Cancel any existing timeout if the host reconnects
      if (hostDisconnectTimers.has(roomCode)) {
        clearTimeout(hostDisconnectTimers.get(roomCode)!);
        hostDisconnectTimers.delete(roomCode);
        logger.info(`Host reconnected to ${roomCode}. Cancelled end-timer.`);
      }
    }
  });

  const handleHostDisconnect = (roomCode: string) => {
    logger.info(`Host disconnected from ${roomCode}. Starting 10-min end-timer.`);
    
    const timer = setTimeout(async () => {
      try {
        const meeting = await meetingQueries.findByCode(roomCode);
        if (meeting) {
          const ongoingRecordings = await recordingQueries.getOngoingRecordingsForMeeting(meeting.id);
          for (const rec of ongoingRecordings) {
            try {
              const parts = JSON.parse(rec.parts_json || '[]');
              if (parts.length > 0 && rec.upload_id) {
                await s3Service.completeMultipartUpload(rec.storage_key, rec.upload_id, parts);
                await recordingQueries.finalizeRecording(rec.id, 'saved', 0, 0);
              } else if (rec.upload_id) {
                await s3Service.abortMultipartUpload(rec.storage_key, rec.upload_id);
                await recordingQueries.finalizeRecording(rec.id, 'failed', 0, 0);
              }
            } catch (e) {
              logger.error('Failed to auto-finalize recording', e);
            }
          }
        }

        await meetingQueries.endMeeting(roomCode);
        livekitService.endRoom(roomCode);
        io.to(roomCode).emit(SOCKET_EVENTS.MEETING_ENDED);
        io.emit(SOCKET_EVENTS.MEETING_ENDED_GLOBAL, roomCode);
        hostDisconnectTimers.delete(roomCode);
        logger.info(`Meeting ${roomCode} auto-ended due to 10-minute host absence.`);
      } catch (err) {
        logger.error(`Failed to auto-end meeting ${roomCode}:`, err);
      }
    }, 10 * 60 * 1000); // 10 minutes

    hostDisconnectTimers.set(roomCode, timer);
  };

  socket.on(SOCKET_EVENTS.RECORDING_START, (payload) => {
    const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
    io.to(roomCode).emit(SOCKET_EVENTS.RECORDING_STARTED);
  });

  socket.on(SOCKET_EVENTS.RECORDING_STOP, (payload) => {
    const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
    io.to(roomCode).emit(SOCKET_EVENTS.RECORDING_STOPPED);
  });

  socket.on(SOCKET_EVENTS.LEAVE_ROOM, (payload: any) => {
    const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
    if (typeof roomCode !== 'string' || roomCode.length > 20) return;
    
    socket.leave(roomCode);
    logger.debug(`${socket.id} left room ${roomCode}`);

    if (socket.data.isHost && socket.data.roomCode === roomCode) {
      handleHostDisconnect(roomCode);
      socket.data.isHost = false;
      socket.data.roomCode = undefined;
    }
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
    if (socket.data.isHost && socket.data.roomCode) {
      handleHostDisconnect(socket.data.roomCode);
    }
  });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(err.message, { stack: err.stack, url: req.url, method: req.method });
  res.status(err.status || 500).json({ error: config.isProduction ? 'Internal Server Error' : err.message });
});

const start = async () => {
  await initializeDatabase();
  server.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
    if (!config.isProduction) {
      console.log('');
      console.log('🎵 ═══════════════════════════════════════════════════');
      console.log('   Sangeet Arghya — Nada Upasana Academy');
      console.log('   Meeting Server');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`   🚀 Server running on http://localhost:${config.port}`);
      console.log(`   📡 API endpoint: http://localhost:${config.port}/api`);
      console.log(`   🔑 LiveKit: ${config.livekit.apiKey ? '✅ Configured' : '⚠️  Not configured (demo mode)'}`);
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    }
  });
};
start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});

const shutdown = () => {
  logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
  io.close();
  server.close(() => {
    logger.info('HTTP server closed.');
    import('./models/db').then(({ default: db }) => {
      db.close();
      logger.info('Database connection closed.');
      process.exit(0);
    }).catch((err) => {
      logger.error('Failed to close database:', err);
      process.exit(1);
    });
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server, io };
