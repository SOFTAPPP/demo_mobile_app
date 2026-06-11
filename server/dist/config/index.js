"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const requiredInProduction = ['JWT_SECRET', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'TURSO_DATABASE_URL'];
if (process.env.NODE_ENV === 'production') {
    const missing = requiredInProduction.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.warn(`[Config] Missing env vars in production: ${missing.join(', ')}`);
    }
}
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
        'capacitor://localhost',
        process.env.CLIENT_URL || ''
    ].filter(Boolean),
    isProduction: process.env.NODE_ENV === 'production',
};
//# sourceMappingURL=index.js.map