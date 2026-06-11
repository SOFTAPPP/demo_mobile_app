import { AccessToken, EgressClient, EncodedFileOutput, S3Upload, EncodedFileType } from 'livekit-server-sdk';
import { RoomServiceClient } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../lib/logger';

let roomServiceClient: RoomServiceClient | null = null;
let egressClient: EgressClient | null = null;

function getRoomServiceClient(): RoomServiceClient {
  if (!roomServiceClient) {
    const httpUrl = config.livekit.url.replace('wss://', 'https://').replace('ws://', 'http://');
    roomServiceClient = new RoomServiceClient(httpUrl, config.livekit.apiKey, config.livekit.apiSecret);
  }
  return roomServiceClient;
}

function getEgressClient(): EgressClient {
  if (!egressClient) {
    const httpUrl = config.livekit.url.replace('wss://', 'https://').replace('ws://', 'http://');
    egressClient = new EgressClient(httpUrl, config.livekit.apiKey, config.livekit.apiSecret);
  }
  return egressClient;
}

export const livekitService = {
  async generateToken(
    roomName: string,
    participantName: string,
    participantId: string,
    isTeacher: boolean = false
  ): Promise<string> {
    if (!this.isConfigured()) {
      return 'demo-token-' + participantId;
    }

    const uniqueIdentity = `${participantId}-${uuidv4().substring(0, 8)}`;

    const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
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

  getServerUrl(): string {
    return config.livekit.url;
  },

  isConfigured(): boolean {
    const { apiKey, apiSecret, url } = config.livekit;
    return !!(
      apiKey && apiKey !== 'your_api_key_here' &&
      apiSecret && apiSecret !== 'your_api_secret_here' &&
      url && url !== 'wss://your-project.livekit.cloud'
    );
  },

  async endRoom(roomName: string): Promise<void> {
    if (!this.isConfigured()) return;

    try {
      const client = getRoomServiceClient();
      await client.deleteRoom(roomName);
      logger.info(`Cleaned up LiveKit room: ${roomName}`);
    } catch (error) {
      logger.error(`Failed to delete LiveKit room ${roomName}`, { error });
    }
  },

  async startRecording(roomName: string, publicUrl: string): Promise<{ egressId: string, fileUrl: string }> {
    if (!this.isConfigured()) {
      throw new Error('LiveKit is not configured');
    }

    if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT || !process.env.S3_BUCKET) {
      throw new Error('Cloudflare R2 credentials are not fully configured in .env');
    }

    const client = getEgressClient();
    const timestamp = Date.now();
    const fileName = `recordings/${roomName}-${timestamp}.mp4`;

    const s3Upload = new S3Upload({
      accessKey: process.env.S3_ACCESS_KEY,
      secret: process.env.S3_SECRET_KEY,
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
    });

    const fileOutput = new EncodedFileOutput({
      filepath: fileName,
      fileType: EncodedFileType.MP4,
      output: { case: 's3', value: s3Upload },
    });

    const botLiveKitToken = await this.generateToken(roomName, "Class Recorder", "bot-recorder", false);
    const lkUrl = this.getServerUrl();

    const egressUrl = `${publicUrl}/meeting/${roomName}?botToken=${botLiveKitToken}&lkUrl=${encodeURIComponent(lkUrl)}`;
    logger.info(`Starting WebEgress for room: ${roomName}`);

    const info = await client.startWebEgress(egressUrl, {
      file: fileOutput,
    });

    const publicS3Url = process.env.S3_PUBLIC_URL || '';
    const fileUrl = publicS3Url ? `${publicS3Url}/${fileName}` : fileName;

    return { egressId: info.egressId as string, fileUrl };
  },

  async stopRecording(egressId: string): Promise<void> {
    if (!this.isConfigured()) return;
    const client = getEgressClient();
    await client.stopEgress(egressId);
  },

  async getEgressStatus(egressId: string): Promise<string> {
    if (!this.isConfigured()) return 'completed';

    const client = getEgressClient();

    try {
      const egresses = await client.listEgress({ egressId });
      if (egresses && egresses.length > 0) {
        return egresses[0].status.toString();
      }
      return 'completed';
    } catch {
      return 'completed';
    }
  }
};
