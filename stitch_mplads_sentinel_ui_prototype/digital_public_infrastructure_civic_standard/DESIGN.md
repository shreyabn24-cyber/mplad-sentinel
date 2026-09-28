---
name: Digital Public Infrastructure Civic Standard
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#44474e'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#75777f'
  outline-variant: '#c5c6cf'
  surface-tint: '#4c5f82'
  primary: '#000e27'
  on-primary: '#ffffff'
  primary-container: '#0f2444'
  on-primary-container: '#798cb1'
  inverse-primary: '#b4c7ef'
  secondary: '#006d30'
  on-secondary: '#ffffff'
  secondary-container: '#92f5a4'
  on-secondary-container: '#007233'
  tertiary: '#1c0a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#3b1c00'
  on-tertiary-container: '#d27200'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e3ff'
  primary-fixed-dim: '#b4c7ef'
  on-primary-fixed: '#041b3b'
  on-primary-fixed-variant: '#344769'
  secondary-fixed: '#95f8a7'
  secondary-fixed-dim: '#79db8d'
  on-secondary-fixed: '#00210a'
  on-secondary-fixed-variant: '#005323'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Public Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  headline-xl-mobile:
    fontFamily: Public Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
  headline-lg:
    fontFamily: Public Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Public Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Public Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Public Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-lg:
    fontFamily: Public Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  title-md:
    fontFamily: Public Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Noto Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Noto Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Noto Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Noto Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-sm:
    fontFamily: Noto Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  metric-display:
    fontFamily: Public Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4rem
  gutter-mobile: 1rem
  gutter-tablet: 1.5rem
  gutter-desktop: 2rem
  container-max: 80rem
---

## Brand & Style

The design system establishes an institutional, transparent, and authoritative presence suited for public accountability and civic tracking. The visual philosophy departs sharply from commercial SaaS trends—avoiding oversized border radii, playful micro-interactions, decorative gradients, and ephemeral styling. Instead, it embodies modern Digital Public Infrastructure: sober, highly structured, resilient, and inclusive for citizens across all demographic spectrums, civic journalists, and administrative auditors.

The aesthetic blends **Corporate/Modern Governance** with **High-Contrast Utilitarianism**:
- **Clarity over Cleverness:** High information density paired with generous structural whitespace. Every data point, sanction order, and fund allocation is clearly delineated.
- **Institutional Weight:** Symmetrical grid compositions, rigid alignment, authoritative typography, and a deliberate absence of decorative blur or floating glass surfaces.
- **Civic Trust:** Evoked through rigorous adherence to high contrast (WCAG AAA for text, AA for data metrics), functional status indications with text-plus-icon redundancy, and official tri-band accents used with strict restraint.

## Colors

The color palette reflects sovereign dignity and civic utility. Dark mode is intentionally omitted as primary government information platforms prioritize daytime legibility, universal outdoor visibility on budget mobile devices, and official document-rendering paradigms.

### Core Swatches
- **Primary Sovereign Navy (`#0F2444`):** Anchors headers, primary navigation, institutional identifiers, major table headers, and high-level structural metrics. Conveys permanence, accountability, and legal validity.
- **National Ochre / Tiranga Saffron (`#D97706`):** Dedicated exclusively as a restrained administrative accent band (e.g., top 4px portal indicator, active tab underlines, and focus rings). It must never be used as a general background fill for heavy cards.
- **Civic Forest Green (`#15803D`):** Applied to finalized milestones, utilized funds, completed installations, and positive audit clearance states.
- **Critical Crimson (`#B91C1C`):** Reserved strictly for overdue projects, fund lapses, discrepancy flags, and compliance review alerts.
- **Audit Amber (`#B45309`):** Indicates pending administrative sanction, works in progress nearing deadlines, or under-review documents.

### Surfaces & Text Hierarchy
- **Canvas Base:** `#FFFFFF` for primary workspace and data cards.
- **Section Canvas:** `#F8FAFC` (Slate-50) and `#F1F5F9` (Slate-100) for structural division and alternating rows.
- **Structural Dividers:** `#CBD5E1` (Slate-300) for borders and structural separation.
- **Typography:** Primary text is `#0F172A` (Slate-900) ensuring maximum contrast; descriptive text is `#334155` (Slate-700); metadata and timestamp markers use `#64748B` (Slate-500).

## Typography

The type system pairs **Public Sans** (for institutional headings, numerical data counters, and official titles) with **Noto Sans** (for body copy, microdata, table records, and form fields).

- **Legibility Rules:** All body copy defaults to a minimum of 16px to support elder citizens and individuals accessing data on sub-optimal displays.
- **Tabular Figures:** All numerical tables displaying Indian Rupees (₹ Cr/Lakh), project sanction counts, and completion percentages must explicitly enable `font-feature-settings: "tnum" 1` to ensure vertical alignment of budgetary audits.
- **Character Spacing:** Headings maintain a slightly tightened tracking (`-0.01em`) for authoritative density, while uppercase civic labels (`label-sm`) utilize `+0.05em` letter spacing for heightened visual clarity at reduced sizes.

## Layout & Spacing

The layout architecture uses a structured **12-column fixed-max grid** capped at `80rem` (1280px) to prevent data spanning into unreadable horizontal field-lengths on ultra-wide desktop monitors. 

### Breakpoints & Grid Adaptation
- **Desktop (≥ 1024px):** 12 columns, `gutter-desktop` (32px), `margin` auto. Complex multi-metric KPI cards take 3 or 4 columns; fiscal progress matrices use 6 or 12 columns.
- **Tablet (768px – 1023px):** 8 columns, `gutter-tablet` (24px). Primary statistics consolidate to 2-column configurations.
- **Mobile (≤ 767px):** 4 columns, `gutter-mobile` (16px), fluid edge margin (16px). All comparison side-by-side elements collapse cleanly into single-column vertical stacks.

