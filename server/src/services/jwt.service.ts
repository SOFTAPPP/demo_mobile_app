import jwt from 'jsonwebtoken';
import { config } from '../config';

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export const jwtService = {
  signAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });
  },

  signRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, config.jwtRefreshSecret, {
      expiresIn: config.jwtRefreshExpiresIn as any,
    });
  },

  verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  },

  verifyRefreshToken(token: string): TokenPayload {
    return jwt.verify(token, config.jwtRefreshSecret) as TokenPayload;
  },
};
