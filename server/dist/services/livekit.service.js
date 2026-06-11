"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
    isConfigured() {
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        return !!(apiKey && apiKey !== 'your_api_key_here' &&
            apiSecret && apiSecret !== 'your_api_secret_here' &&
            url && url !== 'wss://your-project.livekit.cloud');
    },
    /**
     * Forcefully ends a LiveKit room, kicking out all participants
     */
    async endRoom(roomName) {
        if (!this.isConfigured())
            return;
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        // RoomServiceClient requires http/https URL, not ws/wss
        const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
        try {
            const { RoomServiceClient } = await Promise.resolve().then(() => __importStar(require('livekit-server-sdk')));
            const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
            await roomService.deleteRoom(roomName);
            console.log(`🧹 Cleaned up LiveKit room: ${roomName}`);
        }
        catch (error) {
            console.error(`Failed to delete LiveKit room ${roomName}:`, error);
        }
    },
    /**
     * Start recording a room via WebEgress
     */
    async startRecording(roomName, publicUrl) {
        if (!this.isConfigured()) {
            throw new Error('LiveKit is not configured');
        }
        if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT || !process.env.S3_BUCKET) {
            throw new Error('Cloudflare R2 credentials are not fully configured in .env');
        }
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
        const egressClient = new livekit_server_sdk_1.EgressClient(httpUrl, apiKey, apiSecret);
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
        // Generate a secure LiveKit token specifically for the bot to join the room
        const botLiveKitToken = await this.generateToken(roomName, "Class Recorder", "bot-recorder", false);
        // The LiveKit server URL that the frontend needs to connect to
        const lkUrl = this.getServerUrl();
        // Construct the WebEgress URL with the secure bot token
        const egressUrl = `${publicUrl}/meeting/${roomName}?botToken=${botLiveKitToken}&lkUrl=${encodeURIComponent(lkUrl)}`;
        // Start WebEgress instead of RoomCompositeEgress
        const info = await egressClient.startWebEgress(egressUrl, {
            file: fileOutput,
        });
        const publicS3Url = process.env.S3_PUBLIC_URL || '';
        const fileUrl = publicS3Url ? `${publicS3Url}/${fileName}` : fileName;
        return { egressId: info.egressId, fileUrl };
    },
    /**
     * Stop a recording
     */
    async stopRecording(egressId) {
        if (!this.isConfigured())
            return;
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
        const egressClient = new livekit_server_sdk_1.EgressClient(httpUrl, apiKey, apiSecret);
        await egressClient.stopEgress(egressId);
    },
    /**
     * Get the current status of an egress
     */
    async getEgressStatus(egressId) {
        if (!this.isConfigured())
            return 'completed';
        const { apiKey, apiSecret, url } = config_1.config.livekit;
        const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
        const egressClient = new livekit_server_sdk_1.EgressClient(httpUrl, apiKey, apiSecret);
        try {
            // We pass the egressId in a list EgressListRequest object
            const egresses = await egressClient.listEgress({ egressId });
            if (egresses && egresses.length > 0) {
                // Status 3 is EGRESS_COMPLETE, 4 is EGRESS_FAILED, 5 is EGRESS_ABORTED
                // We will just convert it to string for checking
                return egresses[0].status.toString();
            }
            return 'completed'; // If it doesn't exist, assume completed/failed and don't block UI
        }
        catch (e) {
            console.error('Failed to get egress status:', e);
            return 'completed';
        }
    }
};
//# sourceMappingURL=livekit.service.js.map