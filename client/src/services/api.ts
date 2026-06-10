import axios from 'axios';

const api = axios.create({
  // Option 1: Cloudflare Tunnel (For Mobile Demoing or sharing link)
  baseURL: 'https://sangeet-arghya.onrender.com/api',

  // Option 2: Local Web Browser / Pinggy Testing (Uncomment this line)
  //baseURL: import.meta.env.VITE_API_URL || '/api',

  // Option 3: Local Android Emulator Testing WITHOUT Cloudflare (Uncomment this line, and comment out the others)
  // baseURL: import.meta.env.VITE_API_URL || 'http://10.0.2.2:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Remove request interceptor since cookies are sent automatically.

// Response interceptor — handle 401 (token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthRequest = originalRequest?.url?.includes('/auth/login') || originalRequest?.url?.includes('/auth/signup');

    if (error.response?.status === 401 && !originalRequest?._retry && !isAuthRequest) {
      originalRequest._retry = true;

      try {
        await axios.post(`${api.defaults.baseURL || ''}/auth/refresh`, {}, { withCredentials: true });

        // Retry original request since the cookie has been refreshed
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed — force logout
        localStorage.removeItem('user');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
