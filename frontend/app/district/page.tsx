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
 *    agency was contacted — it was a timestamp and a random number formatted
 *    like a government order.
 *  - `handleDisbursement` created `PFMS<date><state><random>` UTR numbers and
 *    preloaded two "completed" disbursements, asserting ₹8.42 Cr had moved
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
import { useAuth, displayName } from '@/lib/auth';
import {
  ApiError,
  acknowledgeDemand,
  fetchOfficeDemands,
  fetchWorks,
} from '@/lib/api';
import { CitizenDemand, Work } from '@/lib/types';
import { displayDemandStatus, demandStatusTone } from '@/lib/demandStatus';

export default function DistrictDeskPage() {
  const { user, role } = useAuth();

  const isDistrict = role === 'DISTRICT_AUTHORITY' || role === 'ADMIN';
  // Straight from the account record. The previous version defaulted to
  // 'Kannauj' / 'UP', so an account with no district on it was still shown a
  // real collectorate's name and its works.
  const districtName = user?.district_name ?? null;
  const stateCode = user?.state_code ?? null;

  const [activeTab, setActiveTab] = useState<'requests' | 'works'>('requests');

  const [works, setWorks] = useState<Work[]>([]);
  const [loadingWorks, setLoadingWorks] = useState(true);
  const [worksError, setWorksError] = useState('');

  const [demands, setDemands] = useState<CitizenDemand[]>([]);
  const [demandsLoading, setDemandsLoading] = useState(false);
  const [demandsError, setDemandsError] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!isDistrict) return;
    let cancelled = false;

    setLoadingWorks(true);
    setWorksError('');
    if (!districtName || !stateCode) {
      setWorks([]);
      setLoadingWorks(false);
      // The server refuses `district_name` without `state_code` for the same
      // reason: district names repeat between states, so a name on its own
      // cannot identify the district. Mirroring that here means an
      // incompletely provisioned account explains itself rather than making a
      // request the API will reject.
      setWorksError(
        !districtName
          ? 'This account has no district recorded, so no works can be scoped to it. An operator ' +
              'must set the district on the account.'
          : 'This account has a district but no state, so its works cannot be identified. ' +
              'District names repeat between states, so the server will not accept a district ' +
              'name on its own. An operator must set the state on the account.'
      );
    } else {
      fetchWorks({ state_code: stateCode, district_name: districtName, limit: 50 })
        .then((rows) => {
          if (cancelled) return;
          setWorks(rows);
          if (rows.length === 0) {
            setWorksError(`No works are on record for ${districtName}.`);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setWorks([]);
          setWorksError(
            err instanceof ApiError
              ? `District works could not be loaded: ${err.detail}`
              : 'District works could not be loaded because the service is unreachable, so no ' +
                'list is shown.'
          );
        })
        .finally(() => {
          if (!cancelled) setLoadingWorks(false);
        });
    }

    setDemandsLoading(true);
    setDemandsError('');
    fetchOfficeDemands()
      .then((rows) => {
        if (cancelled) return;
        setDemands(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setDemands([]);
        setDemandsError(
          err instanceof ApiError
            ? err.detail
            : 'The request queue could not be loaded, so no requests are shown.'
        );
      })
      .finally(() => {
        if (!cancelled) setDemandsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDistrict, districtName, stateCode]);

  async function handleAcknowledge(e: FormEvent, demand: CitizenDemand) {
    e.preventDefault();
    setActionError('');
    const note = noteText.trim();
    if (note.length < 3) {
      setActionError('A note is required. It is stored with your account name and the request.');
      return;
    }
    setActing(demand.demand_id);
    try {
      const updated = await acknowledgeDemand(demand.demand_id, note);
      setDemands((prev) => prev.map((d) => (d.demand_id === updated.demand_id ? updated : d)));
      setNoteFor(null);
      setNoteText('');
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.detail
          : 'The note was not recorded. Nothing was changed.'
      );
    } finally {
      setActing(null);
    }
  }

  if (!isDistrict) {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[50vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-secondary/15 text-secondary flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">lock</span>
          </div>
          <h1 className="text-2xl font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            This desk is for district authority accounts
          </h1>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {role === 'PUBLIC'
              ? 'You are not signed in. This page and the request queue behind it are served only to an account whose role is DISTRICT_AUTHORITY or ADMIN, and the server scopes the response to that account\'s district.'
              : `Your account holds the role ${role}, not DISTRICT_AUTHORITY.`}{' '}
            The page previously offered a button that assigned a district identity in the browser
            and then displayed sanction orders and PFMS UTR numbers, which is why it is closed
            rather than reopened with a rename.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
            <Link href="/login" className="btn-primary text-sm inline-flex items-center justify-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">login</span>
              Sign in
            </Link>
            <Link href="/works" className="btn-secondary text-sm inline-flex items-center justify-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">construction</span>
              Browse published works
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const openRequests = demands.filter((d) => d.status !== 'ACKNOWLEDGED' && d.status !== 'WITHDRAWN');
  const reviewed = demands.filter((d) => d.status === 'ACKNOWLEDGED');

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ── District Authority Header ──────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-on-surface-variant font-mono">
              <span className="px-2 py-0.5 rounded bg-secondary/20 text-emerald-900 font-bold border border-secondary/30">
                District authority account
              </span>
              <span>•</span>
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
              District Desk
            </h1>
            <p className="text-xs text-on-surface-variant max-w-3xl">
              Signed in as <strong>{displayName(user)}</strong>. This desk reviews citizen requests
              and lists the district&apos;s works. It does not sanction works, release funds, issue
              tenders, or contact PFMS — those actions are taken in the district&apos;s own systems,
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

        {/* ── Key Metrics ───────────────────────────────────────── */}
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
              {loadingWorks ? '—' : works.length}
            </div>
            <span className="text-[10px] text-on-surface-variant">From the works register</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Funds disbursed</div>
            <div className="text-lg font-mono font-bold text-on-surface-variant">Not connected</div>
            <span className="text-[10px] text-on-surface-variant">No PFMS or bank feed</span>
          </div>
        </div>

        {/* ── Navigation Tabs ───────────────────────────────────── */}
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

      {/* ── TAB: requests ──────────────────────────────────────── */}
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
                {demands.length} in district
              </span>
            </div>

            {demandsError && (
              <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{demandsError}</span>
              </div>
            )}
            {actionError && (
              <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{actionError}</span>
              </div>
            )}

            {demandsLoading ? (
              <p className="text-xs text-on-surface-variant py-6 text-center">Loading requests...</p>
            ) : demands.length === 0 ? (
              !demandsError && (
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
                {demands.map((demand) => (
                  <div
                    key={demand.demand_id}
                    className="p-5 rounded-xl border border-outline-variant/30 bg-surface-container-low space-y-3.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-on-surface-variant font-bold bg-surface-container px-2 py-0.5 rounded">
                            {demand.acknowledgement_ref}
                          </span>
                          {demand.work_category && (
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container px-2 py-0.5 rounded">
                              {demand.work_category}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-primary mt-2">{demand.work_title}</h3>
                        {demand.description && (
                          <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                            {demand.description}
                          </p>
                        )}
                      </div>
                      {demand.estimated_amount != null && (
                        <div className="text-right shrink-0">
                          <span className="text-sm font-mono font-bold text-on-surface block">
                            ₹ {demand.estimated_amount.toLocaleString('en-IN')}
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
                          Constituency: <strong>{demand.constituency_name ?? '—'}</strong>
                        </span>
                        <span>
                          Location: <strong>{demand.village ?? '—'}</strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>
                          Submitted by: <strong>{demand.submitted_by_name ?? demand.submitted_by}</strong>
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${demandStatusTone(demand.status)}`}
                        >
                          {displayDemandStatus(demand.status)}
                        </span>
                      </div>
                    </div>

                    {demand.decision_note && (
                      <p className="text-[11px] text-on-surface-variant border-l-2 border-outline-variant pl-2">
                        {demand.decision_note}
                        {demand.decided_by && (
                          <span className="block font-mono text-[10px]">
                            — {demand.decided_by}
                            {demand.decided_at
                              ? ` · ${new Date(demand.decided_at).toLocaleString('en-IN')}`
                              : ''}
                          </span>
                        )}
                      </p>
                    )}

                    {demand.status !== 'ACKNOWLEDGED' && demand.status !== 'WITHDRAWN' && (
                      noteFor === demand.demand_id ? (
                        <form onSubmit={(e) => handleAcknowledge(e, demand)} className="space-y-2">
                          <textarea
                            rows={2}
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Your response to the requester. Stored with your account name."
                            className="w-full px-3 py-2 border border-outline-variant/60 rounded-lg text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                            required
                          />
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={acting === demand.demand_id}
                              className="px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-[11px] font-bold hover:bg-secondary/90 disabled:opacity-60"
                            >
                              {acting === demand.demand_id ? 'Recording...' : 'Record acknowledgement'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteFor(null);
                                setNoteText('');
                              }}
                              className="px-3 py-1.5 border border-outline-variant/60 rounded-lg text-[11px] font-bold hover:bg-surface-container"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          onClick={() => {
                            setNoteFor(demand.demand_id);
                            setNoteText('');
                            setActionError('');
                          }}
                          className="w-full py-2.5 px-4 bg-secondary text-on-secondary rounded-xl text-xs font-bold hover:bg-secondary/90 transition flex items-center justify-center gap-2 shadow-sm"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit_note</span>
                          <span>Record an acknowledgement</span>
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: works ────────────────────────────────────────── */}
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
                executing agency — the works register carries allocation and status fields only.
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
                        ? `₹ ${(work.sanction_amount / 100000).toFixed(1)}L`
                        : '—'}
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

          {/* ── What this deployment cannot do ─────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-outline-variant/20">
            {[
              {
                icon: 'gavel',
                title: 'Administrative sanction',
                body:
                  'There is no endpoint that sanctions a work or issues an order number, and this ' +
                  'application is not connected to any district MIS. A sanction is issued in the ' +
                  'district\'s own system; nothing here creates one.',
              },
              {
                icon: 'payments',
                title: 'PFMS disbursement',
                body:
                  'No PFMS or banking connection exists. This page previously displayed UTR ' +
                  'numbers built from Date.now() and Math.random() and a preloaded ₹8.42 Cr ' +
                  'total, which asserted payments that never occurred. No amount is shown here ' +
                  'because none can be read.',
              },
              {
                icon: 'receipt_long',
                title: 'Tender issuance',
                body:
                  'No e-procurement integration exists, so the tender count is not displayed. ' +
                  'Tenders live in GeM and state e-procurement portals, which this deployment ' +
                  'does not read.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-[18px]">
                    {item.icon}
                  </span>
                  <span className="text-xs font-bold text-on-surface">{item.title}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant">
                    unavailable
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
