import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { LocalAudioTrack, RoomEvent, Track } from 'livekit-client';
import { Disc, LogOut, Mic, MicOff, Palette, PhoneOff, Square, Users, Video as VideoIcon, VideoOff } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { clearSharedRoom, getSharedRoom, roomOptions } from '../services/livekitPrewarm';
import '../styles/meeting.css';

// Audio helper for nice chimes
const playNotificationSound = (type: 'start' | 'stop') => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'start') {
      // Happy rising chime
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.3);
    } else {
      // Gentle falling chime
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15); // A4
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.3);
    }
  } catch (e) {
    console.log("Audio not supported or blocked", e);
  }
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#2D1B22', color: '#FF8888', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2>🚨 React Application Crashed</h2>
          <pre style={{ background: '#1A0D12', padding: '15px', borderRadius: '8px', overflow: 'auto' }}>
            {this.state.error?.stack || String(this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 20px', background: '#FF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function Meeting() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isLeavingManually = useRef(false);
  const hasConnected = useRef(false);

  const [livekitToken, setLivekitToken] = useState<string>(location.state?.livekit?.token || '');
  const [livekitUrl, setLivekitUrl] = useState<string>(location.state?.livekit?.url || '');
  const [meetingTitle, setMeetingTitle] = useState(location.state?.meeting?.title || 'Music Class');
  const [isConnecting, setIsConnecting] = useState(!location.state?.livekit);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'maroon'>('light');
  const [isHost, setIsHost] = useState(!!location.state?.isHost);
  const [isRecording, setIsRecording] = useState(false);
  const [egressId, setEgressId] = useState<string | null>(null);
  const [recordingToast, setRecordingToast] = useState<{ show: boolean, type: 'start' | 'stop' | null }>({ show: false, type: null });
  const prewarmedRoom = useRef(getSharedRoom());

  // Socket.io for instant teardown
  useEffect(() => {
    if (!roomCode) return;

    // Connect to the backend root (which proxies via Vite or connects directly)
    const socketUrl = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : '/';
    const socket = socketIO(socketUrl);

    socket.emit('join-room', roomCode);

    socket.on('meeting-ended', () => {
      console.log(`[⏱️ Profiling] Socket.io INSTANT Teardown Received`);
      socket.disconnect();
      clearSharedRoom();
      navigate('/meeting-ended', { state: { roomCode } });
    });

    socket.on('recording-started', () => {
      setIsRecording(true);
      setRecordingToast({ show: true, type: 'start' });
      playNotificationSound('start');
    });

    socket.on('recording-stopped', () => {
      setIsRecording(false);
      setRecordingToast({ show: true, type: 'stop' });
      playNotificationSound('stop');
      setEgressId(null);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomCode, navigate]);

  useEffect(() => {
    if (!location.state?.livekit && roomCode) {
      fetchMeetingToken(roomCode);
    }
  }, [roomCode, location.state]);

  const fetchMeetingToken = async (code: string) => {
    try {
      const { data } = await api.post('/meetings/join', {
        roomCode: code,
        displayName: user?.name,
      });
      setLivekitToken(data.livekit.token);
      setLivekitUrl(data.livekit.url);
      setMeetingTitle(data.meeting?.title || 'Music Class');
      setIsHost(!!data.isHost);
      setIsConnecting(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to join meeting');
      setIsConnecting(false);
    }
  };

  if (isConnecting) {
    return (
      <div className="meeting-page">
        <div className="pre-join">
          <div className="pre-join__card" style={{ textAlign: 'center' }}>
            <span className="loader" style={{ marginBottom: '16px', display: 'inline-block' }} />
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>Connecting to Sangeet Arghya servers...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="meeting-page">
        <div className="pre-join">
          <div className="pre-join__card" style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '3rem', marginBottom: '16px' }}>😔</p>
            <h2 className="pre-join__title" style={{ marginBottom: '8px' }}>Unable to Join</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '24px' }}>{error}</p>
            <button className="pre-join__join-btn" onClick={() => navigate('/dashboard')}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className={`meeting-page ${theme === 'maroon' ? 'theme-maroon' : ''}`}>
        <LiveKitRoom
          room={prewarmedRoom.current || undefined}
          serverUrl={livekitUrl}
          token={livekitToken}
          options={prewarmedRoom.current ? undefined : roomOptions}
          video={false}
          audio={false}
          onConnected={() => {
            hasConnected.current = true;
          }}
          onDisconnected={() => {
            console.log('Disconnected from room');
            // We removed the fallback to /meeting-ended here because it was aggressively kicking
            // users out during minor network blips or browser hot-reloads.
            // Teardown navigation is now handled 100% reliably by Socket.io.
          }}
          onError={(err) => {
            console.error('LiveKit Error:', err);
            // Only show hard errors, ignore minor warnings or temporary disconnects
            if (err.message && !err.message.includes('permission') && !err.message.includes('reconnect')) {
              setConnectionError(err.message);
            }
          }}
          style={{ height: '100dvh', width: '100vw' }}
        >
          <BrandedMeetingUI
            roomCode={roomCode || ''}
            meetingTitle={meetingTitle}
            isHost={isHost}
            onLeave={async () => {
              isLeavingManually.current = true;
              clearSharedRoom();
              navigate('/dashboard');
            }}
            onEnd={async () => {
              if (isHost) {
                try {
                  await api.post('/meetings/end', { roomCode });
                  clearSharedRoom();
                  // Navigate host to the meeting-ended page directly
                  navigate('/meeting-ended', { state: { roomCode } });
                } catch (e) {
                  console.error('Failed to end meeting', e);
                }
              }
            }}
            connectionError={connectionError}
            clearConnectionError={() => setConnectionError('')}
            theme={theme}
            onToggleTheme={() => setTheme(t => t === 'light' ? 'maroon' : 'light')}
            joinStartTime={location.state?.joinStartTime}
            isRecording={isRecording}
            egressId={egressId}
            onOptimisticStart={(newEgressId) => {
              setEgressId(newEgressId);
              setIsRecording(true);
              playNotificationSound('start');
              setRecordingToast({ show: true, type: 'start' });
              setTimeout(() => setRecordingToast({ show: false, type: null }), 3500);
            }}
            onOptimisticStop={() => {
              setEgressId(null);
              setIsRecording(false);
              playNotificationSound('stop');
              setRecordingToast({ show: true, type: 'stop' });
              setTimeout(() => setRecordingToast({ show: false, type: null }), 3500);
            }}
          />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>

      {/* Recording Toast Overlay */}
      <style>{`
        @keyframes slideDown {
          from { top: -100px; opacity: 0; }
          to { top: 20px; opacity: 1; }
        }
      `}</style>
      {recordingToast.show && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: recordingToast.type === 'start'
            ? 'linear-gradient(135deg, rgba(220, 38, 38, 0.95) 0%, rgba(185, 28, 28, 0.95) 100%)'
            : 'linear-gradient(135deg, rgba(37, 99, 235, 0.95) 0%, rgba(29, 78, 216, 0.95) 100%)',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          zIndex: 9999,
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.2)',
          animation: 'slideDown 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}>
          <div style={{ fontSize: '1.8rem', animation: recordingToast.type === 'start' ? 'pulse 1.5s infinite' : 'none', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>
            {recordingToast.type === 'start' ? '🔴' : '✅'}
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', letterSpacing: '0.5px' }}>
              Recording {recordingToast.type === 'start' ? 'Started' : 'Saved'}
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)' }}>
              {recordingToast.type === 'start'
                ? 'This session is now being recorded.'
                : 'The recording is now available on your dashboard.'}
            </p>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}

// Custom UI that consumes LiveKit context
function BrandedMeetingUI({
  roomCode,
  meetingTitle,
  isHost,
  onLeave,
  onEnd,
  connectionError,
  clearConnectionError,
  theme,
  onToggleTheme,
  joinStartTime,
  isRecording,
  egressId,
  onOptimisticStart,
  onOptimisticStop
}: {
  roomCode: string;
  meetingTitle: string;
  isHost: boolean;
  onLeave: () => void;
  onEnd?: () => void;
  connectionError?: string;
  clearConnectionError: () => void;
  theme: 'light' | 'maroon';
  onToggleTheme: () => void;
  joinStartTime?: number;
  isRecording?: boolean;
  egressId: string | null;
  onOptimisticStart?: (egressId: string) => void;
  onOptimisticStop?: () => void;
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [elapsed, setElapsed] = useState(0);
  const [showParticipants, setShowParticipants] = useState(false);
  const [musicMode, setMusicMode] = useState(false); // Default to standard mode
  const [isRecordLoading, setIsRecordLoading] = useState(false);

  // Synthesize a nice chime without needing any audio files
  const playTone = useCallback((type: 'join' | 'leave') => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { });
      }

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      if (type === 'join') {
        // Happy rising tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      } else {
        // Soft falling tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
        osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.1); // C5
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      }

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.log('Audio playback skipped', e);
    }
  }, []);

  // Listen for participant enter/leave to play the sound
  useEffect(() => {
    if (!room) return;

    const onParticipantConnected = (participant: any) => {
      if (participant?.identity?.startsWith('EG_') || participant?.identity?.toLowerCase().includes('egress') || participant?.isHidden) return;
      playTone('join');
    };
    const onParticipantDisconnected = (participant: any) => {
      if (participant?.identity?.startsWith('EG_') || participant?.identity?.toLowerCase().includes('egress') || participant?.isHidden) return;
      playTone('leave');
    };

    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room, playTone]);

  // Confirmation Modal State
  const [confirmAction, setConfirmAction] = useState<'leave' | 'end' | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const [optimisticMic, setOptimisticMic] = useState<boolean | null>(null);
  const [optimisticCam, setOptimisticCam] = useState<boolean | null>(null);

  useEffect(() => {
    if (optimisticMic === isMicrophoneEnabled) setOptimisticMic(null);
  }, [isMicrophoneEnabled, optimisticMic]);

  useEffect(() => {
    if (optimisticCam === isCameraEnabled) setOptimisticCam(null);
  }, [isCameraEnabled, optimisticCam]);

  const displayMic = optimisticMic !== null ? optimisticMic : isMicrophoneEnabled;
  const displayCam = optimisticCam !== null ? optimisticCam : isCameraEnabled;

  // Profiling Logs
  useEffect(() => {
    if (joinStartTime) {
      console.log(`[⏱️ Profiling] 3. Meeting Room UI Rendered in ${(performance.now() - joinStartTime).toFixed(0)}ms`);
    }
  }, [joinStartTime]);

  // Auto-clear connection error when connection is restored
  useEffect(() => {
    if ((connectionState === 'connected' || connectionState === 'reconnecting') && connectionError) {
      clearConnectionError();
    }

    if (connectionState === 'connected' && joinStartTime) {
      console.log(`[⏱️ Profiling] 4. LiveKit Connection Excellent (Connected) in ${(performance.now() - joinStartTime).toFixed(0)}ms`);
    }
  }, [connectionState, connectionError, clearConnectionError, joinStartTime]);

  // Get all camera tracks from all participants
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const [recElapsed, setRecElapsed] = useState(0);

  // Timers
  useEffect(() => {
    const elapsedTimer = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(elapsedTimer);
  }, []);

  useEffect(() => {
    let timer: any;
    if (isRecording) {
      timer = setInterval(() => setRecElapsed((p) => p + 1), 1000);
    } else {
      setRecElapsed(0);
    }
    return () => clearInterval(timer);
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const toggleMic = async () => {
    const nextState = !displayMic;
    setOptimisticMic(nextState);
    try {
      await localParticipant.setMicrophoneEnabled(nextState);
    } catch (e) {
      console.error('Mic toggle failed', e);
      setOptimisticMic(null);
    }
  };

  const toggleCam = async () => {
    const nextState = !displayCam;
    setOptimisticCam(nextState);
    try {
      await localParticipant.setCameraEnabled(nextState);
    } catch (e) {
      console.error('Cam toggle failed', e);
      setOptimisticCam(null);
    }
  };

  const toggleMusicMode = async () => {
    const nextMode = !musicMode;
    setMusicMode(nextMode);
    // Re-publish audio with music mode settings (filters disabled for zero latency)
    if (displayMic) {
      await localParticipant.setMicrophoneEnabled(false);
      await localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: !nextMode,
        noiseSuppression: !nextMode,
        autoGainControl: !nextMode,
      });
    }
  };

  // Determine grid layout based on number of tracks
  const gridClass = tracks.length <= 1 ? 'video-grid--1' :
    tracks.length <= 2 ? 'video-grid--2' :
      tracks.length <= 4 ? 'video-grid--4' : 'video-grid--many';

  const handleRecordToggle = async () => {
    if (!isHost) return;
    try {
      setIsRecordLoading(true);
      if (isRecording && egressId) {
        if (onOptimisticStop) onOptimisticStop();
        
        // Broadcast
        const socketUrl = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : '/';
        const tempSocket = socketIO(socketUrl);
        tempSocket.emit('recording-stopped', roomCode);
        tempSocket.disconnect();

        await api.post('/meetings/record/stop', { egressId, roomCode });
      } else {
        let totalTracks = 0;
        room.remoteParticipants.forEach((p) => { totalTracks += p.trackPublications.size; });
        totalTracks += room.localParticipant.trackPublications.size;

        if (totalTracks === 0) {
          try {
            // Generate a 100% silent audio track using Web Audio API (does NOT prompt user for permissions!)
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0; // 0 volume = complete silence
            const dst = ctx.createMediaStreamDestination();
            oscillator.connect(gainNode);
            gainNode.connect(dst);
            oscillator.start();

            const track = dst.stream.getAudioTracks()[0];
            const dummyTrack = new LocalAudioTrack(track);
            // Publish as Unknown source so the UI doesn't show a Microphone icon!
            await room.localParticipant.publishTrack(dummyTrack, { name: 'silence', source: Track.Source.Unknown });

            // The Egress server will detect the track and start recording instantly.
            // We can safely unpublish it after 10 seconds because the Egress will have fully booted up.
            setTimeout(() => {
              room.localParticipant.unpublishTrack(dummyTrack).catch(console.error);
            }, 10000);
          } catch (e) {
            console.log('Failed to create dummy track', e);
          }
        }

        // Optimistic UI for start
        if (onOptimisticStart) onOptimisticStart('temp_id_loading');

        // Broadcast
        const socketUrl = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : '/';
        const tempSocket = socketIO(socketUrl);
        tempSocket.emit('recording-started', roomCode);
        tempSocket.disconnect();

        const { data } = await api.post('/meetings/record/start', { roomCode });
        // Update with real ID once we have it
        if (onOptimisticStart) onOptimisticStart(data.egressId);
      }
    } catch (e: any) {
      console.error('Failed to toggle recording', e);
      setAlertMessage(e.response?.data?.error || 'Failed to toggle recording.');

      // Revert optimistic UI on failure
      if (isRecording) {
        if (onOptimisticStart && egressId) onOptimisticStart(egressId);
      } else {
        if (onOptimisticStop) onOptimisticStop();
      }
    } finally {
      setIsRecordLoading(false);
    }
  };

  return (
    <div className="meeting-room" style={{ height: '100dvh', width: '100%' }}>
      {/* Connection Error Banner */}
      {connectionError && (
        <div style={{
          background: '#C53030',
          color: 'white',
          padding: '8px 16px',
          textAlign: 'center',
          fontSize: '0.85rem',
          fontWeight: 600,
          zIndex: 100,
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>⚠️ Connection Error: {connectionError}</span>
        </div>
      )}

      {/* Header */}
      <div className="meeting-room__header">
        <div className="meeting-room__header-left">
          <span className="meeting-room__title">{meetingTitle}</span>
          <span className="meeting-room__code">{roomCode}</span>
          <span style={{
            fontSize: '0.7rem',
            background: 'rgba(45, 95, 45, 0.3)',
            color: '#4CAF50',
            padding: '2px 8px',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            LIVE
          </span>
          {isRecording && (
            <span style={{
              fontSize: '0.75rem',
              background: 'rgba(220, 38, 38, 0.15)',
              color: '#EF4444',
              padding: '4px 10px',
              borderRadius: '6px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              animation: 'pulse 2s infinite'
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
              REC {formatTime(recElapsed)}
            </span>
          )}
        </div>
        <div className="meeting-room__header-right">
          <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle Theme">
            <Palette size={18} />
          </button>
          <div className="connection-status">
            <span className={`connection-status__dot connection-status__dot--${connectionState === 'connected' ? 'good' :
              connectionState === 'connecting' || connectionState === 'reconnecting' ? 'fair' : 'poor'
              }`} />
            {connectionState === 'connected' ? 'Excellent' :
              connectionState === 'connecting' ? 'Connecting...' :
                connectionState === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
          </div>
          <span className="meeting-room__timer">⏱ {formatTime(elapsed)}</span>
          <button
            className="meeting-room__participants-count"
            onClick={() => setShowParticipants(!showParticipants)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit' }}
          >
            <Users size={16} /> {participants.length}
          </button>
        </div>
      </div>

      {/* Video Area */}
      <div className="meeting-room__content">
        {connectionState === 'connecting' || connectionState === 'reconnecting' ? (
          <div className="elite-connecting">
            <div className="elite-connecting__orb">
              <span style={{ fontSize: '24px', color: 'white' }}>🎵</span>
            </div>
            <span className="elite-connecting__text">Connecting Securely...</span>
          </div>
        ) : (
          <div className={`video-grid ${gridClass}`} style={{ width: '100%' }}>
            {tracks.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'white' }}>
                Waiting for participants...
              </div>
            ) : (
              tracks.map((trackRef, idx) => (
                <ParticipantVideoTile key={trackRef.participant.identity + idx} trackRef={trackRef} />
              ))
            )}
          </div>
        )}

        {/* Participants Sidebar */}
        {showParticipants && (
          <div className="participants-sidebar">
            <div className="participants-sidebar__header">
              <span className="participants-sidebar__title">
                Participants ({participants.length})
              </span>
              <button
                className="participants-sidebar__close"
                onClick={() => setShowParticipants(false)}
              >
                ✕
              </button>
            </div>
            <div className="participants-sidebar__list">
              {participants.map((p) => (
                <div key={p.identity} className="participant-item">
                  <div
                    className="participant-item__avatar"
                    style={{ backgroundColor: '#7B2D26' }}
                  >
                    {p.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
                  </div>
                  <span className="participant-item__name">
                    {p.name} {p.isLocal && '(You)'}
                  </span>
                  {!p.isMicrophoneEnabled && (
                    <span className="participant-item__role"><MicOff size={14} /></span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="meeting-room__controls-wrapper">
        <div className="meeting-room__controls">
          <button
            className={`control-btn ${displayMic ? 'control-btn--default' : 'control-btn--off'}`}
            onClick={toggleMic}
          >
            {displayMic ? <Mic size={22} /> : <MicOff size={22} />}
            <span className="control-btn__tooltip">{displayMic ? 'Mute' : 'Unmute'}</span>
          </button>

          <button
            className={`control-btn ${displayCam ? 'control-btn--default' : 'control-btn--off'}`}
            onClick={toggleCam}
          >
            {displayCam ? <VideoIcon size={22} /> : <VideoOff size={22} />}
            <span className="control-btn__tooltip">{displayCam ? 'Stop Camera' : 'Start Camera'}</span>
          </button>

          <button
            className={`control-btn ${musicMode ? 'control-btn--active' : 'control-btn--default'}`}
            onClick={toggleMusicMode}
            style={musicMode ? { background: '#D97706', color: 'white', borderColor: '#D97706' } : {}}
          >
            <span style={{ fontSize: '1.2rem' }}>🎵</span>
            <span className="control-btn__tooltip">{musicMode ? 'Music Mode ON (Zero Latency)' : 'Music Mode OFF (Noise Suppressed)'}</span>
          </button>

          <button className={`control-btn ${showParticipants ? 'control-btn--active' : 'control-btn--default'}`} onClick={() => setShowParticipants(!showParticipants)}>
            <Users size={22} />
            <span className="control-btn__tooltip">Participants</span>
          </button>

          <button
            className="control-btn control-btn--default"
            onClick={() => setConfirmAction('leave')}
          >
            <LogOut size={22} />
            <span className="control-btn__tooltip">Leave</span>
          </button>

          <button
            className={`control-btn ${isRecording ? 'control-btn--active' : 'control-btn--default'}`}
            onClick={handleRecordToggle}
            disabled={isRecordLoading}
            style={isRecording
              ? { background: '#DC2626', color: 'white', borderColor: '#DC2626', animation: 'pulse 2s infinite' }
              : { background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', borderColor: 'rgba(239, 68, 68, 0.3)' }
            }
          >
            {isRecording ? <Square size={22} fill="currentColor" /> : <Disc size={22} />}
            <span className="control-btn__tooltip">{isRecording ? 'Stop Recording' : 'Record Class'}</span>
          </button>

          {isHost && (
            <>
              <button className="control-btn control-btn--end" onClick={() => setConfirmAction('end')}>
                <PhoneOff size={22} />
                <span className="control-btn__tooltip">End for All</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {confirmAction && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="modal-content" style={{
            background: 'white', padding: '24px', borderRadius: '16px',
            maxWidth: '320px', width: '90%', textAlign: 'center',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)', color: '#111827'
          }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
              {confirmAction === 'end' ? 'End Meeting for All?' : 'Leave Meeting?'}
            </h3>
            <p style={{ color: '#4B5563', marginBottom: '24px', fontSize: '0.95rem', lineHeight: 1.4 }}>
              {confirmAction === 'end'
                ? 'Are you sure you want to completely end this meeting and disconnect all participants?'
                : 'Are you sure you want to leave this meeting? You can rejoin later.'}
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setConfirmAction(null)}
                style={{ flex: 1, padding: '10px', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.background = '#E5E7EB'}
                onMouseOut={(e) => e.currentTarget.style.background = '#F3F4F6'}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction === 'end') {
                    if (onEnd) onEnd();
                  } else {
                    room.disconnect();
                    onLeave();
                  }
                  setConfirmAction(null);
                }}
                style={{ flex: 1, padding: '10px', background: '#DC2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.background = '#B91C1C'}
                onMouseOut={(e) => e.currentTarget.style.background = '#DC2626'}
              >
                {confirmAction === 'end' ? 'End Call' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="modal-overlay" onClick={() => setAlertMessage(null)} style={{ position: 'fixed', zIndex: 9999, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ background: 'white', padding: '32px 24px', borderRadius: '16px', maxWidth: '340px', width: '90%', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <h3 style={{ fontSize: '1.25rem', color: '#111827', marginBottom: '8px', fontWeight: 600 }}>Notice</h3>
            <p style={{ color: '#4B5563', fontSize: '0.95rem', marginBottom: '24px', lineHeight: 1.5 }}>
              {alertMessage}
            </p>
            <button
              onClick={() => setAlertMessage(null)}
              style={{ width: '100%', padding: '10px', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Single Video Tile for a Participant
function ParticipantVideoTile({ trackRef }: { trackRef: any }) {
  const p = trackRef.participant;
  const isVideoEnabled = p.isCameraEnabled;
  const isAudioEnabled = p.isMicrophoneEnabled;
  const isSpeaking = p.isSpeaking;

  const hasVideoTrack = isVideoEnabled && trackRef.publication !== undefined;

  return (
    <div className={`video-tile ${p.isLocal ? 'video-tile--local' : ''} ${isSpeaking ? 'video-tile--speaking' : ''}`}>
      {hasVideoTrack ? (
        <VideoTrack trackRef={trackRef} />
      ) : (
        <div className="video-tile__placeholder">
          <div className="video-tile__avatar" style={{ backgroundColor: '#7B2D26' }}>
            {p.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
          </div>
        </div>
      )}

      <span className="video-tile__name">
        {p.name} {p.isLocal && '(You)'}
      </span>

      {!isAudioEnabled && <span className="video-tile__muted"><MicOff size={14} color="white" /></span>}
    </div>
  );
}
