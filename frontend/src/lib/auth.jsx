import React, { createContext, useContext, useEffect, useState } from 'react';
import api from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('axistra_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  /**
   * Step 1 of login. Returns:
   *   { require_2fa: true, challenge_token, user }  → caller must call verify2fa()
   *   or the final user object (also stored).
   */
  const login = async (email, password) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.require_2fa) {
        return { require_2fa: true, challenge_token: data.challenge_token, partial: data.user };
      }
      localStorage.setItem('axistra_token', data.token);
      localStorage.setItem('axistra_user', JSON.stringify(data.user));
      setUser(data.user);
      return { user: data.user };
    } finally {
      setLoading(false);
    }
  };

  /** Step 2 of login when require_2fa was true. */
  const verify2faLogin = async (challenge_token, { code, recovery_code }) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/2fa/login-verify', {
        challenge_token,
        code: code || undefined,
        recovery_code: recovery_code || undefined,
      });
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

  /** Refresh the cached user from /auth/me (e.g. after enabling 2FA). */
  const refreshUser = async () => {
    try {
      const { data } = await api.get('/auth/me');
      const next = {
        ...(user || {}),
        ...data,
      };
      localStorage.setItem('axistra_user', JSON.stringify(next));
      setUser(next);
      return next;
    } catch {
      return user;
    }
  };

  useEffect(() => {
    if (user && localStorage.getItem('axistra_token')) {
      api.get('/auth/me').then(({ data }) => {
        const merged = { ...user, ...data };
        localStorage.setItem('axistra_user', JSON.stringify(merged));
        setUser(merged);
      }).catch((err) => {
        if (err.response && err.response.status === 401) logout();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, verify2faLogin, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
