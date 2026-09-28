/**
 * Comprehensive Knowledge Base of ML Anomaly Causes & Risk Telemetry
 * Explains root causes for every detection layer in MPLADS Sentinel:
 * 1. Satellite Change Discrepancy (Sentinel-2 NDBI / NDVI)
 * 2. Weather & Monsoon Feasibility (IMD Precipitation Norms)
 * 3. Contractor Cartel Nexus & Vendor Concentration
 * 4. Dual / Cross-Scheme Duplicate Funding (MGNREGA / PMGSY)
 * 5. Fiscal Velocity & Sanction-to-Completion Ratio
 * 6. GSTIN Status & Shell Entity Red Flags
 * 7. Citizen Ground-Truth Discrepancies
 */

export interface AnomalyCauseDetail {
  code: string;
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  icon: string;
  category: 'SATELLITE' | 'WEATHER' | 'CARTEL' | 'DUPLICATE' | 'FISCAL' | 'GSTIN' | 'CITIZEN';
  summary: string;
  forensicEvidence: string;
  regulatoryStandard: string;
  recommendedAuditAction: string;
}

export const ANOMALY_CAUSES_REGISTRY: Record<string, AnomalyCauseDetail> = {
  // ── 1. Satellite Spectral Discrepancies ───────────────────────────────
  'satellite_score': {
    code: 'S2-SPECTRAL-NIL',
    name: 'Zero Built-up Spectral Delta (Ghost Project Signature)',
    severity: 'CRITICAL',
    icon: 'satellite_alt',
    category: 'SATELLITE',
    summary: 'Multi-temporal Sentinel-2 optical imagery (B04, B08, B11) shows no alteration in Normalized Difference Built-Up Index (NDBI ≤ 0.02) across claimed start and completion dates.',
    forensicEvidence: 'AWS Sentinel-2 L2A STAC surface reflectance passes recorded pre-work baseline and post-completion timestamps with <5% cloud cover. Zero geometric or spectral variation at geocoded coordinates.',
    regulatoryStandard: 'MoSPI Scheme Guidelines 2023 Para 5.4: Completion certificates mandatory with physical proof before final contractor settlement.',
    recommendedAuditAction: 'Depute Sub-Divisional Officer (SDO) for physical inspection with hand-held DGPS receiver within 7 calendar days.',
  },
  'vegetation_loss_absent': {
    code: 'S2-NDVI-UNCHANGED',
    name: 'Intact Crop / Forest Cover at Civil Construction Site',
    severity: 'CRITICAL',
    icon: 'forest',
    category: 'SATELLITE',
    summary: 'Vegetation index (NDVI > 0.65) remained entirely intact throughout claimed road paving or building excavation timeline.',
    forensicEvidence: 'Bi-temporal NDVI delta recorded +0.02 (undisturbed biomass). Earthworks or foundation pouring impossible without initial ground clearing.',
    regulatoryStandard: 'CPWD Works Manual Section 14 (Site Clearing & Levelling Verification).',
    recommendedAuditAction: 'Freeze final installment disbursement pending satellite SAR (Sentinel-1 Cloud-penetrating radar) verification.',
  },

  // ── 2. Weather & Monsoon Feasibility ────────────────────────────────
  'weather_score': {
    code: 'IMD-RAIN-IMPOSSIBLE',
    name: 'Weather-Impossible Construction Window (Extreme Monsoon)',
    severity: 'HIGH',
    icon: 'thunderstorm',
    category: 'WEATHER',
    summary: 'Civil road bituminous carpeting or concrete curing claimed during periods where IMD gridded radar data logged continuous heavy rainfall (>75mm/day for >10 days).',
    forensicEvidence: 'Indian Meteorological Department (IMD) AWS gridded precipitation API recorded 18 days of deluge during the 14-day reported asphalt paving window.',
    regulatoryStandard: 'IRC:SP:72-2015 & MORD Specifications Clause 501: Strict prohibition of bituminous binder laying in wet weather or ambient temp <10°C.',
    recommendedAuditAction: 'Audit core asphalt thickness and lab compressive strength test reports from Quality Control Laboratory.',
  },
  'flash_flood_submergence': {
    code: 'IMD-SUBMERGE-CLAIM',
    name: 'Site Inundation During Reported Execution',
    severity: 'HIGH',
    icon: 'flood',
    category: 'WEATHER',
    summary: 'Area was officially declared flood-affected with prolonged inundation during claimed active construction window.',
    forensicEvidence: 'NDMA Disaster Management geo-portal and Sentinel-1 SAR flood extent mapping recorded 1.2m surface water standing.',
    regulatoryStandard: 'Disaster Management Act 2005 & State PWD Flood SOPs.',
    recommendedAuditAction: 'Cross-examine Measurement Book (MB) recordings against disaster relief records.',
  },

  // ── 3. Contractor Cartel Nexus & Collusion ──────────────────────────
  'graph_score': {
    code: 'NEXUS-CARTEL-LOUVAIN',
    name: 'Contractor Cartel Nexus & MP Tender Monopolization',
    severity: 'HIGH',
    icon: 'hub',
    category: 'CARTEL',
    summary: 'NetworkX/Louvain graph analysis identified modularity clustering where >70% of constituency works are concentrated among interlocked vendor entities sharing common directors or addresses.',
    forensicEvidence: 'Bipartite tender graph exhibits Herfindahl-Hirschman Index (HHI) > 0.68. Distinct vendor GSTINs share matching ROC registered director DIN numbers and bank branch IFSC codes.',
    regulatoryStandard: 'Competition Act 2002 Section 3(3) (Bid Rigging & Collusive Tendering) & CVC Tender Guidelines 2021.',
    recommendedAuditAction: 'Refer contractor corporate registry (MCA-21) to Competition Commission of India (CCI) and District Vigilance Officer.',
  },

  // ── 4. Cross-Scheme Duplicate Double-Dipping ────────────────────────
  'cross_scheme_score': {
    code: 'DUP-SCHEME-OVERLAP',
    name: 'Multi-Scheme Duplicate Asset Funding (Double-Dipping)',
    severity: 'CRITICAL',
    icon: 'content_copy',
    category: 'DUPLICATE',
    summary: 'Identical civil asset (sanctioned road or community hall) geocoded within 150m of an asset simultaneously funded under MGNREGA, PMGSY, or MLALAD state scheme.',
    forensicEvidence: 'RapidFuzz semantic title similarity > 88% combined with Haversine spatial delta < 110 meters against MGNREGA / PMGSY GIS database.',
    regulatoryStandard: 'MPLADS Guidelines 2023 Clause 2.3: Inadmissible works already funded or executing under any Central or State Scheme.',
    recommendedAuditAction: 'Order joint verification with District Rural Development Agency (DRDA) and recover duplicate disbursed funds to Consolidated Fund of India.',
  },

  // ── 5. Fiscal Velocity & Speed Anomalies ────────────────────────────
  'isolation_score': {
    code: 'ISOFOREST-VELOCITY',
    name: 'Fiscal Velocity & Outlier Completion Anomaly',
    severity: 'HIGH',
    icon: 'speed',
    category: 'FISCAL',
    summary: 'Isolation Forest (200 trees) isolated multi-dimensional anomaly: Project completed in 6 days with 100% fund release immediately preceding fiscal year-end (March Rush).',
    forensicEvidence: 'Z-score of timeline delta is -3.42σ compared to median district timeline of 145 days for identical bridge and RCC works.',
    regulatoryStandard: 'General Financial Rules (GFR) 2017 Rule 62: Prevention of unscientific expenditure rushes in the closing month of financial year.',
    recommendedAuditAction: 'Audit bank debit transfer logs and verify whether physical milestone inspection occurred prior to Treasury release.',
  },

  // ── 6. GSTIN Status & Shell Entity Red Flags ────────────────────────
  'gstin_score': {
    code: 'GSTIN-CANCELLED-RISK',
    name: 'Disbursement to Suspended or Retroactively Cancelled GSTIN',
    severity: 'CRITICAL',
    icon: 'receipt_long',
    category: 'GSTIN',
    summary: 'Contractor GSTIN was suspended, revoked, or non-compliant under GST Portal API during the payment release date.',
    forensicEvidence: 'GSTN Returns API confirms GSTR-3B default for 6 consecutive tax periods and registration cancelled ab-initio for fictitious billing.',
    regulatoryStandard: 'Central Goods and Services Tax Act 2017 & MoF Public Procurement Circular 2020.',
    recommendedAuditAction: 'Immediate issuance of notice under Section 73/74 and freezing of vendor PFMS escrow bank account.',
  },

  // ── 7. Citizen Ground-Truth Discrepancy ─────────────────────────────
  'citizen_score': {
    code: 'CITIZEN-CONTRADICTION',
    name: 'Citizen Physical Verification Contradicts Paper Claims',
    severity: 'HIGH',
    icon: 'person_alert',
    category: 'CITIZEN',
    summary: 'Geotagged ground truth photo submitted by registered local citizen confirms absence of structure, dilapidated conditions, or non-functioning equipment.',
    forensicEvidence: 'Citizen photo verified with EXIF GPS coordinates within 45m of work location; 3 independent resident testimonies corroborate zero civil activity.',
    regulatoryStandard: 'Citizen\'s Charter on Public Works & MoSPI Social Audit Framework.',
    recommendedAuditAction: 'Schedule formal Social Audit Gram Sabha in the presence of District Development Officer.',
  },
};

