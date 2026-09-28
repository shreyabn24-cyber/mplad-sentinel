/**
 * MPLADS Sentinel — Frontend API Layer
 * Connects to the FastAPI backend at /api/v1/*
 *
 * Three rules this layer follows
 * ------------------------------
 * 1. **No mock fallback, ever.** Every read used to substitute a hardcoded
 *    record when the backend was unreachable. The worst case was
 *    `fetchWorkById`, which returned `MOCK_WORKS[0]` for *any* unrecognised ID —
 *    so a mistyped or stale project URL rendered a completely different,
 *    real-looking project with a real contractor name and coordinates, and
 *    nothing on screen indicated anything was wrong. Read failures now reject
 *    and the calling view shows an explicit error state.
 *
 * 2. **The access token is attached centrally.** Handlers used to fetch without
 *    an `Authorization` header, so every write returned 401 and each call site
 *    had grown its own ad-hoc header. `withAuth` handles it in one place.
 *
 * 3. **FormData is never given a JSON content type.** Setting
 *    `Content-Type: application/json` on a multipart body strips the boundary
 *    delimiter and the server cannot parse the upload at all, so it is left to
 *    the browser.
 */

import {
  Anomaly,
  CitizenDemand,
  CitizenDemandCreate,
  ContractorGraphData,
  DemandAcknowledgement,
  EvidenceAttachment,
  MPProfile,
  TokenResponse,
  UserProfile,
  Work,
} from './types';

/**
 * The base URL for API calls, and it has to differ by environment.
 *
 * In the browser, the relative `/api/v1` is correct and necessary: the
 * Next.js rewrite in `next.config.js` proxies it to the backend, so the request
 * stays same-origin and no CORS configuration is involved. `NEXT_PUBLIC_API_URL`
 * is inlined at build time, so the fallback is what a build without it uses.
 *
 * On the server there is no rewrite in front of the fetch and no browser to
 * resolve a relative URL: `fetch` requires an absolute one and throws
 * `TypeError: Failed to parse URL` on `/api/v1/works/`. `app/page.tsx` is a
 * Server Component and calls this layer directly, so without this branch every
 * server render of the home page failed its data fetch.
 */
const API_BASE =
  typeof window === 'undefined'
    ? process.env.SERVER_API_URL || 'http://127.0.0.1:8000/api/v1'
    : process.env.NEXT_PUBLIC_API_URL || '/api/v1';

/**
 * Requests that neither resolve nor fail.
 *
 * A hung connection leaves a page spinning on its skeleton indefinitely, with no
 * way for a reader to tell that is different from "loading". Twenty seconds is
 * long enough for a cold database query and short enough that a broken deployment
 * reports itself. Callers can still pass their own `signal`; the two are linked
 * by `AbortSignal.any` so whichever fires first cancels the request.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

const TOKEN_KEY = 'mplads_token';

// ── Token storage ────────────────────────────────────────────────────────────
//
// sessionStorage, not localStorage. A token in localStorage survives the tab
// closing and is readable by any script on the page, so one XSS anywhere gives
// an attacker a long-lived credential. sessionStorage confines it to the tab
// and drops it when the tab closes. The tradeoff is that a page reload inside
// the same tab keeps the session, but a new tab needs a fresh sign-in.

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Private-browsing modes can throw on storage access.
    return null;
  }
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable; the session simply won't persist across reloads */
  }
}

/** Lets the auth layer push token changes into the API layer. */
let authToken: string | null = null;
export function setApiToken(token: string | null): void {
  authToken = token;
}
setApiToken(getToken());

// ── Errors ───────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  /** True when the caller needs to sign in (or was signed out server-side). */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** True when the account is authenticated but not permitted to do this. */
  get isPermissionError(): boolean {
    return this.status === 403;
  }
}

// ── Generic fetch helper ─────────────────────────────────────────────────────

type Body = RequestInit['body'];

/**
 * Perform a request with the access token attached and errors normalised.
 *
 * `isFormData` is inferred, so callers cannot accidentally break an upload by
 * setting a JSON content type over it.
 */
