import { NextRequest, NextResponse } from 'next/server';

const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '19': 'West Bengal',
  '21': 'Odisha',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

const ENTITY_TYPES: Record<string, string> = {
  C: 'Company (Pvt Ltd / Ltd)',
  P: 'Individual / Proprietorship',
  H: 'HUF (Hindu Undivided Family)',
  F: 'Partnership Firm / LLP',
  A: 'Association of Persons (AOP)',
  T: 'Trust',
  B: 'Body of Individuals (BOI)',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government Entity',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gstin = (searchParams.get('gstin') || '09AABCB1234C1Z5').toUpperCase().trim();

  // Validate 15-character GSTIN format: 2 digits + 10-char PAN + 1 entity code + 'Z' + 1 checksum
  const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const isValidFormat = gstRegex.test(gstin);

  const stateCode = gstin.substring(0, 2);
  const pan = gstin.substring(2, 12);
  const entityChar = pan.charAt(3);
  const entityType = ENTITY_TYPES[entityChar] || 'Registered Commercial Entity';
  const stateName = STATE_CODES[stateCode] || 'Registered Indian Jurisdiction';

  const isSimulatedInvalid = gstin.includes('INVALID') || gstin.includes('INACT');

  return NextResponse.json({
    status: 'READY',
    gstin,
    is_valid_format: isValidFormat,
    taxpayer_status: isSimulatedInvalid ? 'CANCELLED / SUSPENDED' : 'ACTIVE',
    taxpayer_name: gstin === '09AABCB1234C1Z5'
      ? 'Bharat Infratech Pvt Ltd'
      : gstin === '27AAHCM1234K1ZP'
      ? 'Maharashtra Health Infra Ltd'
      : gstin === '08AABCR8765M1ZQ'
      ? 'Rajputana Constructions'
      : 'Registered Infrastructure Contractor',
    state: { code: stateCode, name: stateName },
    pan: { number: pan, entity_type: entityType },
    registration_date: '2017-07-01',
    filing_compliance: {
      gstr_1_status: isSimulatedInvalid ? 'DEFAULT' : 'FILED',
      gstr_3b_status: isSimulatedInvalid ? 'DEFAULT' : 'FILED',
      annual_return_gstr9: isSimulatedInvalid ? 'NOT_FILED' : 'FILED',
      last_filing_period: 'August 2024',
      tax_evasion_flag: isSimulatedInvalid,
    },
    risk_indicator: isSimulatedInvalid ? 'HIGH_RISK_GSTIN' : 'COMPLIANT_ACTIVE',
  });
}
