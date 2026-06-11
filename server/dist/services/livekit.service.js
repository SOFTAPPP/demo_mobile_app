"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.livekitService = void 0;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const livekit_server_sdk_2 = require("livekit-server-sdk");
const uuid_1 = require("uuid");
const config_1 = require("../config");
const logger_1 = require("../lib/logger");
let roomServiceClient = null;
let egressClient = null;
function getRoomServiceClient() {
    if (!roomServiceClient) {
        const httpUrl = config_1.config.livekit.url.replace('wss://', 'https://').replace('ws://', 'http://');
        roomServiceClient = new livekit_server_sdk_2.RoomServiceClient(httpUrl, config_1.config.livekit.apiKey, config_1.config.livekit.apiSecret);
    }
    return roomServiceClient;
}
function getEgressClient() {
    if (!egressClient) {
        const httpUrl = config_1.config.livekit.url.replace('wss://', 'https://').replace('ws://', 'http://');
        egressClient = new livekit_server_sdk_1.EgressClient(httpUrl, config_1.config.livekit.apiKey, config_1.config.livekit.apiSecret);
    }
    return egressClient;
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
    },
    async startRecording(roomName, publicUrl) {
        if (!this.isConfigured()) {
            throw new Error('LiveKit is not configured');
        }
        if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT || !process.env.S3_BUCKET) {
            throw new Error('Cloudflare R2 credentials are not fully configured in .env');
        }
        const client = getEgressClient();
        const timestamp = Date.now();
        const fileName = `recordings/${roomName}-${timestamp}.mp4`;
        const s3Upload = new livekit_server_sdk_1.S3Upload({
            accessKey: process.env.S3_ACCESS_KEY,
            secret: process.env.S3_SECRET_KEY,
            endpoint: process.env.S3_ENDPOINT,
            bucket: process.env.S3_BUCKET,
        });
        const fileOutput = new livekit_server_sdk_1.EncodedFileOutput({
            filepath: fileName,
            fileType: livekit_server_sdk_1.EncodedFileType.MP4,
            output: { case: 's3', value: s3Upload },
        });
        const botLiveKitToken = await this.generateToken(roomName, "Class Recorder", "bot-recorder", false);
        const lkUrl = this.getServerUrl();
        const egressUrl = `${publicUrl}/meeting/${roomName}?botToken=${botLiveKitToken}&lkUrl=${encodeURIComponent(lkUrl)}`;
        logger_1.logger.info(`Starting WebEgress for room: ${roomName}`);
        const info = await client.startWebEgress(egressUrl, {
            file: fileOutput,
        });
        const publicS3Url = process.env.S3_PUBLIC_URL || '';
        const fileUrl = publicS3Url ? `${publicS3Url}/${fileName}` : fileName;
        return { egressId: info.egressId, fileUrl };
    },
    async stopRecording(egressId) {
        if (!this.isConfigured())
            return;
        const client = getEgressClient();
        await client.stopEgress(egressId);
    },
    async getEgressStatus(egressId) {
        if (!this.isConfigured())
            return 'completed';
        const client = getEgressClient();
        try {
            const egresses = await client.listEgress({ egressId });
            if (egresses && egresses.length > 0) {
                return egresses[0].status.toString();
            }
            return 'completed';
        }
        catch {
            return 'completed';
        }
    }
};
//# sourceMappingURL=livekit.service.js.map