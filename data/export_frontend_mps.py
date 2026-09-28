import json
import pandas as pd
from pathlib import Path

data_dir = Path(__file__).parent / 'output'
df = pd.read_csv(data_dir / 'mps.csv')
raw = pd.read_csv(data_dir / 'Allocated Limit for Honble MPs (1).csv')
raw = raw[raw['State'].str.strip() != ''].copy()
raw['full_name'] = raw["Hon'ble Members of Parliaments"].str.strip().str.title()
raw['constituency_name'] = raw['Constituency'].str.strip().str.title()
raw_map = dict(zip(raw['full_name'], raw['constituency_name']))

records = []
for _, r in df.iterrows():
    c_name = raw_map.get(r['full_name'], r['constituency_code'])
    records.append({
        'mp_id': r['mp_id'],
        'full_name': r['full_name'],
        'party': r['party'],
        'state_code': r['state_code'],
        'constituency_code': r['constituency_code'],
        'constituency_name': c_name,
        'annual_allocation': float(r['annual_allocation'])
    })

out_path = Path(__file__).parent.parent / 'frontend' / 'lib' / 'allRealMps.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(records, f, indent=2)

print(f"Successfully saved {len(records)} real MPs to {out_path}")