async function request<T>(
  path: string,
  opts: { method?: string; body?: Body; signal?: AbortSignal; cache?: RequestCache } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = authToken;

  if (token) headers.Authorization = `Bearer ${token}`;

  // A FormData body must keep the browser-generated boundary, so no
  // Content-Type is set for it. Anything else is JSON.
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body != null && !isFormData) headers['Content-Type'] = 'application/json';

  // A caller-supplied signal and the timeout are composed rather than one
  // replacing the other: a component unmounting must still cancel its request
  // when there is a default timeout, and the timeout must still apply when a
  // caller passes its own signal. `AbortSignal.any` returns whichever aborts
  // first, and is passed to fetch so the socket is actually torn down.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')),
    DEFAULT_TIMEOUT_MS
  );
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal,
      cache: opts.cache,
    });
  } catch (err) {
    // Distinguish "we gave up" from "the caller cancelled" from "the network is
    // down", because the UI says something different for each. A bare fetch
    // failure gives only "Failed to fetch", which is why every view previously
    // had to guess at the cause.
    if (timeoutController.signal.aborted) {
      throw new ApiError(
        408,
        `The request timed out after ${Math.round(DEFAULT_TIMEOUT_MS / 1000)} seconds without a ` +
          'response. The service may be down or unreachable.'
      );
    }
    if (opts.signal?.aborted) throw err;
    throw new ApiError(
      0,
      'The service could not be reached at all, so nothing was loaded.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!res.ok) {
    // FastAPI puts a human-readable explanation in `detail`, sometimes as a
    // list of validation objects. Prefer it over a bare status code so the UI
    // can tell the user what actually went wrong.
    let detail = `Request failed (HTTP ${res.status})`;
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const raw = (payload as { detail: unknown }).detail;
      if (typeof raw === 'string') detail = raw;
      else if (Array.isArray(raw)) {
        detail = raw
          .map((d) =>
            d && typeof d === 'object' && 'msg' in d
              ? String((d as { msg: unknown }).msg)
              : String(d)
          )
          .join('; ');
      }
    }
    throw new ApiError(res.status, detail);
  }

  return payload as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Exchange credentials for an access token. */
export async function login(
  username: string,
  password: string
): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/** The account behind the current token. Used to rehydrate a page load. */
export async function fetchCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>('/auth/me');
}

/**
 * Whether the caller holds a token, without requiring a network round trip.
 *
 * The SSE stream cannot set an Authorization header, so the backend has
 * deliberately refused a `token` query parameter instead of accepting a
 * credential that would then land in access logs. The stream is therefore only
 * opened for an authenticated session, and the backend reads the role from the
 * header-based path.
 */
export async function whoami(): Promise<{
  authenticated: boolean;
  role: string;
  username: string | null;
}> {
  return request('/auth/whoami');
}

// ── Works ─────────────────────────────────────────────────────────────────────

export interface WorkQuery {
  state_code?: string;
  district_code?: string;
  district_name?: string;
  constituency_code?: string;
  /** `mp_id` on the backend. This was named `mp`, which the API does not
   * accept, so the parameter was silently dropped and callers received an
   * unfiltered list. */
  mp_id?: string;
  work_type?: string;
  tier?: string;
  status?: string;
  scheme_year?: number;
  min_score?: number;
  search?: string;
  has_satellite_audit?: boolean;
  has_coordinates?: boolean;
  official_id_only?: boolean;
  sort?: string;
  skip?: number;
  limit?: number;
}

function workQueryString(params?: WorkQuery): string {
  const q = new URLSearchParams();
  if (!params) return '';
  const append = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') {
      q.append(key, String(value));
    }
  };
  append('state_code', params.state_code);
  append('district_code', params.district_code);
  append('district_name', params.district_name);
  append('constituency_code', params.constituency_code);
  append('mp_id', params.mp_id);
  append('work_type', params.work_type);
  append('tier', params.tier);
  append('status', params.status);
  append('scheme_year', params.scheme_year);
  append('min_score', params.min_score);
  append('search', params.search);
  append('has_satellite_audit', params.has_satellite_audit);
  append('has_coordinates', params.has_coordinates);
  append('official_id_only', params.official_id_only);
  append('sort', params.sort);
  append('skip', params.skip);
  append('limit', params.limit);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function fetchWorks(params?: WorkQuery): Promise<Work[]> {
  return request<Work[]>(`/works/${workQueryString(params)}`);
}

export async function fetchWorkById(id: string): Promise<Work | undefined> {
  return request<Work>(`/works/${encodeURIComponent(id)}`);
}

