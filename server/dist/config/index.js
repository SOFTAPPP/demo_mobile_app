"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isProduction = process.env.NODE_ENV === 'production';
const requiredEnvs = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
];
for (const key of requiredEnvs) {
    if (!process.env[key]) {
        if (isProduction) {
            throw new Error(`[Config] Missing required env var: ${key}. Server cannot start in production.`);
        }
        console.warn(`[Config] Missing env var: ${key}. Running in demo/dev mode.`);
    }
}
exports.config = {
    port: parseInt(process.env.PORT || '3001', 10),
    jwtSecret: process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
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
        'capacitor://localhost',
        process.env.CLIENT_URL || '',
    ].filter(Boolean),
    isProduction,
    isLocalhost: !isProduction,
};
//# sourceMappingURL=index.js.map