import { SourceRef } from './types';

/** Authoritative sources, read on the dates shown. Update `reviewed` when re-checking. */
export const SOURCES: Record<string, SourceRef> = {
  'ato-resident-rates': {
    title: 'ATO — Tax rates: Australian residents',
    url: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents',
    reviewed: '2026-09-27',
    covers: 'Resident individual tax rates for 2024–25, 2025–26 and 2026–27 (Medicare levy excluded).',
  },
  'ato-new-tax-cuts': {
    title: 'ATO — Personal income tax: new tax cuts for every Australian taxpayer',
    url: 'https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer',
    reviewed: '2026-09-27',
    pageUpdated: '2026-05-13',
    covers: 'Legislated reduction of the 16% rate to 15% from 1 July 2026 and 14% from 1 July 2027 (Treasury Laws Amendment (More Cost of Living Relief) Act 2025).',
  },
  'ato-medicare-low-income-2026': {
    title: 'ATO — Medicare levy reduction for low-income earners',
    url: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners',
    reviewed: '2026-09-27',
    pageUpdated: '2026-06-30',
    covers: '2025–26 single low-income thresholds ($28,011 / $35,013) and 10% phase-in.',
  },
  'ato-medicare-low-income-2025': {
    title: 'ATO — myTax 2025: Medicare levy reduction or exemption',
    url: 'https://www.ato.gov.au/individuals-and-families/your-tax-return/instructions-to-complete-your-tax-return/mytax-instructions/2025/medicare-and-private-health-insurance/medicare-levy-reduction-or-exemption',
    reviewed: '2026-09-27',
    covers: '2024–25 single low-income thresholds ($27,222 / $34,027).',
  },
  'ato-lito': {
    title: 'ATO — Low income tax offset',
    url: 'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset',
    reviewed: '2026-09-27',
    pageUpdated: '2026-06-08',
    covers: 'LITO: $700 up to $37,500; less 5c per $1 to $45,000; then $325 less 1.5c per $1 to $66,667.',
  },
  'ato-study-loans': {
    title: 'ATO — Study and training loan repayment thresholds and rates',
    url: 'https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds',
    reviewed: '2026-09-27',
    pageUpdated: '2026-06-30',
    covers: 'HELP/VSL/SSL/AASL compulsory repayment thresholds: percentage table for 2024–25; marginal system from 2025–26 (2025–26 and 2026–27 tables).',
  },
  'ato-super-caps': {
    title: 'ATO — Contributions caps',
    url: 'https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/contributions-caps',
    reviewed: '2026-09-27',
    pageUpdated: '2026-09-11',
    covers: 'Concessional cap $30,000 (2024–25, 2025–26), $32,500 (2026–27); non-concessional cap $120,000 (2024–25, 2025–26), $130,000 (2026–27).',
  },
  'ato-super-guarantee': {
    title: 'ATO — Super guarantee percentage',
    url: 'https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/super-guarantee',
    reviewed: '2026-09-27',
    pageUpdated: '2026-04-17',
    covers: 'Super guarantee 11.5% (2024–25), 12% from 1 July 2025 onwards.',
  },
  'ato-gst-registration': {
    title: 'ATO — Registering for GST',
    url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/registering-for-gst',
    reviewed: '2026-09-27',
    pageUpdated: '2026-09-14',
    covers: 'GST registration required at GST turnover of $75,000 or more (taxi/ride-sourcing regardless of turnover). GST rate 10%.',
  },
  'ato-simpler-bas': {
    title: 'ATO — Simpler BAS GST bookkeeping guide',
    url: 'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/business-activity-statements-bas/goods-and-services-tax-gst/simpler-bas-gst-bookkeeping-guide',
    reviewed: '2026-09-27',
    pageUpdated: '2025-05-01',
    covers: 'Simpler BAS labels: G1 Total sales, 1A GST on sales, 1B GST on purchases.',
  },
  'ato-cgt-discount': {
    title: 'ATO — CGT discount',
    url: 'https://www.ato.gov.au/individuals-and-families/investments-and-assets/capital-gains-tax/cgt-discount',
    reviewed: '2026-09-27',
    pageUpdated: '2026-06-29',
    covers: '50% discount for Australian-resident individuals who owned the asset at least 12 months (excluding the days of acquisition and the CGT event).',
  },
};
