'use client';

/**
 * Pipeline Administration & Model Orchestrator
 *
 * Honesty rules enforced here:
 *  - No hardcoded "healthy" telemetry. Every tile is derived from
 *    `GET /admin/pipeline-status`; when the backend is unreachable the tile
 *    shows an explicit "unreachable" state instead of a plausible number.
 *  - Buttons are disabled with a stated reason when the capability is not
 *    available in this deployment, rather than firing a request that cannot
 *    succeed.
 *  - The success banner quotes the server's own response, never a local
 *    assumption that the job ran.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import {
  fetchPipelineStatus,
  triggerPipeline,
  syncMospiData,
  runCrossSchemeDetection,
  trainMLPipeline,
  PipelineStatus,
} from '@/lib/api';

type ComponentState = 'AVAILABLE' | 'NO_ARTIFACTS' | 'NOT_INSTALLED' | 'UNREACHABLE';

const COMPONENT_TONE: Record<string, string> = {
  AVAILABLE: 'text-secondary',
  NO_ARTIFACTS: 'text-on-tertiary-container',
  NOT_INSTALLED: 'text-error',
  UNREACHABLE: 'text-error',
};

export default function AdminPage() {
  const { role } = useAuth();
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [jobSuccess, setJobSuccess] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchPipelineStatus();
      setPipelineStatus(res);
      setReachable(true);
    } catch {
      setPipelineStatus(null);
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleTrigger = async (jobName: string, actionFn: () => Promise<{ status?: string; message?: string }>) => {
    setRunningJob(jobName);
    setJobSuccess(null);
    setJobError(null);
    try {
      const res = await actionFn();
      setJobSuccess(`${jobName}: ${res?.message || res?.status || 'accepted by server'}`);
      await refresh();
    } catch (err: any) {
      setJobError(`${jobName} failed — ${err?.message || 'request rejected by server'}`);
    } finally {
      setRunningJob(null);
    }
  };

  // ── Role guardrail: platform operations are auditor-only ──
  if (role !== 'AUDITOR') {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[60vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-sm text-center space-y-space-md">
          <div className="w-16 h-16 rounded-full bg-error-container text-error flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">admin_panel_settings</span>
          </div>
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-error-container text-on-error-container">
              Admin role required • signed in as {role}
            </span>
            <h1 className="text-2xl font-bold text-primary tracking-tight mt-2">
              Pipeline Administration Restricted
            </h1>
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            This screen reads the same data as the rest of the prototype and adds nothing that is
            legally restricted: the pipeline counters, the source snapshot status, and the ingest
            trigger are visible to anyone on the <code className="font-mono">/data</code> provenance
            page. What it does add is the ability to run a sync, so it is kept behind the admin role.
          </p>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            It was previously labelled a &ldquo;Statutory Access Restriction&rdquo; and said access
            was limited to &ldquo;MoSPI Vigilance Officers and CAG audit personnel&rdquo;. No such
            designation exists, no MoSPI or CAG officer has an account here, and a role check in this
            codebase is not a statutory control.
          </p>
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/reports" className="btn-primary text-sm">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Open the data provenance page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const l1 = pipelineStatus?.l1_count;
  const l2 = pipelineStatus?.l2_count;
  const l3 = pipelineStatus?.l3_count;

  const componentTile = (
    label: string,
    icon: string,
    value: string,
    sub: string,
    state: ComponentState | null,
  ) => {
    const tone = state === null ? 'text-on-surface-variant' : COMPONENT_TONE[state] || 'text-on-surface';
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/30 p-space-md rounded-xl shadow-card space-y-1">
        <div className="flex items-center justify-between text-xs text-on-surface-variant">
          <span>{label}</span>
          <span className={`material-symbols-outlined text-[18px] ${tone}`}>{icon}</span>
        </div>
        <div className={`text-xl font-bold font-mono ${tone}`}>{value}</div>
        <p className="text-[11px] text-on-surface-variant">{sub}</p>
      </div>
    );
  };

  const JobButton = ({
    label,
    busyLabel,
    jobName,
    icon,
    actionFn,
    disabledReason,
    className,
  }: {
    label: string;
    busyLabel: string;
    jobName: string;
    icon: string;
    actionFn: () => Promise<{ status?: string; message?: string }>;
    disabledReason?: string;
    className: string;
  }) => {
    const busy = runningJob === jobName;
    const disabled = runningJob !== null || !!disabledReason;
    return (
      <div className="space-y-1.5">
        <button
          onClick={() => handleTrigger(jobName, actionFn)}
          disabled={disabled}
          title={disabledReason}
          className={`${className} py-2.5 px-4 font-semibold rounded-xl text-xs w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition`}
        >
          {busy ? (
            <>
              <span className="material-symbols-outlined text-[16px] animate-spin">refresh</span>
              <span>{busyLabel}</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">{icon}</span>
              <span>{label}</span>
            </>
          )}
        </button>
        {disabledReason && <p className="text-[10px] text-on-surface-variant leading-snug">{disabledReason}</p>}
      </div>
    );
  };

  const pipelineUnavailable = reachable === false;

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-outline-variant/30 pb-space-lg">
        <div>
          <div className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-1 font-label-md">
            <span className="material-symbols-outlined text-[16px] text-primary">admin_panel_settings</span>
            <span>Platform Operations &amp; Model Orchestration</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary tracking-tight" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            Pipeline Administration &amp; Model Orchestrator
          </h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-3xl">
            Infrastructure telemetry, scoring-worker state, AWS Sentinel-2 L2A optical ingestion and
            model artefact management. Every figure below is read from the live database — no
            value on this page is hardcoded.
          </p>
        </div>

        <div className="flex items-center gap-space-sm shrink-0">
          <Link
            href="/anomalies"
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-outline-variant/60 text-on-surface rounded-xl font-label-md text-xs hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">verified_user</span>
            <span>Back to flagged works</span>
          </Link>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-sm text-xs font-semibold ${
              reachable === null
                ? 'bg-surface-container text-on-surface-variant'
                : pipelineStatus?.status === 'OPERATIONAL'
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-error-container text-on-error-container'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                reachable === null
                  ? 'bg-outline animate-pulse'
                  : pipelineStatus?.status === 'OPERATIONAL'
                  ? 'bg-secondary'
                  : 'bg-error animate-pulse'
              }`}
            />
            {reachable === null
              ? 'Checking…'
              : !reachable
              ? 'Backend Unreachable'
              : `Status: ${pipelineStatus?.status}`}
          </span>
        </div>
      </div>

      {pipelineUnavailable && (
        <div className="p-4 rounded-xl bg-error-container/60 border border-error text-on-error-container text-xs flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] shrink-0">cloud_off</span>
          <div>
            <div className="font-semibold">Backend unreachable</div>
            <div className="mt-0.5">
              No live telemetry is available. Counts, tier totals and component health below are
              withheld rather than shown as plausible defaults. Start the FastAPI service to populate
              this page.
            </div>
          </div>
        </div>
      )}

      {pipelineStatus?.notes && (
        <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/40 text-xs flex items-start gap-2 text-on-surface-variant">
          <span className="material-symbols-outlined text-[18px] shrink-0 text-primary">info</span>
          <div>{pipelineStatus.notes}</div>
        </div>
      )}

      {/* Alerts */}
      {jobSuccess && (
        <div className="p-4 rounded-xl bg-secondary-container/60 border border-secondary text-on-secondary-container text-xs flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
          <span>{jobSuccess}</span>
        </div>
      )}
      {jobError && (
        <div className="p-4 rounded-xl bg-error-container/60 border border-error text-on-error-container text-xs flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
          <span>{jobError}</span>
        </div>
      )}

      {/* ── System Health Telemetry Cards ─────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        {componentTile(
          'PostgreSQL Works Registry',
          'database',
          pipelineStatus ? `${pipelineStatus.works_in_db}` : '—',
          pipelineStatus
            ? `${pipelineStatus.works_scored} scored • ${pipelineStatus.works_unscored} unscored`
            : 'no data',
          reachable ? 'AVAILABLE' : 'UNREACHABLE',
        )}

        {componentTile(
          'Scoring Workers',
          'memory',
          pipelineStatus?.ml_status === 'AVAILABLE' ? 'AVAILABLE' : pipelineStatus?.ml_status || '—',
          'No Celery worker ships with this deployment',
          pipelineStatus?.ml_status as ComponentState | undefined ?? null,
        )}

        {componentTile(
          'AWS Sentinel-2 L2A (Optical)',
          'satellite_alt',
          pipelineStatus?.satellite_status || '—',
          'STAC scene search via AWS Earth Search',
          (pipelineStatus?.satellite_status as ComponentState | undefined) ?? null,
        )}

        {componentTile(
          'MoSPI Snapshot Source',
          'cloud_sync',
          pipelineStatus?.scraper_status || '—',
          'Reads stored snapshot; not a live fetch',
          (pipelineStatus?.scraper_status as ComponentState | undefined) ?? null,
        )}
      </div>

      {/* ── Active Risk Tiers Summary ─────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
        <h2 className="text-base font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
          Score bands currently stored (review queue)
        </h2>
        <p className="text-xs text-on-surface-variant">
          These are counts of works bucketed by the Isolation Forest score, not findings. A work in
          the L3 band has not been corroborated by anything: corroboration requires a human to
          record a review against it, and the automatic promotion to L3 has been disabled in the
          scorer. Nothing here has been verified with satellite or financial evidence.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md">
          <div className="bg-surface-container-low rounded-xl p-space-md border-l-4 border-error">
            <div className="text-xs text-on-surface-variant">L3 band (unreviewed)</div>
            <div className="text-2xl font-bold text-error mt-1" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {l3 ?? '—'}
            </div>
            <div className="text-[11px] text-on-surface-variant mt-1">Highest score band. No corroboration exists for these.</div>
          </div>
          <div className="bg-surface-container-low rounded-xl p-space-md border-l-4 border-amber-500">
            <div className="text-xs text-on-surface-variant">L2 band</div>
            <div className="text-2xl font-bold text-amber-700 mt-1" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {l2 ?? '—'}
            </div>
            <div className="text-[11px] text-on-surface-variant mt-1">Second band. Unreviewed, and no discrepancy has been established.</div>
          </div>
          <div className="bg-surface-container-low rounded-xl p-space-md border-l-4 border-primary">
            <div className="text-xs text-on-surface-variant">L1 Pattern Signals</div>
            <div className="text-2xl font-bold text-primary mt-1" style={{ fontFamily: "'Public Sans', sans-serif" }}>
              {l1 ?? '—'}
            </div>
            <div className="text-[11px] text-on-surface-variant mt-1">Weather mismatch or sanction delay</div>
          </div>
        </div>
        {!pipelineStatus && (
          <p className="text-[11px] text-on-surface-variant">
            Tier counts are read from <code className="font-mono">risk_scores.confidence_tier</code>. No
            fallback figures are displayed when the registry is unreachable.
          </p>
        )}
      </div>

      {/* ── Model Pipeline Trigger Console ────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
        <div>
          <h2 className="text-base font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            Manual Pipeline Execution Console
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Actions that are not wired in this deployment are disabled with the reason shown, rather
            than reporting a success that did not happen.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
          <div className="p-space-md rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">Master Ensemble Rescoring Pipeline</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary-container text-on-primary-container font-semibold">
                  Offline Job
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Isolation Forest, Prophet time-series and Louvain modularity recompute composite risk
                scores. Runs as an offline script (<code className="font-mono">ml/training/</code>); a
                Celery worker is not part of this deployment.
              </p>
            </div>
            <JobButton
              jobName="Master Ensemble Rescore"
              label="Trigger Ensemble Rescore"
              busyLabel="Dispatching…"
              icon="play_arrow"
              actionFn={triggerPipeline}
              disabledReason={
                pipelineUnavailable
                  ? 'Backend unreachable.'
                  : 'Requires a Celery worker and tasks.ml_tasks, neither of which exists in this repo.'
              }
              className="bg-primary text-on-primary hover:bg-primary/90"
            />
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">Sentinel-2 Multi-Spectral Ingestion</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container font-semibold">
                  On Demand
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Per-work cloud-free Sentinel-2 L2A tile lookup and ΔNDBI computation. Available per work
                from the project detail page rather than as a bulk job.
              </p>
            </div>
            <Link
              href="/works"
              className="py-2.5 px-4 bg-primary text-on-primary font-semibold rounded-xl text-xs flex items-center justify-center gap-2 hover:bg-primary/90 transition"
            >
              <span className="material-symbols-outlined text-[16px]">satellite</span>
              Open Works Explorer
            </Link>
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">IMD Rainfall Normals Cross-Check</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container text-on-surface font-semibold">
                  Not Wired
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Cross-references pour and road-laying milestone dates against IMD gridded precipitation.
              </p>
            </div>
            <button
              disabled
              title="No IMD endpoint is implemented."
              className="py-2.5 px-4 bg-primary text-on-primary font-semibold rounded-xl text-xs w-full flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">block</span>
              Execute Weather Re-Check
            </button>
            <p className="text-[10px] text-on-surface-variant leading-snug">
              No IMD integration is implemented. The <code className="font-mono">IMD_API_KEY</code> entry
              in <code className="font-mono">.env</code> is read by no code.
            </p>
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">MoSPI DigiGov Snapshot</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                  Stored Snapshot
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Reads <code className="font-mono">data/output/live_national_stats.json</code>. The
                snapshot&apos;s own <code className="font-mono">last_synced_at</code> governs freshness;
                regenerate it with <code className="font-mono">data/sync_live_mospi.py</code>.
              </p>
            </div>
            <JobButton
              jobName="MoSPI Snapshot Read"
              label="Load MoSPI Snapshot"
              busyLabel="Reading…"
              icon="cloud_sync"
              actionFn={syncMospiData}
              disabledReason={pipelineUnavailable ? 'Backend unreachable.' : undefined}
              className="bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm"
            />
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">MGNREGA Cross-Scheme Reconciliation</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">
                  Stored Output
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Reports the row count of the stored detector output at{' '}
                <code className="font-mono">data/output/cross_scheme_matches.csv</code>.
              </p>
            </div>
            <JobButton
              jobName="MGNREGA Cross-Scheme Audit"
              label="Read Cross-Scheme Results"
              busyLabel="Reading…"
              icon="compare"
              actionFn={runCrossSchemeDetection}
              disabledReason={pipelineUnavailable ? 'Backend unreachable.' : undefined}
              className="bg-primary text-on-primary hover:bg-primary/90 shadow-sm"
            />
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">ML Model Artefact Audit</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-semibold">
                  Offline Trained
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Reports which trained artefacts exist in <code className="font-mono">ml/saved_models/</code>.
                Training itself is an offline job, not an HTTP action.
              </p>
            </div>
            <JobButton
              jobName="ML Artefact Audit"
              label="Audit Model Artefacts"
              busyLabel="Scanning…"
              icon="model_training"
              actionFn={trainMLPipeline}
              disabledReason={pipelineUnavailable ? 'Backend unreachable.' : undefined}
              className="bg-purple-700 text-white hover:bg-purple-800 shadow-sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
