import { Room, RoomOptions, VideoPresets } from 'livekit-client';

export const roomOptions: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: {
    // 720p provides a great balance of HD quality while ensuring 60fps runs smoothly
    resolution: VideoPresets.h720.resolution, 
  },
  audioCaptureDefaults: {
    // DEFAULT: Standard voice optimization (Noise suppression on). 
    // User can toggle Music Mode in-room to disable these for zero latency.
    echoCancellation: true, 
    noiseSuppression: true, 
    autoGainControl: true,  
  },
  publishDefaults: {
    simulcast: true,
    red: true, // Redundant Audio Data - sends duplicate audio packets to guarantee 0 loss on poor networks
    dtx: false, // Discontinuous Transmission OFF: Ensures quiet musical notes/reverb aren't accidentally clipped
    videoEncoding: {
      maxBitrate: 2_000_000, // 2 Mbps is the sweet spot for 720p 60fps WebRTC
      maxFramerate: 60,
    },
    audioPreset: {
      maxBitrate: 256_000, // Extreme high-fidelity stereo (Studio Quality)
    },
  },
};

let sharedRoom: Room | null = null;

/**
 * Pre-warms the WebRTC connection in the background.
 * This does DNS resolution, TLS handshake, and ICE candidate gathering
 * before the UI even renders, completely eliminating connection loading screens!
 */
export const prepareLiveKitRoom = (url: string, token: string): Room => {
  if (sharedRoom) {
    sharedRoom.disconnect();
  }
  sharedRoom = new Room(roomOptions);
  // Fire off the FULL background connection negotiation
  sharedRoom.connect(url, token).catch(e => console.warn('Pre-warm connect failed', e));
  return sharedRoom;
};

export const getSharedRoom = (): Room | null => {
  return sharedRoom;
};

export const clearSharedRoom = () => {
  sharedRoom = null;
};
