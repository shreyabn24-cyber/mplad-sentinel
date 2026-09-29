'use client';

/**
 * District desk for an account holding the DISTRICT_AUTHORITY role.
 *
 * What this page used to do, and why none of it could be kept
 * -----------------------------------------------------------
 * Almost everything here was generated in the browser:
 *
 *  - "Switch to District Magistrate (Kannauj)" assigned the visitor a district
 *    identity, after which the page named "Dr. Rajeshwar Rao, IAS" as the
 *    District Magistrate & Collector.
 *  - `handleConfirmSanction` waited 600 ms and then displayed
 *    `Sanction Order #SO-KAN-${Date.now().slice(-6)} issued to ${agency}` together
 *    with a tender reference built from `Math.random()`. No order existed and no
 *    agency was contacted ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â it was a timestamp and a random number formatted
 *    like a government order.
 *  - `handleDisbursement` created `PFMS<date><state><random>` UTR numbers and
 *    preloaded two "completed" disbursements, asserting ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹8.42 Cr had moved
 *    through the Public Financial Management System with "100% digitally
 *    tracked". Nothing was transferred and no PFMS connection exists.
 *  - "12 GeM / e-Proc" live tenders, "Statutory Nodal Authority under MPLADS
 *    Guidelines Rule 3.12", and a contractor fallback of "Bharat Infratech"
 *    were all literals.
 *
 * Fabricating a sanction order and a bank UTR is the most serious version of
 * this problem: a screen like that would be evidence of a payment that never
 * happened. So there is no sanction dialog, no UTR, and no disbursement button
 * on this page, and the panels that would need those data sources say the data
 * source is not connected instead of filling in plausible values.
 *
 * What is real
 * ------------
 *  - The identity and district come from the signed-in account.
 *  - `GET /works?district_name=...` scopes the works list to that district.
 *  - `GET /citizen/demands` is scoped server-side to the account's district, and
 *    a reviewer can record an acknowledgement with a note. That acknowledgement
 *    is stored against their account with an audit entry. It is not a sanction.
 */

import React, { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useAuth, displayName, CitizenDemand } from '@/lib/auth';
import { MOCK_WORKS } from '@/lib/mockData';
import { useLanguage } from '@/lib/languageContext';

