import type { User } from '@agentops/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, readToken, setUnauthorizedHandler, writeToken } from '../api/client';
import { useMe } from '../api/hooks';

interface AuthState {
  user: User | null;
  /** True while a stored token is being checked against /me. */
  checking: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => readToken());
  const [user, setUser] = useState<User | null>(null);
  const me = useMe(!!token && !user);

  useEffect(() => {
    if (me.data) setUser(me.data);
  }, [me.data]);

  const logout = useCallback(() => {
    writeToken(null);
    setToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      qc.clear();
    });
  }, [qc]);

  useEffect(() => {
    if (me.isError) logout();
  }, [me.isError, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    writeToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, checking: !!token && !user && !me.isError, login, logout }),
    [user, token, me.isError, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useIsAdmin(): boolean {
  return useAuth().user?.role === 'admin';
}
