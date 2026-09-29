/**
 * Canonical Indian state / UT registry.
 *
 * This lives in one place because the two filter UIs previously carried their
 * own private copies of the list and had already drifted: Works listed all 36
 * entries while Anomalies was missing CH, DD, LA, LD and PY. A user filtering
 * Anomalies by Chandigarh was told the state did not exist.
 *
 * Codes are ISO 3166-2:IN. Note that ISO 3166-2:IN still assigns 'UT' to the
 * union territories collectively; the individual codes below are the ones
 * used by the MPLADS/GeoPSU data, so 'UT' is intentionally not one of them.
 */

export interface StateOption {
  code: string;
  name: string;
}

export const STATES: StateOption[] = [
  { code: 'AN', name: 'Andaman & Nicobar Islands' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },
  { code: 'CH', name: 'Chandigarh' },
  { code: 'CG', name: 'Chhattisgarh' },
  { code: 'DD', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'HR', name: 'Haryana' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'JK', name: 'Jammu & Kashmir' },
  { code: 'JH', name: 'Jharkhand' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'MN', name: 'Manipur' },
  { code: 'ML', name: 'Meghalaya' },
  { code: 'MZ', name: 'Mizoram' },
  { code: 'NL', name: 'Nagaland' },
  { code: 'OD', name: 'Odisha' },
  { code: 'PY', name: 'Puducherry' },
  { code: 'PB', name: 'Punjab' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'TG', name: 'Telangana' },
  { code: 'TR', name: 'Tripura' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'UK', name: 'Uttarakhand' },
  { code: 'WB', name: 'West Bengal' },
];

export const STATE_CODES: string[] = STATES.map((s) => s.code);

const STATE_ALIASES: Record<string, string> = {
  OR: 'OD',
  TS: 'TG',
  CT: 'CG',
  UT: 'UK',
};

/** Human-readable name for a state code, or the code itself if unknown. */
export function stateName(code?: string | null): string {
  if (!code) return '—';
  const upper = code.toUpperCase();
  const canonical = STATE_ALIASES[upper] || upper;
  const hit = STATES.find((s) => s.code === canonical || s.code === upper);
  return hit ? hit.name : code;
}

