/**
 * National dashboard.
 *
 * This is a React Server Component, so `fetchAnomalySummary()` and friends run
 * on the server. The API layer resolves its base URL differently there: the
 * relative `/api/v1` the browser relies on is unparseable by `fetch` outside a
 * browser, so the server path uses `SERVER_API_URL`. See `lib/api.ts`.
 *
 * The metadata below is a page-level `title`/`description` override, and it
 * replaced what was here: "e-SAKSHI / MPLADS Public Project Monitoring Portal" and
 * a description promising to "track MPLADS-funded public works ... satellite
 * verification". No satellite verification is performed, and this is not a
 * government portal. The root layout supplies the honest metadata.
 */

import React from 'react';
import Link from 'next/link';
import { fetchAnomalies, fetchAnomalySummary, fetchPipelineStatus, fetchLapseRisk } from '@/lib/api';

export const metadata = {
  title: 'Works overview',
  description:
    'A ranked list of works from a public parliamentary dataset of MPLADS projects, with the ' +
    'sources and the limits of that dataset stated on the same page.',
};

function formatCrore(n: number) {
  if (!n) return '₹0';
  const cr = n / 10_000_000;
  return `₹${cr.toFixed(1)} Cr`;
}

function formatLakh(n: number) {
  if (!n) return '₹0';
  const lk = n / 100_000;
  return `₹${lk.toFixed(1)} L`;
}

