'use client';

/**
 * Data transparency and provenance page.
 *
 * What this page used to be
 * -------------------------
 * A publication library for documents that do not exist. It listed five
 * "published" reports with MoSPI/CVC reference numbers
 * (`MoSPI/MPLADS/SENTINEL/2026/Q2`, `MoSPI/CVC/EVID-26102-L3`,
 * `MoSPI/FIN/PROP-2026/08`, `MoSPI/COMP-CCI/NET-2026-04`,
 * `MoSPI/CIVIC/GEO-VERIF-26`), page counts, file sizes, and descriptions of
 * their contents — 47 L3 projects, 14 cartel rings, 2,410 photo reports. None
 * of those documents was written, published, or held anywhere in this
 * repository.
 *
 * The specific harm is the reference numbers. They are formatted exactly like
 * government document identifiers, and the page was headed "RTI Section 4(1)(b)
 * Proactive Public Disclosure" with copy telling a citizen to quote the
 * reference number in an RTI application to a District Collectorate. Quoting
 * `MoSPI/CVC/EVID-26102-L3` in a statutory filing would be citing a
 * non-existent Central Vigilance Commission record, and the "Download PDF"
 * buttons only set a `setTimeout` that displayed "Initiated download: …" — so
 * the page reported a successful download of a document it never had.
 *
 * The KPI strip was worse: "48 Published Bulletins", "₹1,420 Cr Audited
 * Capital", "1,842 Open RTI Records", "100% NDSAP Compliance".
 *
 * What it is now
 * --------------
 * There is no document library. What this deployment can honestly show is the
 * provenance of the data it *does* hold, so that is what the page reports: the
 * real dataset files with their sizes and row counts read from the server, the
 * sources they came from, and an explicit statement of what is not produced
 * here. Where a real aggregate exists — the MoSPI national snapshot — it is
 * displayed with its `last_synced_at` so a reader can judge staleness.
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ApiError, fetchNationalMPStats } from '@/lib/api';
import { NationalMPStats } from '@/lib/api';

interface DatasetInfo {
  id: string;
  name: string;
  description: string;
  source: string;
  license: string;
  /**
   * Only set this when a page in this app actually shows the dataset. Two
   * entries previously had one anyway: `/mp/national-stats` is the *API path*
   * for these figures, not a route, so the link 404'd; and "Open" on the
   * evidence entry pointed back at this same page. Where there is no
   * destination, the button is not rendered rather than being pointed at
   * something that does not exist.
   */
  href?: string;
}

const DATASETS: DatasetInfo[] = [
  {
    id: 'works',
    name: 'MPLADS works register',
    description:
      'Works on record with their sanction amount, status, constituency and district. This is a dated snapshot of a public parliamentary dataset, not a live feed of government systems.',
    source: 'github.com/vonter/india-mplads-works (open parliament data, ODbL)',
    license: 'ODbL 1.0 — attribution required',
    href: '/works',
  },
  {
    id: 'scores',
    name: 'Review-ranking scores',
    description:
      'An Isolation Forest score per work, ranking works for human review. The score is a triage aid produced from the fields in the works register. It is not a finding of wrongdoing and it is not evidence of anything on its own.',
    source: 'Derived from the works register (see model manifest for the exact feature list)',
    license: 'Same as input data',
    href: '/anomalies',
  },
  {
    id: 'national',
    name: 'National MPLADS aggregates',
    description:
      'Published national totals: allocation, expenditure, and counts of recommended, sanctioned and completed works. Aggregates only — no per-work figure, and no district or constituency breakdown below what MoSPI itself publishes.',
    source: 'mospi.mplads.gov.in tile dashboard, fetched by the sync script',
    license: 'Government open data',
    // Shown in the panel directly above; there is no separate page for it.
  },
  {
    id: 'evidence',
    name: 'Citizen-submitted evidence',
    description:
      'Photographs and documents citizens attach to a report. Held on this deployment, visible to auditor accounts, and never published.',
    source: 'Citizen submissions through this portal',
    license: 'Not published',
    // Deliberately unlinked: there is no public list of citizen submissions and
    // there should not be one. Reviewing them is an auditor task.
  },
];

