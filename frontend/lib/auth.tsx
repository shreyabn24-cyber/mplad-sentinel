'use client';

/**
 * MPLADS Sentinel — session state
 *
 * This file used to be a role-play harness. It defined four fictional
 * identities (a "Demo Citizen", a "Demo MP", a "Demo Auditor", a "Demo District
 * Magistrate") and exposed `switchRole(role)` so any visitor could become any of
 * them, plus `endorseDemand`/`sanctionDemand` which mutated a localStorage array
 * and emitted notifications announcing a government act that had not occurred.
 *
 * None of that corresponds to anything the server does. Worse, it presented an
 * officer's powers to someone who had authenticated with nothing. The identity
 * here is now exactly what the server says it is:
 *
 *   POST /auth/login  → token + the account's real role
 *   GET  /auth/me     → rehydrates a reload, and fails closed on revocation
 *
 * The role is read from the server on every load and never chosen by the
 * client. There is deliberately no `switchRole`.
 *
 * Notifications: previously a hardcoded array of six fabricated alerts, including
 * a "Critical Anomaly Detected" naming a work ID that does not exist and an "MP
 * Recommendation Received" for an endorsement that never happened. Real events
 * now arrive over SSE from `POST /notifications/broadcast`. See
 * `openNotificationStream` in lib/api.ts for why the stream is not yet usable
 * from a browser, and why inventing events in its place would be worse than
 * showing none.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

import {
  ApiError,
  fetchCurrentUser,
  login as apiLogin,
  setApiToken,
  setToken,
  getToken,
  openNotificationStream,
  StreamEvent,
} from './api';
import { AccountRole, UserProfile, displayName } from './types';

export type UserRole = AccountRole;
export type { UserProfile };

export interface SessionNotification {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: StreamEvent['severity'];
  timestamp: string;
}

/** A live event, or the reason the stream is not connected. */
export interface NotificationStreamState {
  connected: boolean;
  reason: string | null;
}

export interface AuthContextType {
  /** The signed-in account, or null when anonymous. */
  user: UserProfile | null;
  /**
   * The account's role, or `PUBLIC` when anonymous. This is what the *server*
   * says. It gates nothing by itself — every privileged call is also refused by
   * the API — it exists so the UI can show or hide controls honestly.
   */
  role: UserRole;
  isAuthenticated: boolean;
  /** True until the initial `/auth/me` check has finished. */
  isLoading: boolean;

  /**
   * Role groups matching backend/auth.py. `PUBLIC` is deliberately absent: an
   * anonymous visitor is not a member of any account-holding role.
   */
  canReview: boolean;
  canAdminister: boolean;
  canSubmitCitizenRequests: boolean;

  login: (username: string, password: string) => Promise<UserProfile>;
  logout: () => void;

  notifications: SessionNotification[];
  unreadNotificationCount: number;
  notificationStream: NotificationStreamState;
  markNotificationAsRead: (id: string) => void;
  clearAllNotifications: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const REVIEW_ROLES: UserRole[] = ['AUDITOR', 'ADMIN'];
const ADMIN_ROLES: UserRole[] = ['ADMIN'];
const CITIZEN_ROLES: UserRole[] = ['CITIZEN'];

function hasRole(role: UserRole, allowed: UserRole[]): boolean {
  return allowed.includes(role);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<SessionNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [stream, setStream] = useState<NotificationStreamState>({
    connected: false,
    reason: null,
  });

  const endSession = useCallback(() => {
    setToken(null);
    setApiToken(null);
    setUser(null);
    setNotifications([]);
    setReadIds(new Set());
    setStream({ connected: false, reason: null });
  }, []);

  // Rehydrate. A stored token is not trusted as proof of a session: the server
  // is asked who it belongs to, and an account that has since been deactivated
  // or re-roled is rejected here rather than being treated as signed in.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const token = getToken();
      if (!token) {
        setIsLoading(false);
        return;
      }
      setApiToken(token);
      try {
        const profile = await fetchCurrentUser();
        if (cancelled) return;
        setUser(profile);
      } catch (err) {
        if (cancelled) return;
        // An expired or revoked token is discarded so the app returns to the
        // anonymous view. A 503 means the server could not confirm the account
        // and the token is kept — the session is not known to be invalid.
        if (err instanceof ApiError && err.status !== 503) {
          endSession();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [endSession]);

  // Live events. Only attempted for a real session; a signed-out visitor is
  // told why rather than being shown a placeholder feed.
  useEffect(() => {
    if (!user) return;

    const close = openNotificationStream(
      (event) => {
        setNotifications((prev) => [
          {
            id: `${event.category}-${event.target_id}-${Date.now()}`,
            category: event.category,
            title: event.title,
            description: event.description,
            severity: event.severity,
            timestamp: event.timestamp,
          },
          ...prev,
        ]);
      },
      (reason) => setStream({ connected: false, reason })
    );

    return close;
  }, [user]);

  const login = useCallback(async (username: string, password: string): Promise<UserProfile> => {
    // A previous session's failure surfaces before the token is replaced.
    const response = await apiLogin(username, password);

    // The account's identity is only ever taken from `/auth/me`. If that call
    // cannot be made, no session is created.
    //
    // An earlier version fell back to assembling a profile out of the login
    // response — `role` from the token, `username` from what the visitor typed —
    // and marked it active. That fabricated an identity the server had not
    // confirmed and rendered the full officer UI for an account the backend
    // could not locate. A token alone proves nothing, so this fails closed: the
    // token is discarded and the error is surfaced.
    setApiToken(response.access_token);
    let profile: UserProfile;
    try {
      profile = await fetchCurrentUser();
    } catch (err) {
      endSession();
      throw new ApiError(
        err instanceof ApiError ? err.status : 503,
        err instanceof ApiError && err.status === 401
          ? 'The account could not be verified after sign-in. No session was created.'
          : 'Signed in, but the account record could not be retrieved, so no session was created.'
      );
    }

    setToken(response.access_token);
    setReadIds(new Set());
    setNotifications([]);
    setUser(profile);
    return profile;
  }, [endSession]);

  const markNotificationAsRead = useCallback((id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications((prev) => {
      setReadIds((known) => {
        const next = new Set(known);
        prev.forEach((n) => next.add(n.id));
        return next;
      });
      return prev;
    });
  }, []);

  const role: UserRole = user?.role ?? 'PUBLIC';

  const unreadNotificationCount = notifications.filter((n) => !readIds.has(n.id)).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAuthenticated: !!user,
        isLoading,
        canReview: hasRole(role, REVIEW_ROLES),
        canAdminister: hasRole(role, ADMIN_ROLES),
        canSubmitCitizenRequests: hasRole(role, CITIZEN_ROLES),
        login,
        logout: endSession,
        notifications,
        unreadNotificationCount,
        notificationStream: stream,
        markNotificationAsRead,
        clearAllNotifications,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { displayName };
