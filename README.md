# MPLADS Sentinel — e-SAKSHI

> **AI-Powered Multi-Signal Corroborative Risk Intelligence for MPLADS Scheme Monitoring**
> Smart India Hackathon 2024 — Problem Statement **PS 26102** | Team Ojas

<p align="center">
  <strong>7 ML Models</strong> · <strong>Satellite Imagery (Sentinel-2)</strong> · <strong>4 Role-Based Portals</strong> · <strong>Ensemble Risk Scoring (L1/L2/L3)</strong>
</p>

---

## Table of Contents

- [Project Overview](#project-overview)
  - [The Problem](#the-problem)
  - [Our Solution](#our-solution)
  - [Key Differentiators](#key-differentiators)
- [System Architecture](#system-architecture)
- [Role-Based Access & Personas](#role-based-access--personas)
  - [Citizen Portal](#1-citizen-aarav-sharma)
  - [Member of Parliament (MP) Desk](#2-member-of-parliament-akhilesh-yadav)
  - [CAG Auditor Console](#3-cag-auditor-s-k-ramanathan-iaas)
  - [District Magistrate (DM) Desk](#4-district-magistrate-dr-rajeshwar-rao-ias)
- [Machine Learning Models](#machine-learning-models)
  - [1. Isolation Forest — Tabular Anomaly Detector](#1-isolation-forest--tabular-anomaly-detector)
  - [2. Satellite Change Detector (Sentinel-2 + NDBI/NDVI)](#2-satellite-change-detector-sentinel-2--ndbiindvi)
  - [3. Prophet Fund Lapse Predictor](#3-prophet-fund-lapse-predictor)
  - [4. Contractor Network Graph Analyzer (Louvain)](#4-contractor-network-graph-analyzer-louvain)
  - [5. Cross-Scheme Duplicate Funding Detector](#5-cross-scheme-duplicate-funding-detector)
  - [6. GSTIN Compliance Checker](#6-gstin-compliance-checker)
  - [7. Weather Feasibility Checker](#7-weather-feasibility-checker)
  - [8. Ensemble Risk Scorer](#8-ensemble-risk-scorer)
  - [9. Feature Engineering Pipeline](#9-feature-engineering-pipeline)
- [Model Performance Metrics](#model-performance-metrics)
- [Database Architecture](#database-architecture)
  - [PostgreSQL + PostGIS](#primary-database--postgresql--postgis)
  - [Neo4j Graph DB](#graph-database--neo4j)
  - [Redis + Celery](#cache--queue--redis--celery)
  - [MinIO Object Storage](#object-storage--minio)
  - [MLflow Tracking](#ml-experiment-tracking--mlflow)
- [Satellite Imagery Pipeline](#satellite-imagery-pipeline)
- [API Reference (29 Endpoints)](#api-reference-29-endpoints)
- [User Interface — All Pages](#user-interface--all-pages)
- [Features — Before vs After](#features--before-vs-after)
- [All Features (Complete List)](#all-features-complete-list)
- [Upcoming Features](#upcoming-features)
- [Getting Started](#getting-started)
- [Tech Stack](#tech-stack)
- [Team](#team)

---

## Project Overview

**MPLADS Sentinel** (branded as **e-SAKSHI**) is an AI-powered public works monitoring platform for the **Members of Parliament Local Area Development Scheme (MPLADS)** — a Government of India scheme that allocates **₹5 Crore per year** to every Member of Parliament for local infrastructure development works in their constituency.

### The Problem

MPLADS funds (totalling ₹3,950 Crore annually across 790 MPs) are disbursed with minimal real-time oversight, leading to:

| Problem | Scale | Current Detection |
|---------|-------|-------------------|
| **Ghost Projects** — works claimed as completed that never existed | Estimated 8-12% of total works | Caught only during random CAG physical audits (once every 3-5 years) |
| **Fund Lapse** — crores left unspent at fiscal year-end, returned to the consolidated fund | ₹1,200+ Cr lapsed in FY 2022-23 alone | No early-warning system exists |
| **Contractor Cartels** — shell vendor networks receiving concentrated contracts from a single MP | ~15% of MPs show suspicious concentration | Manual tender scrutiny; near-zero detection rate |
| **Duplicate Funding** — the same physical asset funded under MPLADS + MGNREGA + MLALAD simultaneously | Unknown scale (siloed databases) | Zero cross-scheme verification at national level |
| **GSTIN Fraud** — contracts awarded to cancelled or newly-created shell companies | ~3% of contractors have compliance issues | Post-facto audit only |
| **Weather-Impossible Claims** — road construction claimed during peak monsoon with 90% rain days | ~5% of construction works | Never checked systematically |

### Our Solution

e-SAKSHI uses **7 specialized ML models** running in a **multi-signal corroborative ensemble** to surface anomalies with tiered confidence levels (**L1 / L2 / L3**), combined with:

- 🛰️ **Satellite imagery pipeline** using free ESA Copernicus Sentinel-2 data (10m resolution) + ESRI World Imagery for real-time verification
- 👥 **Public-facing citizen verification layer** with GPS-tagged ground-truth photo reports
- 🔍 **Secure authority auditing interface** for CAG officers and district auditors with full evidence chains
- 🏛️ **MP fund management desk** with Prophet-powered lapse forecasting
- 🏢 **District Magistrate sanction desk** with PFMS disbursement tracking
- ⚖️ **Legal safety enforcement** — MP identity masking at L1/L2, mandatory disclaimers, immutable audit logs

### Key Differentiators

| # | Feature | Why It's Unique |
|---|---------|-----------------|
| 1 | **Multi-Signal Corroboration** | No single model decides — 7 independent signals must agree before escalation |
| 2 | **Free Satellite Verification** | Uses ESA Copernicus Sentinel-2 (free, 10m) — no paid satellite subscriptions needed |
| 3 | **Cross-Scheme Deduplication** | First system to compare MPLADS with MGNREGA/PMGSY/MLALAD for duplicate funding |
| 4 | **Legal Safety by Design** | MP identity masked at L1/L2; only revealed at L3 with ≥3 corroborating signals |
| 5 | **Citizen Participatory Democracy** | Citizens can submit demands, upload geotagged proof, and track petition status |
| 6 | **No Labeled Data Required** | Isolation Forest is unsupervised — works on day one without historical fraud labels |
| 7 | **Weather Feasibility Check** | IMD rainfall data cross-referenced with construction timelines — physically impossible claims caught |
| 8 | **Hard Rule Overrides** | Strong satellite evidence (≥0.80) automatically forces L3 regardless of other signals |
| 9 | **Immutable Audit Trail** | PostgreSQL audit log table has database-level rules preventing UPDATE or DELETE |
| 10 | **Full Offline Mode** | Works with CSV/JSON fallback when PostgreSQL is unavailable — zero downtime |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MPLADS Sentinel (e-SAKSHI)                 │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  Next.js 14  │    │   FastAPI    │    │    ML Pipeline       │  │
│  │  Frontend    │◄──►│   Backend    │◄──►│    (Python 3.11)     │  │
│  │ (TypeScript) │    │  (Python)    │    │   7 Models +         │  │
│  │  App Router  │    │  8 Routers   │    │   Ensemble Scorer    │  │
│  │  10 Pages    │    │  29 Endpoints│    │   200 Trees (IF)     │  │
│  └──────────────┘    └──────┬───────┘    └──────────────────────┘  │
│                             │                                       │
│         ┌───────────────────┼──────────────────────┐               │
│         ▼                   ▼                      ▼               │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────────┐      │
│  │ PostgreSQL │   │    Neo4j     │   │       MinIO         │      │
│  │ + PostGIS  │   │ (Graph DB)  │   │ (Satellite Imagery + │      │
│  │ (Core DB)  │   │ (Contractor │   │  Citizen Photos)     │      │
│  │ 14 Tables  │   │  Networks)  │   │ S3-Compatible        │      │
│  └────────────┘   └──────────────┘   └─────────────────────┘      │
│         ┌───────────────────┐   ┌───────────────┐                  │
│         │       Redis       │   │    MLflow     │                  │
│         │ (Cache + Queue)   │   │ (Experiment   │                  │
│         │ + Celery Workers  │   │  Tracking)    │                  │
│         └───────────────────┘   └───────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘

External Data Sources:
  🛰️ ESA Copernicus Hub    (Sentinel-2 imagery — free, 10m resolution)
  🛰️ ESRI World Imagery    (High-resolution satellite basemap — free tier)
  🌧️ IMD Pune API          (Daily district rainfall data — 15 states)
  📋 GST Portal            (GSTIN validation — contractor compliance)
  🏛️ Sansad.in             (MP speech NLP — fund-district alignment)
  📰 NewsAPI               (Local news cross-referencing)
  🏗️ MGNREGA MIS           (Cross-scheme deduplication)
  🛣️ PMGSY OMMAS           (Cross-scheme road overlap detection)
  📊 MoSPI e-SAKSHI Portal (Official MPLADS statistics sync)
```

---

## Role-Based Access & Personas

e-SAKSHI implements **strict role-based access control (RBAC)** with 4 distinct user personas. Each persona sees a completely different interface tailored to their responsibilities under the MPLADS Guidelines.

> **Prototype Mode:** At login, users select from 4 pre-configured demo profiles with pre-filled passwords. No sign-up required.

### 1. Citizen (Aarav Sharma)

**Login Profile:** Aarav Sharma · Resident, Kannauj, Uttar Pradesh
**Route:** `/citizen`
**Password:** `citizen@demo` (pre-filled)

| Capability | Description |
|------------|-------------|
| **Submit Project Demands** | File infrastructure demands (roads, schools, borewells) directly to the constituency MP with estimated cost, location, and justification |
| **Ground-Truth Photo Verification** | Upload GPS-tagged photographs of MPLADS project sites to verify construction existence |
| **Petition Status Tracker** | Track demand lifecycle: `SUBMITTED` → `ENDORSED_BY_MP` → `SANCTIONED_BY_DISTRICT` |
| **Real-Time Notifications** | Receive alerts when MP endorses a demand or when district sanctions a project |

**What Citizens CANNOT see:**
- ML risk scores or anomaly tiers
- Individual MP fund details or contractor information
- Auditor evidence chains or administrative actions

**Citizen-Specific Features:**
- Auto GPS capture from browser Geolocation API
- India bounds validation (6°N–37°N, 68°E–98°E)
- RTI Act 2005 identity protection notice
- Quality rating (1–5 star) for physical work assessment
- URL-prefillable work ID (`/citizen?work_id=MPLADS-2023-MH-0441`)

---

### 2. Member of Parliament (Akhilesh Yadav)

**Login Profile:** Akhilesh Yadav · Kannauj (PC 29) · Samajwadi Party · 18th Lok Sabha
**Route:** `/mp`
**Password:** `mp@demo` (pre-filled)

| Capability | Description |
|------------|-------------|
| **Fund Utilization Dashboard** | Real-time view of ₹14.7 Cr annual allocation — sanctioned, released, expenditure, unspent balance |
| **Citizen Demand Endorsement** | Review and officially endorse citizen petitions for forwarding to the District Authority |
| **Works Portfolio** | View all works in the constituency with status, amount, and completion timeline |
| **Lapse Forecasting** | Prophet-powered prediction of fund lapse probability before fiscal year-end |
| **Notifications** | Real-time alerts for new citizen demands, statutory lapse warnings, and sanction updates |

**What MPs CANNOT see:**
- L1/L2 risk flags (identity is masked at these tiers)
- Auditor evidence chains or administrative audit notes
- Other MPs' fund details

**MP-Specific Features:**
- KPI cards: Statutory Entitlement, Sanctioned, Expenditure, Unspent Balance
- Utilization percentage gauge
- Critical Action Window alert for fiscal quarter deadlines
- "Dispatch Nodal Advisory" button for lapse warnings
- Demand endorsement workflow with confirmation dialog

---

### 3. CAG Auditor (S. K. Ramanathan, IA&AS)

**Login Profile:** S. K. Ramanathan, IA&AS · Senior Audit Officer / Vigilance Director · CAG of India
**Route:** `/anomalies`
**Password:** `auditor@demo` (pre-filled)

| Capability | Description |
|------------|-------------|
| **Anomaly Queue** | Filterable list of all flagged works by tier (L1/L2/L3), state, district, work type |
| **Evidence Chain Inspector** | Expandable cards for each of the 7 model signals with detailed analysis |
| **Satellite Before/After Viewer** | Side-by-side Sentinel-2 imagery comparison with NDBI/NDVI overlays |
| **Contractor Network Graph** | Interactive D3.js/Vis.js visualization of contractor-MP bipartite graph |
| **Audit Verdict Workflow** | CONFIRMED / CLEARED / PENDING decision with mandatory notes |
| **AI Audit Note Generator** | Gemini 1.5 Pro auto-drafts CAG-format audit memorandums from evidence chains |
| **Contractor Deep Dive** | Full GSTIN compliance check, MCA21 director network, contract history |

**What Auditors CAN see that others CANNOT:**
- L3 alerts with **unmasked MP identity** (only at L3 tier with ≥3 corroborating signals)
- Full evidence chain from all 7 models
- Contractor graph communities and cartel clusters
- Cross-scheme duplicate funding matches
- Hard rule override details

**Auditor-Specific Features:**
- Tier-based color coding (Red = L3 Critical, Amber = L2 High, Blue = L1 Info)
- Batch review mode for multiple flagged works
- Immutable audit log — all actions recorded, no edit/delete possible
- Legal disclaimer on every alert: *"This system surfaces patterns for expert review — it does not determine fraud."*

---

### 4. District Magistrate (Dr. Rajeshwar Rao, IAS)

**Login Profile:** Dr. Rajeshwar Rao, IAS · District Magistrate & Collector · Kannauj, UP
**Route:** `/district`
**Password:** `dm@demo` (pre-filled)

| Capability | Description |
|------------|-------------|
| **Administrative Sanction Desk** | Accord administrative & financial sanction for MP-endorsed projects |
| **PFMS Disbursement Tracking** | Monitor Public Financial Management System releases and expenditure |
| **MP Recommendation Queue** | View all pending MP recommendations awaiting district sanction |
| **Project Progress Monitoring** | Track work milestones, completion status, and implementing agency performance |
| **Citizen Demand Pipeline** | See all citizen demands that have been endorsed by MPs |

**What DMs CANNOT see:**
- ML risk scores or anomaly details (unless also an auditor)
- Other districts' data

**DM-Specific Features:**
- Sanction workflow: `ENDORSED_BY_MP` → `SANCTIONED_BY_DISTRICT`
- PFMS budget head allocation display
- Implementing Agency assignment panel
- Notifications for new MP recommendations and citizen demands

---

### Notification Flow Across Roles

```
Citizen submits demand
  └──► MP receives notification: "New Citizen Project Request"
  └──► DM receives notification: "Citizen Demand Registered"

MP endorses demand
  └──► Citizen receives notification: "Project Request Endorsed by MP!"
  └──► DM receives notification: "MP Work Recommendation Received"

DM sanctions project
  └──► ALL roles receive notification: "Administrative Sanction Accorded"
```

---

## Machine Learning Models

The trained detector is `ml/models/isolation_forest.py`, fitted by
`ml/training/train_real.py` on the verified work records in
`data/output/works_real.csv` using the features in
`ml/features/real_features.py`.

The previous pipeline (`ml/training/train_all.py`, `ml/features/feature_engineering.py`,
`ml/models/contractor_graph.py`, `ml/models/prophet_lapse.py`) was trained on a
generated 3,000-row dataset and its artefacts are quarantined under
`data/quarantine_synthetic/`. Those outputs measured invented patterns. See
`data/README.md` for what the real feed does and does not support.

A high anomaly score means a work deviates from comparable works in its state
and category. It is a prompt for human review, not evidence of wrongdoing.

---

### 1. Isolation Forest — Tabular Anomaly Detector

**File:** `ml/models/isolation_forest.py`

#### What It Does

Detects **cost outliers, timeline anomalies, and sanction pattern anomalies** using scikit-learn's Isolation Forest. This is the backbone tabular model — it flags works that look statistically unusual compared to peers in the same district/state/work-type cohort. **Fully unsupervised — no labeled fraud data needed.**

#### Algorithm Details

Isolation Forest (Liu et al., 2008) isolates anomalies by randomly partitioning the feature space. Anomalous points require fewer splits to isolate (shorter average path length), producing a score inversely proportional to normal behavior.

**Hyperparameters:**
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `n_estimators` | **200 trees** | Higher tree count improves stability of anomaly scores; 200 provides excellent bias-variance tradeoff for tabular data |
| `contamination` | **0.05** (5%) | Conservative assumption — CAG reports suggest 5-10% anomaly rate in MPLADS |
| `max_samples` | `auto` (256) | Standard for Isolation Forest — subsample size per tree |
| `max_features` | `1.0` | All 12 features used per tree |
| `random_state` | `42` | Reproducibility |
| Preprocessing | `StandardScaler` | Z-score normalization before scoring |

#### Input Features (12 Engineered Features)

| # | Feature | Description |
|---|---------|-------------|
| 1 | `amount_zscore_district` | Z-score of sanction amount within district × work_type group |
| 2 | `amount_zscore_state` | Z-score within state × work_type group |
| 3 | `amount_per_unit_zscore` | Cost-per-unit (₹/km, ₹/sqft) z-score within work_type |
| 4 | `timeline_zscore` | Z-score of days from sanction to completion within work_type |
| 5 | `suspiciously_fast` | Binary: completion < 30 days for construction types |
| 6 | `in_election_window` | Binary: sanctioned within 6 months of Lok Sabha election |
| 7 | `release_ratio` | Released amount / Sanctioned amount |
| 8 | `expenditure_ratio` | Expenditure / Sanctioned amount |
| 9 | `contractor_mp_concentration` | Fraction of contractor's works from a single MP (>70% = suspicious) |
| 10 | `mp_contractor_exclusivity` | Fraction of MP's works going to a single contractor |
| 11 | `contractor_district_spread` | Number of unique districts the contractor operates in |
| 12 | `mp_march_completion_ratio` | Fraction of MP's works completed in March (fiscal year-end clustering) |

#### Output

- **Anomaly score (0–1):** Normalized from `decision_function()`, where 1 = most anomalous
- **Prediction (−1 / 1):** sklearn convention — −1 = anomaly, 1 = normal
- **Top-3 feature explanations** per anomaly (z-score contribution ranking)

---

### 2. Satellite Change Detector (Sentinel-2 + NDBI/NDVI)

**File:** `ml/models/satellite_detector.py`

#### What It Does

Detects **ghost projects** by comparing **ESA Copernicus Sentinel-2** satellite imagery **before and after** the claimed construction completion date. If a work claims to have built a road or community hall but the satellite shows no change in built-up area, it is flagged as a suspected ghost project.

#### Spectral Indices Used

**NDBI — Normalized Difference Built-up Index:**
```
NDBI = (SWIR - NIR) / (SWIR + NIR)
```
Uses Sentinel-2 Band B11 (SWIR, 20m) and B08 (NIR, 10m). Increases when concrete/asphalt replaces vegetation. A **positive NDBI change after construction** is the expected signal.

**NDVI — Normalized Difference Vegetation Index:**
```
NDVI = (NIR - RED) / (NIR + RED)
```
Uses B08 (NIR) and B04 (Red). Decreases when vegetation is replaced by built-up area. A **negative NDVI change** corroborates construction evidence.

#### Construction Thresholds by Work Type

| Work Type | Min NDBI Change | Max NDVI Change | Detectable at 10m? |
|-----------|-----------------|-----------------|---------------------|
| Road / CC Road | +0.05 / +0.06 | −0.10 / −0.12 | ✅ Yes |
| Community Hall | +0.08 | −0.08 | ✅ Yes |
| School Building | +0.07 | −0.08 | ✅ Yes |
| Health Center | +0.07 | −0.08 | ✅ Yes |
| Stadium | +0.10 | −0.05 | ✅ Yes |
| Drainage | +0.03 | −0.15 | ✅ Yes |
| Borewell / Solar / Plantation | N/A | N/A | ❌ Sub-10m resolution |

#### Data Sources

- **ESA Copernicus Hub** (free, open-access) — Sentinel-2 Level-2A imagery at 10m resolution
- **ESRI World Imagery** — High-resolution satellite basemap for visual map display
- Buffer radius: **200m** around project GPS coordinates
- Cloud coverage penalty: Confidence score reduced proportionally to cloud %

---

### 3. Prophet Fund Lapse Predictor

**File:** `ml/models/prophet_lapse.py`

#### What It Does

Predicts **which districts/MPs will fail to spend their annual MPLADS allocation** before fiscal year-end (March 31), enabling proactive advisories weeks before funds lapse.

#### Algorithm — Facebook Prophet

Prophet is Meta's decomposable time-series forecasting model:
```
y(t) = trend(t) + seasonality(t) + holidays(t) + error
```

**Configuration:**
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `yearly_seasonality` | `True` | Captures MPLADS quarterly release patterns |
| `weekly_seasonality` | `False` | Not applicable for monthly/quarterly fiscal data |
| `daily_seasonality` | `False` | Not applicable |
| `changepoint_prior_scale` | `0.1` | Conservative trend flexibility — prevents overfitting |
| `seasonality_prior_scale` | `10.0` | Allows stronger seasonal patterns (MPLADS has strong Q4 rush) |
| Training entities | **1 model per district/MP** | Personalized forecasting |
| Minimum data | **4 quarterly points** per entity | Minimum for reliable forecast |

#### Lapse Tiers

| Tier | Probability | Action |
|------|-------------|--------|
| LOW | < 30% | No action needed |
| MEDIUM | 30–50% | Informational nudge to nodal officer |
| HIGH | 50–70% | Automated district alert dispatched |
| CRITICAL | ≥ 85% | Urgent advisory to MP + DM + MoSPI |

---

### 4. Contractor Network Graph Analyzer (Louvain)

**File:** `ml/models/contractor_graph.py`

#### What It Does

Builds a **bipartite network graph** of MP ↔ Contractor relationships and applies **Louvain community detection** to identify shell vendor cartels, concentrated contractor-MP relationships, and suspicious communities.

#### Graph Structure

- **Nodes:** MP entities (`node_type='MP'`) + Contractor GSTINs (`node_type='CONTRACTOR'`)
- **Edges:** MP → Contractor contract relationships, weighted by total contract value (₹ Crore)
- **Edge attributes:** `contract_count`, `total_value`, `years_active`
- **Libraries:** `networkx`, `python-louvain` (community-louvain)

#### Community Detection — Louvain Algorithm

```python
partition = community_louvain.best_partition(G, weight='weight')
```

Maximizes graph modularity to find natural contractor clusters. Falls back to **connected components** if Louvain is unavailable.

#### Contractor Risk Scoring (Rule-Based)

| Rule | Condition | Score Added |
|------|-----------|-------------|
| **MP Concentration** | >70% of works from a single MP AND ≥5 total works | +0.40 |
| **Long-term Exclusivity** | ≥4 consecutive years with same MP AND >60% concentration | +0.30 |
| **District Concentration** | >80% from single district AND ≥10 total works | +0.20 |
| **Volume Flag** | ≥20 total works AND >50% from one MP | +0.10 |
| **Maximum score** | Capped at 1.0 | — |

---

### 5. Cross-Scheme Duplicate Funding Detector

**File:** `ml/models/cross_scheme_dedup.py`

#### What It Does

Detects **the same physical asset funded under multiple government schemes simultaneously** — e.g., a road funded under both MPLADS and MGNREGA. Data lives in separate siloed systems — this is one of the hardest-to-detect frauds in Indian public finance.

#### Multi-Signal Matching

| Signal | Weight | Method |
|--------|--------|--------|
| **Geospatial Proximity** | **40%** | Haversine distance — 0m=1.0, 500m=0.5, >2km=0.0 |
| **Description Similarity** | **30%** | `rapidfuzz` token_sort_ratio + partial_ratio (NLP fuzzy matching) |
| **Amount Overlap** | **15%** | min/max ratio — ≥85% match = 1.0 |
| **Timeline Overlap** | **15%** | overlap_days / shorter_duration |

**Duplicate flag threshold:** Composite ≥ 0.75

#### Supported Cross-Scheme Comparisons

| MPLADS vs. | Full Name | Data Source |
|------------|-----------|-------------|
| **MGNREGA** | National Rural Employment Guarantee Act | nrega.nic.in MIS |
| **MLALAD** | MLA Local Area Development | State legislature portals |
| **PMGSY** | Pradhan Mantri Gram Sadak Yojana | omms.nic.in |
| **PMAY** | Pradhan Mantri Awas Yojana | pmaymis.gov.in |

---

### 6. GSTIN Compliance Checker

**File:** `ml/models/gstin_compliance.py`

#### What It Does

Validates **contractor GST registration status** against the public GST portal and flags compliance violations. Contractors with cancelled/suspended GSTINs, or those registered days before the contract award (shell companies), are scored as high-risk.

#### Flag Severity Matrix

| Flag Type | Severity | Anomaly Score | Description |
|-----------|----------|---------------|-------------|
| `GSTIN_CANCELLED` | HIGH | **0.90** | GSTIN cancelled by tax authority — major red flag |
| `GSTIN_SUSPENDED` | HIGH | **0.85** | GSTIN temporarily suspended |
| `GSTIN_NOT_FOUND` | HIGH | **0.80** | GSTIN does not exist in GST registry |
| `GSTIN_INVALID_FORMAT` | HIGH | **0.70** | 15-char GSTIN regex fails |
| `GSTIN_INACTIVE` | MEDIUM | **0.60** | GSTIN exists but inactive |
| `GSTIN_TOO_NEW` | MEDIUM | **0.50** | Registered < 30 days before contract award (shell company) |

---

### 7. Weather Feasibility Checker

**File:** `ml/models/weather_feasibility.py`

#### What It Does

Cross-checks **claimed construction timelines against IMD rainfall data** to detect physically impossible completion claims. A contractor cannot lay a bitumen road during 60% monsoon rain days.

#### Rainfall Thresholds (mm/day)

| Work Type | Rain Threshold | Rationale |
|-----------|---------------|-----------|
| Road / CC Road | 25–30 mm | Bitumen/concrete cannot cure in heavy rain |
| Community Hall / School | 25 mm | Masonry and plastering infeasible |
| Stadium | 30 mm | Large outdoor construction |
| Drainage (earthwork) | 50 mm | Earthwork can tolerate moderate rain |
| Borewell / Solar / Plantation | N/A | Weather-independent works |

**Flag Trigger:** > 60% of construction days had rainfall exceeding the threshold

**States Covered:** Maharashtra, Uttar Pradesh, Madhya Pradesh, Rajasthan, Gujarat, Karnataka, Tamil Nadu, West Bengal, Andhra Pradesh, Telangana, Bihar, Odisha, Haryana, Punjab, Delhi (15 states)

---

### 8. Ensemble Risk Scorer

**File:** `ml/ensemble/scorer.py`

#### Signal Weights

| # | Signal | Weight | Rationale |
|---|--------|--------|-----------|
| 1 | **Satellite Score** | **25%** | Hardest evidence to fabricate — physical ground truth from space |
| 2 | **Isolation Forest Score** | **20%** | Robust unsupervised tabular baseline on 12 features |
| 3 | **Weather Score** | **15%** | Physical impossibility — objective IMD data |
| 4 | **GSTIN Score** | **15%** | Legal compliance — public government record |
| 5 | **Graph Score** | **10%** | Contractor network cartel detection (Louvain) |
| 6 | **Cross-Scheme Score** | **10%** | Duplicate funding — systemic fraud across schemes |
| 7 | **Citizen Score** | **5%** | Ground truth corroboration from citizen reports |

**Total: 100%**

#### Composite Score Formula

```python
composite_score = sum(signal_score × weight for signal, weight in SIGNAL_WEIGHTS.items()) × 100
# Normalized to 0–100 scale
```

#### Confidence Tiers

| Tier | Score Range | Min Active Signals | MP Identity | Action |
|------|------------|-------------------|-------------|--------|
| **No Flag** | < 30 | — | N/A | No action taken |
| **L1** — Informational | 30–54.9 | ≥ 1 | 🔒 **Masked** | Logged for pattern tracking |
| **L2** — Needs Review | 55–74.9 | ≥ 2 | 🔒 **Masked** | District auditor reviews |
| **L3** — High Confidence | 75–100 | ≥ 3 | 🔓 **Revealed** | CAG officer action required |

#### Hard Rule Overrides

**Currently disabled.** The three rules below were specified when the pipeline
consumed fabricated signals, and each one asserted a conclusion the underlying
evidence could not support: a satellite score was treated as a confirmed ghost
project, a duplicate match as unambiguous double funding, a cancelled GSTIN as
proof of a shell company. No input currently produces a valid value for any of
these signals, so the overrides would be unreachable in practice. They are
documented rather than silently retained as if they were working.

| Signal | Intended override | Status |
|--------|-------------------|--------|
| `satellite_score` | Force L3 | Disabled; no calibrated satellite signal exists |
| `cross_scheme_score` | Force L3 | Disabled; no real duplicate-detection source |
| `gstin_score` | Force L2+ | Disabled; no GSTIN data |

---

### 9. Feature Engineering Pipeline

**File:** `ml/features/real_features.py`

Derives a 21-feature matrix from the fields the verified feed actually
contains. Amount outliers are scored within a state + work-category peer
group, so a value is meaningful relative to comparable works rather than an
absolute claim.

| Group | Features | Count |
|-------|----------|-------|
| **Cost outliers** | `amount_zscore_state_type`, `amount_zscore_constituency_type`, `amount_vs_peer_median`, `amount_log` | 4 |
| **Process stage** | `status_unsanctioned`, `status_ongoing`, `status_completed`, `status_sanctioned`, `status_unknown`, `ida_pending`, `ida_rejected` | 7 |
| **Election proximity** | `in_election_window`, `days_to_nearest_election` | 2 |
| **MP concentration** | `mp_total_works`, `mp_unsanctioned_share`, `mp_election_window_share`, `mp_amount_zscore` | 4 |
| **Agency** | `agency_total_works`, `agency_unsanctioned_share` | 2 |
| **Record quality** | `description_uninformative` | 1 |

Features that would require data the open feed does not publish (release and
expenditure ratios, completion timelines, cost-per-unit, contractor
concentration) are omitted rather than zero-filled, because a placeholder
would teach the model a relationship that does not exist. Zero-variance
columns are dropped at build time.

---

## Model Performance

No accuracy or error metric is quoted for the anomaly detector, and none should
be. There is no labelled fraud dataset for this scheme, so any precision,
recall, F1, silhouette or R-squared figure would be invented. The detector is
unsupervised: it ranks works by deviation from peer-group norms and is intended
to prioritise human review.

What can be stated is the shape of the output on the current 46,348-record
dataset, which `ml/training/train_real.py` prints on every run and
`ml/saved_models/isolation_forest_manifest.json` records:

| Observed | Value |
|----------|-------|
| Records scored | 46,348 |
| Features used | 21 |
| Score >= 0.5 | 2,791 (6.02%) |
| Score >= 0.7 | 264 (0.57%) |
| Score >= 0.9 | 7 (0.02%) |

### Capabilities withheld for lack of data

These were previously reported with invented metrics. The real feed cannot
support them, so they are not produced at all:

| Capability | Why not |
|------------|---------|
| Contractor network / bid-ringing detection | no vendor identifier or GSTIN |
| GSTIN compliance scoring | no GSTIN data |
| Prophet fund-lapse forecasting | no district-wise released/spent series |
| Cross-scheme deduplication | synthetic inputs only; no real overlap source |
| NDBI / NDVI change detection | scene metadata only, no calibrated analysis |

Satellite-2 is queried for scene metadata. A recorded scene means imagery
exists for a date, nothing more; no NDBI or NDVI computation is performed and
no construction verdict is produced.

---


---

## Database Architecture

### Primary Database — PostgreSQL + PostGIS

**Version:** PostgreSQL 15 + PostGIS 3.3
**Tables:** 14 core tables
**Extensions:** `postgis`, `uuid-ossp`, `pg_trgm`

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `states` | 36 Indian states and UTs | `state_code`, `state_name`, `region` |
| `districts` | 700+ districts with PostGIS geometry | `district_code`, `lat`, `lon`, `population`, `secc_deprivation_score`, `geometry GEOMETRY(MULTIPOLYGON, 4326)` |
| `constituencies` | Lok Sabha + Rajya Sabha seats | `constituency_code`, `constituency_name`, PostGIS geometry |
| `mps` | Member of Parliament records | `mp_id`, `full_name`, `party`, `constituency_code`, `annual_allocation`, `is_active` |
| `contractors` | Contractor master with GSTIN | `gstin` (PK), `name`, `gstin_status`, `registration_date`, `director_names TEXT[]`, `risk_score` |
| `works` | **Central entity — all MPLADS works** | `work_id` (PK), `mp_id`, `district_code`, `work_type`, `sanction_amount`, `completion_date`, `location_point GEOMETRY(POINT, 4326)`, `contractor_gstin` |
| `risk_scores` | ML output — one row per work | `isolation_score`, `satellite_score`, `weather_score`, `gstin_score`, `graph_score`, `cross_scheme_score`, `citizen_score`, `composite_score`, `confidence_tier`, `evidence_chain JSONB` |
| `satellite_checks` | Per-work satellite analysis | `ndbi_before`, `ndbi_after`, `ndbi_change`, `ndvi_change`, `change_score`, `satellite_flag`, `cloud_coverage_pct` |
| `weather_checks` | Per-work IMD feasibility | `total_days`, `heavy_rain_days`, `infeasibility_ratio`, `feasibility_flag` |
| `citizen_reports` | GPS-tagged citizen submissions | `report_id UUID`, `work_id`, `report_lat`, `report_lon`, `construction_visible`, `quality_rating`, `photo_url` |
| `cross_scheme_matches` | Duplicate funding pairs | `work_id_mplads`, `work_id_other`, `other_scheme`, `similarity_score`, `distance_m` |
| `lapse_forecasts` | Prophet predictions per entity | `allocated_amount`, `predicted_year_end_spend`, `lapse_probability`, `lapse_tier` |
| `quarterly_expenditure` | Time-series for Prophet training | `entity_id`, `fiscal_year`, `quarter`, `cumulative_spend` |
| `audit_log` | **Immutable append-only** audit trail | `action`, `actor`, `entity_type`, `old_value JSONB`, `new_value JSONB` — **No UPDATE/DELETE rules enforced at database level** |

### Graph Database — Neo4j

**Version:** Neo4j 5.14 + Graph Data Science plugin
**Purpose:** Stores the contractor-MP bipartite graph for real-time network traversal, community membership queries, and path analysis.

| Node Type | Properties |
|-----------|------------|
| `MP` | `mp_id`, `name`, `party`, `constituency`, `state` |
| `CONTRACTOR` | `gstin`, `name`, `status`, `risk_score` |

| Edge | Properties |
|------|------------|
| `MP → CONTRACTOR` | `contract_count`, `total_value`, `years_active` |

### Cache & Queue — Redis + Celery

**Version:** Redis 7 Alpine

| Database | Purpose |
|----------|---------|
| `DB 0` | Application cache — API response caching, session data |
| `DB 1` | Celery task broker — async ML pipeline jobs |
| `DB 2` | Celery result backend — task completion tracking |

**Celery Workers:** 4 concurrent workers
**Celery Beat Scheduled Jobs:**
- Nightly: Satellite batch checks for all completed works
- Weekly: Contractor graph rebuild (Louvain community re-detection)
- Daily: Prophet forecast refresh for all districts

### Object Storage — MinIO

**Version:** MinIO (S3-compatible)

| Bucket | Contents |
|--------|----------|
| `sentinel2-imagery` | Before/after Sentinel-2 satellite imagery tiles (GeoTIFF format) |
| `citizen-photos` | Citizen-submitted geotagged photographs |

Fully compatible with AWS S3 API — can be replaced with S3 or GCS in production with zero code changes.

### ML Experiment Tracking — MLflow

**Version:** MLflow (Python 3.11 base)

Tracks model versions, hyperparameters, performance metrics across training runs, and model artifacts. Enables reproducible model comparison and rollback.

---

## Satellite Imagery Pipeline

e-SAKSHI uses a **dual satellite imagery approach**:

### 1. Analytical Layer — ESA Copernicus Sentinel-2 (Free)

Used for **ML-based change detection** (NDBI/NDVI analysis):

| Specification | Value |
|--------------|-------|
| **Satellite** | Sentinel-2A / 2B (ESA) |
| **Resolution** | 10m (B04, B08) / 20m (B11) |
| **Revisit Time** | 5 days (equatorial) |
| **Cost** | **Free** (open-access) |
| **API** | Copernicus Open Access Hub (`apihub.copernicus.eu`) |
| **Library** | `sentinelsat` + `rasterio` |
| **Analysis** | NDBI/NDVI before-after change detection |
| **Buffer** | 200m radius around project GPS coordinates |

### 2. Visual Layer — ESRI World Imagery (Free Tier)

Used for the **interactive constituency map display**:

| Specification | Value |
|--------------|-------|
| **Provider** | ESRI / Maxar / Earthstar Geographics |
| **Resolution** | Sub-meter (urban areas) |
| **Cost** | **Free** (public tile server) |
| **Usage** | Interactive Leaflet.js map with satellite basemap |
| **Features** | 3 toggle modes: Satellite, Hybrid (satellite + labels), Street |

### Map Features

- **Interactive Leaflet.js map** with real satellite imagery basemap
- **12+ geocoded work markers** with risk-tier color coding (Red = L3, Amber = L2, Blue = L1, Green = Clear)
- **Click-to-inspect** — clicking any marker shows full project details, risk score, satellite verification status
- **Fly-to animation** — map smoothly zooms to selected project location
- **3 basemap modes:** Satellite, Hybrid (satellite + CartoDB labels), OpenStreetMap Street
- **State and risk filtering** — filter markers by state and risk category

---

## API Reference (29 Endpoints)

**Base URL:** `/api/v1`
**Documentation:** Auto-generated Swagger UI at `/api/docs` and ReDoc at `/api/redoc`

### Works Router — `/api/v1/works`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/works/` | List all works with filters (state, district, type, tier, status, year) |
| `GET` | `/works/{work_id}` | Get single work by ID with full details |
| `POST` | `/works/{work_id}/audit-note` | Generate AI audit note using Gemini 1.5 Pro |

### Anomalies Router — `/api/v1/anomalies`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/anomalies/` | List all flagged anomalies with filters |
| `GET` | `/anomalies/{work_id}` | Get anomaly details + evidence chain |
| `GET` | `/anomalies/summary` | Tier distribution summary (L1/L2/L3 counts) |
| `POST` | `/anomalies/{work_id}/review` | Submit auditor verdict (CONFIRMED/CLEARED/PENDING) |

### Contractors Router — `/api/v1/contractors`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/contractors/` | List contractors with risk scores |
| `GET` | `/contractors/{gstin}` | Contractor detail + GSTIN compliance check |
| `GET` | `/contractors/graph` | Full contractor-MP network graph (D3.js format) |
| `GET` | `/contractors/suspicious-clusters` | Louvain-detected suspicious communities |

### Satellite Router — `/api/v1/satellite`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/satellite/check/{work_id}` | Get satellite analysis for a work |
| `POST` | `/satellite/check` | Trigger new satellite check |
| `GET` | `/satellite/batch-status` | Status of nightly batch satellite processing |

### Citizen Router — `/api/v1/citizen`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/citizen/reports` | List all citizen ground-truth reports |
| `POST` | `/citizen/report` | Submit new GPS-tagged citizen report |
| `GET` | `/citizen/reports/{work_id}` | Get all reports for a specific work |

### MP Router — `/api/v1/mp`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/mp/` | List all MPs with fund utilization stats |
| `GET` | `/mp/{mp_id}` | MP profile + constituency works + lapse forecast |
| `GET` | `/mp/{mp_id}/lapse-forecast` | Prophet lapse prediction for specific MP |
| `GET` | `/mp/fund-utilization` | National fund utilization summary |

### Admin Router — `/api/v1/admin`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/pipeline-status` | System health and pipeline counts |
| `POST` | `/admin/trigger-pipeline` | Manually trigger full ML scoring pipeline |
| `POST` | `/admin/sync-mospi` | Sync with official MoSPI e-SAKSHI data |
| `POST` | `/admin/run-cross-scheme` | Trigger cross-scheme deduplication analysis |
| `POST` | `/admin/train-ml` | Trigger ML model retraining |
| `POST` | `/admin/load-demo-data` | Load demo scenarios for presentation |

### Notifications Router — `/api/v1/notifications`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notifications/stream` | SSE (Server-Sent Events) real-time notification stream |
| `GET` | `/notifications/` | Get all notifications for current user |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | System health status |

---

## User Interface — All Pages

**Stack:** Next.js 14 (App Router) + TypeScript + Leaflet.js
**Design System:** Material Design 3 tokens + GoI DPI civic standard
**Font:** Public Sans (Government of India standard) + Material Symbols Outlined icons

| # | Route | Page Name | Access | Description |
|---|-------|-----------|--------|-------------|
| 1 | `/login` | **Demo Profile Selector** | Public | 4 role cards with pre-filled passwords, dark theme, prototype branding |
| 2 | `/` | **National Dashboard** | Public | KPI cards, anomaly feed, lapse risk heatmap, pipeline status |
| 3 | `/citizen` | **Citizen Portal** | Citizen | 3-tab: Submit Demand / Ground Truth Verification / Petition Tracker |
| 4 | `/mp` | **MP Fund Desk** | MP | Fund utilization KPIs, citizen demand endorsement, works portfolio |
| 5 | `/anomalies` | **Anomaly Engine** | Auditor | L1/L2/L3 filterable queue, evidence chain inspector, verdict workflow |
| 6 | `/works` | **Works Explorer** | All | Filterable/sortable table of all 3,000+ MPLADS works |
| 7 | `/works/[id]` | **Project Detail** | All | Full project dossier with satellite evidence, risk breakdown |
| 8 | `/map` | **Constituency Map** | All | Interactive Leaflet.js map with real satellite imagery + 12 geocoded markers |
| 9 | `/contractors` | **Contractor Intelligence** | Auditor | GSTIN compliance, network graph, cartel clusters |
| 10 | `/reports` | **Statutory Reports** | Auditor/DM | CAG-format audit report generation |
| 11 | `/district` | **DM Sanction Desk** | DM | Administrative sanction, PFMS disbursements, project pipeline |
| 12 | `/admin` | **Admin Panel** | Admin | Pipeline triggers: ML retrain, MoSPI sync, cross-scheme audit |
| 13 | `/help` | **Help & Documentation** | All | User guide and system documentation |

---

## Features — Before vs After

### Before e-SAKSHI (Current MPLADS Monitoring)

| Aspect | Current State |
|--------|--------------|
| **Anomaly Detection** | Manual CAG physical audit every 3–5 years |
| **Satellite Verification** | None — no spatial evidence used |
| **Cross-Scheme Check** | Zero — MPLADS, MGNREGA, PMGSY databases are completely siloed |
| **Fund Lapse Warning** | No early warning — funds lapse silently on March 31 |
| **Citizen Participation** | RTI applications only — reactive, not proactive |
| **Contractor Vetting** | Basic eligibility check at tender stage; no ongoing monitoring |
| **Weather Cross-Check** | Never done — physically impossible claims go undetected |
| **Real-Time Monitoring** | None — all data is retrospective |
| **MP Accountability** | Annual utilization certificates only |
| **Data Integration** | Each scheme has its own siloed database |

### After e-SAKSHI

| Aspect | e-SAKSHI Capability |
|--------|---------------------|
| **Anomaly Detection** | Real-time ML ensemble with 7 models running continuously |
| **Satellite Verification** | Free Sentinel-2 NDBI/NDVI change detection per work |
| **Cross-Scheme Check** | Multi-signal fuzzy matching across MGNREGA, PMGSY, MLALAD, PMAY |
| **Fund Lapse Warning** | Prophet time-series forecasting with tiered alerts (weeks in advance) |
| **Citizen Participation** | Direct demand submission + GPS-tagged photo verification |
| **Contractor Vetting** | Real-time GSTIN compliance + Louvain cartel detection |
| **Weather Cross-Check** | IMD rainfall data vs. construction timeline for all 15 states |
| **Real-Time Monitoring** | Live SSE notifications, streaming dashboards |
| **MP Accountability** | Fund utilization dashboard with Prophet lapse forecasting |
| **Data Integration** | Unified data layer across 6+ government data sources |

---

## All Features (Complete List)

### Core ML Intelligence

| Feature | Model | Status |
|---------|-------|--------|
| Satellite Ghost Detection | Sentinel-2 NDBI/NDVI | ✅ Built |
| Tabular Anomaly Detection | Isolation Forest (200 trees) | ✅ Built |
| Fund Lapse Forecasting | Facebook Prophet | ✅ Built |
| Contractor Cartel Detection | Louvain + NetworkX | ✅ Built |
| Cross-Scheme Deduplication | Multi-signal fuzzy matching | ✅ Built |
| GSTIN Compliance | Regex + API + shell company detection | ✅ Built |
| Weather Feasibility | IMD rainfall + Gamma simulation | ✅ Built |
| Ensemble Risk Scoring | Weighted 7-signal composite (L1/L2/L3) | ✅ Built |

### Governance & Legal Safety

| Feature | Description | Status |
|---------|-------------|--------|
| MP Identity Masking | L1/L2 alerts never reveal MP identity | ✅ Built |
| Legal Disclaimer | All flags include mandatory human-review notice | ✅ Built |
| Hard Rule Overrides | High-confidence signals auto-elevate tier | ✅ Built |
| Immutable Audit Log | Append-only PostgreSQL table (DB-level no UPDATE/DELETE) | ✅ Built |
| RBAC (4 Roles) | Citizen, MP, Auditor, DM — each sees different UI | ✅ Built |
| RTI Protection Notice | Citizens informed of identity protection under RTI Act 2005 | ✅ Built |

### Citizen Participation & Voice Intelligence

| Feature | Description | Status |
|---------|-------------|--------|
| Submit Project Demands | File infrastructure demands directly to constituency MP with geotagged photo proof | ✅ Built |
| 🎤 Voice Assistant & Auto-Fill | Speak in Hindi, English, etc. via Web Speech API with automatic field extraction & TTS playback | ✅ Built |
| 📸 Ground-Truth Photo Upload | Geotagged evidence pictures stored as base64 DataURL and transmitted to MP desk | ✅ Built |
| 📁 MP Citizen Evidence Folder | Full citizen dossier (photo preview, phone, village, voice notes) received and actionable by MP | ✅ Built |
| Petition Lifecycle Tracker | SUBMITTED → ENDORSED → SANCTIONED status tracking | ✅ Built |
| Quality Rating | 1–5 star rating for physical work quality | ✅ Built |
| Real-Time Notifications | SSE-based alerts across all roles | ✅ Built |

### Interactive Mapping & Satellite Forensics

| Feature | Description | Status |
|---------|-------------|--------|
| Real Satellite Basemap | ESRI World Imagery (Maxar) satellite tiles | ✅ Built |
| Interactive Leaflet.js Map | Pan, zoom, click markers on real map with click-through to complete project dossiers | ✅ Built |
| 🛰️ Dual Sentinel-2 Before/After | Live side-by-side satellite image comparison on constituency map inspector and project audit page | ✅ Built |
| 🔍 Multi-Signal Anomaly Root Causes | 7-cause forensic breakdown (Spectral nil-change, Monsoon weather, Cartel nexus, GSTIN, etc.) | ✅ Built |
| 3 Basemap Modes | Satellite / Hybrid / Street toggle | ✅ Built |
| Risk-Coded Markers | Color-coded by L1/L2/L3/Clear with pulse animation | ✅ Built |
| Fly-To Animation | Smooth zoom to selected project location | ✅ Built |
| Work ID Quick Nav | Scrollable work ID strip for fast navigation | ✅ Built |

### Accessibility & Multi-Role Governance

| Feature | Description | Status |
|---------|-------------|--------|
| 🌐 9 Regional Indian Languages | Instant language switching (English, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam) | ✅ Built |
| 🔐 Multi-Profile Demo Login | Dedicated profile cards for Citizen, MP, CAG Auditor, and DM with pre-filled demo credentials | ✅ Built |
| MP Identity Masking | L1/L2 alerts never reveal MP identity | ✅ Built |
| Legal Disclaimer | All flags include mandatory human-review notice | ✅ Built |
| Hard Rule Overrides | High-confidence signals auto-elevate tier | ✅ Built |
| Immutable Audit Log | Append-only PostgreSQL table (DB-level no UPDATE/DELETE) | ✅ Built |
| RBAC (4 Roles) | Citizen, MP, Auditor, DM — each sees different UI | ✅ Built |
| RTI Protection Notice | Citizens informed of identity protection under RTI Act 2005 | ✅ Built |

---

## Upcoming Features

### Phase 2 — Future Extensions

| Feature | Description | Priority |
|---------|-------------|----------|
| 📱 **WhatsApp Bot** | Citizen reporting via WhatsApp Business API in vernacular languages | HIGH |
| 🧠 **Graph Neural Network (GNN)** | Replace rule-based contractor scoring with GNN trained on labeled fraud data | MEDIUM |
| 🔍 **Vision Transformer (ViT)** | Direct satellite imagery classification replacing NDBI/NDVI thresholds | MEDIUM |
| 📝 **LLM Audit Reports** | Gemini 1.5 Pro auto-generates CAG-format audit memorandums from evidence chains | MEDIUM |
| 📸 **Citizen Photo AI Verification** | Computer vision model validates citizen photos match reported work type | MEDIUM |
| 📰 **Live News Integration** | NewsAPI cross-referencing for negative local media coverage of projects | LOW |
| 💬 **SMS Nudge System** | Automated SMS to MPs/DMs for fund lapse warnings | LOW |

### Phase 3 — National Deployment

| Feature | Description |
|---------|-------------|
| National Single Window Integration | Direct alert routing to District Collectors via NIC |
| MoSPI Dashboard Embedding | Embedded into official MPLADS monitoring portal |
| RTI Grievance Tracker | Link citizen reports to formal RTI filings |
| Expanded Scheme Coverage | MLALAD, DMDF, state-level MLA schemes |

---

## Getting Started

### Prerequisites

- Docker and Docker Compose (for full-stack deployment)
- Node.js 18+ (for frontend development)
- Python 3.11+ (for backend and ML development)

### Quick Start with Docker

```bash
# 1. Clone the repository
git clone <repo-url>
cd "Team Ojas SIH"

# 2. Copy environment configuration
cp .env.example .env
# Edit .env and fill in your API keys

# 3. Start all services (PostgreSQL, Redis, Neo4j, MinIO, MLflow, Backend, Frontend)
docker-compose up -d

# Services available at:
# Frontend:   http://localhost:3000
# Backend:    http://localhost:8000
# API Docs:   http://localhost:8000/api/docs
# MLflow:     http://localhost:5000
# Neo4j:      http://localhost:7474
# MinIO:      http://localhost:9001
```

### Local Development (Without Docker)

```bash
# Frontend
cd frontend
npm install
npm run dev
# → http://localhost:3000

# Backend
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
# → http://localhost:8000

# ML Training
cd ml
python training/train_all.py
# Models saved to ml/saved_models/
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL async connection string | Yes |
| `REDIS_URL` | Redis connection URL | Yes |
| `NEO4J_URI` | Neo4j Bolt URI | No (graph features) |
| `MINIO_ENDPOINT` | MinIO S3 endpoint | No (storage features) |
| `GEMINI_API_KEY` | Google Gemini API key (audit note generation) | No (AI features) |
| `COPERNICUS_USER` | ESA Copernicus Hub credentials | No (satellite features) |
| `IMD_API_KEY` | IMD API key | No (weather features) |
| `SECRET_KEY` | JWT signing secret | Yes |

> **Note:** All external API integrations have graceful fallback modes. The system operates fully without any API keys using pre-computed data and simulation modes.

---

## Tech Stack

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11 | Core backend and ML language |
| FastAPI | Latest | Async REST API framework |
| SQLAlchemy | 2.x | Async ORM for PostgreSQL |
| Uvicorn | Latest | ASGI server |
| Celery | Latest | Distributed task queue |
| Pydantic | 2.x | Data validation and settings |

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 14 | React framework (App Router) |
| TypeScript | 5.x | Type-safe frontend code |
| Leaflet.js | Latest | Interactive maps with satellite imagery |
| Material Symbols | Latest | Google Material Design icons |
| Public Sans | — | Government of India standard typeface |

### ML / Data Science

| Library | Purpose |
|---------|---------|
| scikit-learn | Isolation Forest (200 trees) |
| Facebook Prophet | Time-series lapse forecasting |
| NetworkX | Contractor network graph construction |
| community-louvain | Community detection (cartel identification) |
| rapidfuzz | Fuzzy text matching (cross-scheme NLP) |
| sentinelsat | Sentinel-2 imagery download from Copernicus |
| rasterio | Geospatial raster data processing |
| pandas / numpy | Data manipulation and feature engineering |

### Infrastructure

| Technology | Purpose |
|-----------|---------|
| PostgreSQL 15 + PostGIS 3.3 | Primary database with spatial queries |
| Neo4j 5.14 | Graph database for contractor networks |
| Redis 7 | Caching + Celery task broker |
| MinIO | S3-compatible object storage |
| MLflow | ML experiment tracking |
| Docker Compose | Full-stack container orchestration |

---

## Team

**Team Ojas** — Smart India Hackathon 2024
**Problem Statement:** PS 26102 — AI-based monitoring and audit platform for MPLADS scheme

---

<p align="center">
  <em>Built for transparent governance and accountable public spending in India.</em>
  <br/>
  <strong>🇮🇳 e-SAKSHI — Every Rupee Tracked, Every Project Verified</strong>
</p>
