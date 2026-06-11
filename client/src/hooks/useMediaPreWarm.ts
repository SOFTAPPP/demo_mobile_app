let cachedStream: MediaStream | null = null;
let preWarmPromise: Promise<MediaStream | null> | null = null;

export function preWarmAudio(): Promise<MediaStream | null> {
  if (cachedStream && cachedStream.active && cachedStream.getAudioTracks().length > 0) {
    return Promise.resolve(cachedStream);
  }

  if (preWarmPromise) return preWarmPromise;

  preWarmPromise = navigator.mediaDevices
    .getUserMedia({
      audio: {
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    .then((stream) => {
      cachedStream = stream;
      return stream;
    })
    .catch(() => {
      preWarmPromise = null;
      return null;
    });

  return preWarmPromise;
}

export function getPreWarmedStream(): MediaStream | null {
  return cachedStream;
}

export function releasePreWarmedStream(): void {
  if (cachedStream) {
    cachedStream.getTracks().forEach((t) => t.stop());
    cachedStream = null;
  }
  preWarmPromise = null;
}
