import axios from 'axios';
import { Capacitor } from '@capacitor/core';

// Detect if running inside Capacitor native app
const isNative = Capacitor.isNativePlatform();

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  // Cookies don't work in Capacitor (http://localhost + secure:true = silently dropped)
  // So we only use credentials for web browser, and use Bearer tokens for native
  withCredentials: !isNative,
  timeout: 15000,
});

// Request interceptor: attach Bearer token for native apps
api.interceptors.request.use((config) => {
  if (isNative) {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response interceptor: handle 401 refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthRequest = originalRequest?.url?.includes('/auth/login') || originalRequest?.url?.includes('/auth/signup') || originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest?._retry && !isAuthRequest) {
      originalRequest._retry = true;

      try {
        const refreshPayload: any = {};
        const refreshHeaders: any = {};

        if (isNative) {
          // For native, send the refresh token in the body since cookies don't work
          const refreshToken = localStorage.getItem('refreshToken');
          if (!refreshToken) throw new Error('No refresh token');
          refreshPayload.refreshToken = refreshToken;
        }

        const { data } = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          refreshPayload,
          { withCredentials: !isNative, headers: refreshHeaders }
        );

        if (isNative && data.accessToken) {
          localStorage.setItem('accessToken', data.accessToken);
        }

        return api(originalRequest);
      } catch {
        // Clear everything on refresh failure
        sessionStorage.removeItem('user');
        if (isNative) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Save auth tokens from login/signup response (only used on native platforms)
 */
export const saveNativeTokens = (accessToken?: string, refreshToken?: string) => {
  if (isNative) {
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  }
};

/**
 * Clear auth tokens (used on logout for native platforms)
 */
export const clearNativeTokens = () => {
  if (isNative) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }
};

export default api;
