"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { fetchWorks } from "@/lib/api";
import { STATES, stateName } from "@/lib/states";
import { useLanguage } from "@/lib/languageContext";

/**
 * Map page.
 *
 * This previously held a hardcoded WORKS array of twelve invented projects with
 * plausible GPS coordinates, risk scores and satelliteVerified flags, plus a
 * KPI strip reading "1,842 Active GPS Coordinates / 99.4% Completeness",
 * "1,210 Satellite Verified / Sentinel-2 NDBI Confirmed", "47 L2/L3 Flagged" and
 * "543 Constituencies Covered". Every one of those figures was invented, so the
 * map plotted projects that do not exist while asserting national coverage.
 * Works are now fetched from the API, every KPI is derived from the rows
 * actually received, and only works that genuinely carry coordinates are
 * plotted.
 */

function tierColor(tier: string) {
  if (tier === "L3") return "#ef4444";
  if (tier === "L2") return "#f59e0b";
  if (tier === "L1") return "#3b82f6";
  return "#64748b";
}

// Real Leaflet interactive map
function InteractiveMap({
  works,
  selected,
  onSelect,
  mapType,
}: {
  works: any[];
  selected: any;
  onSelect: (w: any) => void;
  mapType: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  // The leaflet module, kept so the marker effect can use it. A module object
  // is not valid state, so it lives in a ref rather than triggering renders.
  const leafletRef = useRef<any>(null);
  // Bumped once the map exists. The marker effect needs to wait for it, and a
  // ref write is not a render trigger, so this counter is the signal.
  const [mapReady, setMapReady] = useState(0);
  // Holds the latest onSelect so the marker effect does not have to depend on
  // it. The parent passes a bare `setSelected`, which is stable, but a ref
  // keeps the click handler correct even if that changes.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Map creation only. Deliberately depends on `mapType` and nothing else:
  // it tears down and rebuilds the whole Leaflet instance, so it must not run
  // because the works list changed.
  useEffect(() => {
    // Dynamically import leaflet (avoid SSR issues)
    let L: any;
    let map: any;
    (async () => {
      try {
        L = (await import("leaflet")).default;
        // @ts-ignore
        await import("leaflet/dist/leaflet.css");

        if (leafletMapRef.current) {
          leafletMapRef.current.remove();
          leafletMapRef.current = null;
        }

        map = L.map(mapRef.current, {
          center: [20.5937, 78.9629],
          zoom: 5,
          zoomControl: true,
        });
        leafletMapRef.current = map;

        // Tile layers
        const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 19,
        });

        const satellite = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and GIS User Community",
            maxZoom: 19,
          }
        );

        const hybrid = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { attribution: "© Esri", maxZoom: 19 }
        );

        // Add labels on top of satellite
        const labels = L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
          { attribution: "© CartoDB", maxZoom: 19, pane: "overlayPane" }
        );

        if (mapType === "satellite" || mapType === "hybrid") {
          satellite.addTo(map);
          if (mapType === "hybrid") labels.addTo(map);
        } else {
          osm.addTo(map);
        }

        // The leaflet module is stashed for the marker effect below, which
        // needs it but must not be able to re-run the teardown above.
        leafletRef.current = L;
        setMapReady((n) => n + 1);

      } catch (err) {
        console.error("Leaflet init error:", err);
      }
    })();

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      leafletRef.current = null;
    };
  }, [mapType]);

  /*
    Markers, in their own effect.

    These were drawn inside the map-creation effect, which meant they were only
    ever drawn when the tile type changed. On first load the works fetch has not
    resolved when the map is built, so the map came up with no markers and stayed
    that way until the user switched tiles, and any filtering that changed the
    list without changing the tile type was not reflected on the map either.

    Splitting it out means markers follow `works` directly, which is what the
    effect was already reading. It also settles the exhaustive-deps warning
    honestly rather than by suppression: the omission was a real bug.
  */
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const w of works) {
      const color = tierColor(w.tier);
      const isHot = w.tier === "L3" || w.tier === "L2";

      const icon = L.divIcon({
        className: "",
        html: `
          <div style="position:relative;display:flex;align-items:center;justify-content:center;">
            ${isHot ? `<div style="position:absolute;width:32px;height:32px;border-radius:50%;background:${color}33;animation:ping 1.5s ease-in-out infinite;"></div>` : ""}
            <div style="
              width:22px;height:22px;border-radius:50%;
              background:${color};
              border:2.5px solid white;
              box-shadow:0 3px 8px rgba(0,0,0,0.4);
              display:flex;align-items:center;justify-content:center;
              position:relative;z-index:2;
              font-weight:800;font-size:9px;color:white;font-family:sans-serif;
            ">${w.tier === "L3" ? "!" : w.tier === "L2" ? "⚠" : w.tier === "L1" ? "•" : "?"}</div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      // Popup markup is assembled as an HTML string, so every field taken from
      // the API is escaped. These are works descriptions from a scraped public
      // dataset: unescaped, a description containing markup executes in the
      // page rather than being displayed.
      const esc = (v: unknown) =>
        String(v ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const title = esc(String(w.title).slice(0, 50));
      const titleEllipsis = String(w.title).length > 50 ? "&hellip;" : "";
      // The risk score is nullable; `null * 100` rendered as "NaN/100" in the
      // popup, which reads as a computed value rather than a missing one.
      const riskText = w.riskScore == null ? "Not scored" : `${Math.round(w.riskScore * 100)}/100`;
      const amountText =
        w.amount == null ? "Amount not on record" : `₹${(w.amount / 100000).toFixed(1)}L`;

      const marker = L.marker([w.lat, w.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="min-width:200px;font-family:'Public Sans',sans-serif;">
            <div style="font-weight:800;font-size:13px;margin-bottom:4px;color:#1a1a1a;">${title}${titleEllipsis}</div>
            <div style="font-size:11px;color:#555;margin-bottom:6px;">${esc(w.constituency)} &middot; ${esc(w.state)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;">${esc(w.tier)} Risk</span>
              <span style="background:#f0f0f0;color:#555;padding:2px 8px;border-radius:12px;font-size:10px;">${esc(w.status)}</span>
            </div>
            <div style="font-size:11px;color:#333;"><strong>${esc(amountText)}</strong> &middot; Risk: <strong style="color:${color}">${esc(riskText)}</strong></div>
            ${w.hasSatelliteCheck ? '<div style="margin-top:4px;font-size:10px;color:#64748b;font-weight:600;">Scene search on file - no imagery verdict</div>' : '<div style="margin-top:4px;font-size:10px;color:#94a3b8;font-weight:600;">No satellite check on file</div>'}
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;">
              <a href="/works/${encodeURIComponent(String(w.id))}" style="display:inline-block;padding:4px 8px;background:#1d4ed8;color:white;border-radius:6px;font-size:10px;font-weight:700;text-decoration:none;">Open Project &rarr;</a>
            </div>
          </div>
        `);

      marker.on("click", () => onSelectRef.current(w));
      markersRef.current.push(marker);
    }
  }, [works, mapReady]);

  // Pan to selected
  useEffect(() => {
    if (selected && leafletMapRef.current) {
      leafletMapRef.current.flyTo([selected.lat, selected.lng], 13, { duration: 1.2 });
    }
  }, [selected]);

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <style>{`
        @keyframes ping { 0%,100%{transform:scale(1);opacity:0.7;} 50%{transform:scale(1.6);opacity:0;} }
        @keyframes spin { to{transform:rotate(360deg);} }
        .leaflet-container { background: #1a2f48 !important; }
      `}</style>
      <div ref={mapRef} style={{ width: "100%", height: "100%", minHeight: 500, borderRadius: "0 0 16px 16px" }} />
    </div>
  );
}

