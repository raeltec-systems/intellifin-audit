import { useEffect, useRef, useState } from 'react';
import type { Session } from './auth';
import type { Scope } from './engagements';
import type { Assessment } from './assessment';
import {
  completenessSentence, conclusionSentence, dispositionLabel, dispositionReasonLabel, found, readMembers, reconciliationSentence,
} from './coverage';
import type { CoveragePopulation, CoverageSummary, Disposition, Limitation, PopulationMembers } from './coverage';
import { reasonLabel } from './assessment';

interface Props {
  assessment: Assessment;
  taskId: string;
  /// Where members are read from; without it the exclusion lists are not offered.
  scope?: Scope;
  /// The captured session that bounds each member read.
  session?: Session;
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 13)}</abbr>;
const number = (value: string) => BigInt(value).toLocaleString('en-GB');
/// A count in a table cell: on an incomplete population, a lower bound.
const bound = (value: string, complete: boolean) => complete ? number(value) : `at least ${number(value)}`;
const plural = (value: string, unit: string) => value === '1' ? unit : `${unit}s`;

const ordinalWord = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n.toLocaleString('en-GB')}${suffix}`;
};

/// The member list of one population and one disposition: an exact count and
/// pages of 50 in receipt order, read on request.
function Members({ scope, session, taskId, population, disposition, label }: { scope: Scope; session: Session; taskId: string; population: CoveragePopulation; disposition: Disposition; label: string }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PopulationMembers[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = (after: string | null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    readMembers(scope, taskId, population.id, disposition, after, session, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setPages(previous => after ? [...previous, page] : [page]);
      setLoading(false);
    }, () => {
      if (controller.signal.aborted) return;
      setError('These rows could not be read now. Nothing is shown in their place.');
      setLoading(false);
    });
  };
  const members = pages.flatMap(page => page.members);
  const last = pages.at(-1);
  return <div className="coverage-members">
    <button type="button" className="text-button" aria-expanded={open}
      onClick={() => { const next = !open; setOpen(next); if (next && !pages.length) load(null); }}>
      {open ? `Hide ${label.toLowerCase()} rows` : `Show ${label.toLowerCase()} rows`}
    </button>
    {open ? <div role="region" aria-label={`${label} rows`}>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {last ? <p className="context-note">{number(last.total)} {last.total === '1' ? 'row' : 'rows'} · showing {members.length}{last.values_withheld ? ' · cell values withheld: you cannot open this source' : ''}</p> : null}
      {members.length ? <table className="coverage-table">
        <caption className="visually-hidden">{label} rows of {population.key}</caption>
        <thead><tr><th scope="col">Sheet row</th><th scope="col">Key</th><th scope="col">Decision</th></tr></thead>
        <tbody>{members.map(m => <tr key={m.ordinal}>
          <td>{m.row}</td>
          <td>{m.subject ?? (m.disposition === 'unkeyed' ? 'No key' : 'Withheld')}</td>
          <td>{dispositionLabel[m.disposition]}{m.reason ? ` · ${dispositionReasonLabel[m.reason]}` : ''}{m.duplicate_of !== null ? ` · repeats the ${ordinalWord(m.duplicate_of + 1)} row received, with the same key` : ''}</td>
        </tr>)}</tbody>
      </table> : null}
      {loading ? <p className="context-note">Reading rows…</p> : null}
      {last?.next_cursor ? <button type="button" className="text-button" aria-disabled={loading} onClick={() => { if (!loading) load(last.next_cursor); }}>Show more rows</button> : null}
    </div> : null}
  </div>;
}

/// A closed limitation in words beside its exact count, naming the
/// criterion by its key.
function limitationWords(l: Limitation, criterion: string, unit: string): string {
  const n = l.count ?? '0';
  const items = `${number(n)} ${plural(n, unit)}`;
  switch (l.code) {
    case 'not_evaluated': return `Criterion ${criterion} was not evaluated for ${items}.`;
    case 'judgment_not_recorded': return `Judgment criterion ${criterion} has no recorded judgment for ${items} at this population's unit; judgments recorded at another unit or basis are not counted.`;
    case 'unreviewed_model_judgments': return `Judgment criterion ${criterion}: ${number(n)} met ${plural(n, 'verdict')} ${n === '1' ? 'is a model proposal' : 'are model proposals'} nobody has reviewed; they cannot show that no exception exists.`;
    case 'sample_selected_only': return `A sample of ${items}: the counts describe the selected items only, never the population.`;
    case 'scope_unknown': return `${items} ${n === '1' ? 'has' : 'have'} an unknown scope; they are unresolved.`;
    case 'unkeyed_rows': return `${number(n)} received ${plural(n, 'row')} ${n === '1' ? 'has' : 'have'} no usable key; ${n === '1' ? 'it was' : 'they were'} not assessed, so no conclusion covers ${n === '1' ? 'it' : 'them'}.`;
    case 'period_not_checked': return 'No period column was named: whether each item falls in the basis period was not checked.';
    case 'naive_date_times': return `${number(n)} Excel date or date-time ${plural(n, 'cell')} carry no time zone; they were read as UTC.`;
    default: return l.text;
  }
}

