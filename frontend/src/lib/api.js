import axios from 'axios';

const BACKEND_URL = import.meta.env.REACT_APP_BACKEND_URL || import.meta.env.VITE_BACKEND_URL || 'http://localhost:9001';
export const API_BASE = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('axistra_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Only force-redirect to /login when the server EXPLICITLY says 401.
    // Network errors, 502/503 (backend restart blip), and 504s must NOT log the user out.
    if (err.response && err.response.status === 401) {
      const path = window.location.pathname;
      const reqUrl = String(err.config?.url || '');
      // Don't redirect for the heartbeat /auth/me — let auth.jsx decide.
      if (path !== '/login' && !reqUrl.includes('/auth/me')) {
        localStorage.removeItem('axistra_token');
        localStorage.removeItem('axistra_user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
