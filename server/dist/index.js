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
const db_1 = require("./models/db");
const livekit_service_1 = require("./services/livekit.service");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const meeting_routes_1 = __importDefault(require("./routes/meeting.routes"));
const recording_routes_1 = __importDefault(require("./routes/recording.routes"));
const db_2 = require("./models/db");
const s3_service_1 = require("./services/s3.service");
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
app.set('trust proxy', 1);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: config_1.config.isProduction ? config_1.config.corsOrigins : true,
        methods: ['GET', 'POST'],
        credentials: true,
    },
    pingTimeout: 20000,
    pingInterval: 10000,
    transports: ['websocket', 'polling'],
});
exports.io = io;
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use((0, compression_1.default)());
app.use((0, cors_1.default)({
    origin: config_1.config.isProduction ? config_1.config.corsOrigins : true,
    credentials: true,
    maxAge: 86400, // Cache preflight requests for 24 hours to speed up mobile APIs
}));
app.use(express_1.default.json({ limit: '1mb' }));
app.use((0, cookie_parser_1.default)());
app.use((0, morgan_1.default)('combined', { stream: { write: (message) => logger_1.logger.info(message.trim()) } }));
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger_1.logger.info(`[API] ${req.method} ${req.originalUrl} took ${duration}ms`);
    });
    next();
});
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        livekit_configured: !!(config_1.config.livekit.apiKey && config_1.config.livekit.apiSecret),
    });
});
app.use('/api/auth', auth_routes_1.default);
app.use('/api/meetings', meeting_routes_1.default);
app.use('/api/recordings', recording_routes_1.default);
const hostDisconnectTimers = new Map();
const socketRateLimits = new Map();
const SOCKET_RATE_WINDOW = 5000;
const SOCKET_RATE_MAX = 30;
function checkSocketRate(socketId) {
    const now = Date.now();
    const entry = socketRateLimits.get(socketId);
    if (!entry || now > entry.resetAt) {
        socketRateLimits.set(socketId, { count: 1, resetAt: now + SOCKET_RATE_WINDOW });
        return true;
    }
    if (entry.count >= SOCKET_RATE_MAX)
        return false;
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
};
io.on('connection', (socket) => {
    logger_1.logger.debug(`Socket connected: ${socket.id}`);
    socket.use(([event], next) => {
        if (!checkSocketRate(socket.id)) {
            return next(new Error('Rate limit exceeded'));
        }
        next();
    });
    socket.on(SOCKET_EVENTS.JOIN_ROOM, (payload) => {
        // Fallback for older clients sending just a string
        const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
        const isHost = typeof payload === 'object' ? payload?.isHost : false;
        if (typeof roomCode !== 'string' || roomCode.length > 20)
            return;
        socket.join(roomCode);
        logger_1.logger.debug(`${socket.id} joined room ${roomCode}`);
        if (isHost) {
            socket.data.isHost = true;
            socket.data.roomCode = roomCode;
            // Cancel any existing timeout if the host reconnects
            if (hostDisconnectTimers.has(roomCode)) {
                clearTimeout(hostDisconnectTimers.get(roomCode));
                hostDisconnectTimers.delete(roomCode);
                logger_1.logger.info(`Host reconnected to ${roomCode}. Cancelled end-timer.`);
            }
        }
    });
    const handleHostDisconnect = (roomCode) => {
        logger_1.logger.info(`Host disconnected from ${roomCode}. Starting 10-min end-timer.`);
        const timer = setTimeout(async () => {
            try {
                const meeting = await db_1.meetingQueries.findByCode(roomCode);
                if (meeting) {
                    const ongoingRecordings = await db_2.recordingQueries.getOngoingRecordingsForMeeting(meeting.id);
                    for (const rec of ongoingRecordings) {
                        try {
                            const parts = JSON.parse(rec.parts_json || '[]');
                            if (parts.length > 0 && rec.upload_id) {
                                await s3_service_1.s3Service.completeMultipartUpload(rec.storage_key, rec.upload_id, parts);
                                await db_2.recordingQueries.finalizeRecording(rec.id, 'saved', 0, 0);
                            }
                            else if (rec.upload_id) {
                                await s3_service_1.s3Service.abortMultipartUpload(rec.storage_key, rec.upload_id);
                                await db_2.recordingQueries.finalizeRecording(rec.id, 'failed', 0, 0);
                            }
                        }
                        catch (e) {
                            logger_1.logger.error('Failed to auto-finalize recording', e);
                        }
                    }
                }
                await db_1.meetingQueries.endMeeting(roomCode);
                livekit_service_1.livekitService.endRoom(roomCode);
                io.to(roomCode).emit(SOCKET_EVENTS.MEETING_ENDED);
                io.emit(SOCKET_EVENTS.MEETING_ENDED_GLOBAL, roomCode);
                hostDisconnectTimers.delete(roomCode);
                logger_1.logger.info(`Meeting ${roomCode} auto-ended due to 10-minute host absence.`);
            }
            catch (err) {
                logger_1.logger.error(`Failed to auto-end meeting ${roomCode}:`, err);
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
    socket.on(SOCKET_EVENTS.LEAVE_ROOM, (payload) => {
        const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
        if (typeof roomCode !== 'string' || roomCode.length > 20)
            return;
        socket.leave(roomCode);
        logger_1.logger.debug(`${socket.id} left room ${roomCode}`);
        if (socket.data.isHost && socket.data.roomCode === roomCode) {
            handleHostDisconnect(roomCode);
            socket.data.isHost = false;
            socket.data.roomCode = undefined;
        }
    });
    socket.on('disconnect', () => {
        logger_1.logger.debug(`Socket disconnected: ${socket.id}`);
        if (socket.data.isHost && socket.data.roomCode) {
            handleHostDisconnect(socket.data.roomCode);
        }
    });
});
app.use((err, req, res, next) => {
    logger_1.logger.error(err.message, { stack: err.stack, url: req.url, method: req.method });
    res.status(err.status || 500).json({ error: config_1.config.isProduction ? 'Internal Server Error' : err.message });
});
const start = async () => {
    await (0, db_1.initializeDatabase)();
    server.listen(config_1.config.port, () => {
        logger_1.logger.info(`Server started on port ${config_1.config.port}`);
        if (!config_1.config.isProduction) {
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
        }
    });
};
start().catch((err) => {
    logger_1.logger.error('Failed to start server:', err);
    process.exit(1);
});
const shutdown = () => {
    logger_1.logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
    io.close();
    server.close(() => {
        logger_1.logger.info('HTTP server closed.');
        Promise.resolve().then(() => __importStar(require('./models/db'))).then(({ default: db }) => {
            db.close();
            logger_1.logger.info('Database connection closed.');
            process.exit(0);
        }).catch((err) => {
            logger_1.logger.error('Failed to close database:', err);
            process.exit(1);
        });
    });
    setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
//# sourceMappingURL=index.js.map