/** Auditor-only. The backend rejects this for anyone without a token. */
export async function generateAuditNote(
  workId: string
): Promise<{
  work_id: string;
  generated_at?: string;
  draft_note?: string;
  model_used?: string;
  disclaimer?: string;
}> {
  return request(`/works/${encodeURIComponent(workId)}/audit-note`);
}

// ── Anomalies ─────────────────────────────────────────────────────────────────

export async function fetchAnomalies(params?: {
  tier?: string;
  state_code?: string;
  district_code?: string;
  reviewed?: boolean;
  skip?: number;
  limit?: number;
}): Promise<Anomaly[]> {
  const q = new URLSearchParams();
  if (params?.tier) q.append('tier', params.tier);
  if (params?.state_code) q.append('state_code', params.state_code);
  if (params?.district_code) q.append('district_code', params.district_code);
  if (params?.reviewed != null) q.append('reviewed', String(params.reviewed));
  if (params?.skip != null) q.append('skip', String(params.skip));
  if (params?.limit) q.append('limit', String(params.limit));
  return request<Anomaly[]>(`/anomalies/?${q.toString()}`);
}

/**
 * Tier counts for the dashboard header.
 *
 * These previously defaulted to a hardcoded `{L1: 28, L2: 14, L3: 7}`. Those
 * numbers were shown to auditors as real detection counts whenever the backend
 * was down, which is the most misleading failure mode in a tool used to make
 * oversight decisions. A failure now rejects so the caller shows "unavailable".
 */
export async function fetchAnomalySummary(): Promise<{ L1: number; L2: number; L3: number }> {
  return request<{ L1: number; L2: number; L3: number }>('/anomalies/summary/');
}

/** Auditor-only. */
export async function fetchL3Anomalies(): Promise<Anomaly[]> {
  return request<Anomaly[]>('/anomalies/l3/');
}

export async function fetchLapseRisk(): Promise<LapseRiskItem[]> {
  return request<LapseRiskItem[]>('/anomalies/lapse-risk/');
}

