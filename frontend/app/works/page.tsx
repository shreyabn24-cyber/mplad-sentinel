'use client';

/**
 * Projects Explorer — e-SAKSHI / MPLADS
 * Based on: stitch_mplads_sentinel_ui_prototype/project_explorer_filters_desktop
 * Client component for interactive filters + real-time search
 */

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fetchWorks } from '@/lib/api';
import { Work } from '@/lib/types';
import { STATES } from '@/lib/states';

const WORK_TYPES = [
  'ROAD',
  'SCHOOL',
  'HEALTH',
  'WATER',
  'COMMUNITY_HALL',
  'SPORTS',
  'DRAINAGE',
  'ELECTRICITY',
  'SANITATION',
  'PARK_PLAYGROUND',
  'IRRIGATION',
  'DIGITAL_INFRASTRUCTURE',
];

const STATUSES = [
  { value: 'RECOMMENDED', label: 'Recommended' },
  { value: 'SANCTIONED', label: 'Sanctioned' },
  { value: 'IN_PROGRESS', label: 'Ongoing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const TIERS = [
  { value: 'L3', label: 'L3 Critical' },
  { value: 'L2', label: 'L2 High-Confidence' },
  { value: 'L1', label: 'L1 Statistical' },
];

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMPLETED: 'status-pill-completed',
    IN_PROGRESS: 'status-pill-ongoing',
    SANCTIONED: 'status-pill-ongoing',
    RECOMMENDED: 'status-pill-review',
    CANCELLED: 'status-pill-cancelled',
  };
  const labels: Record<string, string> = {
    COMPLETED: 'Completed',
    IN_PROGRESS: 'Ongoing',
    SANCTIONED: 'Sanctioned',
    RECOMMENDED: 'Recommended',
    CANCELLED: 'Cancelled',
  };
  return (
    <span className={map[status] || 'status-pill-review'}>
      {labels[status] || status}
    </span>
  );
}

function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  if (tier === 'L3') return <span className="tier-l3"><span className="material-symbols-outlined text-[12px]">warning</span>L3</span>;
  if (tier === 'L2') return <span className="tier-l2">L2</span>;
  return <span className="tier-l1">L1</span>;
}

function formatLakh(n?: number | null) {
  if (!n) return '₹—';
  return `₹${(n / 100_000).toFixed(1)}L`;
}

