import React, { createContext, useContext, useEffect, useState } from 'react';
import api from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('axistra_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('axistra_token', data.token);
      localStorage.setItem('axistra_user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('axistra_token');
    localStorage.removeItem('axistra_user');
    setUser(null);
    window.location.href = '/login';
  };

  useEffect(() => {
    if (user && localStorage.getItem('axistra_token')) {
      // Only log out if the token is EXPLICITLY rejected (401). Network errors,
      // backend restart 502/503s, and timeouts must NOT log the user out — otherwise
      // the preview URL appears to "auto-refresh" every time the API blips.
      api.get('/auth/me').catch((err) => {
        if (err.response && err.response.status === 401) {
          logout();
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
