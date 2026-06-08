import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Home } from 'lucide-react';
import '../styles/meeting.css';

export default function MeetingEnded() {
  const navigate = useNavigate();
  const location = useLocation();
  const roomCode = location.state?.roomCode || 'Unknown';
  
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/dashboard');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="meeting-page theme-light" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', padding: '24px', textAlign: 'center' }}>
      <div style={{ background: 'white', padding: '48px', borderRadius: '16px', boxShadow: '0 10px 40px rgba(123, 45, 38, 0.1)', maxWidth: '400px', width: '100%' }}>
        <div style={{ width: '80px', height: '80px', background: '#FEF2F2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#DC2626' }}>
          <LogOut size={40} />
        </div>
        
        <h1 style={{ color: '#111827', fontSize: '24px', marginBottom: '12px' }}>Meeting Ended</h1>
        <p style={{ color: '#4B5563', marginBottom: '32px', lineHeight: '1.5' }}>
          The host has ended the meeting for all participants. Thank you for joining room <strong>{roomCode}</strong>.
        </p>

        <div style={{ marginBottom: '32px', padding: '16px', background: '#F3F4F6', borderRadius: '8px', color: '#6B7280', fontSize: '14px' }}>
          Redirecting to dashboard in <strong>{countdown}</strong> seconds...
        </div>

        <button 
          onClick={() => navigate('/dashboard')}
          style={{ width: '100%', padding: '14px', background: '#DC2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'background 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.background = '#B91C1C'}
          onMouseOut={(e) => e.currentTarget.style.background = '#DC2626'}
        >
          <Home size={18} />
          Return to Dashboard Now
        </button>
      </div>
    </div>
  );
}
