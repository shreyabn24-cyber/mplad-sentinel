'use client';

import React, { useState, useEffect } from 'react';
import { Search, Bell, Shield, User, X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import Link from 'next/link';
import { useAuth, displayName } from '@/lib/auth';
import { fetchAnomalySummary } from '@/lib/api';

interface LiveNotification {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  timestamp: string;
}

export default function Navbar() {
  const { user, role, notifications: authNotifications, unreadNotificationCount, markNotificationAsRead, clearAllNotifications, notificationStream } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);

  // This bar used to open its own `EventSource` on /notifications/stream. That
  // stream requires a bearer token, which `EventSource` cannot send, so the
  // connection was refused by the backend and closed by `onerror` — the bell
  // then showed whatever it had accumulated before the failure and nothing
  // explained why it had gone quiet. Live events now come from the auth
  // provider's single subscription, which reports the reason when the stream
  // cannot be established instead of silently showing an empty bell.

  const getRoleLabel = () => {
    switch (role) {
      case 'CITIZEN': return 'Verified Citizen';
      case 'MP': return 'Member of Parliament';
      case 'DISTRICT_AUTHORITY': return 'District Authority';
      case 'AUDITOR': return 'Auditor';
      case 'ADMIN': return 'Administrator';
      default: return 'Not signed in';
    }
  };

  const allNotifications: LiveNotification[] = (authNotifications || []).map((an) => ({
    id: an.id,
    category: an.category,
    title: an.title,
    description: an.description,
    severity: an.severity,
    timestamp: an.timestamp,
  }));

  const totalUnread = unreadNotificationCount;

  const handleOpenNotifications = () => {
    setShowNotifications((prev) => !prev);
  };

  // This badge used to read "12 Critical (L3) Corroborated" as a literal. It is a
  // global detection count, so a static string is a fabricated figure in the most
  // prominent position in the header. It is now read from the server, and when
  // the server cannot answer it says so rather than falling back to a number.
  const [l3, setL3] = useState<{ value: number | null; note: string | null }>({
    value: null,
    note: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetchAnomalySummary()
      .then((s) => {
        if (!cancelled) setL3({ value: s.L3, note: null });
      })
      .catch(() => {
        if (!cancelled) {
          setL3({ value: null, note: 'L3 count unavailable — service unreachable' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-white text-base">MPLADS SENTINEL</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">AI-Gov v2.4</span>
            </div>
            <p className="text-[11px] text-slate-400">MoSPI Risk-Intelligence Monitoring Layer</p>
          </div>
        </Link>
      </div>

      <div className="flex-1 max-w-md mx-8 hidden md:block">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search by Work Code, Constituency, MP or Contractor..." 
            className="w-full pl-9 pr-4 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/40 transition"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 relative">
        {l3.value === null ? (
          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 text-slate-400 px-3 py-1 rounded-full text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
            <span title={l3.note ?? undefined}>{l3.note ?? 'L3 count loading…'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-3 py-1 rounded-full text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            <span>
              {l3.value} L3 flagged for review
            </span>
          </div>
        )}

        {/* Notification Bell */}
        <button 
          onClick={handleOpenNotifications}
          className="relative p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          title="Live Notifications & Telemetry"
        >
          <Bell className="w-4 h-4" />
          {totalUnread > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-sky-500 ring-2 ring-slate-900 animate-ping"></span>
          )}
          {totalUnread > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-sky-500"></span>
          )}
        </button>

        {/* Dropdown Notification Box */}
        {showNotifications && (
          <div className="absolute right-12 top-14 w-80 sm:w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 z-50 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Notifications ({totalUnread} Unread)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={clearAllNotifications}
                  className="text-[11px] text-slate-400 hover:text-sky-400 transition"
                >
                  Mark all read
                </button>
                <button onClick={() => setShowNotifications(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {allNotifications.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs space-y-2">
                  <p>No events received in this session.</p>
                  {notificationStream.reason && (
                    <p className="text-[11px] text-slate-500/80 leading-relaxed">
                      {notificationStream.reason}
                    </p>
                  )}
                </div>
              ) : (
                allNotifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markNotificationAsRead(n.id)}
                    className="p-2.5 rounded-xl border border-sky-500/30 bg-slate-800/90 hover:border-sky-500/60 text-xs space-y-1 transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        {n.severity === 'SUCCESS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        {n.severity === 'WARNING' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                        {n.severity === 'INFO' && <Info className="w-3.5 h-3.5 text-sky-400" />}
                        <span>{n.title}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">{n.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{n.description}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="h-5 w-px bg-slate-800"></div>

        {/* Signed-in account, or a sign-in link. This used to read
            `user?.name || 'Authorized Official'`, which displayed
            "Authorized Official" to every anonymous visitor — implying an
            authenticated identity that did not exist. */}
        <Link href={user ? '/login' : '/login'} className="flex items-center gap-2 pl-1 hover:opacity-90 transition">
          <div className="w-7 h-7 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-300">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-medium text-slate-200">
              {user ? displayName(user) : 'Sign in'}
            </p>
            <p className="text-[10px] text-sky-400 font-mono">{getRoleLabel()}</p>
          </div>
        </Link>
      </div>
    </header>
  );
}
