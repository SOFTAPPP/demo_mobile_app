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
import authRoutes from './routes/auth.routes';
import meetingRoutes from './routes/meeting.routes';

const app = express();
const server = http.createServer(app);

// Socket.io for non-media real-time events (chat, notifications)
const io = new SocketIOServer(server, {
  cors: {
    origin: config.corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Morgan request logging mapped to Winston
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    livekit_configured: !!(config.livekit.apiKey && config.livekit.apiSecret),
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);

// Socket.io events (for future chat/reactions features)
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on('join-room', (roomCode: string) => {
    socket.join(roomCode);
    console.log(`👤 ${socket.id} joined room ${roomCode}`);
  });

  socket.on('leave-room', (roomCode: string) => {
    socket.leave(roomCode);
    console.log(`👤 ${socket.id} left room ${roomCode}`);
  });

  socket.on('disconnect', () => {
    logger.info(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(err.message, { stack: err.stack, url: req.url, method: req.method });
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Start server
import { initializeDatabase } from './models/db';

const start = async () => {
  await initializeDatabase();
  server.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
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
  });
};
start();

// Graceful Shutdown
const shutdown = () => {
  logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('HTTP server closed.');
    // Import db lazily so it shuts down properly
    import('./models/db').then(({ default: db }) => {
      db.close();
      logger.info('Database connection closed.');
      process.exit(0);
    }).catch((err) => {
      logger.error('Failed to close database:', err);
      process.exit(1);
    });
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server, io };
