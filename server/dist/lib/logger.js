"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Ensure logs directory exists
const logDir = path_1.default.join(__dirname, '..', '..', '..', 'logs');
if (!fs_1.default.existsSync(logDir)) {
    fs_1.default.mkdirSync(logDir, { recursive: true });
}
exports.logger = winston_1.default.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.json()),
    defaultMeta: { service: 'sangeet-arghya-api' },
    transports: [
        // Write all logs with importance level of `error` or higher to `error.log`
        new winston_1.default.transports.File({ filename: path_1.default.join(logDir, 'error.log'), level: 'error' }),
        // Write all logs with importance level of `info` or higher to `combined.log`
        new winston_1.default.transports.File({ filename: path_1.default.join(logDir, 'combined.log') }),
    ],
});
// Log to the console in all environments so Render can display them
exports.logger.add(new winston_1.default.transports.Console({
    format: winston_1.default.format.combine(process.env.NODE_ENV === 'production' ? winston_1.default.format.uncolorize() : winston_1.default.format.colorize(), winston_1.default.format.printf(({ level, message, timestamp, stack }) => {
        if (stack) {
            return `[${timestamp}] ${level}: ${message}\n${stack}`;
        }
        return `[${timestamp}] ${level}: ${message}`;
    })),
}));
//# sourceMappingURL=logger.js.map