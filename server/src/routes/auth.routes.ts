import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { userQueries } from '../models/db';
import { jwtService } from '../services/jwt.service';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import { config } from '../config';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests from this IP, please try again later' },
});

const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['teacher', 'student']).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: (config.isProduction ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: 24 * 60 * 60 * 1000,
};

const AVATAR_COLORS = [
  '#7B2D26', '#8B4513', '#D4722A', '#B8860B', '#2D5F2D',
  '#4A1A2E', '#6B3A5E', '#1B5E20', '#C4932A', '#A0522D',
];

router.post('/signup', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsedBody = signupSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.issues[0].message });
      return;
    }
    const { name, email, password, role } = parsedBody.data;

    const existing = await userQueries.findByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId = uuidv4();
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const userRole = role === 'teacher' ? 'teacher' : 'student';

    await userQueries.create(userId, name, email, passwordHash, userRole, avatarColor);

    const tokens = {
      accessToken: jwtService.signAccessToken({ userId, email, role: userRole }),
      refreshToken: jwtService.signRefreshToken({ userId, email, role: userRole }),
    };

    res.cookie('accessToken', tokens.accessToken, cookieOptions);
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    res.status(201).json({
      user: { id: userId, name, email, role: userRole, avatar_color: avatarColor }
    });
  } catch (error) {
    logger.error('Signup error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsedBody = loginSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.issues[0].message });
      return;
    }
    const { email, password } = parsedBody.data;

    const user = await userQueries.findByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const tokens = {
      accessToken: jwtService.signAccessToken({ userId: user.id, email: user.email, role: user.role }),
      refreshToken: jwtService.signRefreshToken({ userId: user.id, email: user.email, role: user.role }),
    };

    res.cookie('accessToken', tokens.accessToken, cookieOptions);
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_color: user.avatar_color,
      }
    });
  } catch (error) {
    logger.error('Login error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await userQueries.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_color: user.avatar_color,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    logger.error('Get me error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', (req: Request, res: Response): void => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token required' });
      return;
    }

    const decoded = jwtService.verifyRefreshToken(refreshToken);
    const newAccessToken = jwtService.signAccessToken({
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    });

    res.cookie('accessToken', newAccessToken, cookieOptions);

    res.json({ success: true });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', (req: Request, res: Response): void => {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });
  res.json({ success: true });
});

export default router;
