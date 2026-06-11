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
import { initializeDatabase } from './models/db';
import authRoutes from './routes/auth.routes';
import meetingRoutes from './routes/meeting.routes';

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
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    livekit_configured: !!(config.livekit.apiKey && config.livekit.apiSecret),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);

io.on('connection', (socket) => {
  logger.debug(`Socket connected: ${socket.id}`);

  socket.on('join-room', (roomCode: string) => {
    if (typeof roomCode !== 'string' || roomCode.length > 20) return;
    socket.join(roomCode);
    logger.debug(`${socket.id} joined room ${roomCode}`);
  });

  socket.on('leave-room', (roomCode: string) => {
    if (typeof roomCode !== 'string' || roomCode.length > 20) return;
    socket.leave(roomCode);
    logger.debug(`${socket.id} left room ${roomCode}`);
  });

  socket.on('recording-started', (roomCode: string) => {
    if (typeof roomCode !== 'string' || roomCode.length > 20) return;
    socket.to(roomCode).emit('recording-started');
  });

  socket.on('recording-stopped', (roomCode: string) => {
    if (typeof roomCode !== 'string' || roomCode.length > 20) return;
    socket.to(roomCode).emit('recording-stopped');
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
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
start();

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