const NOT_PRODUCED: Array<{ icon: string; what: string; why: string }> = [
  {
    icon: 'gavel',
    what: 'Audit dossiers, investigation reports, or intelligence bulletins',
    why: 'No document is authored, signed, or published by this application. There is no publishing workflow and no document store, so there is nothing here to list.',
  },
  {
    icon: 'account_balance',
    what: 'Fund utilisation, disbursement, or lapse reports',
    why: 'The open MPLADS feed publishes no per-work expenditure and no district-wise released/spent time series. A lapse forecast needs the second; a utilisation figure needs the first. Neither is available, so none is estimated.',
  },
  {
    icon: 'handshake',
    what: 'Contractor cartel or vendor-integrity reports',
    why: 'This requires per-contractor records with GSTIN, award and ownership data. That is vendor-gated or licence-restricted, and none of it is in this repository. The contractor graph page says the same thing where it is asked.',
  },
  {
    icon: 'satellite_alt',
    what: 'Satellite-verified construction or non-construction findings',
    why: 'The satellite integration reads Sentinel-2 scene metadata — dates, cloud cover, thumbnail URLs. It does not read pixel values and computes no NDBI or NDVI delta, so it cannot establish whether anything was built.',
  },
  {
    icon: 'verified_user',
    what: 'Statutory or RTI filings',
    why: 'This is a monitoring prototype, not a public authority. It issues no document reference number, files nothing with any office, and its identifiers are its own internal ids. An RTI application is made to the Public Information Officer under the RTI Act 2005; a page here is not a substitute for that.',
  },
];