/** Auditor-only. The verdict is recorded against the real account. */
export async function reviewAnomaly(
  workId: string,
  verdict: string,
  notes: string
): Promise<{ status: string }> {
  return request<{ status: string }>(`/anomalies/${encodeURIComponent(workId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ verdict, notes }),
  });
}

// ── Contractors ───────────────────────────────────────────────────────────────

export async function fetchContractorGraph(): Promise<ContractorGraphData> {
  return request<ContractorGraphData>('/contractors/graph');
}

export async function fetchContractorClusters(): Promise<ContractorCluster[]> {
  return request<ContractorCluster[]>('/contractors/clusters');
}

/** What this deployment can and cannot answer about contractors. */
export async function fetchContractorStatus(): Promise<ContractorCapabilityStatus> {
  return request<ContractorCapabilityStatus>('/contractors/status');
}

export async function fetchContractors(): Promise<ContractorListItem[]> {
  return request<ContractorListItem[]>('/contractors/');
}

export async function fetchContractorRisk(gstin: string): Promise<unknown> {
  return request(`/contractors/${encodeURIComponent(gstin)}/risk`);
}

// ── MPs ───────────────────────────────────────────────────────────────────────

export async function fetchMPProfile(id: string): Promise<MPProfile> {
  return request<MPProfile>(`/mp/${encodeURIComponent(id)}/profile`);
}

export async function fetchMPLapseForecast(mpId: string): Promise<MPLapseForecast> {
  return request<MPLapseForecast>(`/mp/${encodeURIComponent(mpId)}/lapse-forecast`);
}

export async function fetchNationalMPStats(): Promise<NationalMPStats> {
  return request<NationalMPStats>('/mp/national-stats');
}

// ── Satellite ─────────────────────────────────────────────────────────────────

function satelliteUnavailable(workId: string, reason: string): SatelliteResult {
  return {
    work_id: workId,
    status: 'UNAVAILABLE',
    applicable: true,
    // Not measured — must not be coerced to 0.
    ndbi_change: null,
    ndvi_change: null,
    change_score: null,
    satellite_flag: null,
    confidence: null,
    cloud_coverage_pct: null,
    data_source: 'None — check did not run',
    evidence_text: reason,
  };
}

export async function fetchSatelliteResult(workId: string): Promise<SatelliteResult> {
  try {
    return await request<SatelliteResult>(`/satellite/${encodeURIComponent(workId)}`, {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return satelliteUnavailable(
        workId,
        'No satellite check has been recorded for this work, so no imagery evidence exists for it. ' +
          "A recorded check requires an operator to run a scene search against the work's own coordinates."
      );
    }
    const detail = err instanceof ApiError ? err.detail : 'the service did not respond';
    return satelliteUnavailable(
      workId,
      `Satellite service is unavailable (${detail}). No imagery evidence is available.`
    );
  }
}

/** Auditor-only. A failed or inapplicable check is reported as unavailable. */
export async function triggerSatelliteCheck(
  workId: string
): Promise<{ status: string; message?: string }> {
  try {
    return await request('/satellite/trigger-check', {
      method: 'POST',
      body: JSON.stringify({ work_id: workId }),
    });
  } catch (err) {
    const detail = err instanceof ApiError ? err.detail : 'the service did not respond';
    return {
      status: 'unavailable',
      message: `Scene search failed: ${detail}. No imagery check was performed.`,
    };
  }
}

export async function queryAWSSatellite(params: {
  lat: number;
  lon: number;
  start_date: string;
  end_date: string;
  max_cloud_cover?: number;
}): Promise<unknown> {
  return request('/satellite/query-aws', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Citizen reports & evidence ────────────────────────────────────────────────
//
// No mock fallbacks. Invented first-person field testimony ("Visited twice. No
// construction activity…") is indistinguishable from a real citizen report to
// any downstream reader, so a failure surfaces as an error rather than an
// invented list.

/** Auditor-only: these rows carry a submitter's identity and coordinates. */
export async function fetchCitizenReports(): Promise<CitizenReportDB[]> {
  return request<CitizenReportDB[]>('/citizen/reports', { cache: 'no-store' });
}

/** Auditor-only. */
export async function fetchCitizenReportsForWork(workId: string): Promise<CitizenReportDB[]> {
  return request<CitizenReportDB[]>(`/citizen/reports/${encodeURIComponent(workId)}`, {
    cache: 'no-store',
  });
}

/** Auditor-only. */
export async function fetchReportEvidence(reportId: string): Promise<EvidenceAttachment[]> {
  return request<EvidenceAttachment[]>(
    `/citizen/report/${encodeURIComponent(reportId)}/evidence`
  );
}

/** URL for a protected evidence download; must be fetched with the token. */
export function evidenceDownloadUrl(attachmentId: string): string {
  return `${API_BASE}/citizen/evidence/${encodeURIComponent(attachmentId)}/download`;
}

/** Download evidence, carrying the token. A plain <a href> cannot do this. */
export async function downloadEvidence(attachmentId: string): Promise<Blob> {
  const res = await fetch(evidenceDownloadUrl(attachmentId), {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}

/** Submit a citizen ground-truth report. CITIZEN only. */
export async function submitCitizenReport(data: CitizenReportSubmit): Promise<CitizenReportDB> {
  return request<CitizenReportDB>('/citizen/report', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Submit a report together with evidence files.
 *
 * The report fields travel as a JSON string in a form field because a multipart
 * part cannot be a structured object. This does not discard a citizen's evidence
 * on failure: the promise rejects so the UI can say it was NOT saved.
 */
export async function submitCitizenReportWithEvidence(
  data: CitizenReportSubmit,
  files: File[] = []
): Promise<CitizenReportDB> {
  const form = new FormData();
  form.append('report', JSON.stringify(data));
  files.forEach((file) => form.append('photos', file));
  return request<CitizenReportDB>('/citizen/report/with-evidence', {
    method: 'POST',
    body: form,
  });
}

// ── Citizen demands ───────────────────────────────────────────────────────────

/** Register a request. CITIZEN only. The response is a receipt, not a sanction. */
export async function submitDemand(
  payload: CitizenDemandCreate
): Promise<DemandAcknowledgement> {
  return request<DemandAcknowledgement>('/citizen/demands', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function submitDemandWithEvidence(
  payload: CitizenDemandCreate,
  files: File[] = []
): Promise<DemandAcknowledgement> {
  const form = new FormData();
  form.append('demand', JSON.stringify(payload));
  files.forEach((file) => form.append('photos', file));
  return request<DemandAcknowledgement>('/citizen/demands/with-evidence', {
    method: 'POST',
    body: form,
  });
}

/** The signed-in citizen's own requests. CITIZEN only. */
export async function fetchMyDemands(): Promise<CitizenDemand[]> {
  return request<CitizenDemand[]>('/citizen/demands/mine');
}

/**
 * Requests inside the caller's own jurisdiction. MP, DISTRICT_AUTHORITY,
 * AUDITOR, ADMIN.
 *
 * The scope comes from the account record on the server, so there is no
 * parameter here that could widen it — which is why the MP and district desks
 * can show a real queue instead of a local array they invented themselves.
 */
export async function fetchOfficeDemands(
  statusFilter?: string
): Promise<CitizenDemand[]> {
  const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  return request<CitizenDemand[]>(`/citizen/demands${q}`);
}

/**
 * Record a reviewer's acknowledgement on a request.
 *
 * This is the operation the UI used to call "endorse", which only rewrote a
 * status in localStorage. It records an acting account, a note and an audit
 * entry. It is not a sanction and produces no order number — the backend only
 * accepts ACKNOWLEDGE for that reason.
 */
export async function acknowledgeDemand(
  demandId: string,
  note: string,
  routedToRole?: string
): Promise<CitizenDemand> {
  return request<CitizenDemand>(
    `/citizen/demands/${encodeURIComponent(demandId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision: 'ACKNOWLEDGE',
        note,
        routed_to_role: routedToRole,
      }),
    }
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface StreamEvent {
  category: string;
  title: string;
  description: string;
  target_id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  timestamp: string;
}

/**
 * Open the SSE stream.
 *
 * `EventSource` cannot set an Authorization header and the backend refuses a
 * `token` query parameter on purpose — a credential in a query string ends up in
 * access logs and proxy caches. So the stream is only reachable for an
 * authenticated session, and the role scoping on the server is what a client
 * actually receives. Returned events are genuine server-side occurrences.
 */
export function openNotificationStream(
  onEvent: (event: StreamEvent) => void,
  onError?: (message: string) => void
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    onError?.('This browser does not support server-sent events.');
    return () => {};
  }
  if (!authToken) {
    onError?.('Sign in to receive live notifications.');
    return () => {};
  }

  // The cookie path is not implemented on the backend, so an authenticated
  // EventSource is not yet possible. Rather than silently showing an empty
  // notification bell, this reports the limitation.
  onError?.(
    'Live notifications are not available: the event stream requires a cookie-based session this build does not use yet.'
  );
  return () => {};
}

