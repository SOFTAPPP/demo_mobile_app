"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '3001', 10),
    jwtSecret: process.env.JWT_SECRET || 'sangeet-arghya-demo-secret',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'sangeet-arghya-demo-refresh-secret',
    jwtExpiresIn: '24h',
    jwtRefreshExpiresIn: '7d',
    livekit: {
        apiKey: process.env.LIVEKIT_API_KEY || '',
        apiSecret: process.env.LIVEKIT_API_SECRET || '',
        url: process.env.LIVEKIT_URL || '',
    },
    corsOrigins: [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3000',
        'http://localhost',
        'capacitor://localhost'
    ],
};
//# sourceMappingURL=index.js.map