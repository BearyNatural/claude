import { useState } from 'react';
import { api, useApi, useAction } from '../lib/api';
import { Badge, Callout, Card, DateField, DateText, Dialog, Empty, ErrorText, Explain, Loading, Money, MoneyField, NumberField, Page, SelectField, Stat, TextField, useConfirm } from '../components/ui';
import { Meter } from '../components/charts';
import { AccountSelect } from '../components/pickers';
import { GOAL_TYPE_LABEL, GoalType } from '@domain/planning/goals';
import { FREQUENCY_LABEL, Frequency, PER_LABEL } from '@domain/periods';
import type { ApiOutput } from '../../main/api';

type Goal = ApiOutput<'goals.list'>[number];

function GoalForm({ initial, onClose }: { initial?: Goal; onClose: () => void }) {
  const [g, setG] = useState({
    id: initial?.id ?? '', name: initial?.name ?? '', type: (initial?.type ?? 'custom') as GoalType, targetCents: initial?.targetCents ?? 0, currentCents: initial?.linkedAccountId ? 0 : initial?.currentCents ?? 0,
    targetDate: initial?.targetDate ?? null, contributionCents: initial?.contributionCents ?? 0, contributionFrequency: (initial?.contributionFrequency ?? 'monthly') as Frequency,
    annualRatePercent: initial?.annualRatePercent ?? 0, oneOffs: initial?.oneOffs ?? [], linkedAccountId: initial?.linkedAccountId ?? null,
  });
  const [oo, setOo] = useState<{ date: string | null; amountCents: number | null }>({ date: null, amountCents: null });
  const save = useAction(async () => { await api('goals.save', g); onClose(); });
  return (
    <Dialog title={initial ? 'Edit goal' : 'New savings goal'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.run()}>Save</button></>}>
      <div className="stack">
        <div className="form-grid">
          <TextField label="Goal" value={g.name} onChange={(v) => setG({ ...g, name: v })} autoFocus />
          <SelectField label="Type" value={g.type} onChange={(v) => setG({ ...g, type: v })} options={Object.entries(GOAL_TYPE_LABEL).map(([value, label]) => ({ value: value as GoalType, label }))} />
          <MoneyField label="Target amount" cents={g.targetCents || null} onChange={(c) => setG({ ...g, targetCents: c ?? 0 })} />
          <AccountSelect label="Track the balance of (optional)" value={g.linkedAccountId} onChange={(v) => setG({ ...g, linkedAccountId: v })} allowNone placeholder="Enter the amount myself" />
          {!g.linkedAccountId && <MoneyField label="Saved so far" cents={g.currentCents} onChange={(c) => setG({ ...g, currentCents: c ?? 0 })} />}
          <DateField label="Target date (optional)" value={g.targetDate} onChange={(v) => setG({ ...g, targetDate: v })} />
          <MoneyField label="Regular contribution" cents={g.contributionCents} onChange={(c) => setG({ ...g, contributionCents: c ?? 0 })} />
          <SelectField label="How often" value={g.contributionFrequency} onChange={(v) => setG({ ...g, contributionFrequency: v })} options={(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually'] as Frequency[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
          <NumberField label="Assumed interest" suffix="% a year" value={g.annualRatePercent} onChange={(v) => setG({ ...g, annualRatePercent: v ?? 0 })} hint="An assumption, not a promise. Use 0 if unsure." />
        </div>
        <h3>One-off contributions</h3>
        {g.oneOffs.length > 0 && <ul className="list-plain small">{g.oneOffs.map((o, i) => <li key={i} className="row-between"><span><DateText date={o.date} /> · <Money cents={o.amountCents} /></span><button className="btn btn-ghost btn-sm" onClick={() => setG({ ...g, oneOffs: g.oneOffs.filter((_, j) => j !== i) })}>Remove</button></li>)}</ul>}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <DateField label="Date" value={oo.date} onChange={(v) => setOo({ ...oo, date: v })} />
          <MoneyField label="Amount" cents={oo.amountCents} onChange={(c) => setOo({ ...oo, amountCents: c })} />
          <button className="btn" disabled={!oo.date || !oo.amountCents} onClick={() => { setG({ ...g, oneOffs: [...g.oneOffs, { date: oo.date!, amountCents: oo.amountCents! }] }); setOo({ date: null, amountCents: null }); }}>Add</button>
        </div>
        <ErrorText error={save.error} />
      </div>
    </Dialog>
  );
}

export function Goals() {
  const q = useApi('goals.list', undefined, []);
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const confirm = useConfirm();
  if (!q.data) return <Loading />;
  return (
    <Page title="Savings goals" intro="Progress towards what you are saving for, and when you might get there under the contributions and interest you enter." actions={<button className="btn btn-primary" onClick={() => setEdit('new')}>New goal</button>}>
      {!q.data.length ? <Card><Empty title="No goals yet" action={<button className="btn btn-primary" onClick={() => setEdit('new')}>Add a goal</button>}>For example an emergency fund, a holiday, a car or a renovation.</Empty></Card> : (
        <div className="grid grid-2">
          {q.data.map((g) => {
            const p = g.projection;
            return (
              <Card key={g.id} title={g.name} sub={GOAL_TYPE_LABEL[g.type]} actions={<><button className="btn btn-sm" onClick={() => setEdit(g)}>Edit</button><button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirm.ask('Delete goal?', <p>Delete “{g.name}”?</p>, 'Delete', true)) await api('goals.delete', { id: g.id }); }}>Delete</button></>}>
                <div className="stack">
                  <Meter value={g.currentCents} max={g.targetCents} label={`${g.name} progress`} />
                  <div className="grid grid-3">
                    <Stat label="Saved" value={<Money cents={g.currentCents} whole />} note={g.currentSource} />
                    <Stat label="Target" value={<Money cents={g.targetCents} whole />} note={g.targetDate ? <>by <DateText date={g.targetDate} /></> : 'No date set'} />
                    <Stat label="Remaining" value={<Money cents={p.remainingCents} whole />} note={`${Math.round(p.progress * 100)}% there`} />
                  </div>
                  <div className="row">
                    {p.remainingCents === 0 ? <Badge kind="ok">Target reached</Badge> : p.projectedDate ? <Badge kind="info">Projected around <DateText date={p.projectedDate} /></Badge> : <Badge kind="warn">Not reached at current contributions</Badge>}
                    {p.reachesTargetByDate === false && <Badge kind="warn">After the target date</Badge>}
                    {p.reachesTargetByDate === true && <Badge kind="ok">By the target date</Badge>}
                  </div>
                  {p.requiredContributionCents !== null && g.targetDate && <p className="small">To reach it by <DateText date={g.targetDate} />: about <Money cents={p.requiredContributionCents} /> {PER_LABEL[g.contributionFrequency]}.</p>}
                  <Explain><p>{p.explanation}</p><p>Contributions to target: <Money cents={p.contributionsToTargetCents} /> · assumed interest: <Money cents={p.interestToTargetCents} />. The projection assumes the contribution continues unchanged; it is not a guarantee.</p></Explain>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Callout kind="neutral">Goal projections are arithmetic based on what you enter. They are not advice about how much to save or where to keep savings.</Callout>
      {edit && <GoalForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {confirm.node}
    </Page>
  );
}
