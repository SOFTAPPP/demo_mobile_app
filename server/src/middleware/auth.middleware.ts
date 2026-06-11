import { Request, Response, NextFunction } from 'express';
import { jwtService } from '../services/jwt.service';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  let token = req.cookies?.accessToken;

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401).json({ error: 'No token provided', code: 'INVALID_TOKEN' });
    return;
  }

  try {
    const decoded = jwtService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    return;
  }
};

export const requireRole = (...roles: string[]) => (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'NOT_HOST' });
    return;
  }
  next();
};

export const optionalAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.cookies?.accessToken || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
  if (token) {
    try {
      req.user = jwtService.verifyAccessToken(token);
    } catch {}
  }
  next();
};