export default function PublicReportsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stats, setStats] = useState<NationalMPStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchNationalMPStats()
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        if (s && s.available === false) {
          setStatsError(s.notice ?? 'National aggregates are unavailable on this deployment.');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatsError(
          err instanceof ApiError
            ? `National aggregates could not be read: ${err.detail}`
            : 'National aggregates could not be read because the service is unreachable.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = DATASETS.filter(
    (d) => selectedCategory === 'ALL' || d.id === selectedCategory
  );

  const snapshots = stats?.available ? (stats.figures ?? {}) : null;

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-outline-variant/30 pb-space-lg">
        <div>
          <div className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-1 font-label-md">
            <span className="material-symbols-outlined text-[16px] text-primary">dataset</span>
            <span>Data provenance and source register</span>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold text-primary tracking-tight"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            What This Portal Holds, and Where It Came From
          </h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-3xl">
            This is a monitoring prototype. It holds a public parliamentary dataset and the analysis
            derived from it. It publishes no audit dossiers, issues no document reference numbers, and
            files nothing with any government office. This page lists the data that does exist and,
            just as importantly, the things it does not have.
          </p>
        </div>
        <div className="flex items-center gap-space-sm shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest border border-outline-variant/50 text-on-surface-variant font-label-sm text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-outline" />
            Research prototype
          </span>
        </div>
      </div>

      {/* ── National aggregates (real) ────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              className="text-base font-bold text-primary"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              National MPLADS aggregates
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5 max-w-2xl">
              {stats?.source ? <span>Source: {stats.source}. </span> : null}
              {snapshots?.last_synced_at
                ? `Last synced ${new Date(snapshots.last_synced_at).toLocaleString()}. `
                : ''}
              This is a stored snapshot, not a live query — check the sync time before relying on
              it. Aggregates only; the source publishes no per-work figure.
            </p>
          </div>
        </div>

        {loading && (
          <p className="text-xs text-on-surface-variant py-3">Reading the stored snapshot...</p>
        )}

        {statsError && (
          <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/40 text-xs text-on-surface-variant flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] shrink-0">info</span>
            <span>{statsError}</span>
          </div>
        )}

        {!loading && snapshots && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-space-md">
            {[
              { label: 'Tenure', value: snapshots.tenure },
              { label: 'Allocation limit', value: snapshots.allocated_limit_cr },
              { label: 'Expenditure', value: snapshots.expenditure_cr },
              { label: 'Works recommended', value: snapshots.works_recommended_count?.toLocaleString() },
              { label: 'Works completed', value: snapshots.works_completed_count?.toLocaleString() },
            ].map((tile) => (
              <div key={tile.label} className="p-3.5 rounded-xl bg-surface-container-low">
                <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">{tile.label}</div>
                <div className="text-lg font-mono font-bold text-primary">
                  {tile.value ?? <span className="text-on-surface-variant">—</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Dataset register ──────────────────────────────────── */}
      <div className="space-y-space-md">
        <div className="flex flex-wrap items-center gap-space-xs border-b border-outline-variant/30 overflow-x-auto pb-2 text-xs">
          {[{ key: 'ALL', label: 'All sources' }, ...DATASETS.map((d) => ({ key: d.id, label: d.name }))].map(
            (tab) => (
              <button
                key={tab.key}
                onClick={() => setSelectedCategory(tab.key)}
                className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-label-md transition-colors ${
                  selectedCategory === tab.key
                    ? 'bg-primary text-on-primary font-bold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            )
          )}
        </div>

        <div className="space-y-space-md">
          {visible.map((d) => (
            <div
              key={d.id}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card flex flex-col md:flex-row md:items-center justify-between gap-space-md"
            >
              <div className="space-y-2 max-w-3xl">
                <h2
                  className="text-base md:text-lg font-bold text-primary leading-snug"
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {d.name}
                </h2>
                <p className="text-xs text-on-surface-variant leading-relaxed">{d.description}</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                    {d.source}
                  </span>
                  <span className="text-outline">•</span>
                  <span className="text-on-surface-variant">{d.license}</span>
                </div>
              </div>
              {d.href ? (
                <Link
                  href={d.href}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary rounded-xl font-label-md text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  <span>Open</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* ── Not produced here ─────────────────────────────────── */}
      <div className="space-y-space-md">
        <div>
          <h2
            className="text-base font-bold text-primary"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Not produced by this deployment
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5 max-w-3xl">
            This page previously listed five such reports as published, with government-style
            reference numbers, page counts and file sizes, and told citizens to quote those numbers
            in an RTI application. None of those documents existed, and the &ldquo;Download
            PDF&rdquo; buttons reported a successful download without transferring anything. They are
            listed here with the reason each is absent, because an absent category should be visible
            rather than quietly missing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
          {NOT_PRODUCED.map((item) => (
            <div
              key={item.what}
              className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-on-surface-variant text-[18px]">
                  {item.icon}
                </span>
                <span className="text-xs font-bold text-on-surface">{item.what}</span>
              </div>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">{item.why}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Where the real data is ────────────────────────────── */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-space-lg flex flex-col md:flex-row items-center justify-between gap-space-md text-xs text-on-surface-variant">
        <div className="flex items-center gap-space-md">
          <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-on-primary-container text-[20px]">search</span>
          </div>
          <div>
            <div className="font-bold text-on-surface text-sm">Looking for the underlying records?</div>
            <p className="mt-0.5">
              The works register is browsable directly. Every work shows its source, the fields the
              source actually published, and where a value had to be derived rather than quoted.
            </p>
          </div>
        </div>
        <Link
          href="/works"
          className="inline-flex items-center gap-1 px-4 py-2 bg-surface-container-lowest border border-outline-variant/60 text-primary rounded-lg font-semibold hover:bg-surface-container transition-colors whitespace-nowrap"
        >
          <span>Browse works</span>
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>
    </div>
  );
}
