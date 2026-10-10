# Australian tax rules

Geranium estimates income tax for an **Australian resident individual** from the records in the app. It is **not tax preparation, not an ATO assessment and not tax advice**. Every estimate on screen carries: *"This is an estimate based on the information currently entered or imported. It is not an ATO assessment or tax advice."*

Rules were last reviewed on **27 September 2026**. Each rule has a status:

- **Published** — taken from a current ATO page for that year.
- **Legislated** — law, but the ATO had not yet published that year's table.
- **Provisional** — not yet known; the latest published figure is used and the screen says so.

## Financial years supported

| Year | Resident rates | Medicare low-income thresholds | Study-loan repayments | Super caps / SG |
|---|---|---|---|---|
| **2024–25** | Published (16% / 30% / 37% / 45%) | Published ($27,222 / $34,027) | Published (percentage-of-income system, 1%–10%) | Published ($30,000 / $120,000; SG 11.5%) |
| **2025–26** | Published (16% / 30% / 37% / 45%) | Published ($28,011 / $35,013) | Published (new marginal system: 15% over $67,000, 17% over $125,000, 10% of income from $179,286) | Published ($30,000 / $120,000; SG 12%) |
| **2026–27** | Published (**15%** / 30% / 37% / 45%) | Provisional (2025–26 thresholds) | Published (15% over $69,528, 17% over $129,717, 10% from $186,051) | Published ($32,500 / $130,000; SG 12%) |
| **2027–28** | Legislated (**14%** / 30% / 37% / 45%; thresholds assumed unchanged) | Provisional | Provisional (2026–27 thresholds) | Provisional (2026–27 caps; SG 12%) |
| Later years | Latest rules, all marked provisional with a note | | | |

Bracket thresholds for all years: $18,200 (tax-free threshold), $45,000, $135,000, $190,000.

## What the estimate includes

1. **Assessable income**
   - Employment income from **payslips** (gross, allowances, salary sacrifice as reportable super). Bank deposits are *net* pay and are never treated as gross income; if salary deposits exist without payslips, the estimate warns and leaves employment income out rather than guessing.
   - **Business / contractor / sole-trader** net income: payments classified as business income less business expenses (the business-use share of mixed expenses). Incoming payments are not assumed to be profit. A business **loss** is not deducted from other income, because whether the non-commercial loss rules allow that depends on tests Geranium does not assess.
   - **Interest** credited to accounts.
   - **Dividends**: cash plus **franking credits** from dividend statements you enter. Dividend deposits without a statement are included as unfranked cash with a warning.
   - **Net capital gains** from recorded share/unit trades (see CGT below).
   - Other income you enter (e.g. rent, government payments).
   - **Employee share scheme discounts** from ESS statements (imported or entered): label D (taxed upfront, eligible for the reduction), E (taxed upfront, not eligible) and F (deferral schemes, in the year of the deferred taxing point). Label D is reduced by up to **$1,000** when taxable income after adjustments is **$180,000 or less** — Geranium tests taxable income before the reduction (which already includes the ESS discounts) plus reportable super contributions; reportable fringe benefits and net investment losses are not recorded, so check the test yourself if you have them. The reduction never takes the discount below nil. Whether a scheme is eligible is shown by which label your employer used.
2. **Deductions**: transactions you mark as deductible, deductions you enter, and business-use shares. Taxable income is rounded down to whole dollars.
3. **Income tax** at resident rates for the year.
4. **Low income tax offset** (LITO): $700 up to $37,500, reducing by 5c per dollar to $45,000 ($325), then by 1.5c per dollar to nil at $66,667.
5. **Medicare levy** 2%, with the low-income reduction (nil below the lower threshold, 10% of the excess between the thresholds). Can be marked exempt.
6. **Study and training loan** repayment (HELP, VSL, SSL, AASL, SFSS) on repayment income (taxable income plus reportable super contributions) when you tick that you have a study loan.
7. **Franking credits** are subtracted as refundable offsets.
8. **PAYG withheld** (payslips), **PAYG instalments** and **TFN amounts withheld from share scheme discounts** (label C) are subtracted to show an estimated amount payable or refundable.

Each step shows its amount, how it was worked out, its rule status and the source. During a financial year that is still in progress the estimate says how many months are covered and that tax withheld from pay is calculated as if the pay continued all year, so a part-year figure often shows an overpayment.

## Capital gains (records and estimate)

