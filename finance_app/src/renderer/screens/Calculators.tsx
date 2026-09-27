import { useEffect, useState } from 'react';
import { api, useAction } from '../lib/api';
import { Callout, Card, DataTable, DateText, ErrorText, Explain, Money, MoneyField, NumberField, Page, SelectField, Stat, Tabs } from '../components/ui';
import { ColumnChart } from '../components/charts';
import { todayLocal } from '../components/pickers';
import { FREQUENCY_LABEL, Frequency } from '@domain/periods';
import type { ApiOutput } from '../../main/api';

const FREQS: Frequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually'];

function Compound() {
  const [opening, setOpening] = useState<number | null>(1000000);
  const [contribution, setContribution] = useState<number | null>(50000);
  const [cf, setCf] = useState<Frequency>('monthly');
  const [rate, setRate] = useState<number | null>(4.5);
  const [comp, setComp] = useState<Frequency>('monthly');
  const [years, setYears] = useState<number | null>(10);
  const [increase, setIncrease] = useState<number | null>(0);
  const [r, setR] = useState<ApiOutput<'calculators.compound'> | null>(null);
  const run = useAction(async () => setR(await api('calculators.compound', { openingCents: opening ?? 0, contributionCents: contribution ?? 0, contributionFrequency: cf, annualRatePercent: rate ?? 0, compounding: comp, years: years ?? 0, contributionIncreasePercent: increase ?? 0 })));
  useEffect(() => { void run.run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack-lg">
      <Card title="Compound growth" sub="What regular contributions and an assumed return could grow to. Returns are never guaranteed.">
        <div className="form-grid">
          <MoneyField label="Starting amount" cents={opening} onChange={setOpening} />
          <MoneyField label="Regular contribution" cents={contribution} onChange={setContribution} />
          <SelectField label="Contribution frequency" value={cf} onChange={setCf} options={FREQS.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
          <NumberField label="Assumed interest or return" suffix="% a year" value={rate} onChange={setRate} />
          <SelectField label="Compounding" value={comp} onChange={setComp} options={(['daily', ...FREQS] as Frequency[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
          <NumberField label="Duration" suffix="years" value={years} onChange={setYears} />
          <NumberField label="Increase contributions yearly by" suffix="%" value={increase} onChange={setIncrease} />
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={() => run.run()}>Calculate</button></div>
        <ErrorText error={run.error} />
      </Card>
      {r && (
        <Card title="Result">
          <div className="grid grid-4">
            <Stat label="Projected amount" value={<Money cents={r.finalCents} />} />
            <Stat label="Starting amount" value={<Money cents={r.openingCents} />} />
            <Stat label="Money contributed" value={<Money cents={r.totalContributionsCents} />} />
            <Stat label="Estimated growth" value={<Money cents={r.growthCents} />} note="From the assumed rate" />
          </div>
          <div style={{ marginTop: 14 }}>
            <ColumnChart title="Balance by year" series={['Balance']} data={r.years.map((y) => ({ label: `Yr ${y.year}`, values: [y.balanceCents] }))} />
          </div>
          <Explain><ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul><p>{r.explanation}</p></Explain>
          <DataTable rows={r.years} rowKey={(y) => String(y.year)} maxHeight={300} columns={[
            { key: 'y', header: 'Year', render: (y) => y.year },
            { key: 'c', header: 'Contributed that year', num: true, render: (y) => <Money cents={y.contributedCents} /> },
            { key: 'g', header: 'Growth that year', num: true, render: (y) => <Money cents={y.growthCents} /> },
            { key: 'b', header: 'Balance', num: true, render: (y) => <Money cents={y.balanceCents} /> },
          ]} />
        </Card>
      )}
    </div>
  );
}

function LoanCalc() {
  const [principal, setPrincipal] = useState<number | null>(60000000);
  const [rate, setRate] = useState<number | null>(6);
  const [term, setTerm] = useState<number | null>(360);
  const [freq, setFreq] = useState<'weekly' | 'fortnightly' | 'monthly'>('monthly');
  const [repay, setRepay] = useState<number | null>(null);
  const [extra, setExtra] = useState<number | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [r, setR] = useState<ApiOutput<'calculators.loan'> | null>(null);
  const run = useAction(async () => setR(await api('calculators.loan', { principalCents: principal ?? 0, annualRatePercent: rate ?? 0, startDate: todayLocal(), repaymentFrequency: freq, repaymentCents: repay, remainingTermMonths: term ? Math.round(term) : null, extraRepaymentCents: extra ?? 0, offset: offset ? { balanceCents: offset } : null })));
  return (
    <div className="stack-lg">
      <Card title="Loan repayment calculator" sub="A quick calculation that is not saved. Save a loan on the Mortgage & debts screen to model it in detail.">
        <div className="form-grid">
          <MoneyField label="Loan amount" cents={principal} onChange={setPrincipal} />
          <NumberField label="Interest rate" suffix="% a year" value={rate} onChange={setRate} />
          <NumberField label="Term" suffix="months" value={term} onChange={setTerm} />
          <SelectField label="Repayments" value={freq} onChange={setFreq} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' }]} />
          <MoneyField label="Repayment (blank = minimum)" cents={repay} onChange={setRepay} />
          <MoneyField label="Extra each repayment" cents={extra} onChange={setExtra} />
          <MoneyField label="Offset balance" cents={offset} onChange={setOffset} />
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={() => run.run()}>Calculate</button></div>
        <ErrorText error={run.error} />
      </Card>
      {r && (
        <Card title="Under these assumptions">
          <div className="grid grid-3">
            <Stat label="Repayment" value={<Money cents={r.repaymentCents} />} note={FREQUENCY_LABEL[freq]} />
            <Stat label="Estimated payoff" value={r.payoffDate ? <DateText date={r.payoffDate} /> : '—'} />
            <Stat label="Estimated total interest" value={<Money cents={r.totalInterestCents} />} />
          </div>
          <Callout kind="neutral">{r.explanation}</Callout>
          <Explain><ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Explain>
        </Card>
      )}
    </div>
  );
}

function SuperCalc() {
  const [bal, setBal] = useState<number | null>(12000000);
  const [conc, setConc] = useState<number | null>(1500000);
  const [tax, setTax] = useState<number | null>(15);
  const [nonc, setNonc] = useState<number | null>(0);
  const [ret, setRet] = useState<number | null>(6);
  const [fees, setFees] = useState<number | null>(30000);
  const [years, setYears] = useState<number | null>(20);
  const [growth, setGrowth] = useState<number | null>(3);
  const [r, setR] = useState<ApiOutput<'calculators.super'> | null>(null);
  const run = useAction(async () => setR(await api('calculators.super', { startingBalanceCents: bal ?? 0, annualConcessionalCents: conc ?? 0, contributionsTaxPercent: tax ?? 15, annualNonConcessionalCents: nonc ?? 0, returnPercent: ret ?? 0, annualFeesCents: fees ?? 0, years: Math.max(1, Math.round(years ?? 1)), contributionGrowthPercent: growth ?? 0 })));
  return (
    <div className="stack-lg">
      <Card title="Super projection" sub="Uses only the assumptions you enter. It is not a prediction of fund performance and not advice about funds, options or contributions.">
        <div className="form-grid">
          <MoneyField label="Current balance" cents={bal} onChange={setBal} />
          <MoneyField label="Before-tax contributions per year" cents={conc} onChange={setConc} hint="Employer and salary sacrifice" />
          <NumberField label="Contributions tax" suffix="%" value={tax} onChange={setTax} />
          <MoneyField label="After-tax contributions per year" cents={nonc} onChange={setNonc} />
          <NumberField label="Assumed return after investment fees" suffix="% a year" value={ret} onChange={setRet} />
          <MoneyField label="Admin fees per year" cents={fees} onChange={setFees} />
          <NumberField label="Years" value={years} onChange={setYears} />
          <NumberField label="Contributions grow yearly by" suffix="%" value={growth} onChange={setGrowth} />
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={() => run.run()}>Project</button></div>
        <ErrorText error={run.error} />
      </Card>
      {r && (
        <Card title="Projection">
          <Stat hero label={`Projected balance after ${r.years.length} years`} value={<Money cents={r.finalCents} />} />
          <ColumnChart title="Projected balance" series={['Balance']} data={r.years.map((y) => ({ label: `Yr ${y.year}`, values: [y.balanceCents] }))} />
          <Explain><ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Explain>
        </Card>
      )}
    </div>
  );
}

export function Calculators() {
  const [tab, setTab] = useState<'compound' | 'loan' | 'super'>('compound');
  return (
    <Page title="Calculators" intro="Quick what-if arithmetic. Nothing here is saved or changes your records.">
      <Tabs label="Calculator" value={tab} onChange={setTab} tabs={[{ value: 'compound', label: 'Compound growth' }, { value: 'loan', label: 'Loan repayments' }, { value: 'super', label: 'Super projection' }]} />
      {tab === 'compound' && <Compound />}
      {tab === 'loan' && <LoanCalc />}
      {tab === 'super' && <SuperCalc />}
    </Page>
  );
}
