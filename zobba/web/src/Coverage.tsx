import { useEffect, useRef, useState } from 'react';
import type { Scope } from './engagements';
import type { Assessment } from './assessment';
import {
  completenessSentence, conclusionSentence, dispositionLabel, dispositionReasonLabel, found, readMembers, reconciliationSentence,
} from './coverage';
import type { CoveragePopulation, CoverageSummary, Disposition, PopulationMembers } from './coverage';
import { reasonLabel } from './assessment';

interface Props {
  assessment: Assessment;
  taskId: string;
  /// Where members are read from; without it the exclusion lists are not offered.
  scope?: Scope;
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 13)}</abbr>;
const number = (value: string) => BigInt(value).toLocaleString('en-GB');

/// The member list of one population and one disposition: an exact count and
/// pages of 50 in receipt order, read on request.
function Members({ scope, taskId, population, disposition, label }: { scope: Scope; taskId: string; population: CoveragePopulation; disposition: Disposition; label: string }) {
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
    readMembers(scope, taskId, population.id, disposition, after, null, controller.signal).then(page => {
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
        <thead><tr><th scope="col">Row</th><th scope="col">Key</th><th scope="col">Decision</th></tr></thead>
        <tbody>{members.map(m => <tr key={m.ordinal}>
          <td>{m.row}</td>
          <td>{m.subject ?? (m.disposition === 'unkeyed' ? 'No key' : 'Withheld')}</td>
          <td>{dispositionLabel[m.disposition]}{m.reason ? ` · ${dispositionReasonLabel[m.reason]}` : ''}{m.duplicate_of !== null ? ` · repeats received row ${m.duplicate_of + 1}` : ''}</td>
        </tr>)}</tbody>
      </table> : null}
      {loading ? <p className="context-note">Reading rows…</p> : null}
      {last?.next_cursor && !loading ? <button type="button" className="text-button" onClick={() => load(last.next_cursor)}>Show more rows</button> : null}
    </div> : null}
  </div>;
}

/// Story 24.2: exact population, sample and coverage counts. Every number is
/// a count trusted code made from every row of the exact source and the
/// database recounted; when the population is incomplete each count is "at
/// least" and the total is "not known". There are no percentages and no
/// confidence score, and a sample says nothing about items it did not select.
export function Coverage({ assessment, taskId, scope }: Props) {
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
        <li>Duplicate rows collapsed: {found(c.duplicate_rows, 'row', complete)} · rows with no key: {found(c.unkeyed, 'row', complete)}</li>
        <li>Excluded outside the basis period: {found(c.excluded_out_of_period, p.subject_unit, complete)}</li>
        <li>Scope unknown: date does not parse {found(c.scope_unknown_period_unparsed, 'row', complete)} · date blank {found(c.scope_unknown_period_missing, 'row', complete)} · same key, different values {found(c.scope_unknown_conflicting_duplicate, 'row', complete)}</li>
        <li>In scope: {found(c.in_scope, p.subject_unit, complete)}</li>
      </ul>
      {scope ? <div className="coverage-inspect">
        {c.excluded_out_of_period !== '0' ? <Members scope={scope} taskId={taskId} population={p} disposition="excluded" label="Excluded" /> : null}
        {(BigInt(c.scope_unknown_period_unparsed) + BigInt(c.scope_unknown_period_missing) + BigInt(c.scope_unknown_conflicting_duplicate)) > 0n ? <Members scope={scope} taskId={taskId} population={p} disposition="scope_unknown" label="Scope unknown" /> : null}
        {c.duplicate_rows !== '0' ? <Members scope={scope} taskId={taskId} population={p} disposition="duplicate_row" label="Duplicate" /> : null}
        {c.unkeyed !== '0' ? <Members scope={scope} taskId={taskId} population={p} disposition="unkeyed" label="Unkeyed" /> : null}
      </div> : null}
    </>;
  };
  const summaryView = (s: CoverageSummary) => {
    const sample = s.sample_id !== null;
    const unit = populationById.get(s.population_id)?.subject_unit ?? 'item';
    const scopeWord = sample ? 'selected' : 'in scope';
    return <li key={s.id}>
      <p className="coverage-conclusion"><strong>{conclusionSentence(s)}</strong></p>
      <p>{completenessSentence(s)} {reconciliationSentence(s)}</p>
      <p>{sample ? `Sample ${s.sample_id?.slice(0, 13)}: ${number(s.selected ?? '0')} selected ${unit}s; nothing is inferred about the rest.` : `${found(s.counts.in_scope, unit, s.completeness === 'complete')} in scope.`}</p>
      {s.criteria.length ? <div className="coverage-scroll" role="group" aria-label="Criterion opportunities" tabIndex={0}><table className="coverage-table">
        <caption>Criterion opportunities over the {scopeWord} {unit}s</caption>
        <thead><tr><th scope="col">Criterion</th><th scope="col">Applies</th><th scope="col">Does not apply</th><th scope="col">Applicability unknown</th><th scope="col">Met</th><th scope="col">Not met</th><th scope="col">Undetermined</th><th scope="col">Failed</th><th scope="col">Not evaluated</th></tr></thead>
        <tbody>{s.criteria.map(c => <tr key={c.criterion_id}>
          <th scope="row">{criterionKey.get(c.criterion_id) ?? c.criterion_id.slice(0, 13)}</th>
          <td>{number(c.applicable)}</td><td>{number(c.not_applicable)}</td><td>{number(c.applicability_unknown)}</td>
          <td>{number(c.met)}</td><td>{number(c.not_met)}</td>
          <td>{number(c.undetermined)}{c.undetermined_by_reason.length ? <span className="context-note"> ({c.undetermined_by_reason.map(r => `${number(r.count)} ${reasonLabel(r.reason)}`).join('; ')})</span> : null}</td>
          <td>{number(c.execution_failed)}</td><td>{number(c.not_evaluated)}</td>
        </tr>)}</tbody>
      </table></div> : null}
      <ul aria-label={`${unit}s by outcome`}>
        <li>{unit.charAt(0).toUpperCase() + unit.slice(1)}s with at least one exception: {number(s.failing_subjects)}</li>
        <li>Meeting every criterion that applies: {number(s.meets_every_applicable)}</li>
        <li>Unresolved (no exception, but at least one result unknown): {number(s.unresolved_subjects)}</li>
        <li>No criterion applies: {number(s.not_applicable_to_any)}</li>
        <li>Failing criterion opportunities (not {unit}s): {number(s.failing_opportunities)}</li>
      </ul>
      {s.limitations.length ? <ul aria-label="Coverage limitations">{s.limitations.map((l, i) => <li key={i} className="retained-text">{l}</li>)}</ul> : null}
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
