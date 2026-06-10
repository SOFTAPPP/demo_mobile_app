import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import type { User, AuthResponse } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, role: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      const storedUser = sessionStorage.getItem('user');

      if (storedUser) {
        try {
          // Verify token is still valid
          const { data } = await api.get('/auth/me');
          setUser(data.user);
          sessionStorage.setItem('user', JSON.stringify(data.user));
        } catch {
          // Token invalid — clear storage and logout
          sessionStorage.removeItem('user');
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
    sessionStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string, role: string) => {
    const { data } = await api.post<AuthResponse>('/auth/signup', { name, email, password, role });
    sessionStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('user');
    setUser(null);
    api.post('/auth/logout').catch(() => {});
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