- Parcels are matched first-in-first-out.
- Cost base includes purchase brokerage; proceeds are net of sale brokerage.
- The **50% CGT discount** applies to assets held at least 12 months (not counting the acquisition and sale days).
- Capital losses in the year offset gains before the discount (non-discountable gains first). Carried-forward losses from earlier years are not yet entered anywhere in the app.
- If any disposal in the year lacks cost-base information, the net capital gain is shown as **unavailable** rather than estimated.

## GST and BAS preparation (for users who say they are registered)

- Transactions can be classed as taxable (GST included), GST-free, input-taxed or not reportable, with a business-use percentage for purchases.
- GST is 1/11 of a GST-inclusive amount unless a GST amount from a tax invoice is entered.
- Quarterly **Simpler BAS** figures: **G1** total sales (GST-inclusive, including GST-free sales), **1A** GST on sales, **1B** GST credits on the business portion of taxable purchases, and the net amount.
- A turnover note compares the last 12 months of sales with the $75,000 registration threshold (information only).
- Every summary is labelled *"Preparation summary only — verify before lodgment."* Nothing is lodged, and sole traders are not assumed to be registered.

## Super

Super is kept separate from the personal estimate. Transactions in superannuation accounts — employer contributions (Super Guarantee), returns, fees and tax deducted inside the fund — are never counted as assessable income, deductions or tax paid: contributions tax is paid by the fund, not withheld from you, and fund earnings are taxed inside the fund. (Salary sacrifice still matters to the estimate as reportable super, which comes from payslips.)


Contributions (employer, salary sacrifice, personal deductible, after-tax), fees, insurance premiums and earnings from super statements are recorded by financial year and compared with the general concessional and non-concessional caps for that year. Carry-forward of unused concessional cap and the bring-forward rule are mentioned but **not** calculated, because they depend on details Geranium does not hold (total super balance history, prior contributions).

## Known omissions

The estimator does **not** include: the Medicare levy surcharge; the private health insurance rebate or its income tiers; seniors and pensioners tax offset and other offsets; family-income Medicare levy reductions; carried-forward capital losses; non-resident, part-year resident and working-holiday-maker rates; reportable fringe benefits; non-commercial loss rules; Division 293 tax; foreign income and foreign tax offsets; employee share schemes; lump sums and ETPs; rental property depreciation schedules (enter the deductible amounts yourself); trusts and partnerships; the small business income tax offset. Where one of these might apply the result can differ materially from your assessment.

## Sources

All in `src/domain/tax/australia/sources.ts`, each with the date it was read:

- ATO — Tax rates: Australian residents — https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents
- ATO — Personal income tax: new tax cuts for every Australian taxpayer — https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer
- ATO — Medicare levy reduction for low-income earners — https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners
- ATO — myTax 2025: Medicare levy reduction or exemption — https://www.ato.gov.au/individuals-and-families/your-tax-return/instructions-to-complete-your-tax-return/mytax-instructions/2025/medicare-and-private-health-insurance/medicare-levy-reduction-or-exemption
- ATO — Low income tax offset — https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset
- ATO — Study and training loan repayment thresholds and rates — https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds
- ATO — Contributions caps — https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/contributions-caps
- ATO — Super guarantee percentage — https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/super-guarantee
- ATO — Registering for GST — https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/registering-for-gst
- ATO — Simpler BAS GST bookkeeping guide — https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/business-activity-statements-bas/goods-and-services-tax-gst/simpler-bas-gst-bookkeeping-guide
- ATO — CGT discount — https://www.ato.gov.au/individuals-and-families/investments-and-assets/capital-gains-tax/cgt-discount
- ATO — Individual tax return instructions 2026, question 12 Employee share schemes (labels D, E, F, C; the $1,000 reduction and $180,000 test), read 10 October 2026 — https://www.ato.gov.au/forms-and-instructions/individual-tax-return-2026-instructions/income-questions-1-12-individual-tax-return-2026/12-employee-share-schemes-2026
- ATO — Income test for the upfront concession ($1,000 reduction) — https://www.ato.gov.au/businesses-and-organisations/corporate-tax-measures-and-assurance/employee-share-schemes/employees/ess-and-your-tax/income-test-for-the-upfront-concession-1000-dollar-reduction

## Updating the rules

1. Add or edit `src/domain/tax/australia/years/<year>.ts` with values, status, source ids and notes; register it in `rules.ts`.
2. Update `reviewed` dates in `sources.ts` and `lastReviewed` in `years/shared.ts`.
3. Add worked examples to `tests/domain/tax.test.ts` (the existing tests check bracket edges, LITO tapers, Medicare phase-in and study-loan tiers against ATO examples).
4. Record the change in `CHANGELOG.md`.