// ── Admin / pipeline ──────────────────────────────────────────────────────────
// A failed pipeline action must reject so the console can show it, rather than
// being converted into a fake "completed" banner.

export async function fetchPipelineStatus(): Promise<PipelineStatus> {
  return request<PipelineStatus>('/admin/pipeline-status', { cache: 'no-store' });
}

export async function triggerPipeline(): Promise<{ status: string; task_id?: string; message?: string }> {
  return request('/admin/trigger-pipeline', { method: 'POST' });
}

export async function syncMospiData(): Promise<{ status: string; message?: string }> {
  return request('/admin/sync-mospi', { method: 'POST' });
}

export async function runCrossSchemeDetection(): Promise<{ status: string; matches_found?: number; message?: string }> {
  return request('/admin/run-cross-scheme', { method: 'POST' });
}

export async function trainMLPipeline(): Promise<{ status: string; message?: string; models?: string[] }> {
  return request('/admin/train-ml', { method: 'POST' });
}

/** Auditor-only. */
export async function broadcastNotification(payload: {
  category: string;
  title: string;
  description: string;
  target_id?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  target_roles?: string[];
}): Promise<{ status: string; subscribers_count: number; connected_subscribers: number }> {
  return request('/notifications/broadcast', {
    method: 'POST',
    body: JSON.stringify({ target_id: 'ALL', severity: 'INFO', target_roles: [], ...payload }),
  });
}

// ── Response types ────────────────────────────────────────────────────────────

export interface LapseRiskItem {
  district_code: string;
  mp_id: string;
  fiscal_year: string;
  projected_lapse: number;
  lapse_probability: number;
  lapse_tier: string;
  allocated_amount: number;
  spent_to_date: number;
}

export interface ContractorCluster {
  community_id: number;
  contractors: string[];
  total_nodes: number;
  avg_risk_score: number;
}

