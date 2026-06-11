import { AccessToken } from 'livekit-server-sdk';
import { RoomServiceClient } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../lib/logger';

let roomServiceClient: RoomServiceClient | null = null;

function getRoomServiceClient(): RoomServiceClient {
  if (!roomServiceClient) {
    const httpUrl = config.livekit.url.replace('wss://', 'https://').replace('ws://', 'http://');
    roomServiceClient = new RoomServiceClient(httpUrl, config.livekit.apiKey, config.livekit.apiSecret);
  }
  return roomServiceClient;
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
  }
};
