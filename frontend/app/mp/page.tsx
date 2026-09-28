'use client';

/**
 * Constituency desk for an account holding the MP role.
 *
 * What this page previously was
 * -----------------------------
 * A role-play screen. There was a "Switch to Hon'ble MP (Akhilesh Yadav)"
 * button that assigned the visitor the MP identity in localStorage, after which
 * the page displayed that real parliamentarian's name and constituency with
 * figures attached. The fund tiles were partly synthesised as
 * `totalAllocation * 0.68` and `* 0.52` — invented sanctioned and spent amounts
 * presented as this MP's real position. The request inbox read a localStorage
 * array, and "Endorse & Recommend for MPLADS Sanction" rewrote a status string
 * in the browser while announcing that the request had gone to the district.
 *
 * What it is now
 * --------------
 *  - The identity and jurisdiction come from the signed-in account, and the
 *    page is closed to anyone without the MP role.
 *  - Every rupee figure is read from `GET /mp/{id}/profile`; none is estimated.
 *    The unspent figure is a subtraction of two of them, and is now labelled as
 *    calculated rather than presented as a published balance.
 *  - The works list is scoped to the account's constituency, not the first
 *    eight works the API returns.
 *  - The request inbox calls `GET /citizen/demands`, which the server scopes to
 *    the account's constituency.
 *  - The only action available is an acknowledgement recorded against the
 *    account, with a note the MP must type. The backend will not accept
 *    anything else, and there is no order number anywhere on this page.
 */

import React, { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useAuth, displayName } from '@/lib/auth';
import {
  ApiError,
  acknowledgeDemand,
  fetchMPProfile,
  fetchOfficeDemands,
  fetchWorks,
} from '@/lib/api';
import { CitizenDemand, Work } from '@/lib/types';
import { useLanguage } from '@/lib/languageContext';
import { displayDemandStatus, demandStatusTone } from '@/lib/demandStatus';

/** Crore formatter that shows an explicit dash instead of inventing ₹0.00. */
function cr(v: number | null | undefined): string {
  if (v == null) return '—';
  return `₹ ${(v / 10000000).toFixed(2)} Cr`;
}

function pct(num: number | null, den: number | null): number | null {
  if (num == null || !den) return null;
  return Math.round((num / den) * 100);
}

