import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  VideoTrack,
  useConnectionState,
} from '@livekit/components-react';
import { Track, RoomOptions, VideoPresets, RoomEvent } from 'livekit-client';
import { useAuth } from '../context/AuthContext';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Users, PhoneOff, LogOut, Signal, SignalHigh, SignalLow, SignalMedium, Palette } from 'lucide-react';
import { io as socketIO } from 'socket.io-client';
import api from '../services/api';
import '../styles/meeting.css';

const roomOptions: RoomOptions = {
  adaptiveStream: { pixelDensity: 'screen' }, // Smart adaptive video based on screen size
  dynacast: true, // Dynamically manage video quality
  videoCaptureDefaults: {
    resolution: VideoPresets.h1080.resolution, // Lowered to 1080p to preserve bandwidth for audio
  },
  audioCaptureDefaults: {
    echoCancellation: true, 
    noiseSuppression: true, 
    autoGainControl: true,  
  },
  publishDefaults: {
    simulcast: true, // Allow fallback qualities for bad networks
    videoEncoding: {
      maxBitrate: 1_500_000, // Capped at 1.5 Mbps to prevent network DDOS
      maxFramerate: 30,
    }
  },
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

  const [livekitToken, setLivekitToken] = useState<string>(location.state?.livekit?.token || '');
  const [livekitUrl, setLivekitUrl] = useState<string>(location.state?.livekit?.url || '');
  const [meetingTitle, setMeetingTitle] = useState(location.state?.meeting?.title || 'Music Class');
  const [isConnecting, setIsConnecting] = useState(!location.state?.livekit);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'maroon'>('light');
  const [isHost, setIsHost] = useState(!!location.state?.isHost);

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
      navigate('/meeting-ended', { state: { roomCode } });
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
          serverUrl={livekitUrl}
          token={livekitToken}
          options={roomOptions}
          video={false}
          audio={false}
          onDisconnected={() => {
            console.log('Disconnected from room');
            // Do not force navigate here; allow socket or manual leave to handle it
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
              navigate('/dashboard');
            }} 
            onEnd={async () => {
              if (isHost) {
                try {
                  await api.post('/meetings/end', { roomCode });
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
          />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
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
  joinStartTime
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
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [elapsed, setElapsed] = useState(0);
  const [showParticipants, setShowParticipants] = useState(false);
  const [musicMode, setMusicMode] = useState(false);

  // Optimistic UI States for instant feedback
  const [optimisticMic, setOptimisticMic] = useState<boolean | null>(null);
  const [optimisticCam, setOptimisticCam] = useState<boolean | null>(null);

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

  // Timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(timer);
  }, []);

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
      setOptimisticMic(!nextState); // Revert on error
    } finally {
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
      setOptimisticCam(!nextState); // Revert on error
    } finally {
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
        </div>
        <div className="meeting-room__header-right">
          <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle Theme">
            <Palette size={18} />
          </button>
          <div className="connection-status">
            <span className={`connection-status__dot connection-status__dot--${
              connectionState === 'connected' ? 'good' :
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
        {connectionState !== 'connected' ? (
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
            onClick={() => {
              room.disconnect();
              onLeave();
            }}
          >
            <LogOut size={22} />
            <span className="control-btn__tooltip">Leave</span>
          </button>

          {isHost && onEnd && (
            <button
              className="control-btn control-btn--end"
              onClick={() => {
                room.disconnect();
                onEnd();
              }}
            >
              <PhoneOff size={22} />
              <span className="control-btn__tooltip">End for All</span>
            </button>
          )}
        </div>
      </div>
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
