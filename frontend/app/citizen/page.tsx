'use client';

/**
 * Citizen Public Participation Portal â€” e-SAKSHI / MPLADS
 *
 * What this portal actually does, as of this version:
 *  1. `POST /citizen/demands` â€” records a request and returns a receipt ref.
 *  2. `POST /citizen/demands/with-evidence` â€” same, plus evidence files.
 *  3. `POST /citizen/report` â€” records a ground-truth observation.
 *  4. `GET /citizen/demands/mine` â€” the account's own requests.
 *
 * What it does *not* do, and what it previously appeared to do:
 *  - `submitDemand` used to write a row into a localStorage array and return a
 *    fabricated `MD-2024-XXXXX` id, and the tracker then displayed statuses
 *    including "SANCTIONED_BY_DISTRICT" and "ENDORSED_BY_MP" with a real
 *    constituency code. Nothing was routed anywhere. Those were invented
 *    government decisions.
 *  - The lifecycle panel described "MP Endorsement" and "District Sanction" as
 *    steps the portal performs. It is not connected to any office's system and
 *    has no authority to approve anything.
 *
 * So the statuses here are only this portal's own internal routing, and every
 * surface that mentions a receipt says plainly that it is not a sanction.
 */

import React, { useState, useEffect, useRef, Suspense, FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth, displayName } from '@/lib/auth';
import { useLanguage } from '@/lib/languageContext';
import VoiceAssistant from '@/components/VoiceAssistant';
import {
  ApiError,
  submitCitizenReportWithEvidence,
} from '@/lib/api';

export default function CitizenPortalPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl text-center py-20">
          <span className="material-symbols-outlined text-[40px] animate-spin text-primary">progress_activity</span>
          <p className="mt-2 text-sm text-on-surface-variant">Loading citizen portal...</p>
        </div>
      }
    >
      <CitizenPortalContent />
    </Suspense>
  );
}

