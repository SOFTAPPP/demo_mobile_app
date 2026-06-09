"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../models/db");
const jwt_service_1 = require("../services/jwt.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Rate limiters
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per `window`
    message: { error: 'Too many requests from this IP, please try again later' },
});
// Zod schemas
const signupSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters').max(50),
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters'),
    role: zod_1.z.enum(['teacher', 'student']).optional(),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(1, 'Password is required'),
});
const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
};
// Random avatar colors matching the Sangeet Arghya theme
const AVATAR_COLORS = [
    '#7B2D26', '#8B4513', '#D4722A', '#B8860B', '#2D5F2D',
    '#4A1A2E', '#6B3A5E', '#1B5E20', '#C4932A', '#A0522D',
];
/**
 * POST /api/auth/signup
 */
router.post('/signup', authLimiter, async (req, res) => {
    try {
        const parsedBody = signupSchema.safeParse(req.body);
        if (!parsedBody.success) {
            res.status(400).json({ error: parsedBody.error.issues[0].message });
            return;
        }
        const { name, email, password, role } = parsedBody.data;
        // Check if user already exists
        const existing = db_1.userQueries.findByEmail.get(email);
        if (existing) {
            res.status(409).json({ error: 'Email already registered' });
            return;
        }
        // Hash password
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const userId = (0, uuid_1.v4)();
        const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        const userRole = role === 'teacher' ? 'teacher' : 'student';
        db_1.userQueries.create.run(userId, name, email, passwordHash, userRole, avatarColor);
        const tokens = {
            accessToken: jwt_service_1.jwtService.signAccessToken({ userId, email, role: userRole }),
            refreshToken: jwt_service_1.jwtService.signRefreshToken({ userId, email, role: userRole }),
        };
        res.cookie('accessToken', tokens.accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 }); // 15 mins
        res.cookie('refreshToken', tokens.refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 }); // 7 days
        res.status(201).json({
            user: { id: userId, name, email, role: userRole, avatar_color: avatarColor }
        });
    }
    catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * POST /api/auth/login
 */
router.post('/login', authLimiter, async (req, res) => {
    try {
        const parsedBody = loginSchema.safeParse(req.body);
        if (!parsedBody.success) {
            res.status(400).json({ error: parsedBody.error.issues[0].message });
            return;
        }
        const { email, password } = parsedBody.data;
        const user = db_1.userQueries.findByEmail.get(email);
        if (!user) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        const isMatch = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!isMatch) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        const tokens = {
            accessToken: jwt_service_1.jwtService.signAccessToken({ userId: user.id, email: user.email, role: user.role }),
            refreshToken: jwt_service_1.jwtService.signRefreshToken({ userId: user.id, email: user.email, role: user.role }),
        };
        res.cookie('accessToken', tokens.accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
        res.cookie('refreshToken', tokens.refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                avatar_color: user.avatar_color,
            }
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * GET /api/auth/me
 */
router.get('/me', auth_middleware_1.authMiddleware, (req, res) => {
    try {
        const user = db_1.userQueries.findById.get(req.user.userId);
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
    }
    catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * POST /api/auth/refresh
 */
router.post('/refresh', (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
        if (!refreshToken) {
            res.status(401).json({ error: 'Refresh token required' });
            return;
        }
        const decoded = jwt_service_1.jwtService.verifyRefreshToken(refreshToken);
        const newAccessToken = jwt_service_1.jwtService.signAccessToken({
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
        });
        res.cookie('accessToken', newAccessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
        res.json({ success: true });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});
/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.json({ success: true });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map