"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jwtService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
exports.jwtService = {
    signAccessToken(payload) {
        return jsonwebtoken_1.default.sign(payload, config_1.config.jwtSecret, {
            expiresIn: config_1.config.jwtExpiresIn,
        });
    },
    signRefreshToken(payload) {
        return jsonwebtoken_1.default.sign(payload, config_1.config.jwtRefreshSecret, {
            expiresIn: config_1.config.jwtRefreshExpiresIn,
        });
    },
    verifyAccessToken(token) {
        return jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
    },
    verifyRefreshToken(token) {
        return jsonwebtoken_1.default.verify(token, config_1.config.jwtRefreshSecret);
    },
};
//# sourceMappingURL=jwt.service.js.map