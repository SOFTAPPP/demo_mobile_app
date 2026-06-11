"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.requireRole = exports.authMiddleware = void 0;
const jwt_service_1 = require("../services/jwt.service");
const authMiddleware = (req, res, next) => {
    let token = req.cookies?.accessToken;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
        res.status(401).json({ error: 'No token provided', code: 'INVALID_TOKEN' });
        return;
    }
    try {
        const decoded = jwt_service_1.jwtService.verifyAccessToken(token);
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
        return;
    }
};
exports.authMiddleware = authMiddleware;
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        res.status(403).json({ error: 'Insufficient permissions', code: 'NOT_HOST' });
        return;
    }
    next();
};
exports.requireRole = requireRole;
const optionalAuth = (req, res, next) => {
    const token = req.cookies?.accessToken || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
    if (token) {
        try {
            req.user = jwt_service_1.jwtService.verifyAccessToken(token);
        }
        catch { }
    }
    next();
};
exports.optionalAuth = optionalAuth;
//# sourceMappingURL=auth.middleware.js.map