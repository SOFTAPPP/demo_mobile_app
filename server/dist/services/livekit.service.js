"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.livekitService = void 0;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const uuid_1 = require("uuid");
const config_1 = require("../config");
exports.livekitService = {
    /**
     * Generate a LiveKit access token for a participant to join a room.
     * This token is what the client uses to connect to the LiveKit SFU.
     */
    async generateToken(roomName, participantName, participantId, isTeacher = false) {
        if (!this.isConfigured()) {
            // Demo mode — return a placeholder token
            // In production, LiveKit credentials are required
            console.warn('⚠️  LiveKit credentials not configured. Running in demo mode.');
            return 'demo-token-' + participantId;
        }
        // Append a unique UUID to prevent identity collisions if a user joins from multiple tabs
        const uniqueIdentity = `${participantId}-${(0, uuid_1.v4)().substring(0, 8)}`;
        const token = new livekit_server_sdk_1.AccessToken(config_1.config.livekit.apiKey, config_1.config.livekit.apiSecret, {
            identity: uniqueIdentity,
            name: participantName,
            // Token expires in 6 hours (one class session)
            ttl: '6h',
            metadata: JSON.stringify({
                role: isTeacher ? 'teacher' : 'student',
                name: participantName,
            }),
        });
        // Grant room-level permissions
        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: isTeacher, // Only teacher can broadcast data messages
        });
        return await token.toJwt();
    },
    /**
     * Get the LiveKit WebSocket URL for the client to connect to
     */
    getServerUrl() {
        return config_1.config.livekit.url;
    },
    /**
     * Check if LiveKit is configured with valid non-placeholder credentials
     */
    isConfigured() {
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        return !!(apiKey && apiKey !== 'your_api_key_here' &&
            apiSecret && apiSecret !== 'your_api_secret_here' &&
            url && url !== 'wss://your-project.livekit.cloud');
    },
};
//# sourceMappingURL=livekit.service.js.map