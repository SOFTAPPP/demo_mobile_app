import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocketUrl = (): string => {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    return apiUrl.replace(/\/api\/?$/, '');
  }
  return window.location.origin;
};

export const getSocket = (): Socket => {
  if (socket && (socket.connected || socket.io.engine.readyState === 'opening')) {
    return socket;
  }
  socket = io(getSocketUrl(), {
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    transports: ['websocket', 'polling'],
  });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
