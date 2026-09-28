"""
Process real Lok Sabha MP allocated limit data and update the project dataset.
Replaces fake synthetic MPs with the authentic 18th Lok Sabha MPs and their allocated funds.
"""

import sys
from pathlib import Path
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

# Path definitions
DATA_DIR = Path(__file__).parent
OUTPUT_DIR = DATA_DIR / 'output'
REAL_CSV_PATH = OUTPUT_DIR / 'Allocated Limit for Honble MPs (1).csv'

STATE_MAP = {
    'Maharashtra': 'MH', 'Uttar Pradesh': 'UP', 'Madhya Pradesh': 'MP',
    'Rajasthan': 'RJ', 'Gujarat': 'GJ', 'Karnataka': 'KA',
    'Tamil Nadu': 'TN', 'West Bengal': 'WB', 'Andhra Pradesh': 'AP',
    'Telangana': 'TS', 'Bihar': 'BR', 'Odisha': 'OR',
    'Haryana': 'HR', 'Punjab': 'PB', 'Delhi': 'DL',
    'Kerala': 'KL', 'Jharkhand': 'JH', 'Assam': 'AS', 'Chhattisgarh': 'CG',
    'Jammu And Kashmir': 'JK', 'Uttarakhand': 'UK', 'Himachal Pradesh': 'HP',
    'Tripura': 'TR', 'Manipur': 'MN', 'Meghalaya': 'ML', 'Goa': 'GA',
    'Arunachal Pradesh': 'AR', 'Puducherry': 'PY', 'Mizoram': 'MZ',
    'Nagaland': 'NL', 'Sikkim': 'SK', 'Chandigarh': 'CH', 'Ladakh': 'LA',
    'Andaman And Nicobar Islands': 'AN', 'Lakshadweep': 'LD',
    'The Dadra And Nagar Haveli And Daman And Diu': 'DD'
}

ALL_STATES = [
    ('AN', 'Andaman And Nicobar Islands', 'UT'),
    ('AP', 'Andhra Pradesh', 'Southern'),
    ('AR', 'Arunachal Pradesh', 'Northeastern'),
    ('AS', 'Assam', 'Northeastern'),
    ('BR', 'Bihar', 'Eastern'),
    ('CG', 'Chhattisgarh', 'Central'),
    ('CH', 'Chandigarh', 'UT'),
    ('DD', 'The Dadra And Nagar Haveli And Daman And Diu', 'UT'),
    ('DL', 'Delhi', 'Northern'),
    ('GA', 'Goa', 'Western'),
    ('GJ', 'Gujarat', 'Western'),
    ('HP', 'Himachal Pradesh', 'Northern'),
    ('HR', 'Haryana', 'Northern'),
    ('JH', 'Jharkhand', 'Eastern'),
    ('JK', 'Jammu And Kashmir', 'Northern'),
    ('KA', 'Karnataka', 'Southern'),
    ('KL', 'Kerala', 'Southern'),
    ('LA', 'Ladakh', 'UT'),
    ('LD', 'Lakshadweep', 'UT'),
    ('MH', 'Maharashtra', 'Western'),
    ('ML', 'Meghalaya', 'Northeastern'),
    ('MN', 'Manipur', 'Northeastern'),
    ('MP', 'Madhya Pradesh', 'Central'),
    ('MZ', 'Mizoram', 'Northeastern'),
    ('NL', 'Nagaland', 'Northeastern'),
    ('OR', 'Odisha', 'Eastern'),
    ('PB', 'Punjab', 'Northern'),
    ('PY', 'Puducherry', 'UT'),
    ('RJ', 'Rajasthan', 'Northern'),
    ('SK', 'Sikkim', 'Northeastern'),
    ('TN', 'Tamil Nadu', 'Southern'),
    ('TR', 'Tripura', 'Northeastern'),
    ('TS', 'Telangana', 'Southern'),
    ('UK', 'Uttarakhand', 'Northern'),
    ('UP', 'Uttar Pradesh', 'Northern'),
    ('WB', 'West Bengal', 'Eastern'),
]


def clean_amount(val):
    """Parse an official allocation figure, or leave it unknown.

    This must never fall back to a default. A fabricated allocation would
    silently misstate the real entitlement of a named, sitting MP.
    """
    if pd.isna(val):
        return None
    val_str = str(val).replace(',', '').replace('\u20b9', '').strip()
    try:
        return float(val_str)
    except ValueError:
        return None


def main():
    print(f"Reading real MP dataset from {REAL_CSV_PATH}...")
    raw_df = pd.read_csv(REAL_CSV_PATH)

    # Exclude Grand Total row
    df = raw_df[raw_df['State'].str.strip() != ''].copy()
    df['state_code'] = df['State'].map(STATE_MAP)

    df['annual_allocation'] = df['Allocated AMOUNT ( ₹ )'].apply(clean_amount)
    df['full_name'] = df["Hon'ble Members of Parliaments"].str.strip().str.title()
    df['constituency_name'] = df['Constituency'].str.strip().str.title()

    # Sort deterministically
    df = df.sort_values(by=['state_code', 'full_name']).reset_index(drop=True)
    df['seq_in_state'] = df.groupby('state_code').cumcount() + 1
    df['mp_id'] = df.apply(lambda r: f"MP-{r['state_code']}-{r['seq_in_state']:03d}", axis=1)
    df['constituency_code'] = df.apply(lambda r: f"C-{r['state_code']}-{r['seq_in_state']:03d}", axis=1)
    # The official MPLADS allocation sheet carries no party column. Leave it
    # blank rather than defaulting every MP to one party, which would
    # misattribute the political affiliation of 543 real people.
    df['party'] = ''
    df['term_start'] = '2024-06-04'
    df['term_end'] = '2029-05-31'
    df['is_active'] = True

    # Output real mps.csv
    out_cols = [
        'mp_id', 'full_name', 'party', 'state_code', 'constituency_code',
        'term_start', 'term_end', 'is_active', 'annual_allocation'
    ]
    mps_out_df = df[out_cols].copy()
    mps_csv_path = OUTPUT_DIR / 'mps.csv'
    mps_out_df.to_csv(mps_csv_path, index=False)
    print(f"✓ Saved {len(mps_out_df)} real MPs to {mps_csv_path}")

    # No works file is touched here. Reassigning works to MPs by
    # "modulo wrap around" would attribute a work to a real MP who has no
    # connection to it. Works are linked by name matching in
    # ingest_real_data.py, and left unlinked when no match exists.

    # Update states reference CSV to include all 36 states/UTs
    states_ref_path = DATA_DIR / 'reference' / 'states.csv'
    states_df = pd.DataFrame(ALL_STATES, columns=['state_code', 'state_name', 'region'])
    states_df.to_csv(states_ref_path, index=False)
    print(f"✓ Updated reference states to {len(states_df)} states/UTs at {states_ref_path}")

    # database/seed_demo_data.sql is intentionally NOT regenerated. It is a
    # fabricated demo fixture, quarantined under data/quarantine_synthetic/.


if __name__ == '__main__':
    main()
