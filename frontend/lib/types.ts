export type ConfidenceTier = 
  | 'L1' 
  | 'L2' 
  | 'L3' 
  | 'L1_PATTERNS' 
  | 'L2_HIGH_CONFIDENCE' 
  | 'L3_CRITICAL_CORROBORATED';

export type AnomalyCategory = 
  | 'GHOST_WORK' 
  | 'FUND_LAPSE_RISK' 
  | 'CONTRACTOR_NEXUS' 
  | 'WEATHER_IMPOSSIBILITY' 
  | 'CROSS_SCHEME_DUPLICATE' 
  | 'COST_INFLATION' 
  | 'SANCTION_DELAY';

export interface Work {
  work_id: string;
  work_code?: string;
  work_title?: string;
  work_description?: string;
  work_type?: string;
  work_type_category?: string;
  work_category?: string;
  constituency_code?: string;
  constituency_name?: string;
  district_code?: string;
  district_name?: string;
  state_code?: string;
  state_name?: string;
  mp_id?: string;
  mp_name?: string;
  sanction_amount?: number;
  release_amount?: number;
  expenditure_amount?: number;
  sanction_date?: string;
  completion_date?: string;
  reported_lat?: number;
  reported_lon?: number;
  contractor_gstin?: string;
  contractor_name?: string;
  implementing_agency?: string;
  scheme_year?: number;
  status: 'RECOMMENDED' | 'SANCTIONED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | string;
  risk_score?: number | any;
  composite_score?: number;
  confidence_tier?: ConfidenceTier;
  active_signals?: string[];
  has_satellite_audit?: boolean;
  created_at?: string;
}

export interface Anomaly {
  anomaly_id?: string;
  work_id: string;
  work_code?: string;
  work_title?: string;
  work_description?: string;
  district_name?: string;
  district_code?: string;
  state_code?: string;
  work_type?: string;
  category?: AnomalyCategory | string;
  tier?: ConfidenceTier;
  confidence_tier?: ConfidenceTier;
  risk_score?: number;
  composite_score?: number;
  sanction_amount?: number;
  sanction_date?: string;
  completion_date?: string;
  active_signals?: string[];
  signals?: {
    name: string;
    score: number;
    description: string;
  }[];
  review_status?: 'PENDING' | 'IN_REVIEW' | 'VERIFIED' | 'DISMISSED' | string;
  mp_masked?: boolean;
  mp_id_masked?: string;
  mp_name_or_masked?: string;
  constituency_name?: string;
  detected_at?: string;
  audit_note_draft?: string;
}

export interface SatelliteResult {
  check_id?: number;
  work_id: string;
  date_before?: string;
  date_after?: string;
  ndbi_change?: number;
  ndvi_change?: number;
  change_score?: number;
  satellite_flag?: boolean;
  confidence?: number;
  cloud_coverage_pct?: number;
  imagery_before_url?: string;
  imagery_after_url?: string;
  thumbnail_before_url?: string;
  thumbnail_after_url?: string;
}

export interface ContractorNode {
  id: string;
  name: string;
  gstin: string;
  pan: string;
  total_works: number;
  total_amount: number;
  risk_score: number;
  flags: string[];
  is_cluster_hub?: boolean;
}

export interface ContractorLink {
  source: string;
  target: string;
  reason: 'SHARED_PHONE' | 'SHARED_ADDRESS' | 'BID_RING' | 'COMMON_DIRECTOR';
  weight: number;
}

export interface ContractorGraphData {
  nodes: ContractorNode[];
  links: ContractorLink[];
}

export interface MPProfile {
  mp_id: string;
  name: string;
  house: 'LOKSABHA' | 'RAJYASABHA';
  constituency_name: string;
  state_name: string;
  party: string;
  term_start: string;
  term_end: string;
  entitlement: number; // usually 25 Cr (5 Cr/yr)
  recommended_amount: number;
  sanctioned_amount: number;
  expenditure_amount: number;
  unspent_balance: number;
  projected_lapse_amount: number;
  lapse_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  historical_expenditures: {
    year: string;
    actual: number;
    recommended: number;
    projected?: number;
  }[];
}

export interface CitizenReport {
  report_id: string;
  work_id: string;
  work_title: string;
  status: string;
  claimed_progress_pct: number;
  reported_progress_pct: number;
  has_geotagged_photo: boolean;
  gps_distance_meters: number;
  remarks: string;
  submitted_at: string;
  discrepancy_score: number;
}

// ── Authentication ──────────────────────────────────────────────────────────
//
// Mirrors backend/auth.py. `PUBLIC` is the anonymous read class, not something
// an account can hold: the backend refuses to issue or accept a token for it.

export type AccountRole =
  | 'PUBLIC'
  | 'CITIZEN'
  | 'MP'
  | 'AUDITOR'
  | 'DISTRICT_AUTHORITY'
  | 'ADMIN';

export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  full_name?: string | null;
  role: Exclude<AccountRole, 'PUBLIC'>;
  state_code?: string | null;
  district_name?: string | null;
  constituency_name?: string | null;
  mp_id?: string | null;
  is_active: boolean;
  last_login?: string | null;
}

/** Display name, preferring the real name over the login handle. */
export function displayName(user: UserProfile | null): string {
  if (!user) return 'Signed out';
  return user.full_name?.trim() || user.username;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: Exclude<AccountRole, 'PUBLIC'>;
  expires_at: string;
  expires_in_minutes: number;
}

// There is no `LoginResponse`. The endpoint returns this token and nothing else;
// the account's identity comes from `GET /auth/me`. A combined type would let a
// caller render a profile that was never sent.

// ── Citizen demands ──────────────────────────────────────────────────────────
//
// A demand is a request received by this portal. The portal issues a receipt
// reference and nothing else: it does not sanction anything, and no government
// order number is ever generated. `status` therefore only describes internal
// routing, never an office's decision.

export type DemandStatus = 'RECEIVED' | 'ROUTED' | 'ACKNOWLEDGED' | 'WITHDRAWN' | string;

export interface CitizenDemandCreate {
  work_title: string;
  description?: string;
  work_category?: string;
  state_code?: string;
  district_name?: string;
  constituency_name?: string;
  village?: string;
  estimated_amount?: number;
  contact_phone?: string;
  contact_email?: string;
}

export interface CitizenDemand {
  demand_id: string;
  /** This portal's own receipt id. NOT a government sanction order number. */
  acknowledgement_ref: string;
  submitted_by: string;
  submitted_by_name?: string | null;
  work_title: string;
  description?: string | null;
  work_category?: string | null;
  state_code?: string | null;
  district_name?: string | null;
  constituency_name?: string | null;
  village?: string | null;
  estimated_amount?: number | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** Records this portal's internal routing, not a decision by any office. */
  routed_to_role?: string | null;
  status: DemandStatus;
  decision_note?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  created_at?: string;
  attachment_count?: number;
}

export interface DemandAcknowledgement {
  status: string;
  acknowledgement_ref: string;
  submitted_at: string;
  attachment_count?: number;
  /**
   * States in words that this is a receipt and not an approval. Rendered
   * verbatim wherever a reference is shown, so no screen can present the
   * reference as a sanction.
   */
  notice: string;
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export interface EvidenceAttachment {
  attachment_id: string;
  original_filename: string;
  content_type?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
  uploaded_by?: string | null;
  uploaded_at?: string;
}

