'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Layers, 
  AlertTriangle, 
  Network, 
  TrendingDown, 
  Satellite, 
  Users, 
  SlidersHorizontal,
  FileCheck,
  ShieldCheck
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const NAV_ITEMS = [
  { name: 'National Overview', href: '/', icon: LayoutDashboard },
  { name: 'Works Explorer', href: '/works', icon: Layers },
  { name: 'Anomaly Intelligence', href: '/anomalies', icon: AlertTriangle, badge: 'L1-L3', auditorOnly: true },
  { name: 'Contractor Cartel Graph', href: '/contractors', icon: Network, badge: 'ML', auditorOnly: true },
  { name: 'MP & Fund Lapse Forecast', href: '/mp', icon: TrendingDown },
  { name: 'Citizen Ground Truth', href: '/citizen', icon: Users },
  { name: 'Administration & Pipeline', href: '/admin', icon: SlidersHorizontal }
];

export default function Sidebar() {
  const pathname = usePathname();
  const { role } = useAuth();

  const filteredNavItems = NAV_ITEMS.filter(
    (item) => !item.auditorOnly || (role === 'AUDITOR')
  );

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950/70 backdrop-blur flex flex-col justify-between p-4 shrink-0">
      <div className="space-y-6">
        <div>
          <p className="px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Intelligence Modules
          </p>
          <nav className="mt-2 space-y-1">
            {filteredNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                    isActive 
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-sm' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                    <span>{item.name}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-400">
            <Satellite className="w-3.5 h-3.5" />
            <span>Sentinel-2 Sync</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Multi-spectral NDBI diffing active. 1,482 works monitored across 543 constituencies.
          </p>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-sky-500 h-full w-[88%] rounded-full"></div>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>Pass: Track 113</span>
            <span>88% Verified</span>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800/80">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Audit Integrity Guardrail v3</span>
        </div>
        <p className="text-[10px] text-slate-400 mt-1 font-mono">
          Model: IsolationForest + Prophet + Louvain
        </p>
      </div>
    </aside>
  );
}
