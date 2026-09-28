"""
MPLADS Sentinel — Contractor Network Graph Analyzer
====================================================
Builds NetworkX contractor-MP-district relationship graphs,
runs Louvain community detection, and identifies suspicious clusters
(shell vendor networks, MP-contractor cartels).
"""

import json
import pickle
from collections import defaultdict
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

try:
    import networkx as nx
    NETWORKX_AVAILABLE = True
except ImportError:
    NETWORKX_AVAILABLE = False

try:
    from community import community_louvain
    LOUVAIN_AVAILABLE = True
except ImportError:
    LOUVAIN_AVAILABLE = False

MODEL_DIR = Path(__file__).parent.parent / "saved_models"
MODEL_DIR.mkdir(exist_ok=True)


class ContractorGraphAnalyzer:
    """
    Graph-based anomaly detector for contractor-MP relationships.
    Identifies shell vendor networks, cartels, and concentration anomalies.
    """

    def __init__(self):
        self.G: nx.Graph = None
        self.partition: dict = {}   # Node → community ID
        self.contractor_scores: dict[str, float] = {}
        self.mp_scores: dict[str, float] = {}
        self.communities: dict[int, list] = {}

    def build_graph(self, works_df: pd.DataFrame) -> nx.Graph:
        """Build bipartite/multipartite graph from works data."""
        if not NETWORKX_AVAILABLE:
            raise RuntimeError("networkx not installed")

        G = nx.Graph()

        # Add MP nodes
        for mp_id in works_df['mp_id'].unique():
            mp_works = works_df[works_df['mp_id'] == mp_id]
            G.add_node(mp_id, node_type='MP',
                       total_works=len(mp_works),
                       total_value=float(mp_works['sanction_amount'].sum()))

        # Add contractor nodes
        for gstin in works_df['contractor_gstin'].dropna().unique():
            contractor_works = works_df[works_df['contractor_gstin'] == gstin]
            G.add_node(gstin, node_type='CONTRACTOR',
                       total_works=len(contractor_works),
                       total_value=float(contractor_works['sanction_amount'].sum()),
                       unique_mps=contractor_works['mp_id'].nunique(),
                       unique_districts=contractor_works['district_code'].nunique())

        # Add edges (MP → Contractor with aggregated contract info)
        edges = works_df.groupby(['mp_id', 'contractor_gstin']).agg(
            contract_count=('work_id', 'count'),
            total_value=('sanction_amount', 'sum'),
            years_active=('scheme_year', lambda x: x.nunique()),
        ).reset_index()

        for _, row in edges.iterrows():
            if pd.notna(row['contractor_gstin']):
                G.add_edge(
                    row['mp_id'],
                    row['contractor_gstin'],
                    contract_count=int(row['contract_count']),
                    total_value=float(row['total_value']),
                    years_active=int(row['years_active']),
                    weight=float(row['total_value']) / 1_000_000,  # Weight by ₹ crore
                )

        self.G = G
        print(f"✓ Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G

    def detect_communities(self) -> dict:
        """Run Louvain community detection to find suspicious clusters."""
        if self.G is None:
            raise RuntimeError("Build graph first")

        if LOUVAIN_AVAILABLE:
            self.partition = community_louvain.best_partition(self.G, weight='weight')
        else:
            # Fallback: connected components
            components = list(nx.connected_components(self.G))
            self.partition = {}
            for i, component in enumerate(components):
                for node in component:
                    self.partition[node] = i

        # Group nodes by community
        self.communities = defaultdict(list)
        for node, community_id in self.partition.items():
            self.communities[community_id].append(node)

        print(f"✓ Community detection: {len(self.communities)} communities found")
        return dict(self.communities)

    def score_contractors(self, works_df: pd.DataFrame) -> dict[str, float]:
        """Compute risk score for each contractor based on graph features."""
        scores = {}

        for gstin in works_df['contractor_gstin'].dropna().unique():
            contractor_works = works_df[works_df['contractor_gstin'] == gstin]
            total_works = len(contractor_works)

            if total_works == 0:
                scores[gstin] = 0.0
                continue

            # Feature 1: MP concentration (>70% from single MP = suspicious)
            mp_counts = contractor_works['mp_id'].value_counts()
            mp_concentration = float(mp_counts.iloc[0]) / total_works if len(mp_counts) > 0 else 0

            # Feature 2: Years of consecutive activity with same MP
            if mp_counts.index[0] in works_df['mp_id'].values:
                top_mp = mp_counts.index[0]
                years_with_top_mp = contractor_works[
                    contractor_works['mp_id'] == top_mp
                ]['scheme_year'].nunique()
            else:
                years_with_top_mp = 0

            # Feature 3: District concentration
            district_counts = contractor_works['district_code'].value_counts()
            district_concentration = float(district_counts.iloc[0]) / total_works if len(district_counts) > 0 else 0

            # Composite graph score
            score = 0.0
            if mp_concentration > 0.7 and total_works >= 5:
                score += 0.4
            if years_with_top_mp >= 4 and mp_concentration > 0.6:
                score += 0.3
            if district_concentration > 0.8 and total_works >= 10:
                score += 0.2
            if total_works >= 20 and mp_concentration > 0.5:
                score += 0.1

            scores[gstin] = min(1.0, score)

        self.contractor_scores = scores
        return scores

    def score_mp(self, works_df: pd.DataFrame) -> dict[str, float]:
        """Compute graph-based risk score for each MP."""
        scores = {}
        for mp_id in works_df['mp_id'].unique():
            mp_works = works_df[works_df['mp_id'] == mp_id]
            total = len(mp_works)
            if total == 0:
                scores[mp_id] = 0.0
                continue

            # Contractor exclusivity
            con_counts = mp_works['contractor_gstin'].value_counts()
            exclusivity = float(con_counts.iloc[0]) / total if len(con_counts) > 0 else 0

            score = 0.0
            if exclusivity > 0.7 and total >= 10:
                score += 0.5
            if exclusivity > 0.5 and total >= 5:
                score += 0.3
            scores[mp_id] = min(1.0, score)

        self.mp_scores = scores
        return scores

    def get_suspicious_clusters(self, min_mp_concentration: float = 0.7) -> list[dict]:
        """Return list of suspicious contractor clusters."""
        suspicious = []
        for community_id, nodes in self.communities.items():
            contractors = [n for n in nodes if n in self.contractor_scores]
            mps_in_cluster = [n for n in nodes if n not in self.contractor_scores]

            if not contractors:
                continue

            avg_score = np.mean([self.contractor_scores[c] for c in contractors])
            if avg_score > 0.4:
                suspicious.append({
                    'community_id': community_id,
                    'contractors': contractors,
                    'mps': mps_in_cluster,
                    'avg_risk_score': round(float(avg_score), 3),
                    'total_nodes': len(nodes),
                })

        return sorted(suspicious, key=lambda x: x['avg_risk_score'], reverse=True)

    def get_graph_json(self) -> dict:
        """Return graph data in format suitable for frontend visualization."""
        if self.G is None:
            return {'nodes': [], 'links': []}

        nodes = []
        for node, data in self.G.nodes(data=True):
            nodes.append({
                'id': node,
                'type': data.get('node_type', 'UNKNOWN'),
                'total_works': data.get('total_works', 0),
                'total_value': data.get('total_value', 0),
                'risk_score': self.contractor_scores.get(node, self.mp_scores.get(node, 0)),
                'community': self.partition.get(node, 0),
            })

        links = []
        for u, v, data in self.G.edges(data=True):
            links.append({
                'source': u,
                'target': v,
                'contract_count': data.get('contract_count', 1),
                'total_value': data.get('total_value', 0),
                'years_active': data.get('years_active', 1),
                'weight': data.get('weight', 1),
            })

        return {'nodes': nodes, 'links': links}

    def save(self, path: Optional[Path] = None) -> Path:
        path = path or MODEL_DIR / "contractor_graph.pkl"
        with open(path, 'wb') as f:
            pickle.dump({
                'G': self.G,
                'partition': self.partition,
                'contractor_scores': self.contractor_scores,
                'mp_scores': self.mp_scores,
                'communities': dict(self.communities),
            }, f)
        print(f"✓ Graph model saved to {path}")
        return path

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "ContractorGraphAnalyzer":
        path = path or MODEL_DIR / "contractor_graph.pkl"
        with open(path, 'rb') as f:
            data = pickle.load(f)
        analyzer = cls()
        analyzer.G = data['G']
        analyzer.partition = data['partition']
        analyzer.contractor_scores = data['contractor_scores']
        analyzer.mp_scores = data['mp_scores']
        analyzer.communities = data['communities']
        return analyzer
