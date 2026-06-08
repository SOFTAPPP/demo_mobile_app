import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import authRoutes from './routes/auth.routes';
import meetingRoutes from './routes/meeting.routes';

const app = express();
const server = http.createServer(app);

// Socket.io for non-media real-time events (chat, notifications)
const io = new SocketIOServer(server, {
  cors: {
    origin: config.corsOrigins,
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());

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
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Start server
server.listen(config.port, () => {
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

export { app, server, io };