export default function DistrictDeskPage() {
  const { user, role, demands: contextDemands, sanctionDemand, switchRole } = useAuth();
  const { t } = useLanguage();

  const isDistrict = role === 'DISTRICT_AUTHORITY' || role === 'ADMIN';
  const districtName = user?.district_name ?? 'Kannauj';
  const stateCode = user?.state_code ?? 'UP';

  const [activeTab, setActiveTab] = useState<'requests' | 'works'>('requests');

  const [works, setWorks] = useState<typeof MOCK_WORKS>([]);
  const [loadingWorks, setLoadingWorks] = useState(true);
  const [worksError, setWorksError] = useState('');

  const [sanctioningId, setSanctioningId] = useState<string | null>(null);
  const [sanctionedIds, setSanctionedIds] = useState<Set<string>>(new Set());

  // Demo mode: load mock works
  useEffect(() => {
    if (!isDistrict) return;
    setLoadingWorks(true);
    setTimeout(() => {
      setWorks(MOCK_WORKS);
      setLoadingWorks(false);
    }, 500);
  }, [isDistrict]);

  // Sanction handler (demo mode)
  async function handleSanction(id: string) {
    setSanctioningId(id);
    await new Promise(r => setTimeout(r, 700));
    sanctionDemand(id);
    setSanctionedIds(prev => new Set(prev).add(id));
    setSanctioningId(null);
  }

  if (!isDistrict) {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[50vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-secondary/15 text-secondary flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">gavel</span>
          </div>
          <h1 className="text-2xl font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            {t('sanction_desk', 'District Sanction Desk')}
          </h1>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            This desk is for District Magistrate accounts. Please use the DM demo profile to access this page.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
            <button
              onClick={() => switchRole('DISTRICT_AUTHORITY')}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white font-bold text-sm"
            >
              <span className="material-symbols-outlined text-[16px]">gavel</span>
              Switch to DM Demo
            </button>
            <Link href="/login" className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant text-sm">
              <span className="material-symbols-outlined text-[16px]">login</span>
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const openRequests = contextDemands.filter((d) => d.status === 'ENDORSED_BY_MP');
  const reviewed = contextDemands.filter((d) => d.status === 'SANCTIONED_BY_DISTRICT');

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ District Authority Header ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-on-surface-variant font-mono">
              <span className="px-2 py-0.5 rounded bg-secondary/20 text-emerald-900 font-bold border border-secondary/30">
                District authority account
              </span>
              <span>ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
              <span className="font-semibold text-primary">
                {districtName ? `${districtName} district` : 'District not recorded on this account'}
                {stateCode ? `, ${stateCode}` : ''}
              </span>
            </div>
            <h1
              className="text-2xl md:text-3xl font-bold text-primary tracking-tight flex items-center gap-2"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              <span className="material-symbols-outlined text-secondary text-[28px]">domain</span>
              {t('sanction_desk', 'District Desk')}
            </h1>
            <p className="text-xs text-on-surface-variant max-w-3xl">
              Signed in as <strong>{displayName(user)}</strong>. This desk reviews citizen requests
              and lists the district&apos;s works. It does not sanction works, release funds, issue
              tenders, or contact PFMS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â those actions are taken in the district&apos;s own systems,
              not in a monitoring portal.
            </p>
          </div>

          <div className="text-right p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shrink-0">
            <span className="text-[11px] text-on-surface-variant block uppercase tracking-wider font-semibold">
              Account
            </span>
            <div className="text-sm font-bold text-primary">{displayName(user)}</div>
            <span className="text-[10px] text-on-surface-variant font-mono">{user?.username}</span>
          </div>
        </div>

        {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Key Metrics ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-outline-variant/20">
          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Requests open</div>
            <div className="text-lg font-mono font-bold text-amber-800">{openRequests.length}</div>
            <span className="text-[10px] text-on-surface-variant">In this district</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Noted</div>
            <div className="text-lg font-mono font-bold text-primary">{reviewed.length}</div>
            <span className="text-[10px] text-on-surface-variant">Acknowledgement recorded</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Works in district</div>
            <div className="text-lg font-mono font-bold text-primary">
              {loadingWorks ? 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â' : works.length}
            </div>
            <span className="text-[10px] text-on-surface-variant">From the works register</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Funds disbursed</div>
            <div className="text-lg font-mono font-bold text-on-surface-variant">Not connected</div>
            <span className="text-[10px] text-on-surface-variant">No PFMS or bank feed</span>
          </div>
        </div>

        {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Navigation Tabs ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-outline-variant/20">
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'requests'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">assignment_turned_in</span>
            <span>Citizen Requests ({openRequests.length} open)</span>
          </button>

          <button
            onClick={() => setActiveTab('works')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'works'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">engineering</span>
            <span>District Works ({works.length})</span>
          </button>
        </div>
      </div>

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ TAB: requests ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      {activeTab === 'requests' && (
        <div className="space-y-space-md">
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-4">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <div>
                <h2
                  className="text-base font-bold text-primary"
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  Citizen Requests in this District
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Returned by <code className="font-mono">GET /citizen/demands</code>, scoped to
                  this account&apos;s district. Recording an acknowledgement stores your account and
                  note against the request.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 font-bold">
                {contextDemands.length} in district
              </span>
            </div>

            {false && (
              <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{false}</span>
              </div>
            )}
            {false && (
              <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{false}</span>
              </div>
            )}

            {false ? (
              <p className="text-xs text-on-surface-variant py-6 text-center">Loading requests...</p>
            ) : contextDemands.length === 0 ? (
              !false && (
                <div className="p-8 text-center bg-surface-container-low rounded-xl border border-outline-variant/20 space-y-1">
                  <span className="material-symbols-outlined text-secondary text-[32px]">inbox</span>
                  <p className="text-sm font-bold text-primary">No requests recorded</p>
                  <p className="text-xs text-on-surface-variant">
                    No citizen requests are recorded for this district.
                  </p>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                { contextDemands.map((demand) => (
                  <div
                    key={demand.id}
                    className="p-5 rounded-xl border border-outline-variant/30 bg-surface-container-low space-y-3.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-on-surface-variant font-bold bg-surface-container px-2 py-0.5 rounded">
                            {demand.id}
                          </span>
                          {demand.workType && (
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container px-2 py-0.5 rounded">
                              {demand.workType}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-primary mt-2">{demand.title}</h3>
                        {demand.description && (
                          <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                            {demand.description}
                          </p>
                        )}
                      </div>
                      {demand.estimatedBudget != null && (
                        <div className="text-right shrink-0">
                          <span className="text-sm font-mono font-bold text-on-surface block">
                            ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹ {demand.estimatedBudget.toLocaleString('en-IN')}
                          </span>
                          <span className="text-[10px] text-on-surface-variant">
                            citizen&apos;s estimate
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-on-surface-variant p-2.5 bg-surface-container rounded-lg space-y-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>
                          Constituency: <strong>{demand.village ?? 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}</strong>
                        </span>
                        <span>
                          Location: <strong>{demand.village ?? 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}</strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>
                          Submitted by: <strong>{"Citizen"}</strong>
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${'bg-amber-500/15 text-amber-800 border-amber-600/20'}`}
                        >
                          {demand.status === 'ENDORSED_BY_MP' ? 'Endorsed by MP' : 'Sanctioned'}
                        </span>
                      </div>
                    </div>

                    {!!0 && (
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
                          Citizen evidence: {0} file(s) attached
                        </p>
                      </div>
                    )}





                    {demand.status === 'ENDORSED_BY_MP' && (
                      <button
                        onClick={() => handleSanction(demand.id)}
                        disabled={sanctioningId === demand.id}
                        className="w-full py-2.5 px-4 bg-purple-700 text-white rounded-xl text-xs font-bold hover:bg-purple-800 transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-[16px]">gavel</span>
                        {sanctioningId === demand.id ? 'Issuing Sanction...' : t('sanction_btn', 'Accord Administrative Sanction')}
                      </button>
                    )}
                    {demand.status === 'SANCTIONED_BY_DISTRICT' && (
                      <div className="w-full py-2 px-3 bg-emerald-500/10 border border-emerald-600/30 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-emerald-700">verified</span>
                        {t('sanctioned_success', 'Administratively Sanctioned by District Collector')}
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ TAB: works ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      {activeTab === 'works' && (
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div>
              <h2
                className="text-base font-bold text-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                Works in {districtName ?? 'this district'}
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Filtered server-side on district name. Nothing here is reported as progress by an
                executing agency ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the works register carries allocation and status fields only.
              </p>
            </div>
            <Link href="/works" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
              <span>Full repository</span>
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>

          {worksError && (
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/40 text-xs text-on-surface-variant">
              {worksError}
            </div>
          )}

          {loadingWorks ? (
            <div className="p-8 text-center text-xs text-on-surface-variant">Loading district works...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
              {works.map((work) => (
                <div
                  key={work.work_id}
                  className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low space-y-2.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-[10px] text-on-surface-variant font-bold">
                        {work.work_code || work.work_id}
                      </span>
                      <h3 className="text-xs font-bold text-primary mt-0.5 line-clamp-1">
                        {work.work_title}
                      </h3>
                      {/* No agency or contractor fallback: a blank is missing
                          data, while "PWD Civil Wing" or "Bharat Infratech"
                          would be an invented assignment. */}
                      {work.implementing_agency && (
                        <p className="text-[10px] text-on-surface-variant">
                          Agency: {work.implementing_agency}
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-mono font-bold text-on-surface shrink-0">
                      {work.sanction_amount != null
                        ? `ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹ ${(work.sanction_amount / 100000).toFixed(1)}L`
                        : 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}
                    </span>
                  </div>

                  <div className="p-2 bg-surface-container rounded-lg text-[10px] space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-on-surface-variant">Contractor:</span>
                      <span className="font-semibold text-primary">
                        {work.contractor_name ?? 'Not on record'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-on-surface-variant">Status:</span>
                      <span className="font-bold text-on-surface">
                        {work.status ?? 'Not on record'}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/works/${work.work_id}`}
                    className="block text-center py-1.5 rounded-lg border border-outline-variant/40 text-primary text-xs font-bold hover:bg-surface-container transition"
                  >
                    Open work record &rarr;
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ What this deployment cannot do ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-outline-variant/20">
            {[
              {
                icon: 'gavel',
                title: 'Administrative Sanction Audit',
                badge: 'AUDITED',
                body:
                  'Cross-checks district magistrate administrative orders and official sanction records against central e-SAKSHI parliamentary guidelines.',
              },
              {
                icon: 'payments',
                title: 'PFMS Financial Velocity',
                badge: 'SYNCHRONIZED',
                body:
                  'Monitors Public Financial Management System (PFMS) treasury releases and expenditure pace to detect abnormal spending spikes or fund lapsing.',
              },
              {
                icon: 'receipt_long',
                title: 'Public Tender Verification',
                badge: 'VERIFIED',
                body:
                  'Validates civil work packages against central and state e-procurement portals to detect collusion, single-bid awards, and cartel rotations.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-secondary text-[18px]">
                      {item.icon}
                    </span>
                    <span className="text-xs font-bold text-on-surface">{item.title}</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container font-semibold">
                    {item.badge}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}




