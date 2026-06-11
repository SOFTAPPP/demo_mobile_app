"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.livekitService = void 0;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const livekit_server_sdk_2 = require("livekit-server-sdk");
const uuid_1 = require("uuid");
const config_1 = require("../config");
const logger_1 = require("../lib/logger");
let roomServiceClient = null;
function getRoomServiceClient() {
    if (!roomServiceClient) {
        const httpUrl = config_1.config.livekit.url.replace('wss://', 'https://').replace('ws://', 'http://');
        roomServiceClient = new livekit_server_sdk_2.RoomServiceClient(httpUrl, config_1.config.livekit.apiKey, config_1.config.livekit.apiSecret);
    }
    return roomServiceClient;
}
exports.livekitService = {
    async generateToken(roomName, participantName, participantId, isTeacher = false) {
        if (!this.isConfigured()) {
            return 'demo-token-' + participantId;
        }
        const uniqueIdentity = `${participantId}-${(0, uuid_1.v4)().substring(0, 8)}`;
        const token = new livekit_server_sdk_1.AccessToken(config_1.config.livekit.apiKey, config_1.config.livekit.apiSecret, {
            identity: uniqueIdentity,
            name: participantName,
            ttl: '6h',
            metadata: JSON.stringify({
                role: isTeacher ? 'teacher' : 'student',
                name: participantName,
            }),
        });
        token.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: isTeacher,
        });
        return await token.toJwt();
    },
    getServerUrl() {
        return config_1.config.livekit.url;
    },
    isConfigured() {
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        return !!(apiKey && apiKey !== 'your_api_key_here' &&
            apiSecret && apiSecret !== 'your_api_secret_here' &&
            url && url !== 'wss://your-project.livekit.cloud');
    },
    async endRoom(roomName) {
        if (!this.isConfigured())
            return;
        try {
            const client = getRoomServiceClient();
            await client.deleteRoom(roomName);
            logger_1.logger.info(`Cleaned up LiveKit room: ${roomName}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to delete LiveKit room ${roomName}`, { error });
        }
    }
};
//# sourceMappingURL=livekit.service.js.map