### Spacing Rhythm
Vertical cadence adheres rigorously to an 8px scale. Component interiors utilize compact internal padding (`space-md`) to ensure dense, easily scannable administrative dossiers, while page sections maintain `space-2xl` to clearly compartmentalize functional domains (e.g., Sanctions, Physical Progress, Fund Utilization, Geo-Tagged Assets).

## Elevation & Depth

Visual hierarchy is communicated via **structural borders and tonal elevation** rather than soft ambient drop shadows. This ensures that screens printed directly onto paper or exported to administrative PDFs retain absolute legibility and visual structure.

- **Surface Level 0 (Canvas):** `#F8FAFC`. Used as the base portal background.
- **Surface Level 1 (Card & Module Layer):** `#FFFFFF`. Outlined cleanly with a 1px solid `#CBD5E1` border. No drop shadows.
- **Surface Level 2 (Interactive Floating Elements & Dropdowns):** `#FFFFFF` with a single directional administrative shadow: `0px 4px 6px -1px rgba(15, 23, 42, 0.08), 0px 2px 4px -2px rgba(15, 23, 42, 0.06)` combined with a 1px solid `#94A3B8` border.
- **Surface Level 3 (Modal Dialogues & Citizen Redress Overlays):** `#FFFFFF` bounded by a 1px solid `#64748B` border, cast against a heavy institutional backdrop scrim (`#0F172A` at 60% opacity).
- **Tonal Contrast Stacking:** Table headers, sub-navigation panels, and summary metric strips use `#F1F5F9` to create instant spatial recognition without elevation layering.

## Shapes

The design system enforces a **Soft-Edged Civic Geometry (`roundedness: 1`)**. 

- **Containers & Data Cards:** Default border-radius of `0.25rem` (4px). This subtle rounding prevents harsh industrial edges while maintaining the seriousness of an official government ledger.
- **Buttons, Form Inputs, and Filter Controls:** `0.25rem` (4px) to retain continuous mechanical alignment with containing data grids.
- **Status Badges & Chips:** Maximum rounding of `0.25rem` (4px). Full pill/capsule shapes (`9999px`) are explicitly avoided, as rounded pills communicate consumer app aesthetics rather than formal public records.
- **Emblems & State Seals:** Enclosed in square frames with 1px borders or displayed as natural vector silhouettes.

## Components

### 1. Header & Official Accent Band
- **Top Sovereign Accent:** A permanent 4px solid saffron band (`#D97706`) anchored to the top of the browser window.
- **Portal Masthead:** A `#0F2444` deep navy bar housing the State Emblem/Portal insignia, multilingual switcher, accessible font-size adjuster (A- / A / A+), and high-contrast toggle.
- **Global Breadcrumb:** Located in a secondary `#F1F5F9` bar, rendered with chevron separators and high-contrast Slate-700 text.

### 2. Buttons
- **Primary Action (e.g., "Download Sanction Order", "Apply Filter"):** Background `#0F2444`, text `#FFFFFF`, radius `4px`, padding `10px 20px`. Hover state shifts to `#1E3A5F`. Focus state introduces a 2px offset ring of `#D97706`.
- **Secondary / Actionable Civic Secondary:** White `#FFFFFF` surface with a 1.5px border of `#0F2444`, text `#0F2444`. Hover state shifts to `#F1F5F9`.
- **Destructive / Flag Dispute:** Background `#FFFFFF`, border 1px solid `#B91C1C`, text `#B91C1C`. Hover shifts to `#FEF2F2`.

### 3. Status Badges
Status indicators must always use **Text + Icon + High-Contrast Color Pairing** to satisfy accessibility guidelines for color-blind citizens:
- **Completed / Sanctioned:** Green fill `#DCFCE7`, border `#86EFAC`, text `#14532D`, icon: solid checkmark.
- **In Progress / Under Execution:** Blue fill `#E0F2FE`, border `#7DD3FC`, text `#075985`, icon: clock glyph.
- **Delayed / Under Audit Review:** Amber fill `#FEF3C7`, border `#FDE68A`, text `#78350F`, icon: exclamation shield.
- **Critical Non-Compliance / Halted:** Red fill `#FEE2E2`, border `#FCA5A5`, text `#7F1D1D`, icon: alert triangle.

### 4. Data Cards & Transparency Widgets
- Built on a pure white `#FFFFFF` surface with a 1px solid `#CBD5E1` boundary.
- **Metric Header:** Upper section includes a subtle `#F8FAFC` top strip displaying the scheme title, constituency name, and unique project code (e.g., `MPLADS-2023-WB-0492`).
- **Metric Counter:** Heavy Public Sans figures (`metric-display`) displaying approved vs. disbursed funds, accompanied by visual progress tracks with high-contrast filled segments.

### 5. Form Inputs & Filtering Controls
- **Text Inputs & District Selectors:** 1.5px border of `#94A3B8`, background `#FFFFFF`, text `#0F172A`, placeholder `#64748B`. Focus state transitions border to `#0F2444` with a 2px `#D97706` outline glow.
- **Checkboxes & Radios:** Sharp square/round markers with a 2px `#0F2444` border. Checked states feature solid `#0F2444` fills with clear white verification symbols.

### 6. Transparency Comparison Viewport
- Specialized two-column layout showing "Sanctioned Specifications" vs. "Ground Execution Reality".
- Uses a split grid with alternating row colors (`#FFFFFF` and `#F8FAFC`) with verified geo-tagged photo frames bordered in `#CBD5E1`.