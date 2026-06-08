import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { userQueries, User } from '../models/db';
import { jwtService } from '../services/jwt.service';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Random avatar colors matching the Sangeet Arghya theme
const AVATAR_COLORS = [
  '#7B2D26', '#8B4513', '#D4722A', '#B8860B', '#2D5F2D',
  '#4A1A2E', '#6B3A5E', '#1B5E20', '#C4932A', '#A0522D',
];

/**
 * POST /api/auth/signup
 */
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    // Check if user already exists
    const existing = userQueries.findByEmail.get(email) as User | undefined;
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId = uuidv4();
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const userRole = role === 'teacher' ? 'teacher' : 'student';

    userQueries.create.run(userId, name, email, passwordHash, userRole, avatarColor);

    const tokens = {
      accessToken: jwtService.signAccessToken({ userId, email, role: userRole }),
      refreshToken: jwtService.signRefreshToken({ userId, email, role: userRole }),
    };

    res.status(201).json({
      user: { id: userId, name, email, role: userRole, avatar_color: avatarColor },
      ...tokens,
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = userQueries.findByEmail.get(email) as User | undefined;
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

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_color: user.avatar_color,
      },
      ...tokens,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const user = userQueries.findById.get(req.user!.userId) as User | undefined;
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
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', (req: Request, res: Response): void => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    const decoded = jwtService.verifyRefreshToken(refreshToken);
    const newAccessToken = jwtService.signAccessToken({
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    });

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

export default router;
