import { Room, RoomOptions, VideoPresets } from 'livekit-client';

export const roomOptions: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  publishDefaults: {
    simulcast: true,
    red: true,
    dtx: false,
    videoEncoding: {
      maxBitrate: 2_000_000,
      maxFramerate: 60,
    },
    audioPreset: {
      maxBitrate: 256_000,
    },
  },
};

let sharedRoom: Room | null = null;

export const prepareLiveKitRoom = (url: string, token: string): Room => {
  if (sharedRoom) {
    try { sharedRoom.disconnect(); } catch {}
  }
  sharedRoom = new Room(roomOptions);
  sharedRoom.connect(url, token).catch(() => {
    sharedRoom = null;
  });
  return sharedRoom;
};

export const getSharedRoom = (): Room | null => {
  return sharedRoom;
};

export const clearSharedRoom = () => {
  if (sharedRoom) {
    try { sharedRoom.disconnect(); } catch {}
    sharedRoom = null;
  }
};