export default function MPProfilePage() {
  const { user, role } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<any>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [fundsError, setFundsError] = useState('');
  const [worksError, setWorksError] = useState('');

  const [demands, setDemands] = useState<CitizenDemand[]>([]);
  const [demandsLoading, setDemandsLoading] = useState(false);
  const [demandsError, setDemandsError] = useState('');

  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const isMp = role === 'MP';
  const mpId = user?.mp_id ?? null;

  // The account's own jurisdiction is the only scope used here. It comes from
  // `GET /auth/me`, so there is no way for the page to display a constituency
  // other than the one the server holds for this account.
  useEffect(() => {
    if (!isMp || !mpId) return;
    let cancelled = false;

    setFundsError('');
    setWorksError('');

    fetchMPProfile(mpId)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setProfile(null);
        setFundsError(
          err instanceof ApiError
            ? `Constituency fund figures could not be loaded: ${err.detail}`
            : 'Constituency fund figures could not be loaded because the service is unreachable. ' +
              'No estimated or cached amounts are shown.'
        );
      });

    // Scoped server-side on the account's `mp_id`, not an unfiltered list.
    // The account carries `constituency_name` but no `constituency_code`, and
    // `GET /works` filters on `mp_id`, so this is the identifier that actually
    // narrows the query instead of silently returning another constituency's
    // works.
    fetchWorks({ mp_id: mpId, limit: 8 })
      .then((w) => {
        if (cancelled) return;
        setWorks(w);
        if (w.length === 0) {
          setWorksError(
            mpId
              ? `No works are on record for MP code ${mpId}.`
              : 'This account has no MP code recorded, so no works can be scoped to it.'
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setWorks([]);
        setWorksError('Constituency works could not be loaded, so no list is shown.');
      });

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
  }, [isMp, mpId]);

  const totalAllocation: number | null = profile?.total_allocation ?? null;
  const sanctionedAmount: number | null = profile?.total_sanctioned ?? null;
  const expenditureAmount: number | null = profile?.total_spent ?? null;
  const unspentBalance: number | null =
    totalAllocation != null && expenditureAmount != null
      ? totalAllocation - expenditureAmount
      : null;
  const utilizationPct: number | null =
    profile?.utilization_pct != null
      ? Math.round(profile.utilization_pct)
      : pct(expenditureAmount, totalAllocation);

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
      // Replace with the server's own response, so the row shows the recorded
      // status, the deciding account and the timestamp the server wrote.
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

  if (!isMp) {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[50vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/15 text-amber-700 flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">lock</span>
          </div>
          <h1 className="text-2xl font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            This desk is for MP accounts
          </h1>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {role === 'PUBLIC'
              ? 'You are not signed in. Constituency fund figures and the request queue are served only to an account whose role is MP, and the server scopes the response to that account\'s constituency.'
              : `Your account holds the role ${role}, not MP.`}{' '}
            This page previously offered a &ldquo;Switch to Hon&apos;ble MP&rdquo; button that
            assigned the identity in the browser — it could display a named parliamentarian&apos;s
            constituency and fund figures to anyone who clicked it, which is why the button is gone
            rather than renamed.
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

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ── MP Header Banner ──────────────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-on-surface-variant font-mono">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 font-bold border border-amber-600/30">MP account</span>
              <span>•</span>
              <span className="font-semibold text-primary">
                {user?.constituency_name ?? 'Constituency not recorded on this account'},{' '}
                {user?.state_code ?? '—'}
              </span>
              {mpId && (
                <>
                  <span>•</span>
                  <span>MP Code: {mpId}</span>
                </>
              )}
            </div>
            <h1
              className="text-2xl md:text-3xl font-bold text-primary tracking-tight flex items-center gap-2"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              <span className="material-symbols-outlined text-amber-700 text-[28px]">account_balance</span>
              Constituency Desk
            </h1>
            <p className="text-xs text-on-surface-variant max-w-2xl">
              Signed in as <strong>{displayName(user)}</strong>. The rupee figures are read from the
              server and are not estimated. Two of them are arithmetic on those figures, and are
              labelled as such: the unspent balance is allocation minus expenditure, and the
              percentage is the same division.
            </p>
          </div>

          <div className="text-right p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shrink-0">
            <span className="text-[11px] text-on-surface-variant block uppercase tracking-wider font-semibold">
              Allocation on record
            </span>
            <div className="text-2xl font-mono font-bold text-emerald-700">{cr(totalAllocation)}</div>
            <span className="text-[10px] text-on-surface-variant">
              {profile?.allocation_note ?? 'For the tenure of this MP, from the server'}
            </span>
          </div>
        </div>

        {/* ── Fund Overview Metrics Cards ───────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-outline-variant/20">
          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Total Allocation</div>
            <div className="text-lg font-mono font-bold text-primary">{cr(totalAllocation)}</div>
            <span className="text-[10px] text-on-surface-variant">Tenure allocation</span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Sanctioned Amount</div>
            <div className="text-lg font-mono font-bold text-primary">{cr(sanctionedAmount)}</div>
            <span className="text-[10px] text-on-surface-variant">
              {pct(sanctionedAmount, totalAllocation) != null
                ? `${pct(sanctionedAmount, totalAllocation)}% sanctioned`
                : 'No sanction value on record'}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low">
            <div className="text-[11px] text-on-surface-variant mb-1 font-semibold">Disbursed Expenditure</div>
            <div className="text-lg font-mono font-bold text-emerald-700">{cr(expenditureAmount)}</div>
            <span className="text-[10px] text-on-surface-variant">
              {utilizationPct != null ? `${utilizationPct}% utilized` : 'Utilisation unavailable'}
            </span>
          </div>

          {/*
            Labelled "calculated" because it is not a figure any source published:
            it is `total_allocation - total_spent`, computed here. Both inputs are
            shown above, so a reader can check it. The old label, "Unspent
            Balance", presented it as a recorded amount, and the page elsewhere
            claimed nothing was derived from anything.
          */}
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-600/20">
            <div className="text-[11px] text-amber-900 mb-1 font-semibold">
              Unspent (calculated)
            </div>
            <div className="text-lg font-mono font-bold text-amber-800">{cr(unspentBalance)}</div>
            <span className="text-[10px] text-amber-900">
              Allocation minus expenditure, computed here. Not a published figure, and not a
              commitment by this portal.
            </span>
          </div>
        </div>

        {fundsError && (
          <div className="mt-4 p-3 rounded-lg bg-error-container/60 border border-error text-on-error-container text-xs">
            {fundsError}
          </div>
        )}

        {/*
          Utilisation cannot be shown without an allocation. The previous bar
          divided invented numbers and rendered a confident stacked progress
          bar. It is replaced with an explicit statement of what is missing.
        */}
        <div className="mt-4 space-y-1">
          {utilizationPct == null ? (
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface-variant">
              <strong className="text-on-surface">Fund utilisation cannot be computed.</strong>{' '}
              {profile?.allocation_note ??
                'No authoritative MPLADS allocation is on record for this constituency, so no '
                  + 'utilisation percentage or unspent balance is displayed. Values are left blank '
                  + 'rather than estimated from a default figure.'}
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-on-surface-variant font-mono">
                <span>Fund Utilization Progress</span>
                <span>{utilizationPct}% Disbursed</span>
              </div>
              <div className="w-full h-2.5 bg-surface-container-high rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${utilizationPct}%` }}
                  className="bg-emerald-600 h-full rounded-l-full"
                  title="Disbursed"
                />
              </div>
              <div className="flex justify-between text-[10px] text-on-surface-variant">
                <span className="text-emerald-700 font-semibold">● Disbursed ({cr(expenditureAmount)})</span>
                <span className="text-amber-800 font-semibold">
                  ● Unspent, calculated ({cr(unspentBalance)})
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Access note ───────────────────────────────────────── */}
      <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/40 flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">verified_user</span>
        <div className="text-xs text-on-surface-variant leading-relaxed">
          <strong className="text-primary">Why there is no anomaly data here:</strong> the
          reviewer-only endpoints and the reviewer desk are separate from this page, so an MP
          account cannot read risk flags, tiers or review evidence. That is a configuration
          choice in this deployment rather than a statutory rule, and it is described as such
          rather than as a legal prohibition.
        </div>
      </div>

      {/* ── Two Column Workspace ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        {/* ── Left Column: Request queue ──────────────────────── */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-700 text-[20px]">mark_email_unread</span>
              <h2
                className="text-base font-bold text-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {t('petition_inbox', 'Citizen Requests in this Constituency')}
              </h2>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 font-bold">
              {demands.length} shown
            </span>
          </div>

          <p className="text-xs text-on-surface-variant">
            Returned by <code className="font-mono">GET /citizen/demands</code>, which the server
            scopes to this account&apos;s constituency
            {user?.constituency_name ? ` (${user.constituency_name})` : ''}. Acknowledging a request
            records your account and note against it. It does not sanction a work, release funds, or
            send anything to an office outside this system.
          </p>

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

          <div className="space-y-3">
            {demandsLoading ? (
              <p className="text-xs text-on-surface-variant py-6 text-center">Loading requests...</p>
            ) : demands.length === 0 ? (
              !demandsError && (
                <div className="text-center py-8 text-on-surface-variant text-xs">
                  No requests are recorded for this constituency.
                </div>
              )
            ) : (
              demands.map((demand) => (
                <div
                  key={demand.demand_id}
                  className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container px-1.5 py-0.5 rounded">
                        {demand.work_category ?? 'Uncategorised'}
                      </span>
                      <h3 className="text-xs font-bold text-primary mt-1">{demand.work_title}</h3>
                      {demand.description && (
                        <p className="text-[11px] text-on-surface-variant mt-0.5">{demand.description}</p>
                      )}
                    </div>
                    {demand.estimated_amount != null && (
                      <span className="text-xs font-mono font-bold text-on-surface shrink-0">
                        ₹ {demand.estimated_amount.toLocaleString('en-IN')}
                        <span className="block text-[10px] font-normal text-on-surface-variant">
                          citizen&apos;s estimate
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant pt-2 border-t border-outline-variant/20">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">person</span>
                      <strong>{demand.submitted_by_name || demand.submitted_by}</strong>
                    </span>
                    {demand.village && <span>{demand.village}</span>}
                    {demand.created_at && (
                      <span className="font-mono text-[10px]">
                        {new Date(demand.created_at).toLocaleDateString('en-IN')}
                      </span>
                    )}
                    {demand.attachment_count ? (
                      <span className="font-mono text-[10px]">
                        {demand.attachment_count} file(s) attached
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1 border ${demandStatusTone(demand.status)}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">hourglass_top</span>
                      <span>{displayDemandStatus(demand.status)}</span>
                    </span>
                    {demand.decided_by && (
                      <span className="text-[10px] text-on-surface-variant">
                        Noted by {demand.decided_by}
                        {demand.decided_at
                          ? ` · ${new Date(demand.decided_at).toLocaleDateString('en-IN')}`
                          : ''}
                      </span>
                    )}
                  </div>

                  {demand.decision_note && (
                    <p className="text-[11px] text-on-surface-variant border-l-2 border-outline-variant pl-2">
                      {demand.decision_note}
                    </p>
                  )}

                  {demand.status !== 'ACKNOWLEDGED' && demand.status !== 'WITHDRAWN' && (
                    noteFor === demand.demand_id ? (
                      <form onSubmit={(e) => handleAcknowledge(e, demand)} className="space-y-2">
                        <textarea
                          rows={2}
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="What is your response to the requester? This is stored with your account name."
                          className="w-full px-3 py-2 border border-outline-variant/60 rounded-lg text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                          required
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={acting === demand.demand_id}
                            className="px-3 py-1.5 bg-amber-700 text-white rounded-lg text-[11px] font-bold hover:bg-amber-800 transition-colors disabled:opacity-60"
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
                        className="w-full py-2 px-3 bg-amber-700 text-white rounded-lg text-xs font-bold hover:bg-amber-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit_note</span>
                        Record an acknowledgement
                      </button>
                    )
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right Column: Constituency works ────────────────── */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">construction</span>
              <h2
                className="text-base font-bold text-primary"
                style={{ fontFamily: "'Public Sans', sans-serif" }}
              >
                {t('works_progress', 'Works in this Constituency')}
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

          <p className="text-xs text-on-surface-variant">
            Filtered server-side on the MP code on your account
            {mpId ? ` (${mpId})` : ' — none recorded'}. The previous version fetched the first
            eight works the API returned, whatever the constituency.
          </p>

          {worksError && (
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/40 text-xs text-on-surface-variant">
              {worksError}
            </div>
          )}

          <div className="space-y-3">
            {works.map((work) => (
              <Link
                key={work.work_id}
                href={`/works/${work.work_id}`}
                className="block p-3.5 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container transition-colors space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] text-on-surface-variant">
                      {work.work_code || work.work_id}
                    </span>
                    <h3 className="text-xs font-bold text-primary mt-0.5 line-clamp-1">
                      {work.work_title}
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-primary shrink-0">
                    {work.sanction_amount != null
                      ? `₹ ${(work.sanction_amount / 100000).toFixed(1)}L`
                      : '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>
                    Type: <strong className="text-on-surface">{work.work_type ?? '—'}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface">
                    {work.status ?? 'Status not on record'}
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
