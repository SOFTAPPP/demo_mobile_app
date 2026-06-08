import React, { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name || !email || !password) {
      setError('Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);
    try {
      await signup(name, email, password, role);
      navigate('/dashboard');
    } catch (err: any) {
      if (!err.response) {
        setError('Unable to connect to the server. Please check your network connection.');
      } else {
        setError(err.response.data?.error || 'Signup failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Animated Background */}
      <div className="auth-page__bg">
        <div className="auth-page__bg-circle" />
        <div className="auth-page__bg-circle" />
        <div className="auth-page__bg-circle" />
        <div className="auth-page__music-note" style={{ top: '80%' }}>♪</div>
        <div className="auth-page__music-note" style={{ top: '70%' }}>♫</div>
        <div className="auth-page__music-note" style={{ top: '90%' }}>♬</div>
        <div className="auth-page__music-note" style={{ top: '75%' }}>♩</div>
        <div className="auth-page__music-note" style={{ top: '85%' }}>♪</div>
        <div className="auth-page__music-note" style={{ top: '65%' }}>♫</div>
      </div>

      {/* Left Panel — Branding */}
      <div className="auth-page__brand">
        <div className="auth-page__brand-logo">🎵</div>
        <h1 className="auth-page__brand-title">Sangeet Arghya</h1>
        <p className="auth-page__brand-subtitle">Nada Upasana Academy</p>
        <div className="auth-page__brand-tagline">
          <p>Begin your musical journey with us</p>
          <p style={{ marginTop: '8px', opacity: 0.6, fontSize: '0.8rem' }}>
            Online & offline music classes open.
            Join our community of passionate musicians.
          </p>
        </div>
      </div>

      {/* Right Panel — Signup Form */}
      <div className="auth-page__form-panel">
        <div className="auth-card">
          <h2 className="auth-card__title">Create Account</h2>
          <p className="auth-card__subtitle">Join Sangeet Arghya's online music community</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="signup-name">Full Name</label>
              <input
                id="signup-name"
                type="text"
                className="form-input"
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="signup-email">Email Address</label>
              <input
                id="signup-email"
                type="email"
                className="form-input"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                className="form-input"
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="form-group">
              <label>I am a</label>
              <div className="role-selector">
                <div
                  className={`role-option ${role === 'student' ? 'active' : ''}`}
                  onClick={() => setRole('student')}
                >
                  <span className="role-option__icon">🎓</span>
                  <span className="role-option__label">Student</span>
                </div>
                <div
                  className={`role-option ${role === 'teacher' ? 'active' : ''}`}
                  onClick={() => setRole('teacher')}
                >
                  <span className="role-option__icon">👩‍🏫</span>
                  <span className="role-option__label">Teacher</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className={`btn-submit ${isLoading ? 'btn-submit--loading' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? <span className="loader" /> : 'Create Account'}
            </button>
          </form>

          <p className="auth-toggle">
            Already have an account?{' '}
            <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