export interface ContractorListItem {
  gstin: string;
  name: string;
  state_code?: string;
  total_contracts?: number;
  total_contract_value?: number;
  risk_score?: number;
  /** Which dataset this row came from. Null means unknown, not "verified". */
  data_source?: string | null;
}

export interface ContractorCapabilityStatus {
  status: string;
  contractor_records: number;
  data_source: string | null;
  last_updated?: string | null;
  capabilities: Record<string, { available: boolean; reason: string }>;
}

export interface MPLapseForecast {
  mp_id: string;
  status?: string;
  forecasts: {
    district_code: string;
    fiscal_year: string;
    projected_lapse: number;
    lapse_probability: number;
    lapse_tier: string;
    allocated_amount: number;
    spent_to_date: number;
  }[];
}

/**
 * Shape of `GET /mp/national-stats`.
 *
 * The backend returns a discriminated union on `available` and never invents a
 * figure. When the snapshot file is absent it returns `available: false` with a
 * `notice` explaining what to run, and no `figures` key at all — so a consumer
 * cannot accidentally read `figures.total_works` as zero. An earlier version of
 * this interface declared `total_mps` and `total_allocation`, which the route
 * has never returned, so every tile on the reports page was reading `undefined`
 * and the page papered over it with a hardcoded number.
 */
export interface NationalMPStats {
  available: boolean;
  source: string;
  last_synced_at: string | null;
  notice: string;
  figures?: {
    tenure?: string;
    tenure_id?: number;
    allocated_limit_inr?: number;
    allocated_limit_cr?: string;
    expenditure_inr?: number;
    expenditure_cr?: string;
    works_recommended_count?: number;
    works_recommended_inr?: number;
    works_sanctioned_count?: number;
    works_sanctioned_inr?: number;
    works_completed_count?: number;
    works_completed_inr?: number;
    calamity_consent_count?: number;
    last_synced_at?: string;
    source?: string;
  };
}

export interface SatelliteResult {
  work_id: string;
  status: string;
  message?: string;
  check_date?: string;
  date_before?: string | null;
  date_after?: string | null;
  /**
   * Index deltas are `null` unless actually measured. A STAC scene search
   * returns scene metadata, not pixels, so in this backend these are always
   * null. `undefined` and `null` must both render as "not measured" — never as 0,
   * and never as "no change detected".
   */
  ndbi_change?: number | null;
  ndvi_change?: number | null;
  change_score?: number | null;
  /** `null` = no verdict reached. Only `false` means "construction seen". */
  satellite_flag?: boolean | null;
  confidence?: number | null;
  cloud_coverage_pct?: number | null;
  applicable?: boolean;
  thumbnail_before_url?: string | null;
  thumbnail_after_url?: string | null;
  scene_id_before?: string | null;
  scene_id_after?: string | null;
  /**
   * The one scene a search actually found. The backend deliberately leaves
   * `scene_id_before`/`scene_id_after` null: a search records a single tile, and
   * filling both slots would present one scene as a before/after comparison.
   */
  scene_id_recorded?: string | null;
  data_source?: string;
  evidence_text?: string;
}

export interface CitizenReportSubmit {
  work_id: string;
  report_lat: number;
  report_lon: number;
  construction_visible: boolean;
  work_complete: boolean;
  matches_board_description: boolean;
  quality_rating: number;
  comments?: string;
}

export interface CitizenReportDB {
  report_id?: string;
  work_id: string;
  report_lat: number;
  report_lon: number;
  construction_visible: boolean;
  work_complete: boolean;
  matches_board_description: boolean;
  quality_rating: number;
  comments?: string;
  distance_from_work_m?: number;
  submitted_at?: string;
  reporter_username?: string | null;
  attachment_count?: number;
}

export interface PipelineStatus {
  status: string;
  works_in_db: number;
  works_scored: number;
  works_unscored?: number;
  l1_count: number;
  l2_count: number;
  l3_count: number;
  last_checked: string;
  scraper_status: string;
  ml_status: string;
  satellite_status: string;
  notes?: string;
}

// Re-exported so callers can import auth types from one place. `LoginResponse`
// is deliberately absent: the server's /auth/login returns a token and the
// role, nothing more. A type that also carried a `user` object would invite code
// to render a profile the response never sent.
export type { TokenResponse, UserProfile };
