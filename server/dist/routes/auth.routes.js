"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const db_1 = require("../models/db");
const jwt_service_1 = require("../services/jwt.service");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Random avatar colors matching the Sangeet Arghya theme
const AVATAR_COLORS = [
    '#7B2D26', '#8B4513', '#D4722A', '#B8860B', '#2D5F2D',
    '#4A1A2E', '#6B3A5E', '#1B5E20', '#C4932A', '#A0522D',
];
/**
 * POST /api/auth/signup
 */
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            res.status(400).json({ error: 'Name, email, and password are required' });
            return;
        }
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
        res.status(201).json({
            user: { id: userId, name, email, role: userRole, avatar_color: avatarColor },
            ...tokens,
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
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: 'Email and password are required' });
            return;
        }
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
        const { refreshToken } = req.body;
        if (!refreshToken) {
            res.status(400).json({ error: 'Refresh token required' });
            return;
        }
        const decoded = jwt_service_1.jwtService.verifyRefreshToken(refreshToken);
        const newAccessToken = jwt_service_1.jwtService.signAccessToken({
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
        });
        res.json({ accessToken: newAccessToken });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map