'use client';

/**
 * Authority Vigilance Portal — e-SAKSHI / MPLADS
 * Based on: stitch_mplads_sentinel_ui_prototype/authority_vigilance_evidence_chain_desktop
 * Auditor portal for reviewing anomalies and submitting verdicts.
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { fetchAnomalies, fetchAnomalySummary, fetchLapseRisk, reviewAnomaly } from '@/lib/api';
import { getAnomalyCausesForWork } from '@/lib/anomalyReasons';
import { STATES } from '@/lib/states';

interface AnomalyCard {
  work_id: string;
  district_name: string;
  state_code: string;
  work_type?: string;
  work_description?: string;
  sanction_amount?: number;
  composite_score?: number;
  confidence_tier?: string;
  active_signals?: string[];
  mp_id_masked?: string;
  sanction_date?: string;
  completion_date?: string;
  [key: string]: unknown;
}

function formatLakh(n?: number | null) {
  if (!n) return '₹—';
  return `₹${(n / 100_000).toFixed(1)}L`;
}

function TierTag({ tier }: { tier?: string }) {
  if (!tier) return null;
  if (tier === 'L3') return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-error-container text-on-error-container rounded-full text-xs font-bold">
      <span className="material-symbols-outlined text-[14px]">warning</span>L3 Critical
    </span>
  );
  if (tier === 'L2') return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded-full text-xs font-bold">
      <span className="material-symbols-outlined text-[14px]">visibility</span>L2 High-Confidence
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-container text-on-surface-variant rounded-full text-xs font-bold">
      L1 Statistical
    </span>
  );
}

function ReviewModal({
  anomaly,
  onClose,
  onSubmit,
}: {
  anomaly: AnomalyCard;
  onClose: () => void;
  onSubmit: (verdict: string, notes: string) => Promise<void>;
}) {
  const [verdict, setVerdict] = useState('VERIFIED');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) { setError('Please provide review notes.'); return; }
    setLoading(true);
    setError('');
    try {
      await onSubmit(verdict, notes);
      onClose();
    } catch {
      setError('Failed to submit review. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 backdrop-blur-sm p-4">
      <div className="bg-surface-container-lowest rounded-xl shadow-2xl max-w-lg w-full p-space-xl border border-outline-variant/50">
        <div className="flex items-center justify-between mb-space-lg">
          <h3 className="section-title flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary-container">rate_review</span>
            Auditor Review — {anomaly.work_id}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="bg-surface-container rounded-lg p-space-md mb-space-lg text-sm">
          <div className="flex items-center justify-between mb-2">
            <TierTag tier={anomaly.confidence_tier} />
            <span className="font-mono text-xs">Score: {anomaly.composite_score?.toFixed(0) ?? '—'}/100</span>
          </div>
          <div className="text-on-surface font-semibold">{anomaly.work_type?.replace(/_/g, ' ') || 'Work'}</div>
          <div className="text-xs text-on-surface-variant mt-0.5">{anomaly.district_name}, {anomaly.state_code}</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-space-md">
          <div>
            <label className="stitch-label">Audit Verdict</label>
            <select className="stitch-select text-sm" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
              <option value="VERIFIED">VERIFIED — reviewer confirmed irregularity on inspection</option>
              <option value="DISMISSED">DISMISSED — reviewer found no irregularity</option>
              <option value="REFERRED">REFERRED — flagged for a human to follow up</option>
              <option value="PENDING_INVESTIGATION">PENDING — Further Investigation Required</option>
            </select>
            <p className="text-[11px] text-on-surface-variant mt-1.5">
              These are the reviewer&apos;s own words about a record they have looked at, stored
              against the work with the reviewing account and the time. Nothing is escalated anywhere
              by choosing one: there is no receiving authority behind this form, and &ldquo;VERIFIED&rdquo;
              records that a reviewer looked and agreed, not that any irregularity has been
              established by this system. The values must match{' '}
              <code className="font-mono">AuditorVerdict</code> in{' '}
              <code className="font-mono">backend/schemas/schemas.py</code>.
            </p>
          </div>
          <div>
            <label className="stitch-label">Review Notes <span className="text-error">*</span></label>
            <textarea
              className="stitch-input text-sm min-h-[100px] resize-none"
              placeholder="Provide detailed audit notes, findings, and recommended actions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              required
            />
          </div>
          {error && <div className="notice-error text-xs">{error}</div>}
          <div className="flex gap-space-sm pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 text-sm justify-center">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 text-sm justify-center disabled:opacity-60">
              {loading ? (
                <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[18px]">send</span>
              )}
              {loading ? 'Submitting...' : 'Submit Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AuthorityPortalPage() {
  const { role, canReview } = useAuth();

  const [anomalies, setAnomalies] = useState<AnomalyCard[]>([]);
  // `null` means the summary could not be fetched. The KPI strip then renders
  // "—" instead of a fabricated 0, which would read as "no anomalies found".
  const [summary, setSummary] = useState<{ L1: number; L2: number; L3: number } | null>(null);
  const [lapseRisks, setLapseRisks] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyCard | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [tierFilter, setTierFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'l3' | 'l2' | 'lapse'>('all');

  // An L3 tab selected as a reviewer, then a re-hydration that resolves the
  // account to a non-reviewer, would otherwise leave a tab active that the tab
  // bar no longer renders.
  useEffect(() => {
    if (!canReview && activeTab === 'l3') setActiveTab('all');
  }, [canReview, activeTab]);

  // The list itself is public (`viewer` on the backend), so this runs for
  // everyone. Only the review action and the L3 tab are gated on `canReview`.
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      // These three now reject on failure rather than substituting mock
      // anomalies or hardcoded tier counts.
      const [anomalyData, summaryData, lapseData] = await Promise.all([
        fetchAnomalies({ tier: tierFilter || undefined, state_code: stateFilter || undefined }),
        fetchAnomalySummary(),
        fetchLapseRisk(),
      ]);
      setAnomalies(anomalyData as unknown as AnomalyCard[]);
      setSummary(summaryData);
      setLapseRisks(lapseData);
      setLoading(false);
    };
    load().catch(() => {
      setAnomalies([]);
      setSummary(null);
      setLapseRisks([]);
      setLoadError(
        'Could not reach the anomaly service. Detection counts and lists are unavailable — ' +
          'no figures are shown rather than reporting stale or placeholder values.'
      );
      setLoading(false);
    });
  }, [tierFilter, stateFilter]);

  const handleReview = async (verdict: string, notes: string) => {
    if (!selectedAnomaly) return;
    // Defence in depth. The control is already hidden below, and
    // `POST /anomalies/{work_id}/review` enforces `ROLES_AUDIT` server-side, so
    // this is a third check rather than the one that protects the endpoint.
    if (!canReview) return;
    await reviewAnomaly(selectedAnomaly.work_id, verdict, notes);
    setReviewedIds((prev) => new Set([...prev, selectedAnomaly.work_id]));
    setSuccessMsg(`Review submitted for ${selectedAnomaly.work_id}`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const filtered = anomalies.filter((a) => {
    if (activeTab === 'l3') return a.confidence_tier === 'L3';
    if (activeTab === 'l2') return a.confidence_tier === 'L2';
    return true;
  });

  // ── Who may read, who may review ───────────────────────────────────────────
  //
  // These are two different things and the page used to conflate them.
  //
  // The backend is explicit: `GET /anomalies/` and `GET /anomalies/summary/` take
  // the `viewer` dependency, so the flag list is readable without an account,
  // and `_mask_mp_id` is what protects the MP identity in that response. Only
  // `POST /anomalies/{work_id}/review` and `GET /anomalies/l3/` are behind
  // `ROLES_AUDIT`.
  //
  // So the read list stays open, and only the verdict control and the L3 tab are
  // gated here. The previous version blocked the entire page for every
  // non-reviewer, which contradicted the API, contradicted the copy on the login
  // page, and hid publicly-readable data for no security benefit.
  //
  // Note also that "this deployment's access policy is a configuration decision,
  // not something established by an instrument we can cite" — the guardrail
  // below claims no statutory prohibition it cannot point to.

  return (
    <div className="flex flex-col w-full">
      {/* ── Public flag list header ─────────────────────────────────── */}
      <section className="w-full bg-primary py-space-xl px-gutter-desktop">
        <div className="max-w-container-max mx-auto">
          <div className="flex items-center gap-space-xs text-xs text-primary-fixed-dim mb-space-sm">
            <Link href="/" className="hover:text-on-primary transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">home</span>Home
            </Link>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-on-primary font-semibold">Flagged works</span>
          </div>
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-md">
            <div>
              <div className="flex items-center gap-space-sm mb-2 flex-wrap">
                <span className="px-2 py-0.5 bg-secondary text-on-secondary rounded text-xs font-bold tracking-wider uppercase">
                  Open for reading
                </span>
                <span className="px-2 py-0.5 bg-primary-container text-on-primary-container rounded text-xs">
                  {canReview ? 'Auditor account — you can submit verdicts' : 'Verdicts require an auditor account'}
                </span>
              </div>
              <h1
                className="text-[32px] leading-[40px] font-bold text-on-primary tracking-tight"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                Anomaly Review Desk
              </h1>
              <p className="text-primary-fixed-dim mt-1 text-sm">
                Works the scoring pipeline ranked for review, with the signals behind each score.
                Reading this list needs no account; recording a verdict does.
              </p>
            </div>
            {/*
              This indicator was a permanently-animating green dot labelled "Live
              Intelligence Pipeline Active". Nothing was polled to keep it true,
              and the pipeline is a scheduled batch, not a live feed. It is now
              derived from the same fetch the list uses: the dot is live only
              while the anomaly service is actually answering.
            */}
            <div className="flex items-center gap-1 text-primary-fixed-dim text-xs">
              <span
                className={`w-2 h-2 rounded-full inline-block ${
                  loadError ? 'bg-outline' : 'bg-secondary-fixed'
                }`}
              />
              {loadError
                ? 'Anomaly service unreachable'
                : loading
                  ? 'Loading from the anomaly service'
                  : 'Anomaly service responding'}
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI Summary Strip ───────────────────────────────────────── */}
      {loadError && (
        <div className="w-full px-gutter-desktop pt-space-md">
          <div className="max-w-container-max mx-auto flex items-start gap-space-sm bg-error-container text-on-error-container rounded-lg p-space-md">
            <span className="material-symbols-outlined text-[20px]">cloud_off</span>
            <div>
              <p className="font-semibold text-sm">Anomaly data unavailable</p>
              <p className="text-sm opacity-90">{loadError}</p>
            </div>
          </div>
        </div>
      )}
      <section className="w-full bg-primary-container py-space-md px-gutter-desktop">
        <div className="max-w-container-max mx-auto grid grid-cols-2 md:grid-cols-4 gap-space-md">
          <div className="text-center">
            <div className="text-[28px] font-bold text-on-primary-container" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {summary ? summary.L3 : '\u2014'}
            </div>
            <div className="text-xs text-on-primary-container/70">L3 Critical</div>
          </div>
          <div className="text-center">
            <div className="text-[28px] font-bold text-on-primary-container" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {summary ? summary.L2 : '\u2014'}
            </div>
            <div className="text-xs text-on-primary-container/70">L2 High-Confidence</div>
          </div>
          <div className="text-center">
            <div className="text-[28px] font-bold text-on-primary-container" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {summary ? summary.L1 : '\u2014'}
            </div>
            <div className="text-xs text-on-primary-container/70">L1 Statistical</div>
          </div>
          <div className="text-center">
            <div className="text-[28px] font-bold text-on-primary-container" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {/* A count of your own verdicts is meaningless without an
                  account, and rendering it as 0 would read as "nothing has been
                  reviewed" — a claim about the whole system made by a page that
                  simply has no session. */}
              {canReview ? reviewedIds.size : '—'}
            </div>
            <div className="text-xs text-on-primary-container/70">
              {canReview ? 'Reviewed by you, this session' : 'Reviewed by you (sign in)'}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl w-full flex flex-col gap-space-xl">
        {/* Success message */}
        {successMsg && (
          <div className="notice-success">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            <span className="text-sm font-semibold">{successMsg}</span>
          </div>
        )}

        {/* ── Tabs + Filters ────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md">
          <div className="flex items-center gap-1 bg-surface-container rounded-xl p-1">
            {([
              { key: 'all', label: 'All Flags', reviewerOnly: false },
              // `GET /anomalies/l3/` is behind ROLES_AUDIT, so the L3-only
              // endpoint is not offered without a reviewer. The rows themselves
              // are visible above, filtered client-side, which is what the
              // public list endpoint serves.
              { key: 'l3', label: 'L3 Critical', reviewerOnly: true },
              { key: 'l2', label: 'L2 High-Conf', reviewerOnly: false },
              { key: 'lapse', label: 'Fund Lapse Risk', reviewerOnly: false },
            ] as const)
              .filter((tab) => !tab.reviewerOnly || canReview)
              .map((tab) => (
                <button
                  key={tab.key}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === tab.key
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="appearance-none bg-surface-container-lowest text-on-surface text-xs py-2 pl-3 pr-8 rounded-lg shadow-sm border border-outline-variant/40 focus:outline-none"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
            >
              <option value="">All Tiers</option>
              <option value="L3">L3 Critical</option>
              <option value="L2">L2 High-Confidence</option>
              <option value="L1">L1 Statistical</option>
            </select>
            <select
              className="appearance-none bg-surface-container-lowest text-on-surface text-xs py-2 pl-3 pr-8 rounded-lg shadow-sm border border-outline-variant/40 focus:outline-none"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All States</option>
              {STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Lapse Risk Tab ───────────────────────────────────────── */}
        {activeTab === 'lapse' && (
          <div>
            <h2 className="section-title mb-space-md flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-error">trending_down</span>
              Fund Lapse Risk Districts
            </h2>
            {(lapseRisks as Array<{ district_code: string; mp_id: string; fiscal_year: string; projected_lapse: number; lapse_probability: number; lapse_tier: string; allocated_amount: number; spent_to_date: number }>).length === 0 ? (
              <div className="stitch-card p-space-2xl text-center text-on-surface-variant">
                No high-risk fund lapse districts identified.
              </div>
            ) : (
              <div className="overflow-x-auto stitch-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/30 text-xs text-on-surface-variant">
                      <th className="text-left p-space-md">District</th>
                      <th className="text-left p-space-md">MP (Masked)</th>
                      <th className="text-left p-space-md">Fiscal Year</th>
                      <th className="text-right p-space-md">Projected Lapse</th>
                      <th className="text-right p-space-md">Probability</th>
                      <th className="text-center p-space-md">Tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lapseRisks as Array<{ district_code: string; mp_id: string; fiscal_year: string; projected_lapse: number; lapse_probability: number; lapse_tier: string; allocated_amount: number; spent_to_date: number }>).map((item, i) => (
                      <tr key={i} className="border-b border-outline-variant/20 hover:bg-surface-container/50 transition-colors">
                        <td className="p-space-md font-semibold text-on-surface">{item.district_code}</td>
                        <td className="p-space-md">
                          <span className="bg-surface-container px-2 py-0.5 rounded text-xs font-mono text-on-surface-variant">
                            {item.mp_id}
                          </span>
                        </td>
                        <td className="p-space-md text-on-surface-variant">{item.fiscal_year}</td>
                        <td className="p-space-md text-right font-semibold text-error">{formatLakh(item.projected_lapse)}</td>
                        <td className="p-space-md text-right text-on-surface-variant">{(item.lapse_probability * 100).toFixed(0)}%</td>
                        <td className="p-space-md text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            item.lapse_tier === 'CRITICAL' ? 'bg-error-container text-on-error-container' : 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                          }`}>
                            {item.lapse_tier}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Anomalies Evidence Chain ─────────────────────────────── */}
        {activeTab !== 'lapse' && (
          <>
            {loading ? (
              <div className="grid grid-cols-1 gap-space-md">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="stitch-card p-space-lg space-y-3">
                    <div className="skeleton h-4 w-1/3 rounded" />
                    <div className="skeleton h-3 w-2/3 rounded" />
                    <div className="skeleton h-16 w-full rounded" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="stitch-card p-space-2xl text-center">
                <span className="material-symbols-outlined text-[56px] text-outline block mb-space-md">check_circle</span>
                <h3 className="section-title mb-2">No anomalies in this category</h3>
                <p className="text-on-surface-variant text-sm">All projects are within normal parameters.</p>
              </div>
            ) : (
              <div className="space-y-space-md">
                {filtered.map((anomaly) => {
                  const isReviewed = reviewedIds.has(anomaly.work_id);
                  return (
                    <div key={anomaly.work_id} className={`stitch-card p-space-lg ${isReviewed ? 'opacity-60' : ''}`}>
                      {/* Header row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-md">
                        <div className="flex items-center gap-space-sm flex-wrap">
                          <TierTag tier={anomaly.confidence_tier} />
                          <span className="font-mono text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                            {anomaly.work_id}
                          </span>
                          {isReviewed && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded text-xs font-semibold">
                              <span className="material-symbols-outlined text-[12px]">check</span>
                              Reviewed
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-on-surface-variant font-mono">
                            Risk Score: <strong className={anomaly.confidence_tier === 'L3' ? 'text-error' : 'text-on-tertiary-container'}>
                              {anomaly.composite_score?.toFixed(0) ?? '—'}/100
                            </strong>
                          </span>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="flex flex-col lg:flex-row gap-space-lg">
                        {/* Left: Work info */}
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/works/${anomaly.work_id}`}
                            className="font-semibold text-on-surface hover:text-primary transition-colors text-sm block mb-1"
                            style={{ fontFamily: "'Public Sans', sans-serif" }}
                          >
                            {anomaly.work_type?.replace(/_/g, ' ') || 'Work'} — {anomaly.district_name}
                          </Link>
                          <div className="flex flex-wrap items-center gap-x-space-md gap-y-1 text-xs text-on-surface-variant mb-space-md">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                              {anomaly.district_name}, {anomaly.state_code}
                            </span>
                            <span>•</span>
                            <span>MP: <span className="bg-surface-container px-1.5 rounded font-mono">{anomaly.mp_id_masked || 'MP-***-***'}</span></span>
                            {anomaly.sanction_amount && (
                              <>
                                <span>•</span>
                                <span>Sanctioned: <strong className="text-on-surface">{formatLakh(anomaly.sanction_amount)}</strong></span>
                              </>
                            )}
                          </div>

                          {/* Active signals & Identified Causes */}
                          {(() => {
                            const causes = getAnomalyCausesForWork(anomaly.active_signals, anomaly.work_type);
                            return (
                              <div className="bg-surface-container rounded-lg p-space-sm space-y-2">
                                <div className="text-xs font-semibold text-on-surface-variant flex items-center justify-between">
                                  <span>Signals recorded against this work:</span>
                                  <span className="font-mono text-[10px] text-error font-bold">
                                    {causes.length} rule{causes.length === 1 ? '' : 's'} matched
                                  </span>
                                </div>
                                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                                  Each row is one rule that matched the record&apos;s stored fields.
                                  They are not independent measurements and none has been
                                  corroborated: nothing here has been checked against the ground, a
                                  contractor record, or a payment trail. They are reasons to look, not
                                  findings.
                                </p>
                                <div className="space-y-1.5">
                                  {causes.map((c) => (
                                    <div
                                      key={c.code}
                                      className="flex items-start gap-2 p-1.5 rounded bg-surface-container-lowest border border-outline-variant/30 text-xs"
                                    >
                                      <span className="material-symbols-outlined text-[15px] text-error shrink-0 mt-0.5">{c.icon}</span>
                                      <div className="min-w-0">
                                        <div className="font-bold text-on-surface flex items-center gap-1.5">
                                          <span>{c.name}</span>
                                          <span className="text-[9px] px-1 rounded bg-error-container text-on-error-container font-mono">{c.category}</span>
                                        </div>
                                        <p className="text-[11px] text-on-surface-variant line-clamp-1">{c.summary}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Right: Actions */}
                        <div className="flex flex-col gap-space-sm shrink-0">
                          <Link
                            href={`/works/${anomaly.work_id}`}
                            className="btn-secondary text-xs"
                          >
                            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                            Open the work
                          </Link>
                          {/* A verdict is recorded against the acting account, so
                              it is offered only to a reviewer. A visitor sees
                              why the control is absent rather than a button
                              that would return 403 on click. */}
                          {canReview ? (
                            !isReviewed ? (
                              <button
                                className="btn-primary text-xs"
                                onClick={() => setSelectedAnomaly(anomaly)}
                              >
                                <span className="material-symbols-outlined text-[16px]">rate_review</span>
                                Submit Audit Review
                              </button>
                            ) : (
                              <button className="btn-ghost text-xs opacity-60" disabled>
                                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                Review Submitted
                              </button>
                            )
                          ) : isReviewed ? (
                            <span className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-semibold">
                              <span className="material-symbols-outlined text-[16px]">check_circle</span>
                              Reviewed
                            </span>
                          ) : (
                            <Link href="/login" className="btn-secondary text-xs">
                              <span className="material-symbols-outlined text-[16px]">login</span>
                              Sign in to review
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Review Modal */}
      {selectedAnomaly && (
        <ReviewModal
          anomaly={selectedAnomaly}
          onClose={() => setSelectedAnomaly(null)}
          onSubmit={handleReview}
        />
      )}
    </div>
  );
}