export default async function HomePage() {
  // allSettled, not all: these endpoints now reject on failure instead of
  // returning mock records, and a single unavailable feed must not blank the
  // entire dashboard. Each value below is `null` when its own request failed,
  // and the UI renders "unavailable" rather than a substituted number.
  const [summaryRes, pipelineRes, lapseRes, anomaliesRes] = await Promise.allSettled([
    fetchAnomalySummary(),
    fetchPipelineStatus(),
    fetchLapseRisk(),
    fetchAnomalies({ limit: 6 }),
  ]);

  const anomalySummary = summaryRes.status === 'fulfilled' ? summaryRes.value : null;
  const pipeline = pipelineRes.status === 'fulfilled' ? pipelineRes.value : null;
  const lapseRisks = lapseRes.status === 'fulfilled' ? lapseRes.value : null;
  const topAnomalies = anomaliesRes.status === 'fulfilled' ? anomaliesRes.value : null;

  const dashboardOffline = summaryRes.status === 'rejected' && pipelineRes.status === 'rejected';

  const totalFlagged = anomalySummary
    ? (anomalySummary.L1 || 0) + (anomalySummary.L2 || 0) + (anomalySummary.L3 || 0)
    : null;
  const totalWorksDisplay = pipeline?.works_in_db?.toLocaleString() ?? null;

  return (
    <div className="flex flex-col w-full">
      {/*
        Sovereign Info Bar.

        This bar previously read "Public Ledger Synchronized: Central MoSPI
        Treasury DB - Live v4.19", "100% Geo-Tagged Public Records" and
        "Audited Public Domain" as static text. None of it was derived from
        anything: the version number was invented, no MoSPI Treasury sync
        exists, and "100% geo-tagged" is a completeness claim that was never
        measured. Static assurance language in a government oversight portal
        is worse than no banner, so it now reports only the live pipeline
        state, and says "unavailable" when that cannot be read.
      */}
      <div className="w-full bg-primary text-on-primary py-space-xs px-gutter-desktop">
        <div className="max-w-container-max mx-auto flex items-center justify-between text-label-sm font-label-sm text-xs">
          <div className="flex items-center gap-space-sm text-primary-fixed-dim">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                pipeline ? 'bg-secondary-fixed animate-ping' : 'bg-outline'
              }`}
            />
            <span>
              {pipeline
                ? `Pipeline reachable - last status check ${new Date(
                    pipeline.last_checked
                  ).toLocaleString()}`
                : 'Pipeline status unavailable - no synchronisation state can be confirmed'}
            </span>
          </div>
          <div className="flex items-center gap-space-md text-primary-fixed">
            <span className="flex items-center gap-space-2xs">
              <span className="material-symbols-outlined text-[15px]">database</span>
              {pipeline
                ? `${pipeline.works_in_db.toLocaleString()} works in registry`
                : 'Registry unavailable'}
            </span>
            <span>•</span>
            <span className="text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded font-label-sm text-xs">
              Public Research Prototype
            </span>
          </div>
        </div>
      </div>

      {/* ── Hero Section with Search ────────────────────────────────── */}
      <section className="w-full bg-surface-container-lowest py-space-2xl px-gutter-desktop shadow-sm relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(#000e27 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        />
        <div className="max-w-container-max mx-auto relative z-10">
          <div className="max-w-3xl mb-space-xl">
            <div className="inline-flex items-center gap-space-xs px-2.5 py-1 bg-surface-container rounded font-label-sm text-label-sm text-primary mb-space-sm text-xs">
              <span className="material-symbols-outlined text-[16px] text-secondary">account_balance</span>
              <span>Members of Parliament Local Area Development Scheme (MPLADS)</span>
            </div>
            <h1
              className="text-[40px] leading-[48px] font-bold text-primary tracking-tight mb-space-sm"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              Track Public Projects. See the Progress.
            </h1>
            <p className="text-lg text-on-surface-variant leading-relaxed">
              Browse works from a public parliamentary dataset of MPLADS projects, see what is on
              record for each, and check where the numbers came from.
            </p>
          </div>

          {/* Search Console */}
          <div className="bg-surface-container-low p-space-md rounded-xl shadow-md">
            <form action="/works" method="GET" className="flex flex-col lg:flex-row items-stretch gap-space-sm">
              <div className="relative flex-grow flex items-center bg-surface-container-lowest rounded-lg shadow-sm">
                <span className="material-symbols-outlined text-outline ml-space-md text-[24px]">search</span>
                <input
                  className="w-full px-space-md py-3.5 bg-transparent text-on-surface placeholder:text-outline focus:outline-none text-base"
                  id="mainSearchInput"
                  name="q"
                  placeholder="Search projects, locations, MP name, or scheme ID..."
                  type="text"
                />
              </div>
              <div className="flex items-center gap-space-sm">
                <Link
                  href="/works"
                  className="px-space-lg py-3.5 bg-surface-container-highest text-primary font-label-md text-label-md rounded-lg hover:bg-surface-container-high transition-colors flex items-center gap-space-xs shrink-0"
                  id="filterToggleBtn"
                >
                  <span className="material-symbols-outlined text-[20px]">tune</span>
                  <span>Advanced Filters</span>
                </Link>
                <button
                  className="px-space-xl py-3.5 bg-primary text-on-primary font-label-md text-label-md rounded-lg hover:bg-primary-container transition-colors shadow-sm flex items-center justify-center gap-space-xs shrink-0"
                  type="submit"
                >
                  <span className="material-symbols-outlined text-[20px]">search</span>
                  <span>Search Projects</span>
                </button>
              </div>
            </form>

            {/* Quick Pill Filters */}
            <div className="mt-space-md pt-space-md flex flex-wrap items-center gap-space-sm border-t border-outline-variant/20">
              <span className="font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wider text-xs">
                Quick Filters:
              </span>
              <Link
                href="/works?state_code=KA"
                className="px-3 py-1.5 bg-surface-container-lowest text-on-surface text-xs rounded-full shadow-sm hover:bg-surface-container transition-colors"
              >
                Karnataka
              </Link>
              <Link
                href="/works?state_code=UP"
                className="px-3 py-1.5 bg-surface-container-lowest text-on-surface text-xs rounded-full shadow-sm hover:bg-surface-container transition-colors"
              >
                Uttar Pradesh
              </Link>
              <Link
                href="/works?state_code=MH"
                className="px-3 py-1.5 bg-surface-container-lowest text-on-surface text-xs rounded-full shadow-sm hover:bg-surface-container transition-colors"
              >
                Maharashtra
              </Link>
              <Link
                href="/works?status=IN_PROGRESS"
                className="px-3 py-1.5 bg-surface-container-lowest text-on-surface text-xs rounded-full shadow-sm hover:bg-surface-container transition-colors"
              >
                Ongoing
              </Link>
              <Link
                href="/works?status=COMPLETED"
                className="px-3 py-1.5 bg-surface-container-lowest text-on-surface text-xs rounded-full shadow-sm hover:bg-surface-container transition-colors"
              >
                Completed
              </Link>
              <Link
                href="/works"
                className="ml-auto text-xs text-outline hover:text-error transition-colors flex items-center gap-space-2xs"
              >
                <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                View All
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── National KPI Stats Strip ────────────────────────────────── */}
      <section className="w-full bg-primary py-space-xl px-gutter-desktop">
        <div className="max-w-container-max mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-space-md">
            {/* Works in DB */}
            <div className="text-center">
              <div
                className="text-[36px] leading-[44px] font-bold text-on-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {totalWorksDisplay ?? '\u2014'}
              </div>
              <div className="text-xs text-primary-fixed-dim mt-1">Works in the register</div>
            </div>
            {/* L3 Critical */}
            <div className="text-center">
              <div
                className="text-[36px] leading-[44px] font-bold text-secondary-fixed"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {anomalySummary?.L3 ?? '—'}
              </div>
              <div className="text-xs text-primary-fixed-dim mt-1">
                L3 band (highest scores, unreviewed)
              </div>
            </div>
            {/* L2 High Confidence */}
            <div className="text-center">
              <div
                className="text-[36px] leading-[44px] font-bold text-tertiary-fixed-dim"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {anomalySummary?.L2 ?? '—'}
              </div>
              <div className="text-xs text-primary-fixed-dim mt-1">L2 band (second highest scores)</div>
            </div>
            {/* Total Flagged */}
            <div className="text-center">
              <div
                className="text-[36px] leading-[44px] font-bold text-on-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {totalFlagged ?? '\u2014'}
              </div>
              <div className="text-xs text-primary-fixed-dim mt-1">Works in any score band</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Main Content Area ───────────────────────────────────────── */}
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl w-full flex flex-col gap-space-2xl">

        {/* ── Priority Flagged Projects ─────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-space-lg">
            <div>
              <h2
                className="text-[24px] leading-[32px] font-bold text-on-surface"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                Priority Risk Signals
              </h2>
              <p className="text-sm text-on-surface-variant mt-1">
                The highest-scoring works in the queue, so a reviewer can start somewhere. Scoring is
                not a finding: nothing here has been checked against the ground or a payment record.
              </p>
            </div>
            <Link
              href="/anomalies"
              className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-container transition-colors font-label-md"
            >
              See the full list
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>

          {topAnomalies === null || topAnomalies.length === 0 ? (
            <div className="stitch-card p-space-xl text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-[48px] text-outline mb-2 block">check_circle</span>
              No scored works in this band. That is a statement about the score, not a clearance of
              any project.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
              {(topAnomalies ?? []).map((anomaly) => {
                const isL3 = anomaly.confidence_tier === 'L3' || String(anomaly.confidence_tier).includes('L3');
                const isL2 = anomaly.confidence_tier === 'L2' || String(anomaly.confidence_tier).includes('L2');
                return (
                  <div
                    key={anomaly.work_id}
                    className="stitch-card stitch-card-hover p-space-md flex flex-col gap-space-sm"
                  >
                    {/* Tier + Score */}
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                          isL3
                            ? 'bg-error-container text-on-error-container'
                            : isL2
                            ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                            : 'bg-surface-container text-on-surface-variant'
                        }`}
                      >
                        {isL3 && <span className="material-symbols-outlined text-[14px]">warning</span>}
                        {anomaly.confidence_tier}
                      </span>
                      <span className="text-xs text-on-surface-variant font-mono">
                        Risk: <strong className={isL3 ? 'text-error' : isL2 ? 'text-on-tertiary-container' : ''}>{anomaly.composite_score?.toFixed(0) ?? '—'}/100</strong>
                      </span>
                    </div>

                    {/* Title */}
                    <div>
                      <Link
                        href={`/works/${anomaly.work_id}`}
                        className="text-sm font-semibold text-on-surface hover:text-primary transition-colors line-clamp-2"
                      >
                        {anomaly.work_description || 'Work Description N/A'}
                      </Link>
                      <div className="flex items-center gap-2 mt-1 text-xs text-on-surface-variant">
                        <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                        <span>{anomaly.district_name}, {anomaly.state_code}</span>
                      </div>
                    </div>

                    {/* Signals */}
                    {anomaly.active_signals && anomaly.active_signals.length > 0 && (
                      <div className="bg-surface-container rounded-lg p-2 text-xs text-on-surface-variant">
                        <strong className="text-on-surface">Active signals: </strong>
                        {anomaly.active_signals.slice(0, 3).join(', ')}
                        {anomaly.active_signals.length > 3 && ` +${anomaly.active_signals.length - 3} more`}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-outline-variant/20">
                      <span className="text-xs text-on-surface-variant">
                        {anomaly.sanction_amount ? formatLakh(anomaly.sanction_amount) + ' sanctioned' : ''}
                      </span>
                      <Link
                        href={`/works/${anomaly.work_id}`}
                        className="text-xs text-primary hover:text-primary-container font-semibold flex items-center gap-1 transition-colors"
                      >
                        Full Dossier
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Multi-Signal Framework + Fund Lapse Risk ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-xl">
          {/* Multi-Spectral Anomaly Framework */}
          <div className="stitch-card p-space-lg">
            <h3 className="section-title mb-space-md flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary-container">shield</span>
                How the score bands are produced
            </h3>
            <div className="space-y-space-sm">
              <div className="p-space-md rounded-lg bg-error-container border border-error/20">
                <div className="flex justify-between items-center font-semibold text-on-error-container text-sm">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">warning</span>
                    L3 score band (unreviewed)
                  </span>
                  <span className="text-xs">Highest scores, nothing corroborated</span>
                </div>
                <p className="text-xs text-on-error-container/80 mt-1">
                  Works the model ranked highest. No notice is generated here and no MP is unmasked by
                  this; both are separate manual actions.
                </p>
                <div className="mt-2 text-[28px] font-bold text-error" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {anomalySummary ? anomalySummary.L3 : '\u2014'}
                </div>
              </div>

              <div className="p-space-md rounded-lg bg-tertiary-fixed border border-on-tertiary-container/20">
                <div className="flex justify-between items-center font-semibold text-on-tertiary-fixed-variant text-sm">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                    L2 High-Confidence
                  </span>
                  <span className="text-xs">Second score band</span>
                </div>
                <p className="text-xs text-on-tertiary-fixed-variant/80 mt-1">
                  Nothing has been reconciled. MP IDs are masked on the public list as a design
                  decision, not under any process.
                </p>
                <div className="mt-2 text-[28px] font-bold text-on-tertiary-container" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {anomalySummary ? anomalySummary.L2 : '\u2014'}
                </div>
              </div>

              <div className="p-space-md rounded-lg bg-surface-container border border-outline-variant/40">
                <div className="flex justify-between items-center font-semibold text-on-surface text-sm">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">analytics</span>
                    L1 score band
                  </span>
                  <span className="text-xs">Bulk of the distribution</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">
                  The widest band. Being here means only that the record resembles most others.
                </p>
                <div className="mt-2 text-[28px] font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {anomalySummary ? anomalySummary.L1 : '\u2014'}
                </div>
              </div>
            </div>
          </div>

          {/* Fund Lapse Risk Districts */}
          <div className="stitch-card p-space-lg">
            <h3 className="section-title mb-space-md flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-error">trending_down</span>
              Fund Lapse Risk — Districts
            </h3>
            {lapseRisks === null ? (
              // `null` means the request failed. "No districts identified" would
              // read as a clean bill of health that nothing checked; it is the
              // difference between an empty result and no result.
              <div className="text-center text-on-surface-variant py-8">
                <span className="material-symbols-outlined text-[40px] text-outline block mb-2">
                  cloud_off
                </span>
                The lapse forecast could not be read, so nothing is shown here.
              </div>
            ) : lapseRisks.length === 0 ? (
              <div className="text-center text-on-surface-variant py-8">
                <span className="material-symbols-outlined text-[40px] text-outline block mb-2">check_circle</span>
                No districts in the forecast. This is the forecast&apos;s own empty result, not a
                confirmation that no funds are at risk.
              </div>
            ) : (
              <div className="space-y-2">
                {(lapseRisks ?? []).slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low border border-outline-variant/30">
                    <div>
                      <div className="font-label-md text-label-md text-on-surface">{item.district_code}</div>
                      <div className="text-xs text-on-surface-variant">FY {item.fiscal_year}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold text-sm ${item.lapse_tier === 'CRITICAL' ? 'text-error' : 'text-on-tertiary-container'}`}>
                        {formatLakh(item.projected_lapse)} at risk
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        {(item.lapse_probability * 100).toFixed(0)}% probability
                      </div>
                    </div>
                    <span className={`ml-3 px-2 py-0.5 rounded text-xs font-bold ${
                      item.lapse_tier === 'CRITICAL' ? 'bg-error-container text-on-error-container' : 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                    }`}>
                      {item.lapse_tier}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/*
          "Active Sensor Integrations" previously hardcoded 'Synchronized' with
          a green check for the IMD rainfall API, the GST Portal and
          Sansad.in. No such integrations are configured in this deployment, so
          the panel asserted live government data feeds that do not exist. Each
          entry now carries only the status the backend actually reports, and
          anything unconfigured is labelled as such instead of "Synchronized".
        */}
        <section>
          <div className="flex items-center justify-between mb-space-lg">
            <h2
              className="text-[24px] leading-[32px] font-bold text-on-surface"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              Data Source Status
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
            {[
              {
                name: 'ESA Copernicus Sentinel-2 (STAC scene search)',
                icon: 'satellite_alt',
                // Only reachable status is a claim; otherwise report the value.
                status: pipeline ? pipeline.satellite_status : 'unavailable',
                live: pipeline?.satellite_status === 'READY',
              },
              {
                name: 'Internal risk-scoring registry',
                icon: 'analytics',
                status: pipeline
                  ? `${pipeline.works_scored.toLocaleString()} scored / ${pipeline.works_in_db.toLocaleString()} total`
                  : 'unavailable',
                live: !!pipeline && pipeline.works_scored > 0,
              },
              {
                name: 'IMD Gridded Rainfall API',
                icon: 'cloud',
                status: 'not configured',
                live: false,
              },
              {
                name: 'GST Portal (GSTR-3B/1 API)',
                icon: 'receipt_long',
                status: 'not configured',
                live: false,
              },
            ].map((sensor) => (
              <div key={sensor.name} className="stitch-card p-space-md flex items-center gap-space-sm">
                <div className="w-10 h-10 rounded-lg bg-secondary-container flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-on-secondary-container text-[20px]">{sensor.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-label-md text-label-md text-on-surface text-xs truncate">{sensor.name}</div>
                  <div
                    className={`flex items-center gap-1 text-xs mt-0.5 ${
                      sensor.live ? 'text-secondary' : 'text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {sensor.live ? 'check_circle' : 'info'}
                    </span>
                    {sensor.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA: Citizen Verification ─────────────────────────────── */}
        <section className="bg-primary-container rounded-xl p-space-2xl text-center">
          <span className="material-symbols-outlined text-[48px] text-on-primary-container block mb-space-md">groups</span>
          <h2
            className="text-[28px] leading-[36px] font-bold text-on-primary-container mb-space-sm"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Be a Citizen Auditor
          </h2>
          <p className="text-on-primary-container/80 text-base max-w-xl mx-auto mb-space-lg">
            Have you seen a public project in your area? Submit a geotagged photo and help verify ground reality against official records.
          </p>
          <Link
            href="/citizen"
            className="inline-flex items-center gap-2 px-space-xl py-3 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:bg-primary/90 transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-[20px]">add_a_photo</span>
            Submit a Citizen Report
          </Link>
        </section>
      </div>
    </div>
  );
}
