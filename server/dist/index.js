"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
require("express-async-errors");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = require("./config");
const logger_1 = require("./lib/logger");
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
        credentials: true,
    },
});
exports.io = io;
// Middleware
app.use((0, helmet_1.default)());
app.use((0, compression_1.default)());
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigins, credentials: true }));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// Morgan request logging mapped to Winston
app.use((0, morgan_1.default)('combined', { stream: { write: (message) => logger_1.logger.info(message.trim()) } }));
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
        logger_1.logger.info(`🔌 Socket disconnected: ${socket.id}`);
    });
});
// Global Error Handler
app.use((err, req, res, next) => {
    logger_1.logger.error(err.message, { stack: err.stack, url: req.url, method: req.method });
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});
// Start server
server.listen(config_1.config.port, () => {
    logger_1.logger.info(`Server started on port ${config_1.config.port}`);
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
// Graceful Shutdown
const shutdown = () => {
    logger_1.logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
    server.close(() => {
        logger_1.logger.info('HTTP server closed.');
        // Import db lazily so it shuts down properly
        Promise.resolve().then(() => __importStar(require('./models/db'))).then(({ default: db }) => {
            db.close();
            logger_1.logger.info('Database connection closed.');
            process.exit(0);
        });
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
//# sourceMappingURL=index.js.map