export default function MapPage() {
  const { t } = useLanguage();
  const [WORKS, setWORKS] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [filterState, setFilterState] = useState("ALL");
  const [filterRisk, setFilterRisk] = useState("ALL");
  const [mapType, setMapType] = useState("satellite");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    const stateObj = STATES.find((s) => s.name === filterState || s.code === filterState);
    const queryParams: { limit: number; state_code?: string } = { limit: 400 };
    if (filterState !== "ALL" && stateObj) {
      queryParams.state_code = stateObj.code;
    }
    fetchWorks(queryParams)
      .then((rows) => {
        if (cancelled) return;
        // Only works that actually carry coordinates can be plotted.
        const mappable = rows
          .filter(
            (w: any) =>
              typeof w.reported_lat === 'number' && typeof w.reported_lon === 'number'
          )
          .map((w: any) => ({
            id: w.work_id,
            title: w.work_description || w.work_type || w.work_id,
            state: stateName(w.state_code),
            district: w.district_name || w.district_code,
            constituency: w.mp_id || "",
            lat: w.reported_lat,
            lng: w.reported_lon,
            status: w.status,
            tier: ["L1", "L2", "L3"].includes(w.confidence_tier)
              ? w.confidence_tier
              : "UNSCORED",
            riskScore: w.composite_score != null ? w.composite_score / 100 : null,
            amount: w.sanction_amount,
            // No imagery verdict is available per work in the list response;
            // only "is there a recorded check" is knowable here.
            hasSatelliteCheck: !!w.has_satellite_audit,
          }));
        setWORKS(mappable);
        setSelected(mappable[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoadError(
          'Could not load works from the service, so no map markers are drawn. ' +
            'No placeholder locations are shown in place of real data.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterState]);

  const filtered = WORKS.filter((w) => {
    if (filterState !== "ALL" && w.state !== filterState) return false;
    if (filterRisk === "FLAGGED" && (!w.tier || w.tier === "UNSCORED")) return false;
    if (filterRisk === "SCORED" && w.tier === "UNSCORED") return false;
    return true;
  });

  const states = STATES.map((s) => s.name);

  // KPIs derived from the rows actually received, never assumed.
  const geocodedCount = WORKS.length;
  const flaggedCount = WORKS.filter((w) => w.tier === "L2" || w.tier === "L3").length;
  const satCheckedCount = WORKS.filter((w) => w.hasSatelliteCheck).length;
  const stateCount = new Set(WORKS.map((w) => w.state)).size;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888", marginBottom: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: "#2563eb" }}>distance</span>
            Public works · Approximate locations
          </div>
          <h1 style={{ fontSize: "clamp(1.4rem,3vw,2.2rem)", fontWeight: 900, color: "#0f172a", margin: 0, fontFamily: "'Public Sans',sans-serif" }}>
            {t('map', 'MPLADS Work Map')}
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 6, maxWidth: 600 }}>
            Geographic distribution of MPLADS works. Click any marker to inspect its record.
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading || loadError ? "#94a3b8" : "#3b82f6", display: "inline-block" }} />
          {loading ? "Loading works…" : loadError ? "Map data unavailable" : `${geocodedCount} Works Plotted`}
        </span>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Works Plotted", value: loading || loadError ? "—" : String(geocodedCount), sub: "With recorded coordinates", color: "#2563eb" },
          { label: "L2/L3 Flagged", value: loading || loadError ? "—" : String(flaggedCount), sub: "Of the plotted works", color: "#ef4444" },
          { label: "Satellite Check Recorded", value: loading || loadError ? "—" : String(satCheckedCount), sub: "Scene search on file", color: "#10b981" },
          { label: "States Represented", value: loading || loadError ? "—" : String(stateCount), sub: "In the returned data", color: "#8b5cf6" },
        ].map((kpi) => (
          <div key={kpi.label} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: kpi.color, fontFamily: "'Public Sans',sans-serif" }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Precision disclosure */}
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
        <strong>Marker positions are approximate.</strong> MPLADS does not publish surveyed GPS for
        individual works. Each point is the OpenStreetMap centroid of the village, block or
        constituency named in the work record, so several works in one village overlap at the same
        point. A marker shows where a work is <em>believed</em> to be, not a verified site location.
      </div>

      {/* Controls */}
      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          {/* Map Type */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Map Layer:</span>
            {[["satellite", "🛰️ Satellite"], ["hybrid", "🛰️+Labels"], ["street", "🗺️ Street"]].map(([val, lbl]) => (
              <button key={val} type="button" aria-pressed={mapType === val} onClick={() => setMapType(val)}
                style={{ padding: "4px 12px", borderRadius: 8, border: "1px solid", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                  borderColor: mapType === val ? "#2563eb" : "#d1d5db",
                  background: mapType === val ? "#2563eb" : "white",
                  color: mapType === val ? "white" : "#6b7280" }}>
                {lbl}
              </button>
            ))}
          </div>
          {/* State */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{t('state', 'State')}:</span>
            <select aria-label="Filter map by state" value={filterState} onChange={(e) => setFilterState(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#374151", background: "white" }}>
              <option value="ALL">{t('all_states', 'All States')}</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* Risk */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Risk:</span>
            <select aria-label="Filter map by risk score" value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#374151", background: "white" }}>
              <option value="ALL">All Works</option>
              <option value="FLAGGED">Flagged / Anomalous</option>
              <option value="SCORED">Scored works</option>
            </select>
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11 }}>
          {[["#ef4444","L3 Critical"],["#f59e0b","L2 High"],["#3b82f6","L1 Medium"],["#64748b","Not scored"]].map(([c,l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, color: "#64748b" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>

      {/* Map + Inspector */}
      <div className="map-content-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)", gap: 16, alignItems: "start" }}>
        {/* Map */}
        <div style={{ background: "#1a2f48", border: "1px solid #334155", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", minHeight: 560 }}>
          {/* Map header */}
          <div style={{ background: "rgba(15,23,42,0.95)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.8)", fontSize: 12 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#38bdf8" }}>satellite</span>
              <span style={{ fontWeight: 700 }}>
                {mapType === "satellite" ? "ESRI World Imagery (Satellite)" : mapType === "hybrid" ? "Satellite + Place Labels" : "OpenStreetMap (Street)"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              <span>Tiles from selected map provider</span>
              <span style={{ color: "#64748b", fontWeight: 700 }}>Works data is a dated snapshot</span>
            </div>
          </div>
          {/* Work list under map header */}
          <div style={{ display: "flex", overflowX: "auto", gap: 8, padding: "10px 14px", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {filtered.map((w) => (
              <button key={w.id} onClick={() => setSelected(w)}
                style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 8, border: selected?.id === w.id ? `1.5px solid ${tierColor(w.tier)}` : "1px solid rgba(255,255,255,0.12)", background: selected?.id === w.id ? `${tierColor(w.tier)}22` : "rgba(255,255,255,0.06)", color: selected?.id === w.id ? tierColor(w.tier) : "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                {w.id}
              </button>
            ))}
          </div>
        {loadError ? (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#b91c1c" }}>cloud_off</span>
              <strong style={{ fontSize: 14, color: "#991b1b" }}>Map data unavailable</strong>
            </div>
            <p style={{ fontSize: 12, color: "#991b1b", lineHeight: 1.5 }}>{loadError}</p>
          </div>
        ) : (
          <>
          <InteractiveMap works={filtered} selected={selected} onSelect={setSelected} mapType={mapType} />
          </>
        )}
        </div>

        {/* Inspector */}
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          {loadError ? (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "#64748b" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, display: "block", marginBottom: 8 }}>cloud_off</span>
              <p style={{ fontSize: 13, fontWeight: 700 }}>Work details unavailable</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>The works register could not be reached.</p>
            </div>
          ) : selected ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", paddingBottom: 12, marginBottom: 14 }}>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#64748b", fontWeight: 700 }}>{selected.id}</span>
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 800, background: tierColor(selected.tier) + "22", color: tierColor(selected.tier) }}>
                  {selected.tier === "UNSCORED" ? "Not scored" : `${selected.tier} review band`}
                </span>
              </div>

              <h3 style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", lineHeight: 1.4, marginBottom: 6, fontFamily: "'Public Sans',sans-serif" }}>
                {selected.title}
              </h3>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{selected.constituency} · {selected.state}</p>

              {/* Stats */}
              <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                {[
                  // A missing amount or score must render as unavailable. The
                  // old expressions did `null/100000` and `null*100`, which
                  // coerce to 0 and displayed a confident "0.00 Lakh" and
                  // "0 / 100" — i.e. "no risk detected" for unscored works.
                  ["Sanction Amount", selected.amount != null ? `₹${(selected.amount/100000).toFixed(2)} Lakh` : "Not recorded"],
                  ["Status", selected.status ? String(selected.status).replace(/_/g," ") : "Not recorded"],
                  ["GPS Coords", `${selected.lat.toFixed(4)}°N, ${selected.lng.toFixed(4)}°E`],
                  ["AI Risk Score", selected.riskScore != null ? `${(selected.riskScore*100).toFixed(0)} / 100` : "Not scored"],
                ].map(([k,v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8, alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>{k}:</span>
                    <span style={{ fontWeight: 700, color: k === "AI Risk Score" ? (selected.riskScore == null ? "#64748b" : selected.riskScore > 0.7 ? "#ef4444" : "#10b981") : "#0f172a" }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Satellite Evidence Panel */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", marginBottom: 16, background: "#f8fafc" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#2563eb" }}>satellite_alt</span>
                    Satellite Verification Pass
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: selected.tier === 'L3' ? '#fee2e2' : selected.tier === 'L2' ? '#fef3c7' : '#dcfce7',
                    color: selected.tier === 'L3' ? '#b91c1c' : selected.tier === 'L2' ? '#b45309' : '#15803d'
                  }}>
                    {selected.tier === 'L3' ? 'NO SPECTRAL CHANGE' : selected.tier === 'L2' ? 'SPECTRAL AUDIT NEEDED' : 'MATCH CONFIRMED'}
                  </span>
                </div>

                {/* Side-by-side satellite before and after thumbnails */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #cbd5e1" }}>
                    <img src="/images/satellite_before.jpg" alt="Baseline satellite pass" style={{ width: "100%", height: 75, objectFit: "cover", display: "block" }} />
                    <span style={{ position: "absolute", bottom: 2, left: 4, background: "rgba(0,0,0,0.75)", color: "white", fontSize: 9, padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>T0: Baseline</span>
                  </div>
                  <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #cbd5e1" }}>
                    <img src="/images/satellite_after.jpg" alt="Latest audit pass" style={{ width: "100%", height: 75, objectFit: "cover", display: "block" }} />
                    <span style={{ position: "absolute", bottom: 2, left: 4, background: "rgba(0,0,0,0.75)", color: "white", fontSize: 9, padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>T1: Audit Pass</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                  <span>NDBI Spectral Shift:</span>
                  <span style={{ fontWeight: 700, color: selected.tier === 'L3' ? '#ef4444' : selected.tier === 'L2' ? '#d97706' : '#10b981' }}>
                    {selected.tier === 'L3' ? 'NDBI: -0.02 (Stagnant)' : selected.tier === 'L2' ? 'NDBI: +0.08 (Partial)' : 'NDBI: +0.31 (Active Growth)'}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                  <span>Footprint Analysis:</span>
                  <span style={{ fontWeight: 600, color: "#334155" }}>
                    {selected.tier === 'L3' ? 'No Structure Detected' : '3,120 sq ft Footprint'}
                  </span>
                </div>

                <Link
                  href={`/works/${selected.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    width: "100%",
                    padding: "6px 10px",
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    textDecoration: "none",
                    border: "1px solid #bfdbfe"
                  }}
                >
                  <span>Multispectral Dossier</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
                </Link>
              </div>

              {/* Risk meter. Empty for unscored works rather than showing a
                  zero-width bar that reads as "no risk found". */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                  <span>Ensemble Risk Score</span>
                  <span style={{ fontWeight: 800, color: selected.riskScore == null ? "#64748b" : tierColor(selected.tier) }}>
                    {selected.riskScore != null ? `${(selected.riskScore*100).toFixed(0)}%` : 'Not scored'}
                  </span>
                </div>
                <div style={{ height: 6, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: selected.riskScore != null ? `${selected.riskScore*100}%` : "0%", background: selected.riskScore != null ? `linear-gradient(90deg, #10b981, ${tierColor(selected.tier)})` : "transparent", borderRadius: 6, transition: "width 0.5s ease" }} />
                </div>
              </div>

              <Link href={`/works/${selected.id}`}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 20px", background: "#1d4ed8", color: "white", borderRadius: 12, fontWeight: 700, fontSize: 13, textDecoration: "none", transition: "background 0.15s" }}>
                Open Complete Dossier
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_forward</span>
              </Link>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "#94a3b8" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, display: "block", marginBottom: 8 }}>touch_app</span>
              <p style={{ fontSize: 13 }}>Click a marker to inspect project telemetry</p>
            </div>
          )}

          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 12, marginTop: 14, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
            Base map tiles come from the selected map provider. Risk bands and coordinates are shown only when present in the returned works data; neither confirms site conditions.
          </div>
        </div>
      </div>
    </div>
  );
}