export default function ProjectsExplorerPage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Filters
  const [stateCode, setStateCode] = useState('');
  const [workType, setWorkType] = useState('');
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [schemeYear, setSchemeYear] = useState('');
  const [hasSatellite, setHasSatellite] = useState('');
  const [sort, setSort] = useState('risk_desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 24;

  /**
   * Read filter state out of the query string on mount.
   *
   * Home page quick-filter links (e.g. /works?state=KA&tier=L3) were never
   * read, so following one landed on a completely unfiltered list. Done in an
   * effect reading window.location rather than via useSearchParams so the page
   * does not need a Suspense boundary to prerender.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const first = (k: string) => (q.get(k) || '').trim();
    setStateCode(first('state') || first('state_code'));
    setWorkType(first('type') || first('work_type'));
    setStatus(first('status'));
    setTier(first('tier'));
    setSchemeYear(first('year') || first('scheme_year'));
    setHasSatellite(first('satellite') || first('has_satellite_audit'));
    setSort(first('sort') || 'risk_desc');
    setSearch(first('q') || first('search'));
    setPage(0);
  }, []);

  const loadWorks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWorks({
        state_code: stateCode || undefined,
        work_type: workType || undefined,
        status: status || undefined,
        tier: tier || undefined,
        scheme_year: schemeYear ? Number(schemeYear) : undefined,
        // Search is sent to the server. Filtering the already-fetched page
        // meant a query could never match a work that was not on page 1.
        search: search.trim() || undefined,
        has_satellite_audit: hasSatellite === '' ? undefined : hasSatellite === 'true',
        sort,
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      setWorks(result);
    } catch (e) {
      setError('Failed to load projects. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [stateCode, workType, status, tier, schemeYear, search, hasSatellite, sort, page]);

  useEffect(() => {
    loadWorks();
  }, [loadWorks]);

  const resetFilters = () => {
    setStateCode('');
    setWorkType('');
    setStatus('');
    setTier('');
    setSchemeYear('');
    setHasSatellite('');
    setSort('risk_desc');
    setPage(0);
    setSearch('');
  };

  return (
    <div className="flex flex-col w-full">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <section className="w-full bg-surface-container-lowest shadow-sm py-space-xl px-gutter-desktop border-b border-outline-variant/30">
        <div className="max-w-container-max mx-auto">
          <div className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-space-sm">
            <Link href="/" className="hover:text-primary transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">home</span>Home
            </Link>
            <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
            <span className="text-on-surface font-semibold">Projects Explorer</span>
          </div>
          <h1
            className="text-[32px] leading-[40px] font-bold text-on-surface tracking-tight"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            MPLADS Projects Explorer
          </h1>
          <p className="text-on-surface-variant mt-1">
            Browse, search and filter all MPLADS-funded public works across India.
          </p>
        </div>
      </section>

      {/* ── Filter + Results ────────────────────────────────────────── */}
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl w-full">

        {/* Search + Filter Controls */}
        <div className="bg-surface-container-low rounded-xl p-space-md shadow-sm mb-space-xl border border-outline-variant/30">
          {/* Main search row */}
          <div className="flex flex-col lg:flex-row items-stretch gap-space-sm">
            <div className="relative flex-grow flex items-center bg-surface-container-lowest rounded-lg shadow-sm border border-outline-variant/30">
              <span className="material-symbols-outlined text-outline ml-space-md text-[24px]">search</span>
              <input
                className="w-full px-space-md py-3 bg-transparent text-on-surface placeholder:text-outline focus:outline-none text-sm"
                placeholder="Search by work ID, type, district, or state..."
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
              {search && (
                <button
                  className="mr-3 text-outline hover:text-error transition-colors"
                  onClick={() => { setSearch(''); setPage(0); }}
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              )}
            </div>
            <button
              className="px-space-lg py-3 bg-surface-container-highest text-primary font-label-md rounded-lg hover:bg-surface-container-high transition-colors flex items-center gap-space-xs text-sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span className="material-symbols-outlined text-[20px]">tune</span>
              Advanced Filters
              <span className="material-symbols-outlined text-[16px]">
                {showAdvanced ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            <button
              className="px-space-lg py-3 bg-primary text-on-primary font-label-md rounded-lg hover:bg-primary-container transition-colors flex items-center gap-space-xs shadow-sm text-sm"
              onClick={loadWorks}
            >
              <span className="material-symbols-outlined text-[20px]">search</span>
              Search Projects
            </button>
          </div>

          {/* Quick Pill Filters */}
          <div className="mt-space-md pt-space-md flex flex-wrap items-center gap-space-sm border-t border-outline-variant/20">
            <span className="font-label-sm text-on-surface-variant font-bold uppercase tracking-wider text-xs">Quick Filters:</span>
            {/* State filter */}
            <div className="relative inline-block">
              <select
                className="appearance-none bg-surface-container-lowest text-on-surface text-xs py-1.5 pl-3 pr-8 rounded-full shadow-sm hover:bg-surface-container transition-colors cursor-pointer focus:outline-none border border-outline-variant/40"
                value={stateCode}
                onChange={(e) => { setStateCode(e.target.value); setPage(0); }}
              >
                <option value="">State: All States</option>
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1.5 pointer-events-none text-outline text-[16px]">expand_more</span>
            </div>
            {/* Status filter */}
            <div className="relative inline-block">
              <select
                className="appearance-none bg-surface-container-lowest text-on-surface text-xs py-1.5 pl-3 pr-8 rounded-full shadow-sm hover:bg-surface-container transition-colors cursor-pointer focus:outline-none border border-outline-variant/40"
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(0); }}
              >
                <option value="">Status: All</option>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1.5 pointer-events-none text-outline text-[16px]">expand_more</span>
            </div>
            {/* Work type filter */}
            <div className="relative inline-block">
              <select
                className="appearance-none bg-surface-container-lowest text-on-surface text-xs py-1.5 pl-3 pr-8 rounded-full shadow-sm hover:bg-surface-container transition-colors cursor-pointer focus:outline-none border border-outline-variant/40"
                value={workType}
                onChange={(e) => { setWorkType(e.target.value); setPage(0); }}
              >
                <option value="">Type: All Sectors</option>
                {WORK_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1.5 pointer-events-none text-outline text-[16px]">expand_more</span>
            </div>
            {/* Year filter */}
            <div className="relative inline-block">
              <select
                className="appearance-none bg-surface-container-lowest text-on-surface text-xs py-1.5 pl-3 pr-8 rounded-full shadow-sm hover:bg-surface-container transition-colors cursor-pointer focus:outline-none border border-outline-variant/40"
                value={schemeYear}
                onChange={(e) => { setSchemeYear(e.target.value); setPage(0); }}
              >
                <option value="">FY: All Years</option>
                <option value="2026">FY 2025-2026</option>
                <option value="2025">FY 2024-2025</option>
                <option value="2024">FY 2023-2024</option>
                <option value="2023">FY 2022-2023</option>
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1.5 pointer-events-none text-outline text-[16px]">expand_more</span>
            </div>
            <button
              className="ml-auto text-xs text-outline hover:text-error transition-colors flex items-center gap-space-2xs"
              onClick={resetFilters}
            >
              <span className="material-symbols-outlined text-[14px]">restart_alt</span>
              Reset Filters
            </button>
          </div>

          {/* Advanced Filter Drawer */}
          {showAdvanced && (
            <div className="mt-space-md pt-space-md grid grid-cols-1 md:grid-cols-3 gap-space-md bg-surface-container-lowest p-space-md rounded-lg border border-outline-variant/30">
              <div>
                <label className="stitch-label">Risk Tier</label>
                <select className="stitch-select text-sm" value={tier} onChange={(e) => { setTier(e.target.value); setPage(0); }}>
                  <option value="">All Tiers</option>
                  {TIERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="stitch-label">Has Satellite Audit</label>
                <select
                  className="stitch-select text-sm"
                  value={hasSatellite}
                  onChange={(e) => { setHasSatellite(e.target.value); setPage(0); }}
                >
                  <option value="">Any</option>
                  <option value="true">Yes — a check is on file</option>
                  <option value="false">No check on file</option>
                </select>
              </div>
              <div>
                <label className="stitch-label">Sort By</label>
                <select
                  className="stitch-select text-sm"
                  value={sort}
                  onChange={(e) => { setSort(e.target.value); setPage(0); }}
                >
                  <option value="risk_desc">Risk Score (High → Low)</option>
                  <option value="date_desc">Sanction Date (Newest)</option>
                  <option value="amount_desc">Sanction Amount (High → Low)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-space-md">
          <div className="text-sm text-on-surface-variant">
            {loading ? (
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Loading projects...
              </span>
            ) : error ? (
              <span className="text-error">{error}</span>
            ) : (
              <span>
                Showing <strong className="text-on-surface">{works.length}</strong> projects
                {stateCode && ` in ${STATES.find(s => s.code === stateCode)?.name || stateCode}`}
                {tier && ` — Tier ${tier}`}
              </span>
            )}
          </div>
          {!loading && works.length >= PAGE_SIZE && (
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="p-2 rounded-lg bg-surface-container hover:bg-surface-container-high disabled:opacity-40 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <span className="text-sm text-on-surface-variant">Page {page + 1}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                className="p-2 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          )}
        </div>

        {/* Project Cards Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="stitch-card p-space-md space-y-3">
                <div className="skeleton h-4 w-3/4 rounded" />
                <div className="skeleton h-3 w-1/2 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-8 w-full rounded" />
              </div>
            ))}
          </div>
        ) : works.length === 0 ? (
          <div className="stitch-card p-space-2xl text-center">
            <span className="material-symbols-outlined text-[56px] text-outline block mb-space-md">search_off</span>
            <h3 className="section-title mb-2">No projects found</h3>
            <p className="text-on-surface-variant text-sm">Try adjusting your filters or search term.</p>
            <button className="btn-secondary mt-space-md" onClick={resetFilters}>Reset All Filters</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
            {works.map((work) => (
              <Link
                key={work.work_id}
                href={`/works/${work.work_id}`}
                className="stitch-card stitch-card-hover p-space-md flex flex-col gap-space-sm group block"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                    {work.work_id}
                  </span>
                  <div className="flex items-center gap-1">
                    {work.confidence_tier && <TierBadge tier={work.confidence_tier} />}
                    <StatusPill status={work.status} />
                  </div>
                </div>

                {/* Work type + location */}
                <div>
                  <div
                    className="font-semibold text-on-surface group-hover:text-primary transition-colors text-sm leading-snug"
                    style={{ fontFamily: "'Public Sans', sans-serif" }}
                  >
                    {work.work_type?.replace(/_/g, ' ') || 'Work Type N/A'}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                    <span>{work.district_code}, {work.state_code}</span>
                  </div>
                </div>

                {/* Financial */}
                <div className="bg-surface-container rounded-lg p-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-on-surface-variant">Sanctioned</div>
                    <div className="font-semibold text-on-surface">{formatLakh(work.sanction_amount)}</div>
                  </div>
                  {work.composite_score != null && (
                    <div>
                      <div className="text-on-surface-variant">Risk Score</div>
                      <div className={`font-bold ${work.composite_score > 70 ? 'text-error' : work.composite_score > 40 ? 'text-on-tertiary-container' : 'text-secondary'}`}>
                        {work.composite_score.toFixed(0)}/100
                      </div>
                    </div>
                  )}
                </div>

                {/* Sanction date */}
                {work.sanction_date && (
                  <div className="flex items-center gap-1 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                    Sanctioned: {new Date(work.sanction_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                )}

                {/* CTA arrow */}
                <div className="flex justify-end pt-1 border-t border-outline-variant/20 mt-auto">
                  <span className="text-xs text-primary flex items-center gap-1 font-semibold group-hover:gap-2 transition-all">
                    View Full Details
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination bottom */}
        {!loading && works.length >= PAGE_SIZE && (
          <div className="flex items-center justify-center gap-space-md mt-space-2xl">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="btn-ghost text-sm disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              Previous
            </button>
            <span className="text-sm text-on-surface-variant">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              className="btn-ghost text-sm"
            >
              Next
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
