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
const logger_1 = require("../lib/logger");
const config_1 = require("../config");
const router = (0, express_1.Router)();
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many requests from this IP, please try again later' },
});
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
    secure: config_1.config.isProduction,
    sameSite: (config_1.config.isProduction ? 'none' : 'lax'),
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
};
const AVATAR_COLORS = [
    '#7B2D26', '#8B4513', '#D4722A', '#B8860B', '#2D5F2D',
    '#4A1A2E', '#6B3A5E', '#1B5E20', '#C4932A', '#A0522D',
];
router.post('/signup', authLimiter, async (req, res) => {
    try {
        const parsedBody = signupSchema.safeParse(req.body);
        if (!parsedBody.success) {
            res.status(400).json({ error: parsedBody.error.issues[0].message });
            return;
        }
        const { name, email, password, role } = parsedBody.data;
        const existing = await db_1.userQueries.findByEmail(email);
        if (existing) {
            res.status(409).json({ error: 'Email already registered' });
            return;
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const userId = (0, uuid_1.v4)();
        const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        const userRole = role === 'teacher' ? 'teacher' : 'student';
        await db_1.userQueries.create(userId, name, email, passwordHash, userRole, avatarColor);
        const tokens = {
            accessToken: jwt_service_1.jwtService.signAccessToken({ userId, email, role: userRole }),
            refreshToken: jwt_service_1.jwtService.signRefreshToken({ userId, email, role: userRole }),
        };
        res.cookie('accessToken', tokens.accessToken, cookieOptions);
        res.cookie('refreshToken', tokens.refreshToken, cookieOptions);
        res.status(201).json({
            user: { id: userId, name, email, role: userRole, avatar_color: avatarColor },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        });
    }
    catch (error) {
        logger_1.logger.error('Signup error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/login', authLimiter, async (req, res) => {
    try {
        const parsedBody = loginSchema.safeParse(req.body);
        if (!parsedBody.success) {
            res.status(400).json({ error: parsedBody.error.issues[0].message });
            return;
        }
        const { email, password } = parsedBody.data;
        const user = await db_1.userQueries.findByEmail(email);
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
        res.cookie('accessToken', tokens.accessToken, cookieOptions);
        res.cookie('refreshToken', tokens.refreshToken, cookieOptions);
        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                avatar_color: user.avatar_color,
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        });
    }
    catch (error) {
        logger_1.logger.error('Login error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/me', auth_middleware_1.authMiddleware, async (req, res) => {
    try {
        const user = await db_1.userQueries.findById(req.user.userId);
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
        logger_1.logger.error('Get me error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});
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
        res.cookie('accessToken', newAccessToken, cookieOptions);
        res.json({ success: true, accessToken: newAccessToken });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});
router.post('/logout', (req, res) => {
    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
    res.json({ success: true });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map