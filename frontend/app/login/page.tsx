"use client";

/**
 * Sign in.
 *
 * This page used to be a profile picker. It showed four cards, each naming a
 * real-format officer — "Akhilesh Yadav, Kannauj (PC 29), Samajwadi Party",
 * "Dr. Rajeshwar Rao, IAS, District Magistrate & Collector, Kannauj" — with the
 * password printed on the card. Choosing a card called `loginAsDemo(role)`, which
 * assigned that identity in localStorage and redirected to the matching desk.
 *
 * So the portal let any visitor become the MP, the CAG auditor, or the district
 * magistrate by clicking. The names attached to real constituencies are people
 * who did not consent to being represented here, and the abilities advertised on
 * each card ("Accord Administrative Sanction", "Endorse Citizen Demands") were
 * never wired to anything: the underlying calls were localStorage writes.
 *
 * What replaced it is an ordinary credential form. The role comes from the
 * server and only from the server. There is no role picker, because choosing a
 * role is not something a client may do.
 *
 * Accounts are created out of band with `backend/manage_users.py`; there is no
 * registration endpoint, and adding one would reintroduce the same problem — an
 * unauthenticated POST that mints an operator.
 */

import React, { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, user } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Send each role to the desk that matches the privileges the server granted.
  const destinationFor = (role: string): string => {
    switch (role) {
      case 'MP':
        return '/mp';
      case 'AUDITOR':
      case 'ADMIN':
        return '/anomalies';
      case 'DISTRICT_AUTHORITY':
        return '/district';
      case 'CITIZEN':
        return '/citizen';
      default:
        return '/';
    }
  };

  if (isAuthenticated && user) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={h1}>Already signed in</h1>
          <p style={subtitle}>
            You are signed in as <strong>{user.full_name || user.username}</strong> with the role{' '}
            <strong>{user.role}</strong>, assigned by the server.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
            <button style={primaryButton} onClick={() => router.push(destinationFor(user.role))}>
              Go to my desk
            </button>
            <button style={secondaryButton} onClick={() => router.push('/')}>
              Public overview
            </button>
          </div>
        </div>
      </main>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both a username and a password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const profile = await login(username.trim(), password);
      router.push(destinationFor(profile.role));
    } catch (err) {
      // The server returns one message for both an unknown username and a wrong
      // password, so nothing here reveals which accounts exist.
      setError(
        err instanceof ApiError
          ? err.detail
          : 'Sign-in failed because the service could not be reached. No session was created.'
      );
      setSubmitting(false);
    }
  }

  return (
    <main style={page}>
      <form style={card} onSubmit={handleSubmit}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'linear-gradient(135deg,#38bdf8,#2563eb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <span className="material-symbols-outlined" style={{ color: 'white', fontSize: 28 }}>
              lock
            </span>
          </div>
          <h1 style={h1}>Sign in</h1>
          <p style={subtitle}>
            Published oversight data is readable without an account. An account is required to
            submit a report or request, and to review or act on anything.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#fca5a5',
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: 13,
              marginBottom: 18,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <label style={label} htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={submitting}
          style={input}
          required
        />

        <label style={label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          style={input}
          required
        />

        <button type="submit" disabled={submitting} style={{ ...primaryButton, marginTop: 24 }}>
          {submitting ? (
            <>
              <span
                className="material-symbols-outlined"
                style={{ animation: 'spin 1s linear infinite', fontSize: 18 }}
              >
                progress_activity
              </span>
              Signing in…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                login
              </span>
              Sign in
            </>
          )}
        </button>

        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,0.1)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.45)',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: 'rgba(255,255,255,0.75)' }}>No account?</strong> There is no
          self-registration. An operator account is created out of band with{' '}
          <code style={code}>backend/manage_users.py</code>. Public pages need no account —{' '}
          <a href="/works" style={link}>
            browse works
          </a>{' '}
          and{' '}
          <a href="/anomalies" style={link}>
            read the published flag list
          </a>
          . The list is open to read; recording a verdict on it needs an auditor
          account.
          .
        </div>

        <button
          type="button"
          onClick={() => router.push('/')}
          style={{ ...secondaryButton, marginTop: 16 }}
        >
          Continue without an account
        </button>
      </form>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg,#0d1b2a 0%,#1a2f48 60%,#0d2137 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 16px',
};

const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 20,
  padding: 32,
  backdropFilter: 'blur(10px)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
};

const h1: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 900,
  color: 'white',
  marginBottom: 10,
  fontFamily: "'Public Sans',sans-serif",
};

const subtitle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.55)',
  fontSize: 13,
  lineHeight: 1.6,
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  color: 'rgba(255,255,255,0.7)',
  marginBottom: 6,
  letterSpacing: '0.04em',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  marginBottom: 18,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.06)',
  color: 'white',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const primaryButton: React.CSSProperties = {
  width: '100%',
  padding: '13px 24px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg,#0ea5e9,#2563eb)',
  color: 'white',
  fontWeight: 800,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const secondaryButton: React.CSSProperties = {
  width: '100%',
  padding: '11px 24px',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'transparent',
  color: 'rgba(255,255,255,0.8)',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const code: React.CSSProperties = {
  fontFamily: 'monospace',
  background: 'rgba(255,255,255,0.1)',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 11,
};

const link: React.CSSProperties = {
  color: '#7dd3fc',
  textDecoration: 'underline',
};
