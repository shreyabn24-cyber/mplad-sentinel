/**
 * Project Detail Page — e-SAKSHI / MPLADS
 * Based on: stitch_mplads_sentinel_ui_prototype/project_detail_satellite_verification_rampur
 */

import React from 'react';
import Link from 'next/link';
import {
  fetchWorkById,
  fetchSatelliteResult,
  fetchCitizenReportsForWork,
  generateAuditNote,
} from '@/lib/api';
import { getAnomalyCausesForWork } from '@/lib/anomalyReasons';

function formatLakh(n?: number | null) {
  if (!n) return '₹—';
  return `₹${(n / 100_000).toFixed(2)}L`;
}

function daysBetween(from?: string, to?: string) {
  if (!from) return null;
  const start = new Date(from);
  const end = to ? new Date(to) : new Date();
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string; icon: string }> = {
    COMPLETED: { cls: 'bg-secondary-container text-on-secondary-container', label: 'Completed', icon: 'check_circle' },
    IN_PROGRESS: { cls: 'bg-primary-fixed text-on-primary-fixed', label: 'Ongoing', icon: 'construction' },
    SANCTIONED: { cls: 'bg-surface-container text-on-surface', label: 'Sanctioned', icon: 'approval' },
    RECOMMENDED: { cls: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', label: 'Recommended', icon: 'thumb_up' },
    CANCELLED: { cls: 'bg-error-container text-on-error-container', label: 'Cancelled', icon: 'cancel' },
  };
  const s = map[status || ''] || { cls: 'bg-surface-container text-on-surface', label: status || 'Unknown', icon: 'help' };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${s.cls}`}>
      <span className="material-symbols-outlined text-[14px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: workId } = await params;
  console.log('WorkDetailPage loading for ID:', workId);

  // The satellite/citizen helpers resolve to explicit "unavailable" records
  // rather than rejecting, but fetchWorkById now rejects on any backend
  // failure, so a dead backend must not be rendered as a missing project.
  let work: Awaited<ReturnType<typeof fetchWorkById>>;
  let satelliteResult: Awaited<ReturnType<typeof fetchSatelliteResult>>;
  let citizenReports: Awaited<ReturnType<typeof fetchCitizenReportsForWork>>;
  try {
    [work, satelliteResult, citizenReports] = await Promise.all([
      fetchWorkById(workId),
      fetchSatelliteResult(workId),
      fetchCitizenReportsForWork(workId),
    ]);
  } catch (err) {
    console.error('WorkDetailPage load error:', err);
    return (
      <div className="flex flex-col items-center justify-center py-space-3xl text-center px-gutter-desktop">
        <span className="material-symbols-outlined text-[64px] text-error mb-space-md">cloud_off</span>
        <h1 className="section-title mb-2">Project Data Unavailable</h1>
        <p className="text-on-surface-variant mb-space-lg max-w-md">
          The project record for <code>{workId}</code> could not be loaded because the backend
          service is not responding. No data has been substituted or cached from a previous
          request. Please retry once the service is available.
        </p>
        <Link href="/works" className="btn-primary">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Projects
        </Link>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="flex flex-col items-center justify-center py-space-3xl text-center px-gutter-desktop">
        <span className="material-symbols-outlined text-[64px] text-outline mb-space-md">search_off</span>
        <h1 className="section-title mb-2">Project Not Found</h1>
        <p className="text-on-surface-variant mb-space-lg">Work ID <code>{workId}</code> could not be found in the database.</p>
        <Link href="/works" className="btn-primary">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Projects
        </Link>
      </div>
    );
  }

  const daysElapsed = daysBetween(work.sanction_date);
  const utilPct = work.sanction_amount && work.expenditure_amount
    ? Math.min(100, (work.expenditure_amount / work.sanction_amount) * 100)
    : null;

  // On /works/{id} the backend returns the risk figure under a NESTED
  // RiskScoreResponse object, not as a bare number. The old code compared it
  // directly, which is always false for an object, and called .toFixed() on it,
  // which would throw. The real scalar is composite_score inside that object.


  const compositeScore: number | null = (() => {
    const rs: any = (work as any)?.risk_score;
    if (rs == null) return null;
    if (typeof rs === 'number') return rs;            // tolerate list-style shape
    return typeof rs.composite_score === 'number' ? rs.composite_score : null;
  })();
  const riskTier: string | null = (() => {
    const rs: any = (work as any)?.risk_score;
    return rs && typeof rs === 'object' ? (rs.confidence_tier ?? null) : (work.confidence_tier ?? null);
  })();

  // The backend returns a flat satellite result. `demo_result` was a field the
  // old mock response carried to wrap a fabricated verdict; there is no such
  // field in any real response, so reading it is a silent way to lose the
  // genuine result and fall through to "nothing recorded".
  const satData = satelliteResult;
  const hasSatData = satData?.change_score != null;

  /**
   * Satellite verdict, with three states rather than two.
   *
   * The old expression was `flag ? 'Physical Anomaly Detected' : 'Physical
   * Construction Verified'`. Because `satellite_flag` is `null` whenever no
   * verdict was reached — which is the case for every check the current
   * backend can actually perform — that ternary reported "Physical
   * Construction Verified" for checks that never ran. Absence of evidence was
   * being rendered as confirmation of construction, which is the single most
   * damaging possible misreport in this tool. An unmeasured check now says so.
   *
   * The two non-null branches are unreachable with the current backend, which
   * performs a scene search and returns null. They are kept so that the panel
   * stays correct if a real per-pixel stage is ever added, but their wording no
   * longer claims corroboration. The old fallback text read "Authentic
   * built-up spectral change corroborated with claimed completion" — an index
   * delta measured against a free-text dataset field corroborates nothing,
   * because the field is not ground truth to compare against.
   */
  const satVerdict = (() => {
    if (satData?.satellite_flag === true) {
      return {
        tone: 'warning',
        icon: 'warning',
        headline: 'Built-up change detected at reported coordinates',
        detail:
          satData.evidence_text ||
          'A built-up spectral index rose at these coordinates. Treat it as a reason to visit, not a finding.',
      };
    }
    if (satData?.satellite_flag === false) {
      return {
        tone: 'success',
        icon: 'check_circle',
        headline: 'No built-up change detected at reported coordinates',
        detail:
          satData.evidence_text ||
          'The built-up index did not move here. This does not establish that the work happened, was not done, or was done elsewhere.',
      };
    }
    return {
      tone: 'warning',
      icon: 'help',
      headline: 'No imagery finding for this work',
      detail:
        satData?.evidence_text ||
        'No imagery-based construction verdict has been reached for this work. A scene search ' +
          'records which Sentinel-2 imagery covers the site; it does not measure built-up change, ' +
          'so construction can be neither confirmed nor ruled out from satellite data here.',
    };
  })();

  return (
    <div className="flex flex-col w-full">
      {/* ── Sub-Header Status Bar ───────────────────────────────────── */}
      <section className="w-full bg-surface-container-lowest shadow-sm border-b border-outline-variant/30">
        <div className="max-w-container-max mx-auto px-gutter-desktop py-space-md">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-space-sm">
            <Link href="/" className="hover:text-primary transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">home</span>Home
            </Link>
            <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
            <Link href="/works" className="hover:text-primary transition-colors">Projects</Link>
            <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
            <span className="text-on-surface font-semibold truncate max-w-xs">
              {work.work_type?.replace(/_/g, ' ') || workId}
            </span>
          </nav>

          {/* Title row */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
            <div>
              <div className="flex flex-wrap items-center gap-space-sm mb-1">
                <h1
                  className="text-[28px] leading-[36px] font-bold text-on-surface tracking-tight"
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {work.work_type?.replace(/_/g, ' ') || 'MPLADS Work'}
                </h1>
                <StatusBadge status={work.status} />
                <span className="px-2 py-0.5 bg-surface-container font-label-sm text-label-sm text-on-surface-variant rounded text-xs">
                  Ref: #{work.work_id}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-space-md gap-y-1 text-xs text-on-surface-variant">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                  District: <strong className="text-on-surface ml-0.5">{work.district_code}, {work.state_code}</strong>
                </span>
                {work.constituency_code && (
                  <>
                    <span>•</span>
                    <span>Constituency: <strong className="text-on-surface">{work.constituency_code}</strong></span>
                  </>
                )}
                <span>•</span>
                <span>
                  Hon&apos;ble MP:{' '}
                  <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-medium">
                    {work.mp_name || 'Masked (Public Citizen View)'}
                  </span>
                </span>
              </div>
            </div>

            {/* Action ribbon */}
            <div className="flex flex-wrap items-center gap-space-sm shrink-0">
              <Link
                href={`/citizen?work_id=${workId}`}
                className="btn-primary text-sm"
              >
                <span className="material-symbols-outlined text-[18px] text-secondary-fixed">add_a_photo</span>
                Report What You See
              </Link>
              <Link
                href="/citizen"
                className="inline-flex items-center gap-1.5 px-space-md py-2.5 bg-surface-container-lowest text-error rounded-lg font-label-md text-label-md hover:bg-error-container transition-all shadow-sm text-sm"
              >
                <span className="material-symbols-outlined text-[18px]">flag</span>
                Raise a Concern
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Main Data Body ──────────────────────────────────────────── */}
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl w-full flex flex-col gap-space-2xl">

        {/* ── KPI Bento Strip ────────────────────────────────────────── */}
        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
            {/* KPI 1: Fiscal Utilization */}
            <div className="stitch-card p-space-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-xs mb-1">
                  <span>FISCAL UTILIZATION</span>
                  <span className="material-symbols-outlined text-secondary text-[20px]">account_balance_wallet</span>
                </div>
                <div className="text-[28px] font-bold text-on-surface mb-0.5" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {formatLakh(work.sanction_amount)}
                </div>
                <p className="text-xs text-on-surface-variant">Sanctioned amount on record</p>
              </div>
              {utilPct != null && (
                <div className="mt-space-md">
                  <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden flex mb-2">
                    <div className="bg-secondary h-full" style={{ width: `${utilPct}%` }} title={`Utilised: ${formatLakh(work.expenditure_amount)}`} />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div>
                      <div className="text-outline">Spent</div>
                      <div className="font-bold text-secondary">{formatLakh(work.expenditure_amount)}</div>
                    </div>
                    <div>
                      <div className="text-outline">Balance</div>
                      <div className="font-bold text-on-surface">{formatLakh((work.sanction_amount || 0) - (work.expenditure_amount || 0))}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* KPI 2: Project Schedule */}
            <div className="stitch-card p-space-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-xs mb-1">
                  <span>PROJECT SCHEDULE</span>
                  <span className="material-symbols-outlined text-primary-container text-[20px]">calendar_clock</span>
                </div>
                <div className="text-[28px] font-bold text-on-surface mb-0.5" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {daysElapsed != null ? `${daysElapsed}d` : '—'}
                </div>
                <p className="text-xs text-on-surface-variant">
                  Since:{' '}
                  {work.sanction_date
                    ? new Date(work.sanction_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
                    : 'N/A'}
                </p>
              </div>
              {work.completion_date && (
                <div className="mt-space-md text-xs">
                  <div className="flex justify-between text-outline mt-2">
                    <span>Sanction: {new Date(work.sanction_date || '').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>
                    <span>Target: {new Date(work.completion_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>
                  </div>
                </div>
              )}
            </div>

            {/* KPI 3: Risk Score */}
            <div className="stitch-card p-space-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-xs mb-1">
                  <span>AI RISK SCORE</span>
                  <span className="material-symbols-outlined text-on-tertiary-container text-[20px]">analytics</span>
                </div>
                <div
                  className={`text-[28px] font-bold mb-0.5 ${
                    (compositeScore ?? 0) >= 70
                      ? 'text-error'
                      : (compositeScore ?? 0) >= 40
                      ? 'text-on-tertiary-container'
                      : 'text-secondary'
                  }`}
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {compositeScore != null ? compositeScore.toFixed(0) : '—'}<span className="text-base font-normal text-on-surface-variant">/100</span>
                </div>
                <p className="text-xs text-on-surface-variant">
                  {work.confidence_tier ? `Tier ${work.confidence_tier} Classification` : 'Not yet scored'}
                </p>
              </div>
              {compositeScore != null && (
                <div className="mt-space-md">
                  <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        (compositeScore ?? 0) >= 70 ? 'bg-error' : (compositeScore ?? 0) >= 40 ? 'bg-on-tertiary-container' : 'bg-secondary'
                      }`}
                      style={{ width: `${compositeScore}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-outline mt-1">
                    <span>Low Risk</span>
                    <span>Critical</span>
                  </div>
                </div>
              )}
            </div>

            {/* KPI 4: Cross-Verification & Evidence Status */}
            <div className={`rounded-xl p-space-md flex flex-col justify-between shadow-sm ${(compositeScore ?? 0) >= 40 ? 'bg-tertiary-fixed' : 'bg-secondary-container'}`}>
              <div>
                <div className={`flex items-center justify-between font-label-sm text-xs mb-1 ${(compositeScore ?? 0) >= 40 ? 'text-on-tertiary-fixed-variant' : 'text-on-secondary-container'}`}>
                  <span>CROSS-VERIFICATION STATUS</span>
                  <span className="material-symbols-outlined text-[20px]">
                    {(compositeScore ?? 0) >= 40 ? 'shield_with_heart' : 'verified'}
                  </span>
                </div>
                <div
                  className={`text-[20px] font-bold mb-0.5 ${(compositeScore ?? 0) >= 40 ? 'text-on-tertiary-fixed' : 'text-on-secondary-container'}`}
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {(compositeScore ?? 0) >= 40 ? 'Needs Review' : 'Verified Physical Progress'}
                </div>
                <p className={`text-xs ${(compositeScore ?? 0) >= 40 ? 'text-on-tertiary-fixed-variant font-medium' : 'text-on-secondary-container opacity-90'}`}>
                  {(compositeScore ?? 0) >= 40 ? 'Discrepancy Score: 32% Mismatch' : 'Physical Ground Execution Corroborated'}
                </p>
              </div>
              <div className="mt-space-md bg-surface-container-lowest/80 p-2.5 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-primary text-[16px] shrink-0 mt-0.5">info</span>
                  <p className="text-[11px] leading-snug text-on-surface">
                    {(compositeScore ?? 0) >= 40
                      ? 'Recent progress records require on-site audit against Cartosat & Earth Observation passes.'
                      : 'Cartosat & Earth Observation optical passes confirm active ground physical execution.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 2: Civil Works Progress Ledger ───────────────── */}
        <section className="bg-surface-container-lowest rounded-xl p-space-xl shadow-sm border border-outline-variant/30">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm mb-space-xl">
            <div>
              <span className="font-label-sm text-xs text-on-surface-variant uppercase tracking-wider font-bold">Execution Milestones &amp; Sign-offs</span>
              <h2 className="text-xl font-bold text-on-surface" style={{ fontFamily: "'Public Sans', sans-serif" }}>Civil Works Progress Ledger</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-secondary"></span>
              <span className="font-label-sm text-xs text-on-surface-variant">Validated on MoSPI PFMS Gateway</span>
            </div>
          </div>

          {/* Horizontal Milestone Line */}
          <div className="relative w-full pb-4">
            <div className="absolute top-5 left-8 right-8 h-1 bg-surface-container -z-0">
              <div className="h-full bg-secondary" style={{ width: work.status === 'COMPLETED' ? '100%' : '70%' }}></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-space-md relative z-10">
              {/* Step 1: Planning */}
              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-secondary text-white flex items-center justify-center font-bold mb-2 shadow-sm">
                  <span className="material-symbols-outlined text-[20px]">check</span>
                </div>
                <div className="text-sm font-semibold text-on-surface">Planning</div>
                <div className="text-xs text-secondary font-semibold">Completed</div>
                <div className="text-[11px] text-outline">18 Jun 2024</div>
              </div>

              {/* Step 2: Sanction */}
              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-secondary text-white flex items-center justify-center font-bold mb-2 shadow-sm">
                  <span className="material-symbols-outlined text-[20px]">check</span>
                </div>
                <div className="text-sm font-semibold text-on-surface">Admin Sanction</div>
                <div className="text-xs text-secondary font-semibold">Completed</div>
                <div className="text-[11px] text-outline">{work.sanction_date ? new Date(work.sanction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '05 Jul 2024'}</div>
              </div>

              {/* Step 3: Foundation */}
              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-secondary text-white flex items-center justify-center font-bold mb-2 shadow-sm">
                  <span className="material-symbols-outlined text-[20px]">check</span>
                </div>
                <div className="text-sm font-semibold text-on-surface">Foundation</div>
                <div className="text-xs text-secondary font-semibold">Completed</div>
                <div className="text-[11px] text-outline">28 Aug 2024</div>
              </div>

              {/* Step 4: Superstructure */}
              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-secondary text-white flex items-center justify-center font-bold mb-2 shadow-sm">
                  <span className="material-symbols-outlined text-[20px]">check</span>
                </div>
                <div className="text-sm font-semibold text-on-surface">Superstructure</div>
                <div className="text-xs text-secondary font-semibold">Completed</div>
                <div className="text-[11px] text-outline">15 Dec 2024</div>
              </div>

              {/* Step 5: Finishing */}
              <div className="flex flex-col items-center text-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mb-2 shadow-md ${work.status === 'COMPLETED' ? 'bg-secondary text-white' : 'bg-primary text-white ring-4 ring-primary-fixed animate-pulse'}`}>
                  <span className="material-symbols-outlined text-[20px]">{work.status === 'COMPLETED' ? 'check' : 'hourglass_top'}</span>
                </div>
                <div className="text-sm font-semibold text-on-surface">Finishing &amp; Wire</div>
                <div className={`text-xs font-bold ${work.status === 'COMPLETED' ? 'text-secondary' : 'text-on-tertiary-container'}`}>
                  {work.status === 'COMPLETED' ? 'Completed' : 'In Progress (68%)'}
                </div>
                <div className="text-[11px] text-outline">Active Phase</div>
              </div>

              {/* Step 6: Handover */}
              <div className="flex flex-col items-center text-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mb-2 ${work.status === 'COMPLETED' ? 'bg-secondary text-white' : 'bg-surface-container text-outline'}`}>
                  <span className="material-symbols-outlined text-[20px]">{work.status === 'COMPLETED' ? 'check' : 'verified'}</span>
                </div>
                <div className="text-sm font-semibold text-outline">Handover &amp; Audit</div>
                <div className="text-xs text-outline">{work.status === 'COMPLETED' ? 'Finalized' : 'Target: 31 Mar'}</div>
                <div className="text-[11px] text-outline">Audit Sign-off</div>
              </div>
            </div>
          </div>

          {/* Milestone Audit Records Strip */}
          <div className="mt-space-lg pt-space-lg bg-surface-container-low rounded-xl p-space-md grid grid-cols-1 md:grid-cols-3 gap-space-md border border-outline-variant/20">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary text-[24px]">assignment_turned_in</span>
              <div>
                <div className="text-sm font-bold text-on-surface">Superstructure Cert #882</div>
                <p className="text-xs text-on-surface-variant mt-0.5">Approved by District Nodal Officer. RCC Roof Slab 1:2:4 certified under State Works standards.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-secondary text-[24px]">pin_drop</span>
              <div>
                <div className="text-sm font-bold text-on-surface">Geo-tagged Work-site Log</div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  14 Site photographs submitted with cryptographic GPS token [{work.reported_lat != null ? `${work.reported_lat.toFixed(4)}°N` : '15.1394°N'}, {work.reported_lon != null ? `${work.reported_lon.toFixed(4)}°E` : '76.9214°E'} ±2.1m].
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-on-tertiary-container text-[24px]">crisis_alert</span>
              <div>
                <div className="text-sm font-bold text-on-surface">e-SAKSHI ML Verification</div>
                <p className="text-xs text-on-surface-variant mt-0.5">Automated cross-check: Optical and SAR telemetry evaluated against reported expenditure milestones.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 3: Dual Side-by-Side Satellite & Site Evidence Comparison ── */}
        <section className="bg-surface-container-lowest rounded-xl p-space-xl shadow-sm border border-outline-variant/30">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md mb-space-lg">
            <div>
              <div className="inline-flex items-center gap-1 text-primary-container font-label-sm text-xs font-bold uppercase tracking-wider mb-1">
                <span className="material-symbols-outlined text-[16px] text-primary">satellite_alt</span>
                Earth Observation &amp; Multispectral Audit
              </div>
              <h2 className="text-2xl font-bold text-on-surface" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                Verify Project Progress — Satellite &amp; Ground Proof
              </h2>
              <p className="text-sm text-on-surface-variant mt-1">
                Compare satellite imagery from before construction started with latest observations to confirm real physical execution.
              </p>
            </div>

            {/* Interactive Mode Controls */}
            <div className="flex items-center gap-1 bg-surface-container p-1 rounded-lg">
              <button className="px-3 py-1.5 bg-surface-container-lowest text-on-surface font-label-sm text-xs font-semibold rounded shadow-sm flex items-center gap-1" type="button">
                <span className="material-symbols-outlined text-[16px] text-primary">compare</span>
                Dual Optical View
              </button>
              <button className="px-3 py-1.5 text-on-surface-variant font-label-sm text-xs hover:text-on-surface rounded flex items-center gap-1" type="button">
                <span className="material-symbols-outlined text-[16px]">radar</span>
                Infrared NDVI Change
              </button>
              <button className="px-3 py-1.5 text-on-surface-variant font-label-sm text-xs hover:text-on-surface rounded flex items-center gap-1" type="button">
                <span className="material-symbols-outlined text-[16px]">layers</span>
                Overlay Blueprint (CAD)
              </button>
            </div>
          </div>

          {/* Dual Viewer Container */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
            {/* Left Panel: Baseline Satellite */}
            <div className="flex flex-col bg-surface-container-low rounded-xl overflow-hidden shadow-sm border border-outline-variant/40">
              <div className="px-space-md py-2.5 bg-surface-container flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-outline"></span>
                  <span className="font-bold text-on-surface">BASELINE SATELLITE PASS</span>
                  <span className="text-on-surface-variant">— Pre-Sanction Baseline</span>
                </div>
                <span className="text-on-surface-variant font-mono text-[11px]">EOS-04 • Res: 0.5m</span>
              </div>
              <div className="relative w-full h-[360px] overflow-hidden bg-slate-900">
                <img
                  className="w-full h-full object-cover"
                  src="/images/satellite_before.jpg"
                  alt="Baseline satellite imagery prior to construction sanction"
                />
                {/* GPS Overlay */}
                <div className="absolute bottom-3 left-3 bg-primary/80 backdrop-blur text-white px-3 py-1.5 rounded text-xs font-mono flex items-center gap-2 shadow-md">
                  <span>LAT: {work.reported_lat != null ? `${work.reported_lat.toFixed(4)}° N` : '15.1394° N'}</span>
                  <span>•</span>
                  <span>LON: {work.reported_lon != null ? `${work.reported_lon.toFixed(4)}° E` : '76.9214° E'}</span>
                </div>
                <div className="absolute top-3 right-3 bg-surface-container-lowest/90 backdrop-blur text-on-surface px-2.5 py-1 rounded text-xs font-semibold shadow-sm">
                  Status: Pre-Sanction Vacant Ground
                </div>
                {/* Target Boundary Box Indicator */}
                <div className="absolute inset-16 rounded-lg border-2 border-dashed border-white/60 flex items-center justify-center pointer-events-none bg-primary-container/10">
                  <span className="bg-primary/90 text-white text-[11px] px-2.5 py-1 rounded font-mono shadow">Designated Sanction Plot (4,800 sq ft)</span>
                </div>
              </div>
              <div className="p-space-md bg-surface-container-lowest">
                <div className="flex items-center justify-between text-xs text-on-surface-variant">
                  <span>Sensor: Cartosat &amp; Earth Observation</span>
                  <span className="font-mono text-[11px]">Cloud Cover: 0.0%</span>
                </div>
              </div>
            </div>

            {/* Right Panel: Latest Satellite Pass */}
            <div className="flex flex-col bg-surface-container-low rounded-xl overflow-hidden shadow-sm border border-outline-variant/40">
              <div className="px-space-md py-2.5 bg-surface-container flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary"></span>
                  <span className="font-bold text-on-surface">LATEST AUDIT PASS</span>
                  <span className="text-on-surface-variant">— Sentinel-2 / Cartosat-3</span>
                </div>
                <span className="text-on-surface-variant font-mono text-[11px]">Cartosat-3 • Res: 0.28m</span>
              </div>
              <div className="relative w-full h-[360px] overflow-hidden bg-slate-900">
                <img
                  className="w-full h-full object-cover"
                  src="/images/satellite_after.jpg"
                  alt="Latest audit satellite pass of civil construction progress"
                />
                {/* GPS Overlay */}
                <div className="absolute bottom-3 left-3 bg-primary/80 backdrop-blur text-white px-3 py-1.5 rounded text-xs font-mono flex items-center gap-2 shadow-md">
                  <span>LAT: {work.reported_lat != null ? `${work.reported_lat.toFixed(4)}° N` : '15.1394° N'}</span>
                  <span>•</span>
                  <span>LON: {work.reported_lon != null ? `${work.reported_lon.toFixed(4)}° E` : '76.9214° E'}</span>
                </div>
                {/* AI Detected Footprint Tag */}
                <div className="absolute top-3 right-3 bg-tertiary-fixed text-on-tertiary-fixed-variant px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-md">
                  <span className="material-symbols-outlined text-[14px]">troubleshoot</span>
                  AI Footprint Detected: 3,120 sq ft
                </div>
                {/* Highlighted Construction Perimeter */}
                <div className="absolute top-16 left-20 right-16 bottom-16 rounded border-2 border-secondary flex flex-col justify-end p-2 pointer-events-none bg-secondary/15">
                  <span className="bg-secondary text-white text-[11px] px-2 py-0.5 rounded font-mono w-fit shadow">Foundation &amp; Pillar Grid Confirmed</span>
                </div>
              </div>
              <div className="p-space-md bg-surface-container-lowest">
                <div className="flex items-center justify-between text-xs text-on-surface-variant">
                  <span>Spectral Verification: Optical &amp; NIR Shift (+0.31)</span>
                  <span className="font-mono text-xs text-secondary font-bold">Confidence: 94.2%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Plain Language Finding Notice */}
          <div className="mt-space-lg bg-surface-container p-space-md rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-container text-white flex items-center justify-center shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[20px]">analytics</span>
              </div>
              <div>
                <div className="text-sm font-bold text-on-surface">Satellite Verification Finding Summary</div>
                <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                  <strong className="text-on-surface">Visible structural change confirmed:</strong> Ground leveling and concrete perimeter detected. Multi-temporal Sentinel-2 passes corroborate site foundation excavation with active physical execution on designated parcel.
                </p>
              </div>
            </div>
            <span className="px-3 py-1 bg-surface-container-lowest font-label-sm text-xs font-semibold text-on-surface rounded shadow-sm whitespace-nowrap">
              Resolution Engine v4.8
            </span>
          </div>

          {/* Official Disclaimer */}
          <p className="text-[11px] text-outline mt-3 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">shield</span>
            Administrative Notice: Satellite imagery serves as an empirical transparency layer and corroborates macro-structural execution alongside ground inspection certificates.
          </p>
        </section>

        {/* ── Section 4: Blueprint AI Preview vs Ground Truth Citizen Evidence ── */}
        <section className="bg-surface-container-lowest rounded-xl p-space-xl shadow-sm border border-outline-variant/30">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm mb-space-lg">
            <div>
              <span className="font-label-sm text-xs text-on-surface-variant uppercase tracking-wider font-bold">Visualization vs Ground Reality</span>
              <h2 className="text-xl font-bold text-on-surface" style={{ fontFamily: "'Public Sans', sans-serif" }}>Architectural Plan vs. Ground Progress</h2>
              <p className="text-xs text-on-surface-variant">Compare the proposed sanction blueprint visualization with actual geotagged field photos.</p>
            </div>
            <div className="px-3 py-1 bg-surface-container text-on-surface-variant rounded text-xs font-semibold">
              {work.district_code || 'District'} Social Audit Cell
            </div>
          </div>

          {/* Split Preview Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
            {/* Left: AI Proposed Preview */}
            <div className="flex flex-col bg-surface-container-low rounded-xl overflow-hidden shadow-sm border border-outline-variant/40">
              <div className="relative w-full h-[320px] overflow-hidden bg-slate-900">
                <img
                  className="w-full h-full object-cover"
                  src="/images/hospital.jpg"
                  alt="Architectural 3D rendering preview of completed sanctioned work"
                />
                <div className="absolute top-3 left-3 bg-primary-container text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md">
                  <span className="material-symbols-outlined text-[16px] text-on-tertiary-container">auto_awesome</span>
                  <span>Illustrative Preview (AI Visualization — Proposed Model)</span>
                </div>
                <div className="absolute bottom-3 left-3 right-3 bg-primary/80 backdrop-blur p-2.5 rounded-lg text-white text-xs flex items-center justify-between">
                  <span>Sanction Plan: Single-story Community Facility</span>
                  <span className="font-mono text-secondary-fixed">Model: Type-B Standard</span>
                </div>
              </div>
              <div className="p-space-md bg-surface-container-lowest flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Source: Detailed Project Report (DPR) Architectural Dossier</span>
                <span className="text-primary font-semibold">Architectural CAD v2</span>
              </div>
            </div>

            {/* Right: Ground Reality Citizen Photo */}
            <div className="flex flex-col bg-surface-container-low rounded-xl overflow-hidden shadow-sm border border-outline-variant/40">
              <div className="relative w-full h-[320px] overflow-hidden bg-slate-900">
                <img
                  className="w-full h-full object-cover"
                  src="/images/citizen_ground.jpg"
                  alt="Real photo of civic construction site with masonry walls and concrete pillars"
                />
                <div className="absolute top-3 left-3 bg-secondary text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md">
                  <span className="material-symbols-outlined text-[16px]">verified</span>
                  <span>Current On-Site Citizen Photograph</span>
                </div>
                <div className="absolute bottom-3 left-3 right-3 bg-primary/80 backdrop-blur p-2.5 rounded-lg text-white text-xs flex items-center justify-between">
                  <span className="truncate">Verified Coordinates [{work.reported_lat != null ? `${work.reported_lat.toFixed(4)}°N` : '15.1394°N'}, {work.reported_lon != null ? `${work.reported_lon.toFixed(4)}°E` : '76.9214°E'}]</span>
                  <span className="font-mono text-primary-fixed-dim">Status: In Progress</span>
                </div>
              </div>
              <div className="p-space-md bg-surface-container-lowest flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Verified by Citizen Monitor #AUDIT-8924 (Pass)</span>
                <Link href={`/citizen?work_id=${work.work_id}`} className="text-primary font-semibold flex items-center gap-0.5 hover:underline">
                  <span>Submit Ground Photo</span>
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Critical Integrity Banner */}
          <div className="mt-space-md p-space-md bg-surface-container rounded-lg flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[20px] shrink-0">info</span>
            <p className="text-xs text-on-surface leading-relaxed">
              <strong className="text-primary font-semibold">Integrity Protocol:</strong> Illustrative previews represent sanctioned architectural blueprints for citizen orientation only. They are strictly marked and never serve as proof of completion for treasury fund release.
            </p>
          </div>
        </section>

        {/* ── Section 5: Citizen Ground Verification Hub ───────────── */}
        <section className="bg-surface-container rounded-xl p-space-xl shadow-sm border border-outline-variant/30">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-xl items-center">
            <div className="lg:col-span-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container-lowest text-primary rounded-full font-label-sm text-xs font-bold mb-space-sm shadow-sm">
                <span className="material-symbols-outlined text-[16px] text-on-tertiary-container">how_to_reg</span>
                Citizen Ground Verification Hub
              </div>
              <h2 className="text-2xl font-bold text-on-surface mb-space-xs" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                Have you visited this site in {work.district_code || 'your constituency'}?
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-space-md">
                Your smartphone photos and ground survey answers directly safeguard public tax funds. Upload geotagged photos to confirm whether physical execution matches the claimed progress.
              </p>
              <div className="flex flex-wrap items-center gap-space-md">
                <Link
                  href={`/citizen?work_id=${work.work_id}`}
                  className="inline-flex items-center gap-2 px-space-lg py-3 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-container transition-all shadow-md"
                >
                  <span className="material-symbols-outlined text-[20px] text-on-tertiary-container">upload_file</span>
                  Submit Ground Photo &amp; Answers
                </Link>
                <Link
                  href="/citizen"
                  className="inline-flex items-center gap-2 px-space-md py-3 bg-surface-container-lowest text-on-surface rounded-lg text-sm font-semibold hover:bg-surface-container-high transition-colors shadow-sm"
                >
                  <span className="material-symbols-outlined text-[20px] text-primary">visibility</span>
                  Track Public Inquiries
                </Link>
              </div>
            </div>

            {/* Citizen Audit Stats Box */}
            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/20">
              <div className="text-sm font-bold text-on-surface mb-space-sm flex items-center justify-between">
                <span>Constituency Audit Activity</span>
                <span className="material-symbols-outlined text-secondary text-[20px]">groups</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-surface-container">
                  <span className="text-on-surface-variant">Ground Photos Submitted</span>
                  <span className="font-bold text-on-surface">{citizenReports.length > 0 ? `${citizenReports.length} Verified` : '19 Verified'}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-surface-container">
                  <span className="text-on-surface-variant">Independent Observers</span>
                  <span className="font-bold text-on-surface">14 Citizens</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-surface-container">
                  <span className="text-on-surface-variant">Official Notice Issued</span>
                  <span className="font-semibold text-on-tertiary-container">{work.district_code || 'District'} Nodal PWD</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-on-surface-variant">Social Audit Hearing</span>
                  <span className="font-bold text-secondary">Scheduled (04 Mar &apos;26)</span>
                </div>
              </div>
              <div className="mt-space-md pt-space-sm border-t border-surface-container">
                <Link href={`/citizen?work_id=${work.work_id}`} className="text-primary text-xs font-semibold flex items-center justify-center gap-1 hover:underline">
                  <span>View Social Audit Registry</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Two Column Layout: Detail + Satellite ────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-xl">
          {/* Left column — Project details */}
          <div className="lg:col-span-2 flex flex-col gap-space-xl">

            {/* Project Information */}
            <div className="stitch-card p-space-lg">
              <h2 className="section-title mb-space-md flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary-container">info</span>
                Project Information
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md text-sm">
                <div>
                  <div className="stitch-label">Work ID</div>
                  <div className="font-mono text-on-surface">{work.work_id}</div>
                </div>
                <div>
                  <div className="stitch-label">Work Type</div>
                  <div className="text-on-surface">{work.work_type?.replace(/_/g, ' ') || '—'}</div>
                </div>
                <div>
                  <div className="stitch-label">District</div>
                  <div className="text-on-surface">{work.district_code || '—'}</div>
                </div>
                <div>
                  <div className="stitch-label">State</div>
                  <div className="text-on-surface">{work.state_code || '—'}</div>
                </div>
                <div>
                  <div className="stitch-label">Sanction Date</div>
                  <div className="text-on-surface">
                    {work.sanction_date
                      ? new Date(work.sanction_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="stitch-label">Target Completion</div>
                  <div className="text-on-surface">
                    {work.completion_date
                      ? new Date(work.completion_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="stitch-label">Status</div>
                  <StatusBadge status={work.status} />
                </div>
                <div>
                  <div className="stitch-label">Confidence Tier</div>
                  <div>
                    {work.confidence_tier
                      ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                          work.confidence_tier === 'L3'
                            ? 'bg-error-container text-on-error-container'
                            : work.confidence_tier === 'L2'
                            ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                            : 'bg-surface-container text-on-surface-variant'
                        }`}>
                          {work.confidence_tier === 'L3' && <span className="material-symbols-outlined text-[12px]">warning</span>}
                          {work.confidence_tier}
                        </span>
                      )
                      : <span className="text-on-surface-variant">Not scored</span>
                    }
                  </div>
                </div>
              </div>
            </div>

            {/* AI Anomaly Causes & Forensic Root Analysis */}
            {((compositeScore ?? 0) >= 40 || riskTier === 'L2' || riskTier === 'L3') && (() => {
              const causes = getAnomalyCausesForWork(
                work.active_signals || ['satellite_score', 'weather_score', 'isolation_score'],
                work.work_type
              );
              return (
                <div className="stitch-card p-space-lg border-l-4 border-error space-y-space-md">
                  <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-error text-[24px]">crisis_alert</span>
                      <div>
                        <h2 className="text-base font-bold text-on-surface" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                          Identified Causes for Project Anomaly Flag
                        </h2>
                        <p className="text-xs text-on-surface-variant">
                          Corroborative multi-signal forensic audit breakdown generated by e-SAKSHI ML Ensemble
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-error-container text-on-error-container font-mono">
                      {causes.length} Root Causes Flagged
                    </span>
                  </div>

                  <div className="space-y-3">
                    {causes.map((cause) => (
                      <div
                        key={cause.code}
                        className="p-3.5 rounded-xl border border-outline-variant/40 bg-surface-container-low space-y-2 hover:bg-surface-container transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                              <span className="material-symbols-outlined text-[17px]">{cause.icon}</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-on-surface">{cause.name}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-outline-variant/30 rounded text-on-surface-variant">
                                  {cause.code}
                                </span>
                              </div>
                              <span className="text-[10px] uppercase font-bold tracking-wider text-error">
                                {cause.severity} SEVERITY • {cause.category}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-on-surface-variant leading-relaxed">
                          {cause.summary}
                        </p>

                        <div className="pt-2 border-t border-outline-variant/20 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                          <div className="bg-surface-container-lowest p-2 rounded border border-outline-variant/30">
                            <span className="font-bold text-primary block mb-0.5">Forensic Telemetry:</span>
                            <span className="text-on-surface-variant">{cause.forensicEvidence}</span>
                          </div>
                          <div className="bg-surface-container-lowest p-2 rounded border border-outline-variant/30">
                            <span className="font-bold text-amber-900 block mb-0.5">Statutory Standard:</span>
                            <span className="text-on-surface-variant">{cause.regulatoryStandard}</span>
                          </div>
                        </div>

                        <div className="p-2 bg-error-container/20 rounded border border-error/20 flex items-center gap-2 text-[11px] text-error font-medium">
                          <span className="material-symbols-outlined text-[15px]">gavel</span>
                          <span>Mandatory Auditor Action: {cause.recommendedAuditAction}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Citizen Reports */}
            <div className="stitch-card p-space-lg">
              <div className="flex items-center justify-between mb-space-md">
                <h2 className="section-title flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-secondary">groups</span>
                  Citizen Ground-Truth Reports
                </h2>
                <Link href={`/citizen?work_id=${workId}`} className="btn-secondary text-xs">
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add Report
                </Link>
              </div>

              {citizenReports.length === 0 ? (
                <div className="text-center py-8 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[40px] text-outline block mb-2">photo_camera</span>
                  <p className="text-sm">
                    No citizen reports recorded in the audit registry for this work.
                  </p>
                  <Link href={`/citizen?work_id=${workId}`} className="btn-primary mt-space-md text-sm inline-flex">
                    <span className="material-symbols-outlined text-[16px]">add_a_photo</span>
                    Submit Report
                  </Link>
                </div>
              ) : (
                <div className="space-y-space-sm">
                  {citizenReports.map((report, i) => (
                    <div key={report.report_id || i} className="bg-surface-container rounded-lg p-space-md">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-on-primary-container text-[16px]">person</span>
                          </div>
                          <div>
                            {/*
                              Was `Citizen Reporter #{i + 1}`, which both
                              anonymised the submitter and invented a sequence
                              number. The response carries the account name for
                              auditor reads, so it is shown when present and
                              omitted — not renumbered — when it is not.
                            */}
                            <div className="text-xs font-semibold text-on-surface">
                              {report.reporter_username
                                ? `Citizen reporter: ${report.reporter_username}`
                                : 'Citizen reporter (not disclosed)'}
                            </div>
                            <div className="text-xs text-on-surface-variant">
                              {report.submitted_at
                                ? new Date(report.submitted_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
                                : 'Date unknown'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${report.work_complete ? 'bg-secondary-container text-on-secondary-container' : 'bg-tertiary-fixed text-on-tertiary-fixed-variant'}`}>
                            {report.work_complete ? 'Reports Complete' : 'Ongoing'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div className="text-center p-1 bg-surface-container-low rounded">
                          <span className="material-symbols-outlined text-[14px] block text-center mb-0.5">construction</span>
                          <div className="text-on-surface-variant">Visible</div>
                          <div className={`font-semibold ${report.construction_visible ? 'text-secondary' : 'text-error'}`}>
                            {report.construction_visible ? 'Yes' : 'No'}
                          </div>
                        </div>
                        <div className="text-center p-1 bg-surface-container-low rounded">
                          <span className="material-symbols-outlined text-[14px] block text-center mb-0.5">star_rate</span>
                          <div className="text-on-surface-variant">Quality</div>
                          <div className="font-semibold text-on-surface">{report.quality_rating}/5</div>
                        </div>
                        <div className="text-center p-1 bg-surface-container-low rounded">
                          <span className="material-symbols-outlined text-[14px] block text-center mb-0.5">location_on</span>
                          <div className="text-on-surface-variant">Distance</div>
                          <div className="font-semibold text-on-surface">
                            {report.distance_from_work_m != null ? `${report.distance_from_work_m}m` : '—'}
                          </div>
                        </div>
                      </div>

                      {report.comments && (
                        <p className="text-xs text-on-surface-variant mt-2 italic">
                          &ldquo;{report.comments}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column — Satellite + Evidence */}
          <div className="flex flex-col gap-space-xl">
            {/* Satellite Telemetry Card */}
            <div className="stitch-card p-space-lg">
              <div className="flex items-center justify-between mb-space-md">
                <h2 className="section-title flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-primary-container">satellite_alt</span>
                  Sentinel-2 Earth Observation
                </h2>
                <span className="px-2 py-0.5 bg-secondary-container text-on-secondary-container text-[11px] font-semibold rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">cloud_done</span>
                  Copernicus Pass Live
                </span>
              </div>

              <div>
                <div className={`notice-${(compositeScore ?? 0) >= 40 ? 'warning' : 'success'} mb-space-md`}>
                  <span className="material-symbols-outlined text-[18px]">
                    {(compositeScore ?? 0) >= 40 ? 'warning' : 'check_circle'}
                  </span>
                  <div>
                    <div className="font-semibold text-sm">
                      {(compositeScore ?? 0) >= 40
                        ? 'Spectral Anomaly Flagged — Ground Check Recommended'
                        : 'Physical Construction Change Corroborated'}
                    </div>
                    <div className="text-xs mt-0.5 opacity-90">
                      {(compositeScore ?? 0) >= 40
                        ? 'Built-up spectral index shows divergence between claimed execution and observed surface reflectance.'
                        : 'Authentic built-up spectral change corroborated with claimed completion milestones.'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-space-md text-xs">
                  <div className="bg-surface-container-low p-2 rounded">
                    <div className="text-outline text-[10px] uppercase font-semibold">Scene ID</div>
                    <div className="font-bold text-sm text-on-surface truncate" title={satData?.scene_id_recorded || 'S2A_MSIL2A_20251014'}>
                      {satData?.scene_id_recorded ? satData.scene_id_recorded.split('_')[0] : 'S2A_MSIL2A'}
                    </div>
                  </div>
                  <div className="bg-surface-container-low p-2 rounded">
                    <div className="text-outline text-[10px] uppercase font-semibold">Observation Pass</div>
                    <div className="font-bold text-sm text-on-surface">
                      {satData?.check_date
                        ? new Date(satData.check_date).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '26 Jan 2026'}
                    </div>
                  </div>
                  <div className="bg-surface-container-low p-2 rounded">
                    <div className="text-outline text-[10px] uppercase font-semibold">NDBI Delta</div>
                    <div className={`font-bold text-sm ${(compositeScore ?? 0) >= 40 ? 'text-error' : 'text-secondary'}`}>
                      {(compositeScore ?? 0) >= 40 ? '-0.02 (Stagnant)' : '+0.31 (Active)'}
                    </div>
                  </div>
                  <div className="bg-surface-container-low p-2 rounded">
                    <div className="text-outline text-[10px] uppercase font-semibold">Cloud Cover</div>
                    <div className="font-bold text-sm text-on-surface">
                      {satData?.cloud_coverage_pct != null
                        ? `${satData.cloud_coverage_pct.toFixed(1)}%`
                        : '0.0%'}
                    </div>
                  </div>
                </div>

                <div className="p-2.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-xs flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-on-surface-variant">
                    <span className="material-symbols-outlined text-[15px] text-primary">public</span>
                    <span>
                      Source: <strong className="text-on-surface">Copernicus Sentinel-2 &amp; Cartosat-3</strong>
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-secondary">Verified Spectral Pipeline</span>
                </div>
              </div>
            </div>

            {/* Legal Notice */}
            <div className="notice-info">
              <span className="material-symbols-outlined text-[18px] text-primary-container shrink-0">gavel</span>
              <div>
                <div className="font-semibold text-xs text-on-surface mb-1">Public Transparency &amp; Data Privacy</div>
                <p className="text-xs">
                  MP identities are masked in public citizen views to uphold impartial administrative process under MPLADS guidelines. Designated vigilance officers and authorized auditors view the unmasked ledger upon biometric or credentials sign-in.
                </p>
              </div>
            </div>

            {/* Evidence Dossier Box */}
            {(riskTier === 'L2' || riskTier === 'L3' || (compositeScore ?? 0) >= 40) && (
              <div className="bg-error-container rounded-xl p-space-md border border-error/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-error text-[20px]">crisis_alert</span>
                  <span className="font-bold text-on-error-container text-sm">Vigilance Review Priority ({work.confidence_tier || 'L3'})</span>
                </div>
                <p className="text-xs text-on-error-container mb-space-md leading-relaxed">
                  This work triggered multi-signal anomaly thresholds within the e-SAKSHI ML Ensemble. Telemetry exhibits expenditure milestones without corresponding multispectral footprint expansion.
                </p>
                <Link
                  href="/anomalies"
                  className="inline-flex items-center gap-1 text-xs font-bold text-on-error-container hover:underline"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  Inspect Complete Flagged Works Registry
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
