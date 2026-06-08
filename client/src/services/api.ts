import axios from 'axios';

const api = axios.create({
  // Option 1: Cloudflare Tunnel (For Mobile Demoing or sharing link)
  baseURL: import.meta.env.VITE_API_URL || 'https://told-cooper-pilot-isaac.trycloudflare.com/api',

  // Option 2: Local Web Browser Testing (Uncomment this line, and comment out the others)
  //baseURL: import.meta.env.VITE_API_URL || '/api',

  // Option 3: Local Android Emulator Testing WITHOUT Cloudflare (Uncomment this line, and comment out the others)
  // baseURL: import.meta.env.VITE_API_URL || 'http://10.0.2.2:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — attach JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle 401 (token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthRequest = originalRequest?.url?.includes('/auth/login') || originalRequest?.url?.includes('/auth/signup');

    if (error.response?.status === 401 && !originalRequest?._retry && !isAuthRequest) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const { data } = await axios.post(`${api.defaults.baseURL || ''}/auth/refresh`, { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed — force logout
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
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
