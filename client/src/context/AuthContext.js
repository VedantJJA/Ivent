'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const cachedUser = localStorage.getItem('ivent_user');
        return cachedUser ? JSON.parse(cachedUser) : null;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ivent_token') : null;
    const cachedUserStr = typeof window !== 'undefined' ? localStorage.getItem('ivent_user') : null;

    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    if (cachedUserStr) {
      try {
        setUser(JSON.parse(cachedUserStr));
      } catch {
        // ignore
      }
    }

    // Verify token with server if network is available
    apiGet('/auth/me')
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          try {
            localStorage.setItem('ivent_user', JSON.stringify(data.user));
          } catch {
            // ignore
          }
        }
      })
      .catch((err) => {
        // Only clear credentials if the server explicitly rejected the token (401/403)
        // If it's a network/offline error, preserve login session
        const isAuthError = err.message?.toLowerCase().includes('token') ||
                            err.message?.toLowerCase().includes('unauthorized') ||
                            err.message?.toLowerCase().includes('invalid');

        if (isAuthError) {
          localStorage.removeItem('ivent_token');
          localStorage.removeItem('ivent_user');
          setUser(null);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await apiPost('/auth/login', { email, password });
    localStorage.setItem('ivent_token', data.token);
    localStorage.setItem('ivent_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (email, password, regNumber) => {
    const data = await apiPost('/auth/register', { email, password, regNumber });
    localStorage.setItem('ivent_token', data.token);
    localStorage.setItem('ivent_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ivent_token');
    localStorage.removeItem('ivent_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
