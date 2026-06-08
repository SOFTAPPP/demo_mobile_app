import dotenv from 'dotenv';
dotenv.config();

export const config = {
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
