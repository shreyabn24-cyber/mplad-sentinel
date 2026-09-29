"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/auth';

const DEMO_PROFILES: {
  role: UserRole;
  name: string;
  title: string;
  org: string;
  username: string;
  password: string;
  dest: string;
  icon: string;
  color: string;
  gradient: string;
  capabilities: string[];
}[] = [
  {
    role: 'CITIZEN',
    name: 'Aarav Sharma',
    title: 'Constituent Citizen',
    org: 'Kannauj Constituency, UP',
    username: 'citizen@demo',
    password: 'demo1234',
    dest: '/citizen',
    icon: 'person',
    color: '#22c55e',
    gradient: 'linear-gradient(135deg,#22c55e,#16a34a)',
    capabilities: ['Submit Development Requests', 'Upload Photo Evidence', 'Voice-enabled petition', 'Track petition status'],
  },
  {
    role: 'MP',
    name: 'Akhilesh Yadav',
    title: "Member of Parliament, Kannauj (PC 29)",
    org: 'Samajwadi Party · Lok Sabha',
    username: 'mp@demo',
    password: 'demo1234',
    dest: '/mp',
    icon: 'account_balance',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg,#f59e0b,#d97706)',
    capabilities: ['View Constituency Fund Position', 'Endorse Citizen Petitions', 'Monitor MPLADS Works', 'Recommend for District Sanction'],
  },
  {
    role: 'AUDITOR',
    name: 'S. K. Ramanathan, IA&AS',
    title: 'Director General of Audit',
    org: 'Comptroller & Auditor General of India',
    username: 'auditor@demo',
    password: 'demo1234',
    dest: '/anomalies',
    icon: 'policy',
    color: '#ef4444',
    gradient: 'linear-gradient(135deg,#ef4444,#dc2626)',
    capabilities: ['View AI-Flagged Anomalies', 'Satellite Before/After Analysis', 'Forensic Cause Attribution', 'Issue CAG Audit Notes'],
  },
  {
    role: 'DISTRICT_AUTHORITY',
    name: 'Dr. Rajeshwar Rao, IAS',
    title: 'District Magistrate & Collector',
    org: 'Kannauj District Administration, UP',
    username: 'dm@demo',
    password: 'demo1234',
    dest: '/district',
    icon: 'gavel',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    capabilities: ['Accord Administrative Sanction', 'Review MP-Endorsed Petitions', 'Monitor District Projects', 'Trigger PFMS Disbursement'],
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { loginAsDemo } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  const handleLogin = (profile: typeof DEMO_PROFILES[0]) => {
    setLoading(profile.role);
    loginAsDemo(profile.role);
    setTimeout(() => router.push(profile.dest), 400);
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg,#060d18 0%,#0d1f3c 50%,#070f1d 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 16px',
        fontFamily: "'Public Sans', 'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: 'linear-gradient(135deg,#0ea5e9,#2563eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 8px 32px rgba(14,165,233,0.4)',
          }}
        >
          <span className="material-symbols-outlined" style={{ color: 'white', fontSize: 32 }}>satellite_alt</span>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: 'white', margin: '0 0 10px' }}>
          MPLADS Sentinel
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, maxWidth: 500, lineHeight: 1.7 }}>
          AI-powered constituency fund accountability system. Select a demo profile to explore the platform.
        </p>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 14,
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: 20,
            padding: '5px 14px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#fbbf24' }}>info</span>
          <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700 }}>HACKATHON DEMO — Pre-filled credentials</span>
        </div>
      </div>

      {/* Profile Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          maxWidth: 1100,
          width: '100%',
        }}
      >
        {DEMO_PROFILES.map((profile) => (
          <div
            key={profile.role}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${profile.color}33`,
              borderRadius: 20,
              padding: '28px 24px',
              backdropFilter: 'blur(12px)',
              boxShadow: `0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)`,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              position: 'relative',
              overflow: 'hidden',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = `0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px ${profile.color}44`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)';
            }}
          >
            {/* Decorative glow */}
            <div
              style={{
                position: 'absolute',
                top: -40,
                right: -40,
                width: 120,
                height: 120,
                borderRadius: '50%',
                background: `${profile.color}18`,
                filter: 'blur(20px)',
                pointerEvents: 'none',
              }}
            />

            {/* Role badge + icon */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: profile.gradient,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 16px ${profile.color}44`,
                }}
              >
                <span className="material-symbols-outlined" style={{ color: 'white', fontSize: 24 }}>{profile.icon}</span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: profile.color,
                  background: `${profile.color}18`,
                  border: `1px solid ${profile.color}33`,
                  borderRadius: 12,
                  padding: '3px 10px',
                  letterSpacing: '0.06em',
                }}
              >
                {profile.role.replace('_', ' ')}
              </span>
            </div>

            {/* Identity */}
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'white', marginBottom: 3 }}>{profile.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>{profile.title}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{profile.org}</div>
            </div>

            {/* Capabilities */}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {profile.capabilities.map((cap) => (
                <li key={cap} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: profile.color }}>check_circle</span>
                  {cap}
                </li>
              ))}
            </ul>

            {/* Credentials */}
            <div
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.05em' }}>DEMO CREDENTIALS</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>user:</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace', fontWeight: 700 }}>{profile.username}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>pass:</span>
                <span style={{ fontSize: 11, color: profile.color, fontFamily: 'monospace', fontWeight: 700 }}>{profile.password}</span>
              </div>
            </div>

            {/* CTA Button */}
            <button
              id={`login-${profile.role.toLowerCase()}`}
              onClick={() => handleLogin(profile)}
              disabled={loading !== null}
              style={{
                width: '100%',
                padding: '13px 24px',
                borderRadius: 14,
                border: 'none',
                background: loading === profile.role ? `${profile.color}88` : profile.gradient,
                color: 'white',
                fontWeight: 800,
                fontSize: 13,
                cursor: loading !== null ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'opacity 0.2s',
                opacity: loading !== null && loading !== profile.role ? 0.5 : 1,
                boxShadow: `0 4px 16px ${profile.color}33`,
              }}
            >
              {loading === profile.role ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>progress_activity</span>
                  Entering portal…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>login</span>
                  Enter as {profile.name.split(' ')[0]}
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p style={{ marginTop: 40, fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', maxWidth: 600 }}>
        This is a demonstration environment for SIH 2024. No real government data is submitted or processed.
        All amounts, contractor names, and satellite results are synthetic for showcase purposes.
      </p>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );

}