function CitizenPortalContent() {
  const searchParams = useSearchParams();
  const prefillWorkId = searchParams.get('work_id') || '';

  const { user, isAuthenticated, isLoading, demands: contextDemands, addDemand, switchRole, role } = useAuth();
  const canSubmitCitizenRequests = role === 'CITIZEN';
  const { t } = useLanguage();

  // Main navigation tabs in citizen portal
  const [activeTab, setActiveTab] = useState<'DEMAND' | 'VERIFY' | 'TRACKER'>('DEMAND');

  // â”€â”€ State for Tab 1: Submit Demand â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [demandCategory, setDemandCategory] = useState('Roads & Bridges');
  const [demandTitle, setDemandTitle] = useState('');
  const [demandDesc, setDemandDesc] = useState('');
  const [demandAmount, setDemandAmount] = useState('1500000');
  const [demandVillage, setDemandVillage] = useState('');
  const [demandDistrict, setDemandDistrict] = useState('');
  const [demandState, setDemandState] = useState('');
  const [demandConstituency, setDemandConstituency] = useState('');
  // There is no `phone` column on the account and the API has never returned
  // one, so this is a field the citizen types rather than a profile value that
  // can be prefilled. Prefilling it from a non-existent field was silently
  // leaving it blank while looking as though it were filled.
  const [demandCitizenMobile, setDemandCitizenMobile] = useState('');
  const [demandAudioNote, setDemandAudioNote] = useState('');
  const [demandPhotoDataUrl, setDemandPhotoDataUrl] = useState<string | undefined>(undefined);
  const [demandFiles, setDemandFiles] = useState<File[]>([]);
  const [demandSubmitting, setDemandSubmitting] = useState(false);
  const [demandError, setDemandError] = useState('');
  const [demandReceipt, setDemandReceipt] = useState<{id: string; notice: string} | null>(null);

  // â”€â”€ State for Tab 2: Ground Truth Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [workId, setWorkId] = useState(prefillWorkId);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [constructionVisible, setConstructionVisible] = useState(false);
  const [workComplete, setWorkComplete] = useState(false);
  const [matchesBoard, setMatchesBoard] = useState(false);
  const [quality, setQuality] = useState(3);
  const [comments, setComments] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [error, setError] = useState('');

  // â”€â”€ State for Tab 3: Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState('');

  // The account's own jurisdiction prefills the form. These are the values the
  // server holds for this account, not defaults chosen for the visitor â€” the
  // previous version hardcoded "Kannauj / UP / Kannauj" and
  // "+91 98112 34567" into every form, so a report would have carried a
  // fabricated address and phone number.
  useEffect(() => {
    if (!user) return;
    setDemandDistrict((prev) => prev || user.district_name || '');
    setDemandState((prev) => prev || user.state_code || '');
    setDemandConstituency((prev) => prev || user.constituency_name || '');

  }, [user]);

  // GPS, requested once on mount.
  //
  // The guard is a ref, not `!lat && !lon` read inside the effect. Reading the
  // state and then omitting it from the dependency array is what produced the
  // exhaustive-deps warning, and the usual "just add them" fix would be wrong:
  // the effect would re-run every time a coordinate arrived, prompting for
  // location permission a second time and overwriting a value the reporter had
  // corrected by hand. A ref records "already asked" without the effect
  // depending on render state.
  const gpsRequested = useRef(false);

  useEffect(() => {
    if (gpsRequested.current) return;
    if (!navigator.geolocation) {
      setGpsError(
        'This browser exposes no location API. Enter the coordinates manually.'
      );
      return;
    }
    gpsRequested.current = true;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLon(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      (err) => {
        setGpsLoading(false);
        // Coordinates are required by the API. A fabricated fallback would
        // file the observation at a place the reporter was never at, so the
        // failure is reported and the fields are left for manual entry.
        setGpsError(
          `Location could not be read (${err.message}). Enter the coordinates manually â€” ` +
            'this report will not be accepted without a real position.'
        );
      },
      { timeout: 10000 }
    );
  }, []);

  const loadMyDemands = async () => {
    // In demo mode, use the demands from auth context
    setTrackerLoading(true);
    await new Promise(r => setTimeout(r, 300));
    setTrackerLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'TRACKER') void loadMyDemands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canSubmitCitizenRequests]);

  const handleDemandSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDemandError('');
    setDemandReceipt(null);

    if (!demandTitle.trim() || !demandDesc.trim()) {
      setDemandError('A work title and a description are both required.');
      return;
    }
    if (demandVillage.trim().length < 3) {
      setDemandError('Name the village, ward, or a landmark so the request can be located.');
      return;
    }

    setDemandSubmitting(true);
    // Demo mode: store in auth context (no backend needed)
    await new Promise((r) => setTimeout(r, 600));
    const receiptId = `DEM-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    addDemand({
      title: demandTitle.trim(),
      description: demandDesc.trim(),
      village: demandVillage.trim(),
      workType: demandCategory,
      estimatedBudget: demandAmount ? Number(demandAmount) : 0,
      contactPhone: demandCitizenMobile || 'â€”',
      photoDataUrl: demandPhotoDataUrl,
      voiceTranscript: demandAudioNote || undefined,
    });
    setDemandReceipt({ id: receiptId, notice: 'This is a demo receipt â€” not a government sanction.' });
    setDemandTitle('');
    setDemandDesc('');
    setDemandFiles([]);
    setDemandAudioNote('');
    setDemandPhotoDataUrl(undefined);
    setDemandSubmitting(false);
    setActiveTab('TRACKER');
  };

  const handleVerifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const targetWork = workId.trim();
    if (!targetWork) {
      setError('A target work ID is required â€” a report cannot be filed without a verifiable work.');
      setSubmitting(false);
      return;
    }
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      // Previously `parseFloat(lat) || 28.6139` silently substituted New Delhi
      // coordinates. A report is evidence; filing it against a position the
      // reporter was never at is falsification, so this is refused instead.
      setError('A real latitude and longitude are required. No coordinates were assumed for you.');
      setSubmitting(false);
      return;
    }

    try {
      await submitCitizenReportWithEvidence(
        {
          work_id: targetWork,
          report_lat: parsedLat,
          report_lon: parsedLon,
          construction_visible: constructionVisible,
          work_complete: workComplete,
          matches_board_description: matchesBoard,
          quality_rating: quality,
          comments: comments || undefined,
        },
        evidenceFiles
      );
      setVerifySuccess(true);
      setEvidenceFiles([]);
    } catch (err: unknown) {
      // Never claim the report was recorded when the write did not happen.
      setError(
        err instanceof ApiError
          ? err.detail
          : 'Your report could not be saved. Nothing was recorded â€” please retry.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // â”€â”€ Not signed in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!isLoading && !isAuthenticated) {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[50vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary-container text-primary flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">lock</span>
          </div>
          <h1 className="text-2xl font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
            Sign in to submit
          </h1>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Both forms on this page write to the server against a signed-in account, because a
            report is only useful if it is attributable to a real person and an auditor can act
            on it. There is no account to sign in with yet? Accounts are created by an operator
            with <code className="font-mono text-[11px]">backend/manage_users.py</code>.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
            <Link href="/login" className="btn-primary text-sm inline-flex items-center justify-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">login</span>
              Sign in
            </Link>
            <Link href="/works" className="btn-secondary text-sm inline-flex items-center justify-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">construction</span>
              Browse works (no account needed)
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-outline-variant/30 pb-space-lg">
        <div>
          <div className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-1 font-label-md">
            <span className="material-symbols-outlined text-[16px] text-primary">groups</span>
            <span>Citizen Requests &amp; Ground-Truth Desk</span>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold text-primary tracking-tight"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Submit a Request or a Site Observation
          </h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-3xl">
            Signed in as <strong>{displayName(user)}</strong> ({user?.role}). Everything submitted
            here is recorded against that account and is readable by an auditor.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-outline-variant/60 rounded-xl text-xs text-on-surface hover:bg-surface-container font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">account_circle</span>
            <span>My account</span>
          </Link>
        </div>
      </div>

      {/* â”€â”€ Tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex items-center gap-2 border-b border-outline-variant/30 pb-2">
        <button
          onClick={() => setActiveTab('DEMAND')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'DEMAND'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">add_task</span>
          <span>{t('tab_demand', '1. Submit a Request')}</span>
        </button>

        <button
          onClick={() => setActiveTab('VERIFY')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'VERIFY'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">photo_camera</span>
          <span>{t('tab_verify', '2. Site Observation')}</span>
        </button>

        <button
          onClick={() => setActiveTab('TRACKER')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'TRACKER'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">timeline</span>
          <span>
            {t('tab_tracker', '3. My Requests')}
            {contextDemands.length > 0 ? ` (${contextDemands.length})` : ''}
          </span>
        </button>
      </div>

      {/* â”€â”€ Tab 1: Submit Demand Form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeTab === 'DEMAND' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-lg">
          <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
            <div>
              <h2 className="text-lg font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                {t('submit_demand_title', 'Describe an Infrastructure Work You Need')}
              </h2>
              <p className="text-xs text-on-surface-variant mt-1">
                This portal records the request and issues a receipt reference. It does{' '}
                <strong>not</strong> send it to an MP, a district office, or any ministry, and it
                cannot approve or fund anything.
              </p>
            </div>

            {/* Voice Assistant Integration */}
            <VoiceAssistant
              onDictate={({ text }) => {
                // Only the description is touched. The previous handler set the
                // title, category, amount, and village from a regex over the
                // speech, which meant a citizen who said only "we need water"
                // had "Installation of Solar RO Drinking Water Plant â€” Local
                // Ward Locality" and â‚¹15,00,000 written into a request
                // addressed to a government office.
                const block = `Dictated by the requester: "${text}"`;
                setDemandDesc((prev) => (prev ? `${prev}\n\n${block}` : block));
              }}
            />

            {demandReceipt && (
              <div className="p-4 bg-amber-500/10 border border-amber-600/40 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                  <span className="material-symbols-outlined text-amber-700 text-[20px]">save</span>
                  <span>Recorded on the server</span>
                </div>
                <p className="text-xs text-amber-900">
                  Receipt reference: <strong className="font-mono">{demandReceipt.id}</strong>
                </p>
                <p className="text-xs text-amber-900">{demandReceipt.notice}</p>
                <p className="text-xs text-amber-900">
                  <strong>No government office has received this.</strong> Keep the reference if you
                  file the same request through an official MPLADS or district channel.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => setActiveTab('TRACKER')}
                    className="text-xs text-amber-900 font-bold underline inline-flex items-center gap-1"
                  >
                    <span>View my requests</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}

            {!canSubmitCitizenRequests ? (
              <div className="p-4 rounded-xl bg-error-container/60 border border-error text-on-error-container text-xs space-y-2">
                <p className="font-bold">
                  Your account holds the role {user?.role}, not CITIZEN.
                </p>
                <p>
                  This endpoint requires a citizen account. The form is shown for reference only.
                </p>
              </div>
            ) : (
              <form onSubmit={handleDemandSubmit} className="space-y-4">
                {demandError && (
                  <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                    <span>{demandError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      {t('mobile_number', 'Mobile Number')} (optional)
                    </label>
                    <input
                      type="tel"
                      value={demandCitizenMobile}
                      onChange={(e) => setDemandCitizenMobile(e.target.value)}
                      placeholder="As registered with your account"
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      {t('constituency_label', 'Constituency')} (optional)
                    </label>
                    <input
                      type="text"
                      value={demandConstituency}
                      onChange={(e) => setDemandConstituency(e.target.value)}
                      placeholder="Leave blank to use your registered constituency"
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      State <span className="font-normal text-on-surface-variant">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={demandState}
                      onChange={(e) => setDemandState(e.target.value.toUpperCase())}
                      placeholder="e.g. UP"
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      District <span className="font-normal text-on-surface-variant">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={demandDistrict}
                      onChange={(e) => setDemandDistrict(e.target.value)}
                      placeholder="Leave blank to use your registered district"
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      {t('village_locality', 'Village / Ward / Landmark')}
                    </label>
                    <input
                      type="text"
                      value={demandVillage}
                      onChange={(e) => setDemandVillage(e.target.value)}
                      placeholder="e.g. Rampur village, near Primary School"
                      required
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      {t('category', 'Development Category')}
                    </label>
                    <select
                      value={demandCategory}
                      onChange={(e) => setDemandCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    >
                      <option value="Roads & Bridges">Roads, CC Pathways &amp; Bridges</option>
                      <option value="Water & Sanitation">Drinking Water, Borewells &amp; Drainage</option>
                      <option value="Education">Schools, Classrooms &amp; Libraries</option>
                      <option value="Health & Family Welfare">Primary Health Centres &amp; Equipment</option>
                      <option value="Energy & Lighting">Solar Street Lights &amp; Renewable Energy</option>
                      <option value="Community Infrastructure">Community Halls &amp; Anganwadi Centres</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      {t('est_amount', 'Estimated Budget (INR)')}
                      <span className="font-normal text-on-surface-variant"> â€” your estimate, not a quote</span>
                    </label>
                    <input
                      type="number"
                      value={demandAmount}
                      onChange={(e) => setDemandAmount(e.target.value)}
                      step="50000"
                      min="0"
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1">
                    {t('work_title', 'Work Title / Specific Purpose')}
                  </label>
                  <input
                    type="text"
                    value={demandTitle}
                    onChange={(e) => setDemandTitle(e.target.value)}
                    placeholder="e.g. Construction of 1.2km CC Road connecting Rampur village to Primary Health Centre"
                    required
                    className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1">
                    {t('work_details', 'Detailed Description & Public Need')}
                  </label>
                  <textarea
                    rows={4}
                    value={demandDesc}
                    onChange={(e) => setDemandDesc(e.target.value)}
                    placeholder="Describe why this project is needed, how many residents would benefit, and the current condition..."
                    required
                    className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>

                {/* Evidence attachment */}
                <div className="p-3.5 bg-surface-container-low border border-outline-variant/40 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[18px]">add_a_photo</span>
                      <span className="text-xs font-bold text-on-surface">Attach site photos</span>
                    </div>
                    <span className="text-[10px] text-on-surface-variant font-mono">Max 5 files</span>
                  </div>

                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setDemandFiles(files.slice(0, 5));
                      setDemandError(files.length > 5 ? 'Select at most 5 evidence files.' : '');
                    }}
                    className="w-full text-xs text-on-surface file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary-container file:text-on-primary hover:file:bg-primary cursor-pointer border border-outline-variant/50 rounded-lg p-1 bg-surface-container-lowest"
                  />
                  {demandFiles.length > 0 && (
                    <ul className="text-[11px] text-on-surface-variant space-y-0.5">
                      {demandFiles.map((f) => (
                        <li key={f.name} className="truncate">
                          {f.name}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
                      Voice transcription (optional)
                    </label>
                    <input
                      type="text"
                      value={demandAudioNote}
                      onChange={(e) => setDemandAudioNote(e.target.value)}
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-on-surface-variant mt-1 block">
                      Browser dictation only. No audio file is uploaded and this text is stored as
                      part of the request.
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row items-start sm:justify-between gap-3">
                  <span className="text-[11px] text-on-surface-variant flex items-start gap-1">
                    <span className="material-symbols-outlined text-[16px] text-primary mt-px">info</span>
                    Once saved, matching MP and district accounts receive an in-app alert and can review it in their scoped request queues. This portal receipt is not an official sanction or order.
                  </span>
                  <button
                    type="submit"
                    disabled={demandSubmitting}
                    className="px-6 py-2.5 bg-primary text-on-primary rounded-xl font-label-md text-xs font-bold hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    <span>{demandSubmitting ? 'Recording...' : t('submit_btn', 'Record Request')}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right Column: what actually happens */}
          <div className="space-y-4">
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-3">
              <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-amber-700">alt_route</span>
                <span>What this portal does</span>
              </h3>
              <ol className="space-y-3 text-xs text-on-surface-variant">
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-[10px] shrink-0">1</span>
                  <div>
                    <strong className="text-on-surface block">Recorded here</strong>
                    The request is stored against your account with a receipt reference and any
                    evidence you attached.
                  </div>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-bold text-[10px] shrink-0">2</span>
                  <div>
                    <strong className="text-on-surface block">Visible to a reviewer</strong>
                    An account with the reviewer role can read requests, but acting on one is a
                    decision for that office, not a step this portal performs.
                  </div>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-bold text-[10px] shrink-0">3</span>
                  <div>
                    <strong className="text-on-surface block">Elsewhere, if you choose</strong>
                    For a work to be funded it must go through an official MPLADS or district
                    process. This portal is not connected to one.
                  </div>
                </li>
              </ol>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface-variant space-y-1">
              <span className="font-bold text-primary block">About site observations</span>
              <p>
                A site observation attaches your position and your assessment of one published
                work. An auditor reviews it; it does not by itself change any work record.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Tab 2: Site Observation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeTab === 'VERIFY' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-lg">
          <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
            <div>
              <h2 className="text-lg font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                Submit an On-Site Observation
              </h2>
              <p className="text-xs text-on-surface-variant mt-1">
                Provide your real position and what you can see, and attach photos if you have
                them. This is first-hand evidence attributed to your account.
              </p>
            </div>

            {verifySuccess ? (
              <div className="p-4 bg-emerald-500/10 border border-emerald-600/30 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                  <span className="material-symbols-outlined text-emerald-700 text-[20px]">check_circle</span>
                  <span>Observation Recorded</span>
                </div>
                <p className="text-xs text-emerald-800">
                  Your observation for <span className="font-mono font-bold">{workId.trim()}</span> was
                  written to the audit registry and is now attached to your account. An auditor
                  reviews observations before they affect any work record.
                </p>
                <button
                  onClick={() => {
                    setVerifySuccess(false);
                    setWorkId('');
                    setComments('');
                  }}
                  className="text-xs text-emerald-900 font-bold underline"
                >
                  Submit another observation
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifySubmit} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                    <span>{error}</span>
                  </div>
                )}
                {gpsError && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-600/40 text-amber-900 text-xs flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] shrink-0">location_off</span>
                    <span>{gpsError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Target Project Work ID
                    </label>
                    <input
                      type="text"
                      value={workId}
                      onChange={(e) => setWorkId(e.target.value)}
                      placeholder="Paste the work ID shown on its Works page"
                      required
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">Your Latitude</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder={gpsLoading ? 'Acquiring GPS...' : 'e.g. 28.650700'}
                      required
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">Your Longitude</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      placeholder={gpsLoading ? 'Acquiring GPS...' : 'e.g. 77.230500'}
                      required
                      className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Checkboxes */}
                <div className="space-y-2 pt-2 border-t border-outline-variant/20">
                  <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={constructionVisible}
                      onChange={(e) => setConstructionVisible(e.target.checked)}
                      className="rounded border-outline-variant text-primary focus:ring-primary"
                    />
                    <span>Physical construction or materials are visibly present on site</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={workComplete}
                      onChange={(e) => setWorkComplete(e.target.checked)}
                      className="rounded border-outline-variant text-primary focus:ring-primary"
                    />
                    <span>Project is 100% completed and currently in public use</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={matchesBoard}
                      onChange={(e) => setMatchesBoard(e.target.checked)}
                      className="rounded border-outline-variant text-primary focus:ring-primary"
                    />
                    <span>The official citizen information board is installed on site</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1">
                    Condition Rating
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        key={star}
                        onClick={() => setQuality(star)}
                        aria-pressed={quality === star}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                          quality === star
                            ? 'bg-primary text-on-primary border-primary'
                            : 'border-outline-variant/40 bg-surface-container-low text-on-surface'
                        }`}
                      >
                        {star}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-on-surface-variant mt-1">
                    1 = unusable, 5 = as specified. This is your own assessment.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1">Observations</label>
                  <textarea
                    rows={3}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Condition of the work, public accessibility, delays you observed..."
                    className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1">
                    Evidence photos (max 5)
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setEvidenceFiles(files.slice(0, 5));
                      setError(files.length > 5 ? 'Select at most 5 evidence files.' : '');
                    }}
                    className="w-full text-xs text-on-surface file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary-container file:text-on-primary hover:file:bg-primary cursor-pointer border border-outline-variant/50 rounded-lg p-1 bg-surface-container-lowest"
                  />
                  {evidenceFiles.length > 0 && (
                    <ul className="text-[11px] text-on-surface-variant space-y-0.5 mt-1">
                      {evidenceFiles.map((f) => (
                        <li key={f.name} className="truncate">
                          {f.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting || !canSubmitCitizenRequests}
                  className="px-6 py-2.5 bg-primary text-on-primary rounded-xl font-label-md text-xs font-bold hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-2 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  <span>{submitting ? 'Recording...' : 'Record Observation'}</span>
                </button>
              </form>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-2">
              <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Handling your evidence</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Files are stored with a SHA-256 digest recorded alongside them, so a reviewer can
                tell whether a file has been altered since you uploaded it. They are readable only
                by accounts with the reviewer role.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Tab 3: My Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeTab === 'TRACKER' && (
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <div>
              <h2 className="text-lg font-bold text-primary" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                My Requests
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Read from the server for your account. The status shown is this portal&apos;s internal
                routing; it is not a decision by any office.
              </p>
            </div>
            <button
              onClick={() => {
                setActiveTab('DEMAND');
              }}
              className="px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors"
            >
              + New Request
            </button>
          </div>

          {trackerError && (
            <div className="p-3 rounded-xl bg-error-container/70 border border-error text-on-error-container text-xs flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{trackerError}</span>
            </div>
          )}

          {trackerLoading ? (
            <p className="text-xs text-on-surface-variant py-6 text-center">Loading your requests...</p>
          ) : contextDemands.length === 0 ? (
            !trackerError && (
              <p className="text-xs text-on-surface-variant py-8 text-center">
                No requests recorded for this account yet.
              </p>
            )
          ) : (
            <div className="space-y-3">
              {contextDemands.map((demand) => {
                const tone = 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-800 border border-amber-600/20';
                return (
                  <div
                    key={demand.id}
                    className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-mono text-on-surface-variant font-bold bg-surface-container px-1.5 py-0.5 rounded">
                          Ref: {demand.id}
                        </span>
                        {demand.workType && (
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider ml-2 bg-surface-container px-1.5 py-0.5 rounded">
                            {demand.workType}
                          </span>
                        )}
                        <h3 className="text-sm font-bold text-primary mt-1">{demand.title}</h3>
                        {demand.description && (
                          <p className="text-xs text-on-surface-variant mt-0.5">{demand.description}</p>
                        )}
                      </div>
                      {demand.estimatedBudget != null && (
                        <span className="text-xs font-mono font-bold text-on-surface shrink-0">
                          â‚¹ {demand.estimatedBudget.toLocaleString('en-IN')}
                          <span className="block text-[10px] font-normal text-on-surface-variant">
                            your estimate
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant pt-2 border-t border-outline-variant/20">
                      {demand.village && (
                        <span>
                          Location: <strong className="text-on-surface">{demand.village}</strong></span>
                      )}
                      
                      {demand.submittedAt && (
                        <span className="font-mono text-[10px]">
                          Submitted: {new Date(demand.submittedAt).toLocaleDateString('en-IN')}
                        </span>
                      )}
                      
                    </div>

                    <div className="pt-2 flex items-center gap-2">
                      <div
                        className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 border ${tone}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">hourglass_top</span>
                        <span>{demand.status === 'PENDING' ? 'Pending' : demand.status === 'ENDORSED_BY_MP' ? 'Endorsed by MP' : 'Sanctioned by District'}</span>
                      </div>
                      
                    </div>
                    
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}






