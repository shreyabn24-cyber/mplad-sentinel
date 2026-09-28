'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Network, AlertTriangle, Building, Search } from 'lucide-react';
import { fetchContractorGraph } from '@/lib/api';
import { ContractorNode } from '@/lib/types';

export default function ContractorsPage() {
  const { role, canReview } = useAuth();
  const [graph, setGraph] = useState<{ nodes: ContractorNode[] } | null>(null);
  const [graphError, setGraphError] = useState('');
  const [selectedNode, setSelectedNode] = useState<ContractorNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // The graph is fetched, never assumed. It previously rendered a hardcoded
  // SVG naming real-looking vendors as a bid-ringing cartel with invented risk
  // scores, a fake "Louvain Modularity: 0.74" and fabricated
  // COMMON_DIRECTOR / BID_RING edges. Nothing in that picture came from data.
  useEffect(() => {
    fetchContractorGraph()
      .then((g) => {
        setGraph(g);
        setSelectedNode(g.nodes?.[0] ?? null);
      })
      .catch(() =>
        setGraphError(
          'The contractor network service could not be reached, so no analysis is shown.'
        )
      );
  }, []);

  const filteredNodes = (graph?.nodes ?? []).filter(
    (n) =>
      n.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.gstin?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Derived from the fetched graph. `null` = unknown, and must not render as 0.
  const hubCount: number | null = graph
    ? graph.nodes.filter((n) => n.is_cluster_hub).length
    : null;

  // ── Role guardrail ──────────────────────────────────────────────────────────
  //
  // The previous test excluded only MP and CITIZEN, so an anonymous visitor was
  // shown a collusion analysis. The gate is on the review role, and the notice
  // no longer claims a statutory classification — this is a configuration
  // choice, and calling a dataset "classified" without authority to say so is
  // not something the page can assert.
  if (!canReview) {
    return (
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-2xl min-h-[60vh] flex items-center justify-center">
        <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-space-xl shadow-card text-center space-y-space-md">
          <div className="w-16 h-16 rounded-full bg-error-container text-error flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-[36px]">hub</span>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-error-container text-on-error-container">
              Access Restriction &bull; {role} scope
            </span>
            <h1
              className="text-2xl font-bold text-primary tracking-tight mt-2"
              style={{ fontFamily: "'Public Sans', sans-serif" }}
            >
              Contractor Network Analysis Requires a Reviewer Account
            </h1>
          </div>

          <p className="text-xs text-on-surface-variant leading-relaxed">
            {role === 'PUBLIC'
              ? 'You are not signed in. This page and its endpoint are served only to accounts whose role is AUDITOR or ADMIN.'
              : `Your account holds the role ${role}, which is not permitted to view this analysis.`}{' '}
            Allegations of collusion are serious, so nothing is presented here without a
            reviewer account behind it and a real dataset behind that.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/works"
              className="w-full sm:w-auto px-6 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">construction</span>
              <span>Browse published works</span>
            </Link>

            <Link
              href="/login"
              className="w-full sm:w-auto px-6 py-2.5 border border-error text-error rounded-xl text-xs font-bold hover:bg-error-container transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">login</span>
              <span>Sign in with a reviewer account</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl space-y-space-xl">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-outline-variant/30 pb-space-lg">
        <div>
          <div className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-1 font-label-md">
            <span className="material-symbols-outlined text-[16px] text-primary">hub</span>
            <span>Network Science &amp; Anti-Collusion Intelligence</span>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold text-primary tracking-tight"
            style={{ fontFamily: "'Public Sans', sans-serif" }}
          >
            Contractor Nexus &amp; Bid Cartel Graph
          </h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-3xl">
            Graph topology engine detecting collusive bidding rings, shell entities, shared registered GSTIN contact metadata,
            and disproportionate hub degree centrality.
          </p>
        </div>

        <div className="flex items-center gap-space-sm shrink-0">
          <Link
            href="/anomalies"
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-outline-variant/60 text-on-surface rounded-xl font-label-md text-xs hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">verified_user</span>
            <span>Flagged works</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-on-surface-variant" />
            {hubCount === null
              ? 'Hub count unavailable'
              : `${hubCount} High-Centrality Hub${hubCount === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {/* ── Main Grid: Interactive Network Canvas + Side Inspector ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-lg">
        {/* Left 2 Cols: Network Visualizer Canvas */}
        <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-primary uppercase tracking-wider font-label-md">
                Contractor–MP Network
              </span>
            </div>
            <span className="text-xs text-on-surface-variant font-mono">
              {graph?.nodes?.length ? 'Click an entity to inspect its dossier' : ''}
            </span>
          </div>

          {/* Network view. Rendered only from a real analysed graph; the
              previous hardcoded SVG (named vendors, fixed risk scores,
              BID RING / COMMON DIRECTOR edges, "Modularity 0.74") was
              removed because none of it came from data. */}
          {graphError ? (
            <div className="h-96 w-full rounded-xl border border-error/40 bg-error-container/20 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="material-symbols-outlined text-[32px] text-error">cloud_off</span>
              <p className="font-semibold text-sm text-on-surface">Network analysis unavailable</p>
              <p className="text-xs text-on-surface-variant max-w-sm">{graphError}</p>
            </div>
          ) : !graph ? (
            <div className="h-96 w-full rounded-xl border border-outline-variant/30 bg-surface-container flex items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-on-surface-variant animate-spin">progress_activity</span>
            </div>
          ) : graph.nodes.length === 0 ? (
            <div className="h-96 w-full rounded-xl border border-outline-variant/30 bg-surface-container flex flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="material-symbols-outlined text-[32px] text-on-surface-variant">account_tree</span>
              <p className="font-semibold text-sm text-on-surface">No contractor network has been analysed yet</p>
              <p className="text-xs text-on-surface-variant max-w-sm">
                A contractor graph is produced only after the collusion-detection model has been
                trained on real award and registration records. Until then no entities, links or
                risk scores are asserted.
              </p>
            </div>
          ) : (
            <div className="relative h-96 w-full rounded-xl bg-gradient-to-b from-[#f8fafc] to-[#edf2f7] border border-outline-variant/30 overflow-y-auto p-4">
              <ul className="space-y-1">
                {graph.nodes.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => setSelectedNode(n)}
                      className={`w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm ${
                        selectedNode?.id === n.id
                          ? 'bg-primary text-on-primary'
                          : 'hover:bg-surface-container text-on-surface'
                      }`}
                    >
                      <span className="font-mono truncate">{n.gstin || n.id}</span>
                      <span className="text-xs tabular-nums opacity-80">
                        risk {n.risk_score != null ? n.risk_score.toFixed(2) : 'n/a'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Legend. Shown only when a real graph exists to interpret. */}
          {(graph?.nodes?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between text-xs text-on-surface-variant pt-2 border-t border-outline-variant/30">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-error" /> High Risk Hub</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-600" /> Ring Member</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-secondary" /> Compliant Vendor</span>
              </div>
              <span className="font-mono text-[11px]">Edges: Cross-PAN / Co-Bidding Weight</span>
            </div>
          )}
        </div>

        {/* Right Col: Entity Dossier Inspector */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-space-lg shadow-card space-y-space-md">
          <div className="flex items-center justify-between border-b border-outline-variant/30 pb-space-sm">
            <h2 className="text-sm font-bold text-primary flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" />
              <span>Entity Intelligence Dossier</span>
            </h2>
            {selectedNode?.is_cluster_hub && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-error-container text-on-error-container font-bold">
                NEXUS HUB
              </span>
            )}
          </div>

          {selectedNode ? (
            <div className="space-y-4 text-xs">
              <div>
                <h3
                  className="text-base font-bold text-primary"
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {selectedNode.name}
                </h3>
                <div className="flex items-center gap-2 text-on-surface-variant font-mono mt-1">
                  <span>GSTIN: {selectedNode.gstin}</span>
                </div>
                <div className="text-on-surface-variant font-mono text-[11px]">PAN: {selectedNode.pan}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30">
                  <span className="text-on-surface-variant">Total Sanctions:</span>
                  <div className="text-sm font-bold font-mono text-primary mt-0.5">{selectedNode.total_works} Projects</div>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30">
                  <span className="text-on-surface-variant">Cumulative Value:</span>
                  <div className="text-sm font-bold font-mono text-primary mt-0.5">₹ {(selectedNode.total_amount / 10000000).toFixed(2)} Cr</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30">
                <div className="flex justify-between items-center">
                  <span className="text-on-surface-variant">Hub Centrality Score:</span>
                  <span className="font-mono font-bold text-error">{selectedNode.risk_score} / 100</span>
                </div>
                <div className="w-full bg-surface-container rounded-full h-2 mt-2 overflow-hidden">
                  <div className="bg-error h-full rounded-full" style={{ width: `${selectedNode.risk_score}%` }} />
                </div>
              </div>

              {/* Flags */}
              <div className="space-y-2">
                <span className="font-semibold text-on-surface">Detected Network Flags:</span>
                {selectedNode.flags.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedNode.flags.map((flag, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-error-container/40 border border-error/30 text-on-error-container flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />
                        <span>{flag}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-secondary-container/50 border border-secondary/30 text-on-secondary-container">
                    No collusive flags detected for this entity.
                  </div>
                )}
              </div>

              {/*
                The previous control was an `alert()` reading "Opening official
                MoSPI contractor audit docket for X...". It opened nothing, cited
                no docket, and implied a MoSPI integration that does not exist -
                MoSPI publishes aggregate MPLADS data and holds no per-contractor
                audit docket reachable from here. A button that claims to open an
                official record while opening a browser dialog is worse than no
                button, so it is replaced by what is actually known.
              */}
              <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant">
                    unavailable
                  </span>
                  <span className="text-xs font-bold text-on-surface">
                    Cross-reconciliation docket
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  Not generated. Producing this would require a per-contractor
                  source (GeM award data, GST filings, or a MoSPI contractor
                  release). MoSPI publishes aggregate MPLADS data and exposes no
                  per-contractor docket through any API this deployment can reach,
                  so no docket is generated here and nothing has been reconciled.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-on-surface-variant text-xs">Select any contractor node in the graph to view intelligence.</p>
          )}
        </div>
      </div>
    </div>
  );
}
