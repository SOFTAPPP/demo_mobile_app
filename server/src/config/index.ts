import dotenv from 'dotenv';
dotenv.config();

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

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET as string,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,
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
