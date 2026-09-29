'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'PUBLIC' | 'CITIZEN' | 'MP' | 'AUDITOR' | 'DISTRICT_AUTHORITY' | 'ADMIN';

export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  full_name?: string | null;
  role: Exclude<UserRole, 'PUBLIC'>;
  state_code?: string | null;
  district_name?: string | null;
  constituency_name?: string | null;
  mp_id?: string | null;
  is_active: boolean;
  last_login?: string | null;
}

export interface CitizenDemand {
  id: string;
  title: string;
  description: string;
  village: string;
  workType: string;
  estimatedBudget: number;
  contactPhone: string;
  status: 'PENDING' | 'ENDORSED_BY_MP' | 'SANCTIONED_BY_DISTRICT';
  submittedAt: string;
  photoDataUrl?: string;
  voiceTranscript?: string;
  gpsCoords?: { lat: number; lng: number };
}

export interface SessionNotification {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  timestamp: string;
}

export interface AuthContextType {
  user: UserProfile | null;
  role: UserRole;
  isAuthenticated: boolean;
  isLoading: boolean;
  canReview: boolean;
  canAdminister: boolean;
  canSubmitCitizenRequests: boolean;

  demands: CitizenDemand[];
  addDemand: (demand: Omit<CitizenDemand, 'id' | 'status' | 'submittedAt'>) => void;
  endorseDemand: (id: string) => void;
  sanctionDemand: (id: string) => void;

  notifications: SessionNotification[];
  unreadNotificationCount: number;
  markNotificationAsRead: (id: string) => void;
  clearAllNotifications: () => void;

  loginAsDemo: (role: UserRole) => void;
  logout: () => void;
  switchRole: (role: UserRole) => void;
}

// ─── Demo Users ───────────────────────────────────────────────────────────────

const DEMO_USERS: Record<string, UserProfile> = {
  CITIZEN: {
    user_id: 'demo-citizen-001',
    username: 'citizen@demo',
    email: 'aarav.sharma@example.in',
    full_name: 'Aarav Sharma',
    role: 'CITIZEN',
    constituency_name: 'Kannauj',
    state_code: 'UP',
    district_name: 'Kannauj',
    is_active: true,
    last_login: new Date().toISOString(),
  },
  MP: {
    user_id: 'demo-mp-001',
    username: 'mp@demo',
    email: 'akhilesh.yadav@loksabha.nic.in',
    full_name: 'Akhilesh Yadav',
    role: 'MP',
    constituency_name: 'Kannauj (PC 29)',
    state_code: 'UP',
    district_name: 'Kannauj',
    mp_id: 'UP-KAN-029',
    is_active: true,
    last_login: new Date().toISOString(),
  },
  AUDITOR: {
    user_id: 'demo-auditor-001',
    username: 'auditor@demo',
    email: 'sk.ramanathan@cag.gov.in',
    full_name: 'S. K. Ramanathan, IA&AS',
    role: 'AUDITOR',
    is_active: true,
    last_login: new Date().toISOString(),
  },
  DISTRICT_AUTHORITY: {
    user_id: 'demo-dm-001',
    username: 'dm@demo',
    email: 'rajeshwar.rao@kannauj.nic.in',
    full_name: 'Dr. Rajeshwar Rao, IAS',
    role: 'DISTRICT_AUTHORITY',
    constituency_name: 'Kannauj',
    state_code: 'UP',
    district_name: 'Kannauj',
    is_active: true,
    last_login: new Date().toISOString(),
  },
};

// ─── Initial demo data ────────────────────────────────────────────────────────

