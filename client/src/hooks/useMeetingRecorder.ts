import { useState, useCallback, useRef } from 'react';
import api from '../services/api';

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'saving' | 'saved' | 'failed';

export function useMeetingRecorder(roomCode: string, isHost: boolean) {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const recordingIdRef = useRef<string | null>(null);

  const startRecording = useCallback(async () => {
    if (!isHost) return;
    try {
      setStatus('starting');
      setError(null);
      
      const { data } = await api.post('/recordings/start', { roomCode });
      recordingIdRef.current = data.recordingId;
      
      setStatus('recording');
    } catch (err: any) {
      console.error('Start recording failed', err);
      setError(err.response?.data?.error || err.message || 'Failed to start recording');
      setStatus('failed');
      // Reset to idle after showing error briefly
      setTimeout(() => setStatus('idle'), 2000);
    }
  }, [isHost, roomCode]);

  const stopRecording = useCallback(async () => {
    if (status !== 'recording' && status !== 'starting') return;
    setStatus('saving');
    
    try {
      // Send both recordingId AND roomCode so the server can find the recording either way
      await api.post('/recordings/stop', { 
        recordingId: recordingIdRef.current,
        roomCode 
      });
      
      recordingIdRef.current = null;
      setStatus('idle');
    } catch (err: any) {
      console.error('Stop recording failed', err);
      setError(err.response?.data?.error || err.message || 'Failed to stop recording');
      // Even if stop API fails, reset to idle so the button isn't stuck
      setStatus('idle');
    }
  }, [status, roomCode]);

  return {
    status,
    error,
    startRecording,
    stopRecording,
    setStatus
  };
}
