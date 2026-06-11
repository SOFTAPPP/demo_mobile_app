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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { clearSharedRoom, getSharedRoom, roomOptions } from '../services/livekitPrewarm';
import { getSocket, disconnectSocket } from '../services/socket';
import '../styles/meeting.css';

const playSound = (type: 'record-start' | 'record-stop' | 'user-join' | 'user-leave') => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'sine';
    const now = audioCtx.currentTime;

    if (type === 'record-start') {
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1046.50, now + 0.1);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      gainNode.gain.linearRampToValueAtTime(0.2, now + 0.12);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'record-stop') {
      osc.frequency.setValueAtTime(440, now);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'user-join') {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.1, now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'user-leave') {
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.1);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.08, now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch {}
};

class MeetingErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("MeetingErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#2D1B22', color: '#FF8888', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2>Application Crashed</h2>
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

  useEffect(() => {
    if (!roomCode) return;

    const socket = getSocket();

    socket.emit('join-room', roomCode);

    const onMeetingEnded = () => {
      if (isLeavingManually.current) return;
      clearSharedRoom();
      navigate('/meeting-ended', { state: { roomCode } });
    };

    const onRecordingStarted = () => {
      setIsRecording((prev) => {
        if (!prev) {
          setRecordingToast({ show: true, type: 'start' });
          playSound('record-start');
          return true;
        }
        return prev;
      });
    };

    const onRecordingStopped = () => {
      setIsRecording((prev) => {
        if (prev) {
          setRecordingToast({ show: true, type: 'stop' });
          playSound('record-stop');
          setEgressId(null);
          return false;
        }
        return prev;
      });
    };

    socket.on('meeting-ended', onMeetingEnded);
    socket.on('recording-started', onRecordingStarted);
    socket.on('recording-stopped', onRecordingStopped);

    return () => {
      socket.off('meeting-ended', onMeetingEnded);
      socket.off('recording-started', onRecordingStarted);
      socket.off('recording-stopped', onRecordingStopped);
      socket.emit('leave-room', roomCode);
    };
  }, [roomCode, navigate]);

  useEffect(() => {
    if (!location.state?.livekit && roomCode) {
      const searchParams = new URLSearchParams(window.location.search);
      const botToken = searchParams.get('botToken');
      const lkUrl = searchParams.get('lkUrl');

      if (botToken && lkUrl) {
        setLivekitToken(botToken);
        setLivekitUrl(lkUrl);
        setMeetingTitle('Class Recording');
        setIsHost(false);
        setIsConnecting(false);
      } else {
        fetchMeetingToken(roomCode);
      }
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

  const handleLeave = useCallback(async () => {
    if (isHost && isRecording && egressId) {
      try {
        await api.post('/meetings/record/stop', { egressId, roomCode });
      } catch {}
    }
    isLeavingManually.current = true;
    clearSharedRoom();
    disconnectSocket();
    navigate('/dashboard');
  }, [isHost, isRecording, egressId, roomCode, navigate]);

  const handleEnd = useCallback(() => {
    if (isHost) {
      isLeavingManually.current = true;
      clearSharedRoom();
      disconnectSocket();
      navigate('/meeting-ended', { state: { roomCode } });
      api.post('/meetings/end', { roomCode }).catch(() => {});
    }
  }, [isHost, roomCode, navigate]);

  const handleOptimisticStart = useCallback((newEgressId: string) => {
    setEgressId(newEgressId);
    setIsRecording(true);
    if (newEgressId !== 'temp_id_loading') {
      playSound('record-start');
      setRecordingToast({ show: true, type: 'start' });
      setTimeout(() => setRecordingToast({ show: false, type: null }), 3500);
    }
  }, []);

  const handleOptimisticStop = useCallback(() => {
    setEgressId(null);
    setIsRecording(false);
    playSound('record-stop');
    setRecordingToast({ show: true, type: 'stop' });
    setTimeout(() => setRecordingToast({ show: false, type: null }), 3500);
  }, []);

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
    <MeetingErrorBoundary>
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
          onDisconnected={() => {}}
          onError={(err) => {
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
            onLeave={handleLeave}
            onEnd={handleEnd}
            connectionError={connectionError}
            clearConnectionError={() => setConnectionError('')}
            theme={theme}
            onToggleTheme={() => setTheme(t => t === 'light' ? 'maroon' : 'light')}
            joinStartTime={location.state?.joinStartTime}
            isRecording={isRecording}
            egressId={egressId}
            onOptimisticStart={handleOptimisticStart}
            onOptimisticStop={handleOptimisticStop}
          />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>

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
    </MeetingErrorBoundary>
  );
}

const BrandedMeetingUI = React.memo(function BrandedMeetingUI({
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
  const [musicMode, setMusicMode] = useState(false);
  const [isRecordLoading, setIsRecordLoading] = useState(false);

  useEffect(() => {
    if (!room) return;

    const onParticipantConnected = (participant: any) => {
      if (!participant.name || participant.isHidden) return;
      const id = participant?.identity?.toLowerCase() || '';
      if (id.startsWith('eg_') || id.includes('egress') || id.includes('recorder')) return;
      playSound('user-join');
    };

    const onParticipantDisconnected = (participant: any) => {
      if (!participant.name || participant.isHidden) return;
      const id = participant?.identity?.toLowerCase() || '';
      if (id.startsWith('eg_') || id.includes('egress') || id.includes('recorder')) return;
      playSound('user-leave');
    };

    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room]);

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

  useEffect(() => {
    if ((connectionState === 'connected' || connectionState === 'reconnecting') && connectionError) {
      clearConnectionError();
    }
  }, [connectionState, connectionError, clearConnectionError]);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const [recElapsed, setRecElapsed] = useState(0);

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

  const formatTime = useCallback((seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, []);

  const toggleMic = useCallback(async () => {
    const nextState = !displayMic;
    setOptimisticMic(nextState);
    try {
      await localParticipant.setMicrophoneEnabled(nextState);
    } catch {
      setOptimisticMic(null);
    }
  }, [displayMic, localParticipant]);

  const toggleCam = useCallback(async () => {
    const nextState = !displayCam;
    setOptimisticCam(nextState);
    try {
      await localParticipant.setCameraEnabled(nextState);
    } catch {
      setOptimisticCam(null);
    }
  }, [displayCam, localParticipant]);

  const toggleMusicMode = useCallback(async () => {
    const nextMode = !musicMode;
    setMusicMode(nextMode);
    if (displayMic) {
      await localParticipant.setMicrophoneEnabled(false);
      await localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: !nextMode,
        noiseSuppression: !nextMode,
        autoGainControl: !nextMode,
      });
    }
  }, [musicMode, displayMic, localParticipant]);

  const displayTracks = useMemo(() =>
    tracks.filter(t => !t.participant.identity.includes('bot-recorder') && t.participant.name !== 'Class Recorder'),
    [tracks]
  );

  const gridClass = displayTracks.length <= 1 ? 'video-grid--1' :
    displayTracks.length <= 2 ? 'video-grid--2' :
      displayTracks.length <= 4 ? 'video-grid--4' : 'video-grid--many';

  const handleRecordToggle = useCallback(async () => {
    try {
      setIsRecordLoading(true);
      if (isRecording && egressId) {
        if (onOptimisticStop) onOptimisticStop();

        const socket = getSocket();
        socket.emit('recording-stopped', roomCode);

        api.post('/meetings/record/stop', { egressId, roomCode }).catch(() => {});
      } else {
        if (onOptimisticStart) onOptimisticStart('temp_id_loading');

        const socket = getSocket();
        socket.emit('recording-started', roomCode);

        // Async dummy track publishing to avoid blocking the UI
        let totalTracks = 0;
        room.remoteParticipants.forEach((p) => { totalTracks += p.trackPublications.size; });
        totalTracks += room.localParticipant.trackPublications.size;

        if (totalTracks === 0) {
          (async () => {
            try {
              const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const oscillator = ctx.createOscillator();
              const gainNode = ctx.createGain();
              gainNode.gain.value = 0;
              const dst = ctx.createMediaStreamDestination();
              oscillator.connect(gainNode);
              gainNode.connect(dst);
              oscillator.start();

              const track = dst.stream.getAudioTracks()[0];
              const dummyTrack = new LocalAudioTrack(track);
              await room.localParticipant.publishTrack(dummyTrack, { name: 'silence', source: Track.Source.Unknown });

              setTimeout(() => {
                room.localParticipant.unpublishTrack(dummyTrack).catch(() => {});
              }, 10000);
            } catch {}
          })();
        }

        const fallbackUrl = 'https://demo-mobile-app-liart.vercel.app';
        const currentUrl = window.location.origin;
        const finalUrl = currentUrl.includes('localhost') ? fallbackUrl : currentUrl;

        const { data } = await api.post('/meetings/record/start', {
          roomCode,
          publicUrl: finalUrl
        });
        if (onOptimisticStart) onOptimisticStart(data.egressId);
      }
    } catch (e: any) {
      setAlertMessage(e.response?.data?.error || 'Failed to toggle recording.');

      if (isRecording) {
        if (onOptimisticStart && egressId) onOptimisticStart(egressId);
      } else {
        if (onOptimisticStop) onOptimisticStop();
      }
    } finally {
      setIsRecordLoading(false);
    }
  }, [isRecording, egressId, roomCode, room, onOptimisticStart, onOptimisticStop]);

  return (
    <div className="meeting-room" style={{ height: '100dvh', width: '100%' }}>
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
          <span>Connection Error: {connectionError}</span>
        </div>
      )}

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
            {displayTracks.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'white' }}>
                Waiting for participants...
              </div>
            ) : (
              displayTracks.map((trackRef, idx) => (
                <ParticipantVideoTile key={trackRef.participant.identity + idx} trackRef={trackRef} />
              ))
            )}
          </div>
        )}

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
            <button className="control-btn control-btn--end" onClick={() => setConfirmAction('end')}>
              <PhoneOff size={22} />
              <span className="control-btn__tooltip">End for All</span>
            </button>
          )}
        </div>
      </div>

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
});

const ParticipantVideoTile = React.memo(function ParticipantVideoTile({ trackRef }: { trackRef: any }) {
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
});