/// Story 24.2: exact population, sample and coverage counts. Every number is
/// a count trusted code made from every row of the exact source and the
/// database recounted; when the population is incomplete each count is "at
/// least" and the total is "not known". There are no percentages and no
/// confidence score, and a sample says nothing about items it did not select.
export function Coverage({ assessment, taskId, scope, session }: Props) {
  if (!assessment.populations.length && !assessment.summaries.length && !assessment.samples.length) return null;
  const criterionKey = new Map(assessment.criteria.map(c => [c.id, c.key]));
  const populationById = new Map(assessment.populations.map(p => [p.id, p]));
  const summarised = new Set(assessment.summaries.map(s => s.population_id));
  const omitted = (total: string, shown: number, noun: string) => {
    const left = Number(BigInt(total) - BigInt(shown));
    return left > 0 ? <p className="work-omitted">{left} earlier {noun} not shown; the most recent {shown} are.</p> : null;
  };
  const populationLine = (p: CoveragePopulation) => {
    const complete = p.completeness === 'complete';
    const c = p.counts;
    return <>
      <p><strong>Population {p.key}</strong> · {p.filename ?? 'a source you cannot open'}{p.sheet ? ` · sheet ${p.sheet}, header row ${p.header_row}` : ''} · one {p.subject_unit} per {p.grain.join(' + ')}{p.supersedes ? <> · supersedes {short(p.supersedes)}</> : null}</p>
      <p className="retained-text">{p.selection}</p>
      <p>{completenessSentence(p)} {reconciliationSentence(p)}</p>
      <ul aria-label={`Rows of ${p.key}`}>
        <li>Rows received: {found(c.received_rows, 'row', complete)}{complete ? '' : '; the total is not known'}</li>
        <li>Distinct {p.subject_unit}s: {found(c.distinct_subjects, p.subject_unit, complete)}</li>
        <li>Duplicate rows collapsed: {found(c.duplicate_rows, 'row', complete)} · rows with no usable key: {found(c.unkeyed, 'row', complete)}</li>
        <li>Excluded outside the basis period: {found(c.excluded_out_of_period, p.subject_unit, complete)}</li>
        <li>Scope unknown: date does not parse {found(c.scope_unknown_period_unparsed, p.subject_unit, complete)} · date blank {found(c.scope_unknown_period_missing, p.subject_unit, complete)} · same key, different values {found(c.scope_unknown_conflicting_duplicate, p.subject_unit, complete)} (each on two or more rows)</li>
        <li>In scope: {found(c.in_scope, p.subject_unit, complete)}</li>
      </ul>
      {p.naive_date_times !== '0' ? <p className="context-note">{number(p.naive_date_times)} Excel date or date-time {plural(p.naive_date_times, 'cell')} carry no time zone; they were read as UTC.</p> : null}
      {scope && session ? <div className="coverage-inspect">
        {c.excluded_out_of_period !== '0' ? <Members scope={scope} session={session} taskId={taskId} population={p} disposition="excluded" label="Excluded" /> : null}
        {(BigInt(c.scope_unknown_period_unparsed) + BigInt(c.scope_unknown_period_missing) + BigInt(c.scope_unknown_conflicting_duplicate)) > 0n ? <Members scope={scope} session={session} taskId={taskId} population={p} disposition="scope_unknown" label="Scope unknown" /> : null}
        {c.duplicate_rows !== '0' ? <Members scope={scope} session={session} taskId={taskId} population={p} disposition="duplicate_row" label="Duplicate" /> : null}
        {c.unkeyed !== '0' ? <Members scope={scope} session={session} taskId={taskId} population={p} disposition="unkeyed" label="Unkeyed" /> : null}
      </div> : null}
    </>;
  };
  const summaryView = (s: CoverageSummary) => {
    const sample = s.sample_id !== null;
    const unit = populationById.get(s.population_id)?.subject_unit ?? 'item';
    const scopeWord = sample ? 'selected' : 'in scope';
    // A sample's counts are exact over its selected items; a population's
    // are lower bounds when the population is incomplete.
    const complete = sample || s.completeness === 'complete';
    const key = (id: string | null) => id === null ? '' : criterionKey.get(id) ?? id.slice(0, 13);
    return <li key={s.id}>
      <p className="coverage-conclusion"><strong>{conclusionSentence(s)}</strong></p>
      <p>{completenessSentence(s)} {reconciliationSentence(s)}</p>
      <p>{sample ? `Sample ${s.sample_id?.slice(0, 13)}: ${number(s.selected ?? '0')} selected ${unit}s; nothing is inferred about the rest.` : `${found(s.counts.in_scope, unit, s.completeness === 'complete')} in scope.`}</p>
      {s.criteria.length ? <div className="coverage-scroll" role="group" aria-label="Criterion opportunities" tabIndex={0}><table className="coverage-table">
        <caption>Criterion opportunities over the {scopeWord} {unit}s{complete ? '' : ' (each count is at least the number shown; the total is not known)'}</caption>
        <thead><tr><th scope="col">Criterion</th><th scope="col">Applies</th><th scope="col">Does not apply</th><th scope="col">Applicability unknown</th><th scope="col">Met</th><th scope="col">Not met</th><th scope="col">Undetermined</th><th scope="col">Failed</th><th scope="col">Not evaluated</th></tr></thead>
        <tbody>{s.criteria.map(c => <tr key={c.criterion_id}>
          <th scope="row">{criterionKey.get(c.criterion_id) ?? c.criterion_id.slice(0, 13)}</th>
          <td>{bound(c.applicable, complete)}</td><td>{bound(c.not_applicable, complete)}</td><td>{bound(c.applicability_unknown, complete)}</td>
          <td>{bound(c.met, complete)}{c.met_unreviewed !== '0' ? <span className="context-note"> (of which {number(c.met_unreviewed)} unreviewed model {c.met_unreviewed === '1' ? 'proposal' : 'proposals'})</span> : null}</td><td>{bound(c.not_met, complete)}</td>
          <td>{bound(c.undetermined, complete)}{c.undetermined_by_reason.length ? <span className="context-note"> ({c.undetermined_by_reason.map(r => `${number(r.count)} ${reasonLabel(r.reason)}`).join('; ')})</span> : null}</td>
          <td>{bound(c.execution_failed, complete)}</td><td>{bound(c.not_evaluated, complete)}</td>
        </tr>)}</tbody>
      </table></div> : null}
      <ul aria-label={`${unit}s by outcome`}>
        <li>{unit.charAt(0).toUpperCase() + unit.slice(1)}s with at least one exception: {found(s.failing_subjects, unit, complete)}</li>
        <li>Meeting every criterion that applies: {found(s.meets_every_applicable, unit, complete)}</li>
        <li>Unresolved (no exception, but at least one result unknown): {found(s.unresolved_subjects, unit, complete)}</li>
        <li>No criterion applies: {found(s.not_applicable_to_any, unit, complete)}</li>
        <li>Failing criterion opportunities (not {unit}s): {found(s.failing_opportunities, 'opportunity', complete).replace('opportunitys', 'opportunities')}</li>
        {complete ? null : <li>The total is not known: the population is incomplete.</li>}
      </ul>
      {s.limitations.length ? <ul aria-label="Coverage limitations">{s.limitations.map((l, i) => <li key={i}>{limitationWords(l, key(l.criterion_id), unit)}</li>)}</ul> : null}
      <p className="context-note">Counted with {s.aggregation.replaceAll('_', ' ')} · summary digest {short(s.summary_sha256)}</p>
    </li>;
  };
  return <section className="task-coverage" aria-label="Coverage">
    <h4>Coverage</h4>
    <p className="context-note">Counts made by the platform from every row of the exact source, then recounted by the database. The model never counts. Rows and items are separate: duplicate rows collapse into one item.</p>
    {assessment.summaries.length ? <>
      <h5>Summaries</h5>
      {omitted(assessment.total_summaries, assessment.summaries.length, 'summaries are')}
      <ul className="coverage-summaries">{assessment.summaries.map(summaryView)}</ul>
    </> : null}
    {assessment.populations.length ? <>
      <h5>Populations</h5>
      {omitted(assessment.total_populations, assessment.populations.length, 'population versions are')}
      <ul className="coverage-populations">{assessment.populations.map(p => <li key={p.id}>
        {populationLine(p)}
        {!summarised.has(p.id) ? <p className="context-note">Not yet summarised: no conclusion has been reached for this population.</p> : null}
      </li>)}</ul>
    </> : null}
    {assessment.samples.length ? <>
      <h5>Samples</h5>
      {omitted(assessment.total_samples, assessment.samples.length, 'sample versions are')}
      <ul className="coverage-samples">{assessment.samples.map(s => <li key={s.id}>
        <p><strong>Sample {s.key}</strong> · {s.method === 'seeded_random' ? `seeded random (seed ${s.seed}, ${s.algorithm}), recomputed by the platform` : s.method === 'judgmental' ? 'judgmental selection' : 'every in-scope item'} · {number(s.selected_count)} selected</p>
        <p className="retained-text">{s.justification}</p>
        {s.strata ? <p>Strata: <span className="retained-text">{s.strata}</span></p> : null}
        <p className="context-note">A sample covers its selected items only; no statistical inference is made.{s.keys_withheld ? ' Selected keys withheld: you cannot open this source.' : ''}</p>
      </li>)}</ul>
    </> : null}
  </section>;
}