/**
 * Helper to identify and return full explanatory cause details for any work or anomaly
 */
export function getAnomalyCausesForWork(activeSignals?: string[], workType?: string): AnomalyCauseDetail[] {
  const causes: AnomalyCauseDetail[] = [];

  if (activeSignals && activeSignals.length > 0) {
    activeSignals.forEach((sig) => {
      const key = sig.toLowerCase().trim();
      if (ANOMALY_CAUSES_REGISTRY[key]) {
        causes.push(ANOMALY_CAUSES_REGISTRY[key]);
      } else {
        // Fallback matched by keyword
        if (key.includes('satellit') || key.includes('spectral')) causes.push(ANOMALY_CAUSES_REGISTRY['satellite_score']);
        else if (key.includes('weather') || key.includes('rain')) causes.push(ANOMALY_CAUSES_REGISTRY['weather_score']);
        else if (key.includes('cartel') || key.includes('graph') || key.includes('vendor')) causes.push(ANOMALY_CAUSES_REGISTRY['graph_score']);
        else if (key.includes('duplicat') || key.includes('cross') || key.includes('scheme')) causes.push(ANOMALY_CAUSES_REGISTRY['cross_scheme_score']);
        else if (key.includes('gstin') || key.includes('tax')) causes.push(ANOMALY_CAUSES_REGISTRY['gstin_score']);
        else if (key.includes('veloc') || key.includes('march') || key.includes('isolat')) causes.push(ANOMALY_CAUSES_REGISTRY['isolation_score']);
        else if (key.includes('citizen') || key.includes('photo')) causes.push(ANOMALY_CAUSES_REGISTRY['citizen_score']);
      }
    });
  }

  // NOTE: Never fabricate causes when the work has no anomaly signals.
  // An empty result means "no forensic root cause was established", which is the
  // only defensible output. Injecting default causes here previously labelled
  // clean, fully-paid projects as ghost works.

  // Deduplicate by code
  const uniqueMap = new Map<string, AnomalyCauseDetail>();
  causes.forEach((c) => uniqueMap.set(c.code, c));
  return Array.from(uniqueMap.values());
}
