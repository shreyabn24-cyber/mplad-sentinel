import { DemandStatus } from './types';

/**
 * One vocabulary for request status, shared by the citizen, MP and district
 * views.
 *
 * The previous version gave each page its own inline ternary over status
 * strings, and one of them rendered:
 *
 *   demand.status === 'SANCTIONED_BY_DISTRICT' ? 'Administratively Sanctioned
 *   by District Collector'
 *
 * The backend never writes that status. It writes `RECEIVED`, `ROUTED`,
 * `ACKNOWLEDGED` or `WITHDRAWN`, describing only this portal's own routing. So
 * the label existed for a code no server could produce, and the surrounding UI
 * described an MP endorsing and a District Magistrate sanctioning — none of
 * which this application performs. Placing the mapping in one file makes the
 * distinction explicit: these are internal states, and an unrecognised value is
 * shown verbatim rather than quietly relabelled as something it is not.
 */

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Recorded — not yet routed',
  ROUTED: 'Routed for internal review',
  ACKNOWLEDGED: 'Reviewed by an account with a decision role',
  WITHDRAWN: 'Withdrawn by the requester',
};

const STATUS_TONES: Record<string, string> = {
  RECEIVED: 'bg-surface-container-highest text-on-surface border-outline-variant/40',
  ROUTED: 'bg-amber-500/15 text-amber-900 border-amber-600/30',
  ACKNOWLEDGED: 'bg-emerald-500/15 text-emerald-900 border-emerald-600/30',
  WITHDRAWN: 'bg-surface-container text-on-surface-variant border-outline-variant/30',
};

const UNKNOWN_TONE = 'bg-surface-container text-on-surface-variant border-outline-variant/40';

export function displayDemandStatus(status: DemandStatus | null | undefined): string {
  if (!status) return 'Status unknown';
  return STATUS_LABELS[status] ?? `Unrecognised status: ${status}`;
}

export function demandStatusTone(status: DemandStatus | null | undefined): string {
  if (!status) return UNKNOWN_TONE;
  return STATUS_TONES[status] ?? UNKNOWN_TONE;
}

/**
 * Statuses this deployment can actually produce.
 *
 * Exported so a view can state which of these it expects, rather than implying
 * a wider set of outcomes exists.
 */
export const KNOWN_DEMAND_STATUSES = Object.keys(STATUS_LABELS);
