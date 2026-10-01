import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AuthUser,
  fetchCurrentUser,
  signInWithEmail,
  signOut as requestSignOut,
  signUpWithEmail,
} from '../api/authClient';
import Purchases from 'react-native-purchases';
import { PURCHASES_ENABLED } from '../config';
import { clearToken, loadToken, saveToken } from './tokenStorage';
import { AuthStatus } from './authStatus';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  token: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState(AuthStatus.Loading);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const storedToken = await loadToken();
      if (!storedToken) {
        if (!cancelled) setStatus(AuthStatus.SignedOut);
        return;
      }

      try {
        const currentUser = await fetchCurrentUser(storedToken);
        if (cancelled) return;

        if (currentUser) {
          setToken(storedToken);
          setUser(currentUser);
          setStatus(AuthStatus.SignedIn);
        } else {
          await clearToken();
          setStatus(AuthStatus.SignedOut);
        }
      } catch {
        if (!cancelled) setStatus(AuthStatus.SignedOut);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // RevenueCat keys purchases by our user id, so Pro follows the account
  // rather than the phone. A failure only means Pro reads as locked for now.
  const userId = user?.id;
  useEffect(() => {
    if (PURCHASES_ENABLED && userId) {
      Purchases.logIn(userId).catch(() => {});
    }
  }, [userId]);

  const startSession = useCallback(
    async (newToken: string, newUser: AuthUser) => {
      await saveToken(newToken);
      setToken(newToken);
      setUser(newUser);
      setStatus(AuthStatus.SignedIn);
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await signInWithEmail(email, password);
      await startSession(session.token, session.user);
    },
    [startSession],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const session = await signUpWithEmail(name, email, password);
      await startSession(session.token, session.user);
    },
    [startSession],
  );

  const signOut = useCallback(async () => {
    if (token) {
      await requestSignOut(token).catch(() => {});
    }
    if (PURCHASES_ENABLED) {
      await Purchases.logOut().catch(() => {});
    }
    await clearToken();
    setToken(null);
    setUser(null);
    setStatus(AuthStatus.SignedOut);
  }, [token]);

  const value = useMemo(
    () => ({ status, user, token, signIn, signUp, signOut }),
    [status, user, token, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