const INITIAL_NOTIFICATIONS: SessionNotification[] = [
  {
    id: 'notif-001',
    category: 'ANOMALY',
    title: 'Critical Anomaly Detected',
    description: 'Work UP-RAM-001 flagged: Satellite NDBI delta < 0.05 despite 100% disbursement.',
    severity: 'CRITICAL',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-002',
    category: 'DEMAND',
    title: 'New Citizen Petition Received',
    description: 'Aarav Sharma from Kannauj submitted a demand for road repair.',
    severity: 'INFO',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-003',
    category: 'FUNDS',
    title: 'Fund Lapse Risk Alert',
    description: 'MH-NGP-004 — ₹18.4 Cr unspent with 23 days remaining in fiscal year.',
    severity: 'WARNING',
    timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
];

const INITIAL_DEMANDS: CitizenDemand[] = [
  {
    id: 'DEM-2024-00142',
    title: 'Road Repair — NH-91 Junction, Tirwa',
    description: 'The stretch near the railway gate has deep potholes causing accidents. Urgent repair needed before monsoon.',
    village: 'Tirwa',
    workType: 'ROAD',
    estimatedBudget: 2500000,
    contactPhone: '9876543210',
    status: 'PENDING',
    submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'DEM-2024-00117',
    title: 'Solar Street Lighting — Chakarpur Village',
    description: '14 solar lamps requested for the main village road. No night lighting causing safety issues for women.',
    village: 'Chakarpur',
    workType: 'SOLAR',
    estimatedBudget: 800000,
    contactPhone: '9123456789',
    status: 'ENDORSED_BY_MP',
    submittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'DEM-2024-00098',
    title: 'Community Health Sub-Centre Upgrade',
    description: 'The existing sub-centre at Jajauli lacks basic equipment. 4 new beds, BP machines, and diagnostic kit requested.',
    village: 'Jajauli',
    workType: 'HEALTH',
    estimatedBudget: 5000000,
    contactPhone: '9988776655',
    status: 'SANCTIONED_BY_DISTRICT',
    submittedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [demands, setDemands] = useState<CitizenDemand[]>(INITIAL_DEMANDS);
  const [notifications, setNotifications] = useState<SessionNotification[]>(INITIAL_NOTIFICATIONS);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('demo_role');
      if (saved && DEMO_USERS[saved]) {
        setUser(DEMO_USERS[saved]);
      }
      const savedDemands = localStorage.getItem('demo_demands');
      if (savedDemands) {
        setDemands(JSON.parse(savedDemands));
      }
    } catch {
      // ignore
    }
    setIsLoading(false);
  }, []);

  const loginAsDemo = useCallback((role: UserRole) => {
    if (role === 'PUBLIC') return;
    const profile = DEMO_USERS[role];
    if (!profile) return;
    setUser(profile);
    localStorage.setItem('demo_role', role);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('demo_role');
  }, []);

  const switchRole = useCallback((role: UserRole) => {
    loginAsDemo(role);
  }, [loginAsDemo]);

  const addDemand = useCallback((demand: Omit<CitizenDemand, 'id' | 'status' | 'submittedAt'>) => {
    const newDemand: CitizenDemand = {
      ...demand,
      id: `DEM-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };
    setDemands(prev => {
      const updated = [newDemand, ...prev];
      localStorage.setItem('demo_demands', JSON.stringify(updated));
      return updated;
    });
    setNotifications(prev => [
      {
        id: `notif-demand-${Date.now()}`,
        category: 'DEMAND',
        title: 'New Citizen Petition Received',
        description: `"${demand.title}" from ${demand.village} submitted successfully.`,
        severity: 'INFO',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const endorseDemand = useCallback((id: string) => {
    setDemands(prev => {
      const updated = prev.map(d =>
        d.id === id ? { ...d, status: 'ENDORSED_BY_MP' as const } : d
      );
      localStorage.setItem('demo_demands', JSON.stringify(updated));
      return updated;
    });
    setNotifications(prev => [
      {
        id: `notif-endorse-${Date.now()}`,
        category: 'DEMAND',
        title: 'MP Recommendation Sent',
        description: `Petition ${id} endorsed and forwarded to District Magistrate for sanction.`,
        severity: 'INFO',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const sanctionDemand = useCallback((id: string) => {
    setDemands(prev => {
      const updated = prev.map(d =>
        d.id === id ? { ...d, status: 'SANCTIONED_BY_DISTRICT' as const } : d
      );
      localStorage.setItem('demo_demands', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const markNotificationAsRead = useCallback((id: string) => {
    setReadIds(prev => new Set(prev).add(id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setReadIds(prev => {
      const next = new Set(prev);
      notifications.forEach(n => next.add(n.id));
      return next;
    });
  }, [notifications]);

  const role: UserRole = user?.role ?? 'PUBLIC';
  const unreadNotificationCount = notifications.filter(n => !readIds.has(n.id)).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAuthenticated: !!user,
        isLoading,
        canReview: role === 'AUDITOR' || role === 'ADMIN',
        canAdminister: role === 'ADMIN',
        canSubmitCitizenRequests: role === 'CITIZEN',
        demands,
        addDemand,
        endorseDemand,
        sanctionDemand,
        notifications,
        unreadNotificationCount,
        markNotificationAsRead,
        clearAllNotifications,
        loginAsDemo,
        logout,
        switchRole,
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

export function displayName(user: UserProfile | null): string {
  if (!user) return 'Signed out';
  return user.full_name?.trim() || user.username;
}
