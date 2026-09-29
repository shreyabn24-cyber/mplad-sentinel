'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, UserRole, displayName } from '@/lib/auth';
import { useLanguage } from '@/lib/languageContext';
import { SUPPORTED_LANGUAGES, LanguageCode } from '@/lib/translations';

export default function StitchHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    role,
    isAuthenticated,
    notifications,
    unreadNotificationCount,
    markNotificationAsRead,
    clearAllNotifications,
    logout,
  } = useAuth();
  const { language, setLanguage, currentLanguage, t } = useLanguage();

  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [fontPreferenceReady, setFontPreferenceReady] = useState(false);

  // Apply the accessibility control to the whole document and preserve it.
  useEffect(() => {
    if (!fontPreferenceReady) return;
    const root = document.documentElement;
    root.style.fontSize = fontSize === 'sm' ? '90%' : fontSize === 'lg' ? '110%' : '';
    try {
      window.localStorage.setItem('mplads_font_size', fontSize);
    } catch {
      // The control still works for this session when storage is unavailable.
    }
  }, [fontSize, fontPreferenceReady]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('mplads_font_size');
      if (saved === 'sm' || saved === 'md' || saved === 'lg') setFontSize(saved);
    } catch {
      // Keep the default size when storage is unavailable.
    } finally {
      setFontPreferenceReady(true);
    }
  }, []);

  // Navigation follows the *server-issued* role. An anonymous visitor gets the
  // public set; there is no way to reach another role's views by navigating,
  // because the API refuses those calls independently.
  const getNavItems = () => {
    if (role === 'MP') {
      return [
        { label: t('mp_desk', 'My Constituency Portal'), path: '/mp', badge: 'Active' },
        { label: t('works', 'Constituency Projects'), path: '/works' },
        { label: t('map', 'Constituency Map'), path: '/map' },
        { label: t('reports', 'Data Sources'), path: '/reports' },
        { label: t('help', 'Help & Guidelines'), path: '/help' },
      ];
    }

    if (role === 'AUDITOR' || role === 'ADMIN') {
      return [
        { label: t('anomalies', 'Anomaly Intelligence'), path: '/anomalies', badge: 'L1-L3' },
        { label: t('contractors', 'Contractor Data'), path: '/contractors' },
        { label: t('works', 'Works Explorer'), path: '/works' },
        { label: t('home', 'National Overview'), path: '/' },
        { label: t('map', 'Constituency Map'), path: '/map' },
        { label: t('reports', 'Audit Reports'), path: '/reports' },
      ];
    }

    if (role === 'DISTRICT_AUTHORITY') {
      return [
        { label: t('district', 'District Desk'), path: '/district' },
        { label: t('works', 'Works Explorer'), path: '/works' },
        { label: t('map', 'Constituency Map'), path: '/map' },
        { label: t('reports', 'District Reports'), path: '/reports' },
      ];
    }

    if (role === 'CITIZEN') {
      return [
        { label: t('home', 'Home'), path: '/' },
        { label: t('works', 'Browse Projects'), path: '/works' },
        { label: t('citizen', 'My Requests & Verification'), path: '/citizen', badge: 'Action' },
        { label: t('map', 'Constituency Map'), path: '/map' },
        { label: t('reports', 'Data Sources'), path: '/reports' },
        { label: t('help', 'Help & FAQ'), path: '/help' },
      ];
    }

    // Anonymous. Only the public read surface.
    return [
      { label: t('home', 'Home'), path: '/' },
      { label: t('works', 'Browse Projects'), path: '/works' },
      { label: t('map', 'Constituency Map'), path: '/map' },
      { label: t('reports', 'Data Sources'), path: '/reports' },
      { label: t('help', 'Help & FAQ'), path: '/help' },
    ];
  };

  const navItems = getNavItems();

  const getRoleBadgeStyle = (r: UserRole) => {
    switch (r) {
      case 'CITIZEN': return 'bg-sky-500/20 text-sky-800 border-sky-500/30';
      case 'MP': return 'bg-amber-500/20 text-amber-900 border-amber-600/30 font-bold';
      case 'AUDITOR': return 'bg-rose-500/20 text-rose-900 border-error/30 font-bold';
      case 'ADMIN': return 'bg-rose-500/20 text-rose-900 border-error/30 font-bold';
      case 'DISTRICT_AUTHORITY': return 'bg-emerald-500/20 text-emerald-900 border-secondary/30 font-bold';
      default: return 'bg-surface-container text-on-surface-variant border-outline-variant/40';
    }
  };

  const getRoleLabel = (r: UserRole) => {
    switch (r) {
      case 'CITIZEN': return 'Citizen account';
      case 'MP': return 'Member of Parliament account';
      case 'AUDITOR': return 'Auditor account';
      case 'ADMIN': return 'Administrator account';
      case 'DISTRICT_AUTHORITY': return 'District Authority account';
      default: return 'Not signed in';
    }
  };

  const handleLogout = () => {
    logout();
    setShowAccountDropdown(false);
    setShowNotifDropdown(false);
    router.push('/');
  };

  return (
    // `relative`, not `fixed`. The layout wraps this header together with
    // LegalNoticeBanner in one `sticky top-0` block, which is what keeps both
    // bars visible. When this element was `fixed` it detached from that block
    // and covered the banner, because `fixed` resolves against the viewport and
    // paints above an in-flow sibling regardless of document order.
    <header className="relative w-full shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      {/* ── Sovereign Amber Accent Bar ──────────────────────────── */}
      <div className="h-1 bg-amber-600 w-full" />

      {/* ── Utility Bar ────────────────────────────────────────── */}
      <div className="bg-surface-container-low border-b border-outline-variant/30 text-on-surface-variant">
        <div className="max-w-container-max mx-auto px-gutter-desktop h-9 flex items-center justify-between font-label-sm text-label-sm">
          <div className="hidden md:flex items-center gap-space-sm text-xs">
            {/*
              This read "Government Public Information Portal | भारत सरकार •
              Ministry of Statistics & Programme Implementation". A government
              identity in the chrome of a prototype, on a page that also
              claimed MoSPI as its copyright holder, is the clearest form the
              deception took: it is the first thing read and the least
              qualified. What the data actually is, is now what is said.
            */}
            <span>Research prototype — public parliament data</span>
            <span className="text-outline">|</span>
            <span>Not a government system</span>
          </div>

          <div className="flex items-center gap-space-md text-xs">
            {/* Session pill. Shows the real account, or the anonymous state. */}
            <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] bg-surface-container-lowest">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isAuthenticated ? 'bg-emerald-600' : 'bg-outline'
                }`}
              />
              <span className="text-on-surface-variant font-medium">
                {isAuthenticated ? 'Signed in as:' : 'Viewing anonymously:'}
              </span>
              <span className="font-bold text-primary truncate max-w-[150px]">
                {isAuthenticated ? displayName(user) : 'Public data only'}
              </span>
              <span className={`px-1 rounded text-[10px] uppercase tracking-wider border ${getRoleBadgeStyle(role)}`}>
                {role}
              </span>
            </div>

            {/* Font size controls */}
            <div className="flex items-center gap-space-xs">
              <button
                className="hover:text-on-surface transition-colors"
                type="button"
                title="Decrease font size"
                aria-label="Decrease page text size"
                aria-pressed={fontSize === 'sm'}
                onClick={() => setFontSize('sm')}
              >
                A-
              </button>
              <button
                className={`hover:text-on-surface transition-colors font-bold ${fontSize === 'md' ? 'text-on-surface' : ''}`}
                type="button"
                title="Default font size"
                aria-label="Use default page text size"
                aria-pressed={fontSize === 'md'}
                onClick={() => setFontSize('md')}
              >
                A
              </button>
              <button
                className="hover:text-on-surface transition-colors"
                type="button"
                title="Increase font size"
                aria-label="Increase page text size"
                aria-pressed={fontSize === 'lg'}
                onClick={() => setFontSize('lg')}
              >
                A+
              </button>
            </div>
            <span className="text-outline">|</span>
            {/* Multi-lingual Regional Languages Dropdown (9 Indian Languages) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowLangDropdown(!showLangDropdown);
                  setShowAccountDropdown(false);
                  setShowNotifDropdown(false);
                }}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-outline-variant/60 hover:bg-surface-container font-semibold text-primary transition-colors text-xs"
                title="Select Regional Language"
              >
                <span className="material-symbols-outlined text-[15px] text-amber-700">translate</span>
                <span className="font-bold">{currentLanguage.nativeLabel}</span>
                <span className="material-symbols-outlined text-[14px]">expand_more</span>
              </button>

              {showLangDropdown && (
                <div className="absolute right-0 mt-1.5 w-52 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-2xl z-50 p-1.5 space-y-1 text-xs">
                  <div className="px-2 py-1 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider border-b border-outline-variant/20 mb-1 flex items-center justify-between">
                    <span>{t('language', 'Regional Languages')}</span>
                    <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-900 font-mono">9 Languages</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto pr-0.5 space-y-0.5">
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => {
                          setLanguage(lang.code);
                          setShowLangDropdown(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          language === lang.code
                            ? 'bg-primary text-on-primary font-bold shadow-sm'
                            : 'hover:bg-surface-container text-on-surface'
                        }`}
                      >
                        <span className="font-medium">{lang.nativeLabel}</span>
                        <span className={`text-[10px] font-mono ${language === lang.code ? 'text-on-primary/80' : 'text-on-surface-variant'}`}>{lang.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Brand Bar ───────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest border-b border-outline-variant/30">
        <div className="max-w-container-max mx-auto px-gutter-desktop h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-space-md group">
            {/*
              The mark here was a photograph of India's national emblem,
              presented in a "Government of India Emblem" alt attribute. A
              state emblem on the chrome of an unofficial prototype claims
              official standing to anyone glancing at the page, so it is
              replaced with a neutral wordmark of this project's own
              coordinates-on-a-sheet figure. No state imagery is used.
            */}
            <div
              className="h-12 w-12 rounded-2xl shrink-0 bg-primary-container border border-outline-variant/30 shadow-sm flex items-center justify-center"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h9l7 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" className="stroke-primary" />
                <path d="M13 4v6a1 1 0 0 0 1 1h6" className="stroke-primary" />
                <path d="M6.5 17.5c1.6-3 4-4.5 7-4.5" className="stroke-amber-700" />
                <circle cx="6.5" cy="17.5" r="1.6" className="fill-amber-700" stroke="none" />
                <circle cx="13.5" cy="13" r="1.6" className="fill-primary" stroke="none" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span
                className="text-[20px] leading-none tracking-tight text-primary-container font-bold group-hover:text-primary transition-colors"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                Ojas Sentinel
              </span>
              <span className="text-xs text-on-surface-variant tracking-wide mt-1">
                Independent MPLADS research prototype
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-space-sm relative">
            {/*
              Account menu. This used to be a "Switch Perspective / Persona"
              dropdown with four buttons that assigned a visitor the MP,
              auditor, or district-officer identity outright. There is no
              account behind any of them, so those buttons are gone: the only
              way to hold a role is to sign in as an account that has it.
            */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowAccountDropdown(!showAccountDropdown);
                  setShowNotifDropdown(false);
                }}
                aria-haspopup="menu"
                aria-expanded={showAccountDropdown}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${getRoleBadgeStyle(role)}`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isAuthenticated ? 'account_circle' : 'person_outline'}
                </span>
                <span className="hidden md:inline">{getRoleLabel(role)}</span>
                <span className="md:hidden">{role}</span>
                <span className="material-symbols-outlined text-[14px]">expand_more</span>
              </button>

              {showAccountDropdown && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-72 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-xl z-50 p-2 space-y-1 text-xs"
                >
                  {isAuthenticated ? (
                    <>
                      <div className="px-2 py-2 border-b border-outline-variant/20 mb-1 space-y-1">
                        <p className="font-bold text-primary text-sm">{displayName(user)}</p>
                        <p className="text-on-surface-variant font-mono">{user?.username}</p>
                        <p className="text-[10px] text-on-surface-variant">
                          Role assigned by the server: <strong>{role}</strong>
                        </p>
                        {user?.state_code && (
                          <p className="text-[10px] text-on-surface-variant">
                            Jurisdiction: {user.state_code}
                            {user.district_name ? ` · ${user.district_name}` : ''}
                          </p>
                        )}
                      </div>

                      {role === 'CITIZEN' && (
                        <Link
                          href="/citizen"
                          onClick={() => setShowAccountDropdown(false)}
                          className="block text-center py-1.5 text-[11px] font-bold text-primary hover:bg-surface-container rounded-lg"
                        >
                          My requests &amp; submissions &rarr;
                        </Link>
                      )}
                      {role === 'MP' && (
                        <Link
                          href="/mp"
                          onClick={() => setShowAccountDropdown(false)}
                          className="block text-center py-1.5 text-[11px] font-bold text-primary hover:bg-surface-container rounded-lg"
                        >
                          Constituency portal &rarr;
                        </Link>
                      )}
                      {(role === 'AUDITOR' || role === 'ADMIN') && (
                        <Link
                          href="/anomalies"
                          onClick={() => setShowAccountDropdown(false)}
                          className="block text-center py-1.5 text-[11px] font-bold text-primary hover:bg-surface-container rounded-lg"
                        >
                          Review queue &rarr;
                        </Link>
                      )}

                      <button
                        onClick={handleLogout}
                        className="w-full text-center py-1.5 text-[11px] font-bold text-error hover:bg-error/10 rounded-lg"
                      >
                        Sign out
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="px-2 py-2 border-b border-outline-variant/20 mb-1">
                        <p className="font-bold text-primary">Not signed in</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">
                          Published oversight data is readable without an account. Submitting a
                          report or request, reviewing anomalies, and every write action require one.
                        </p>
                      </div>
                      <Link
                        href="/login"
                        onClick={() => setShowAccountDropdown(false)}
                        className="block text-center py-2 px-3 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary/90"
                      >
                        Sign in
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifDropdown(!showNotifDropdown);
                  setShowAccountDropdown(false);
                }}
                title="Live events"
                className="relative p-2 rounded-lg border border-outline-variant/60 hover:bg-surface-container transition-colors text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                {unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-error text-on-error rounded-full text-[10px] font-bold flex items-center justify-center animate-pulse">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifDropdown && (
                <div className="absolute right-0 mt-2 w-80 md:w-96 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-2xl z-50 p-3 space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-outline-variant/20">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px] text-primary">notifications_active</span>
                      <span className="text-xs font-bold text-primary">Live Events</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant font-mono">
                      {role} scope
                    </span>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {notifications.length === 0 ? (
                      <div className="py-4 text-center space-y-2">
                        <p className="text-xs text-on-surface-variant">
                          No events received in this session.
                        </p>
                        {/*
                          The previous version showed six fabricated alerts here
                          when the list was empty — including a "Critical Anomaly"
                          for a work ID that does not exist and an "MP
                          Recommendation" for an endorsement that never happened.
                          Those were indistinguishable from real events. Nothing
                          is shown now, and the reason is stated instead.
                        */}
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => markNotificationAsRead(n.id)}
                          className="p-2.5 rounded-lg border text-left transition-colors bg-surface-container-lowest border-primary/30 shadow-sm cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-[11px] font-bold text-primary truncate">{n.title}</span>
                            <span className="text-[9px] text-on-surface-variant font-mono shrink-0">{n.timestamp}</span>
                          </div>
                          <p className="text-[11px] text-on-surface-variant leading-snug">{n.description}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {notifications.length > 0 && (
                    <button
                      onClick={clearAllNotifications}
                      className="w-full text-center py-1 text-[10px] font-bold text-primary hover:bg-surface-container rounded-lg"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {role === 'CITIZEN' && (
              <Link
                href="/citizen"
                className="inline-flex items-center gap-space-xs px-3 py-2 bg-error text-on-error rounded-lg font-label-md text-xs font-bold hover:bg-error/90 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">add_task</span>
                <span className="hidden sm:inline">Submit Request</span>
              </Link>
            )}

            {role === 'MP' && (
              <Link
                href="/mp"
                className="inline-flex items-center gap-space-xs px-3 py-2 bg-amber-700 text-white rounded-lg font-label-md text-xs font-bold hover:bg-amber-800 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">account_balance</span>
                <span className="hidden sm:inline">My Funds</span>
              </Link>
            )}

            {(role === 'AUDITOR' || role === 'ADMIN') && (
              <Link
                href="/anomalies"
                className="inline-flex items-center gap-space-xs px-3 py-2 bg-error text-on-error rounded-lg font-label-md text-xs font-bold hover:bg-error/90 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">security</span>
                <span className="hidden sm:inline">Review Desk</span>
              </Link>
            )}

            {role === 'DISTRICT_AUTHORITY' && (
              <Link
                href="/district"
                className="inline-flex items-center gap-space-xs px-3 py-2 bg-secondary text-on-secondary rounded-lg font-label-md text-xs font-bold hover:bg-secondary/90 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span className="hidden sm:inline">District Desk</span>
              </Link>
            )}

            {!isAuthenticated && (
              <Link
                href="/login"
                className="inline-flex items-center gap-space-xs px-3 py-2 bg-primary text-on-primary rounded-lg font-label-md text-xs font-bold hover:bg-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">login</span>
                <span className="hidden sm:inline">Sign in</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Navigation Bar ──────────────────────────────────────── */}
      <div className="bg-primary-container">
        <div className="max-w-container-max mx-auto px-gutter-desktop h-12 flex items-center justify-between">
          <nav className="flex items-center gap-space-xs overflow-x-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-space-md py-2 rounded-lg transition-colors text-sm whitespace-nowrap inline-flex items-center gap-space-xs ${
                    isActive
                      ? 'bg-primary text-on-primary font-bold'
                      : 'font-label-md text-label-md text-primary-fixed hover:bg-primary/50 hover:text-on-primary'
                  }`}
                >
                  {item.label}
                  {item.badge && (
                    <span className="px-1.5 py-0.5 bg-secondary text-on-secondary rounded text-[10px] font-bold tracking-wider uppercase">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center font-label-sm text-label-sm text-primary-fixed-dim text-xs shrink-0">
            <span className="inline-block w-2 h-2 rounded-full bg-secondary-fixed mr-2" />
            <span className="hidden md:inline font-mono">
              {role === 'MP' && user?.constituency_name
                ? `Constituency: ${user.constituency_name}`
                : role === 'AUDITOR' || role === 'ADMIN'
                  ? 'Auditor session'
                  : role === 'DISTRICT_AUTHORITY' && user?.district_name
                    ? `District: ${user.district_name}`
                    : isAuthenticated
                      ? `${role} session`
                      : 'Public data only — sign in to submit or review'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
