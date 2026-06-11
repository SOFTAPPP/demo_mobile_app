import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logDir = path.join(__dirname, '..', '..', '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'sangeet-arghya-api' },
  transports: [
    // Write all logs with importance level of `error` or higher to `error.log`
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    // Write all logs with importance level of `info` or higher to `combined.log`
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  ],
});

// Log to the console in all environments so Render can display them
logger.add(new winston.transports.Console({
  format: winston.format.combine(
    process.env.NODE_ENV === 'production' ? winston.format.uncolorize() : winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      if (stack) {
        return `[${timestamp}] ${level}: ${message}\n${stack}`;
      }
      return `[${timestamp}] ${level}: ${message}`;
    })
  ),
}));
