"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const config_1 = require("./config");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const meeting_routes_1 = __importDefault(require("./routes/meeting.routes"));
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
// Socket.io for non-media real-time events (chat, notifications)
const io = new socket_io_1.Server(server, {
    cors: {
        origin: config_1.config.corsOrigins,
        methods: ['GET', 'POST'],
    },
});
exports.io = io;
// Middleware
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigins, credentials: true }));
app.use(express_1.default.json());
// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        livekit_configured: !!(config_1.config.livekit.apiKey && config_1.config.livekit.apiSecret),
    });
});
// Routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/meetings', meeting_routes_1.default);
// Socket.io events (for future chat/reactions features)
io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);
    socket.on('join-room', (roomCode) => {
        socket.join(roomCode);
        console.log(`👤 ${socket.id} joined room ${roomCode}`);
    });
    socket.on('leave-room', (roomCode) => {
        socket.leave(roomCode);
        console.log(`👤 ${socket.id} left room ${roomCode}`);
    });
    socket.on('disconnect', () => {
        console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
});
// Start server
server.listen(config_1.config.port, () => {
    console.log('');
    console.log('🎵 ═══════════════════════════════════════════════════');
    console.log('   Sangeet Arghya — Nada Upasana Academy');
    console.log('   Meeting Server');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   🚀 Server running on http://localhost:${config_1.config.port}`);
    console.log(`   📡 API endpoint: http://localhost:${config_1.config.port}/api`);
    console.log(`   🔑 LiveKit: ${config_1.config.livekit.apiKey ? '✅ Configured' : '⚠️  Not configured (demo mode)'}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
});
//# sourceMappingURL=index.js.map