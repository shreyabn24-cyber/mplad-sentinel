'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth, displayName } from '@/lib/auth';
import { MOCK_WORKS } from '@/lib/mockData';
import allRealMps from '@/lib/allRealMps.json';
import { useLanguage } from '@/lib/languageContext';

export default function MPProfilePage() {
  const { user, role, demands, endorseDemand, switchRole } = useAuth();
  const { t } = useLanguage();

  const isMp = role === 'MP';
  const [endorsingId, setEndorsingId] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  const mpInfo = (allRealMps as any[]).find(
    (m) => m.name === 'Akhilesh Yadav' || m.constituency === 'Kannauj'
  ) || { name: 'Akhilesh Yadav', constituency: 'Kannauj (PC 29)', state: 'UP', party: 'Samajwadi Party' };

  const totalAllocation = 25_00_00_000; // ₹25 Cr (5 Cr × 5 years)
  const sanctioned = 17_45_00_000;
  const spent = 14_20_00_000;
  const unspent = totalAllocation - spent;
  const utilPct = Math.round((spent / totalAllocation) * 100);

  const constituencyWorks = MOCK_WORKS.slice(0, 6);

  function cr(v: number): string {
    return `₹ ${(v / 1_00_00_000).toFixed(2)} Cr`;
  }

  async function handleEndorse(id: string) {
    setEndorsingId(id);
    await new Promise((r) => setTimeout(r, 800));
    endorseDemand(id);
    setEndorsingId(null);
  }

  if (!isMp) {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[50vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/15 text-amber-700 flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">account_balance</span>
          </div>
          <h1 className="text-2xl font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            MP Constituency Desk
          </h1>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            This desk is for the MP role. Please log in with the MP demo account to access the full dashboard.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
            <button
              onClick={() => switchRole('MP')}
              className="btn-primary text-sm inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white font-bold"
            >
              <span className="material-symbols-outlined text-[16px]">account_balance</span>
              Switch to MP Demo
            </button>
            <Link href="/login" className="btn-secondary text-sm inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant">
              <span className="material-symbols-outlined text-[16px]">login</span>
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* Photo Modal */}
      {photoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setPhotoModal(null)}
        >
          <div className="relative max-w-2xl w-full p-4" onClick={(e) => e.stopPropagation()}>
            <img src={photoModal} alt="Evidence" className="w-full rounded-2xl shadow-2xl" />
            <button
              className="absolute top-6 right-6 bg-white/20 rounded-full p-1.5 hover:bg-white/40"
              onClick={() => setPhotoModal(null)}
            >
              <span className="material-symbols-outlined text-white text-[24px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* ── MP Header Banner ──────────────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-on-surface-variant font-mono">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 font-bold border border-amber-600/30">
                {mpInfo.party || 'Samajwadi Party'}
              </span>
              <span>•</span>
              <span className="font-semibold text-primary">{mpInfo.constituency || 'Kannauj (PC 29)'}, {mpInfo.state || 'UP'}</span>
              <span>•</span>
              <span>Lok Sabha</span>
            </div>
            <h1
              className="text-2xl md:text-3xl font-bold text-primary tracking-tight flex items-center gap-2"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              <span className="material-symbols-outlined text-amber-700 text-[28px]">account_balance</span>
              {t('mp_header', 'MP Fund & Petition Desk')}
            </h1>
            <p className="text-xs text-on-surface-variant max-w-2xl">
              Signed in as <strong>{displayName(user)}</strong> · MP-ID: UP-KAN-029 · Kannauj Parliamentary Constituency
            </p>
          </div>

          <div className="text-right p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shrink-0">
            <span className="text-[11px] text-on-surface-variant block uppercase tracking-wider font-semibold">
              {t('fund_balance', 'Unspent MPLADS Balance')}
            </span>
            <div className="text-2xl font-mono font-bold text-amber-700">{cr(unspent)}</div>
            <span className="text-[10px] text-on-surface-variant">of {cr(totalAllocation)} total allocation</span>
          </div>
        </div>

        {/* ── Fund Overview Metrics Cards ───────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-outline-variant/20">
          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Total Allocation</div>
            <div className="text-lg font-mono font-bold text-primary">{cr(totalAllocation)}</div>
            <span className="text-[10px] text-on-surface-variant">5 Cr/year × 5 years</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Sanctioned</div>
            <div className="text-lg font-mono font-bold text-primary">{cr(sanctioned)}</div>
            <span className="text-[10px] text-on-surface-variant">{Math.round((sanctioned/totalAllocation)*100)}% of allocation</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Disbursed</div>
            <div className="text-lg font-mono font-bold text-emerald-700">{cr(spent)}</div>
            <span className="text-[10px] text-on-surface-variant">{utilPct}% utilized</span>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-600/20">
            <div className="text-[11px] text-amber-900 mb-1 font-semibold">Unspent</div>
            <div className="text-lg font-mono font-bold text-amber-800">{cr(unspent)}</div>
            <span className="text-[10px] text-amber-900">Allocation minus expenditure</span>
          </div>
        </div>

        {/* ── Fund Utilization Bar ─────────────────────────────── */}
        <div className="mt-4 space-y-1">
          <div className="flex justify-between text-xs text-on-surface-variant font-mono">
            <span>{t('fund_utilization', 'Fund Utilization Progress')}</span>
            <span>{utilPct}% Disbursed</span>
          </div>
          <div className="w-full h-2.5 bg-surface-container-high rounded-full overflow-hidden flex">
            <div
              style={{ width: `${utilPct}%` }}
              className="bg-emerald-600 h-full rounded-l-full"
              title="Disbursed"
            />
          </div>
          <div className="flex justify-between text-[10px] text-on-surface-variant">
            <span className="text-emerald-700 font-semibold">● Disbursed ({cr(spent)})</span>
            <span className="text-amber-800 font-semibold">● Unspent ({cr(unspent)})</span>
          </div>
        </div>
      </div>

      {/* ── Two Column Workspace ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        {/* ── Left Column: Citizen Petition Queue ──────────────── */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-700 text-[20px]">mark_email_unread</span>
              <h2
                className="text-base font-bold text-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {t('petition_inbox', 'Constituency Petitions & Citizen Requests')}
              </h2>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 font-bold">
              {demands.filter((d) => d.status === 'PENDING').length} pending
            </span>
          </div>

          <div className="space-y-3">
            {demands.length === 0 ? (
              <div className="text-center py-8 text-on-surface-variant text-xs">
                No citizen petitions have been submitted yet.
              </div>
            ) : (
              demands.map((demand) => (
                <div
                  key={demand.id}
                  className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low space-y-2.5"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container px-1.5 py-0.5 rounded">
                        {demand.workType}
                      </span>
                      <h3 className="text-xs font-bold text-primary mt-1">{demand.title}</h3>
                      <p className="text-[11px] text-on-surface-variant mt-0.5">{demand.description}</p>
                    </div>
                    <span className="text-xs font-mono font-bold text-on-surface shrink-0">
                      ₹{(demand.estimatedBudget / 100000).toFixed(1)}L
                      <span className="block text-[10px] font-normal text-on-surface-variant">estimated</span>
                    </span>
                  </div>

                  {/* Evidence Photo */}
                  {demand.photoDataUrl && (
                    <div className="mt-1">
                      <div className="text-[10px] text-on-surface-variant font-semibold mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">photo_camera</span>
                        Ground Evidence Photo
                      </div>
                      <img
                        src={demand.photoDataUrl}
                        alt="Evidence"
                        className="w-full h-24 object-cover rounded-lg cursor-zoom-in border border-outline-variant/30"
                        onClick={() => setPhotoModal(demand.photoDataUrl!)}
                      />
                    </div>
                  )}

                  {/* Voice Transcript */}
                  {demand.voiceTranscript && (
                    <div className="bg-surface-container p-2 rounded-lg flex items-start gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-primary mt-0.5">mic</span>
                      <p className="text-[11px] text-on-surface-variant italic">&ldquo;{demand.voiceTranscript}&rdquo;</p>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant pt-2 border-t border-outline-variant/20">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">person</span>
                      <strong>Citizen</strong>
                    </span>
                    <span>{demand.village}</span>
                    {demand.gpsCoords && (
                      <span className="font-mono text-[10px]">
                        {demand.gpsCoords.lat.toFixed(4)}°N, {demand.gpsCoords.lng.toFixed(4)}°E
                      </span>
                    )}
                    <span className="font-mono text-[10px]">
                      {new Date(demand.submittedAt).toLocaleDateString('en-IN')}
                    </span>
                    <span>{demand.id}</span>
                  </div>

                  {/* Action */}
                  <div className="w-full">
                    {demand.status === 'PENDING' ? (
                      <button
                        onClick={() => handleEndorse(demand.id)}
                        disabled={endorsingId === demand.id}
                        className="w-full py-2 px-3 bg-amber-700 text-white rounded-lg text-xs font-bold hover:bg-amber-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                        {endorsingId === demand.id ? 'Recommending...' : t('endorse_action', 'Endorse & Recommend for MPLADS Sanction')}
                      </button>
                    ) : demand.status === 'ENDORSED_BY_MP' ? (
                      <div className="w-full py-1.5 px-3 bg-emerald-500/10 border border-emerald-600/30 text-emerald-900 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-emerald-700">check_circle</span>
                        {t('endorsed_success', 'Recommended → Sent to District Magistrate')}
                      </div>
                    ) : (
                      <div className="w-full py-1.5 px-3 bg-secondary/10 border border-secondary/30 text-secondary rounded-lg text-xs font-bold flex items-center justify-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">verified</span>
                        {t('sanctioned_success', 'Administratively Sanctioned by District Collector')}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right Column: Constituency Works ─────────────────── */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">construction</span>
              <h2
                className="text-base font-bold text-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {t('works_progress', 'Constituency Works & Execution Progress')}
              </h2>
            </div>
            <Link
              href="/works"
              className="text-xs text-primary font-bold hover:underline inline-flex items-center gap-1"
            >
              <span>View All</span>
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>

          <div className="space-y-3">
            {constituencyWorks.map((work) => (
              <Link
                key={work.work_id}
                href={`/works/${work.work_id}`}
                className="block p-3.5 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container transition-colors space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] text-on-surface-variant">{work.work_code || work.work_id}</span>
                    <h3 className="text-xs font-bold text-primary mt-0.5 line-clamp-1">{work.work_title}</h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-primary shrink-0">
                    {work.sanction_amount != null
                      ? `₹ ${(work.sanction_amount / 100000).toFixed(1)}L`
                      : '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>Type: <strong className="text-on-surface">{work.work_type ?? '—'}</strong></span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    work.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-800' :
                    work.status === 'IN_PROGRESS' ? 'bg-blue-500/15 text-blue-800' :
                    'bg-surface-container-high text-on-surface'
                  }`}>
                    {work.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
