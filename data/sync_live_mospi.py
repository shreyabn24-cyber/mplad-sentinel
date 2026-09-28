"""
MPLADS Sentinel — Live MoSPI DigiGov API Sync
==============================================
Queries the official Ministry of Statistics & Programme Implementation (MoSPI)
MPLADS DigiGov REST API to fetch live, authenticated data:
1. National summary metrics (recommendations, sanctions, completions, expenditure)
2. All 36 States/UTs reference data
3. 18th Lok Sabha & Rajya Sabha MP performance data
4. Updates local mps.csv and outputs live_national_stats.json and live_mp_performance.csv
"""

import sys
import ssl
import json
import re
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = Path(__file__).parent / "output"
DATA_DIR.mkdir(exist_ok=True, parents=True)

BASE_URL = "https://www.mplads.mospi.gov.in/rest/PreLoginDashboardData"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json, text/plain, */*'
}


def post_json(endpoint: str, payload_dict: dict, timeout: int = 12):
    import urllib.request
    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(payload_dict).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=HEADERS, method='POST')
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read()
        try:
            return json.loads(raw.decode('utf-8'))
        except UnicodeDecodeError:
            return json.loads(raw.decode('latin-1'))


def parse_amount(val_obj) -> float:
    if isinstance(val_obj, list) and len(val_obj) > 0:
        val_str = str(val_obj[0]).replace('\xa0', '').replace(',', '').strip()
        try:
            return float(val_str)
        except ValueError:
            return 0.0
    return 0.0


def parse_count(val_obj) -> int:
    if isinstance(val_obj, list) and len(val_obj) > 0:
        val_str = str(val_obj[0]).replace('\xa0', '').replace(',', '').strip()
        try:
            return int(float(val_str))
        except ValueError:
            return 0
    return 0


def fetch_national_stats():
    print("📡 Fetching National 18th Lok Sabha Summary from MoSPI API...")
    data = post_json("/getTilesData", {"uname": "0,0,0,2"})
    
    stats = {
        "tenure": "18th Lok Sabha",
        "tenure_id": 7,
        "allocated_limit_inr": parse_amount(data.get("Allocated Limit for Hon'ble MPs")),
        "allocated_limit_cr": data.get("Allocated Limit for Hon'ble MPs", ["", ""])[1].strip() if len(data.get("Allocated Limit for Hon'ble MPs", [])) > 1 else "",
        "expenditure_inr": parse_amount(data.get("Expenditure on Completed and On-going Works as on Date")),
        "expenditure_cr": data.get("Expenditure on Completed and On-going Works as on Date", ["", ""])[1].strip() if len(data.get("Expenditure on Completed and On-going Works as on Date", [])) > 1 else "",
        "works_recommended_count": parse_count(data.get("Works Recommended")),
        "works_recommended_inr": parse_amount(data.get("Works Recommended", ["", ""])[1:]),
        "works_sanctioned_count": parse_count(data.get("Works Sanctioned")),
        "works_sanctioned_inr": parse_amount(data.get("Works Sanctioned", ["", ""])[1:]),
        "works_completed_count": parse_count(data.get("Works Completed")),
        "works_completed_inr": parse_amount(data.get("Works Completed", ["", ""])[1:]),
        "calamity_consent_count": parse_count(data.get("Amount consented for Calamity")),
        "last_synced_at": pd.Timestamp.now().isoformat(),
        "source": "https://www.mplads.mospi.gov.in/rest/PreLoginDashboardData/getTilesData"
    }

    out_path = DATA_DIR / "live_national_stats.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
    print(f"  ✓ Saved national summary to {out_path}")
    print(f"    - Allocated: ₹{stats['allocated_limit_inr']:,.2f}")
    print(f"    - Expenditure: ₹{stats['expenditure_inr']:,.2f}")
    print(f"    - Works Sanctioned: {stats['works_sanctioned_count']:,}")
    print(f"    - Works Completed:  {stats['works_completed_count']:,}")
    return stats


def fetch_mp_combo():
    print("\n📡 Fetching official MP list from MoSPI DigiGov API...")
    data = post_json("/getMpAndConstCombo", {"uname": "0,0,0,2"})
    print(f"  ✓ Retrieved {len(data)} MPs from official portal.")
    return data


def clean_name(s: str) -> str:
    s = re.sub(r'^(dr|mr|mrs|shri|smt|adv|prof|ms)\.?\s+', '', str(s), flags=re.IGNORECASE)
    s = re.sub(r'[^a-zA-Z0-9\s]', '', s)
    return " ".join(s.upper().split())


def sync_all_mps(limit: int = 50):
    """
    Syncs live metrics for MPs.
    limit can be set to query a batch or None for all.
    """
    national = fetch_national_stats()
    api_mps = fetch_mp_combo()

    mps_path = DATA_DIR / "mps.csv"
    if not mps_path.exists():
        print(f"❌ {mps_path} not found.")
        return

    mps_df = pd.read_csv(mps_path)
    print(f"\n📂 Local mps.csv contains {len(mps_df)} MPs.")

    # Build name lookup for api_mps
    api_lookup = {}
    for item in api_mps:
        c_name = clean_name(item.get("CAPTION", ""))
        api_lookup[c_name] = item.get("ID")

    # Match each local MP
    matched = 0
    mp_api_ids = []
    for _, row in mps_df.iterrows():
        c_local = clean_name(row["full_name"])
        api_id = api_lookup.get(c_local)
        if not api_id:
            # Try fuzzy/token match
            tokens = set(c_local.split())
            best_id = None
            for api_name, a_id in api_lookup.items():
                api_tokens = set(api_name.split())
                if tokens and api_tokens and (tokens.issubset(api_tokens) or api_tokens.issubset(tokens)):
                    best_id = a_id
                    break
            api_id = best_id

        if api_id:
            matched += 1
        mp_api_ids.append(api_id)

    mps_df["digigov_id"] = mp_api_ids
    print(f"  ✓ Successfully mapped {matched} / {len(mps_df)} MPs to live MoSPI DigiGov IDs.")

    # Fetch and map states
    print("\n📡 Fetching official State IDs from MoSPI API...")
    states_data = post_json("/getStateData", {})
    # Map state name to state_id
    state_name_to_id = {}
    for st in states_data:
        s_name = st.get("STATE_NAME", "").strip().upper()
        state_name_to_id[s_name] = st.get("STATE_ID")

    # Map state_code from reference/states.csv
    states_ref_path = Path(__file__).parent.parent / "data" / "reference" / "states.csv"
    code_to_state_id = {}
    if states_ref_path.exists():
        ref_df = pd.read_csv(states_ref_path)
        for _, r in ref_df.iterrows():
            sc = str(r["state_code"]).strip().upper()
            sn = str(r["state_name"]).strip().upper()
            # Find in state_name_to_id
            for k, sid in state_name_to_id.items():
                if k in sn or sn in k:
                    code_to_state_id[sc] = sid
                    break
    # Defaults for unmatched
    code_to_state_id.setdefault("AN", 35)
    code_to_state_id.setdefault("AP", 2)
    code_to_state_id.setdefault("DL", 7)
    code_to_state_id.setdefault("MH", 27)
    code_to_state_id.setdefault("UP", 9)
    code_to_state_id.setdefault("WB", 19)

    # Query live metrics for mapped MPs using ThreadPoolExecutor
    print(f"\n⚡ Querying live tile metrics from MoSPI for mapped MPs (batch limit={limit})...")
    targets = mps_df[mps_df["digigov_id"].notna()].head(limit)

    results = {}

    def fetch_one(mp_row):
        api_id = int(mp_row["digigov_id"])
        sc = str(mp_row["state_code"]).strip().upper()
        state_id = code_to_state_id.get(sc, 0)
        # Format uname: "<digigov_id>,<state_id>,0,2"
        try:
            res = post_json("/getTilesData", {"uname": f"{api_id},{state_id},0,2"}, timeout=8)
            exp = parse_amount(res.get("Expenditure on Completed and On-going Works as on Date"))
            rec = parse_count(res.get("Works Recommended"))
            sanc = parse_count(res.get("Works Sanctioned"))
            comp = parse_count(res.get("Works Completed"))
            return mp_row["mp_id"], {
                "actual_expenditure": exp,
                "works_recommended": rec,
                "works_sanctioned": sanc,
                "works_completed": comp,
                "sync_status": "SUCCESS"
            }
        except Exception as e:
            return mp_row["mp_id"], {
                "actual_expenditure": 0.0,
                "works_recommended": 0,
                "works_sanctioned": 0,
                "works_completed": 0,
                "sync_status": f"FAILED: {e}"
            }

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(fetch_one, row) for _, row in targets.iterrows()]
        for f in as_completed(futures):
            mp_id, data = f.result()
            results[mp_id] = data

    # Populate dataframe
    for col in ["actual_expenditure", "works_recommended", "works_sanctioned", "works_completed", "sync_status"]:
        if col not in mps_df.columns:
            mps_df[col] = 0 if col != "sync_status" else "UNSYNCED"

    for mp_id, data in results.items():
        idx = mps_df[mps_df["mp_id"] == mp_id].index
        if len(idx) > 0:
            for k, v in data.items():
                mps_df.loc[idx[0], k] = v

    # Save updated mps.csv
    mps_df.to_csv(mps_path, index=False)
    print(f"✓ Saved updated {mps_path} with live figures!")

    # Save performance CSV
    perf_path = DATA_DIR / "live_mp_performance.csv"
    mps_df[mps_df["sync_status"] == "SUCCESS"].to_csv(perf_path, index=False)
    print(f"✓ Exported synced MP performance records to {perf_path}")


if __name__ == "__main__":
    sync_all_mps(limit=None)
