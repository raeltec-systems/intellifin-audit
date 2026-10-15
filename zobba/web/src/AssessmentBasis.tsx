import { Citation } from './Citation';
import { chipLabel } from './citation';
import type { CitationSource } from './citation';
import type { Scope } from './engagements';
import { applicabilityLabel, executionLabel, groundingLabel, originLabel, reasonLabel, supportLabel, valueLabel, verdictLabel } from './assessment';
import type { Assessment, AssessmentCriterion, AssessmentEvaluation } from './assessment';

interface Props {
  assessment: Assessment;
  citations?: { scope: Scope; accessReady: boolean };
  onSourceAccessFailure: () => void;
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 13)}</abbr>;

/// Story 24.1: what the assessment rests on. Criterion versions with their
/// checked authority, the basis period and population references, typed
/// facts with their verified sources, and evaluations whose applicability,
/// execution, verdict and origin are shown as separate words. Agent text is
/// attributed data; nothing here is a confidence score or a free-text verdict.
export function AssessmentBasis({ assessment, citations, onSourceAccessFailure }: Props) {
  const chip = (sources: CitationSource[]) => {
    if (!sources.length) return <span className="context-note"> · no source</span>;
    if (citations) return <> <Citation scope={citations.scope} sources={sources} accessReady={citations.accessReady} onSourceAccessFailure={onSourceAccessFailure} /></>;
    const { label, more } = chipLabel(sources);
    return <span className="citation-label"> · cites {label}{more ? ` and ${more} more` : ''}</span>;
  };
  const criterionById = new Map(assessment.criteria.map(c => [c.id, c]));
  const criterionName = (id: string) => criterionById.get(id)?.key ?? id.slice(0, 13);
  const omitted = (total: string, shown: number, noun: string) => {
    const left = Number(BigInt(total) - BigInt(shown));
    return left > 0 ? <p className="work-omitted">{left} earlier {noun} not shown; the most recent {shown} are.</p> : null;
  };
  const authority = (criterion: AssessmentCriterion) => {
    const state = criterion.authority_verified ? 'cited text verified' : `cited text unverified · ${(criterion.authority_reason ?? '').replaceAll('_', ' ')}`;
    if (criterion.authority_kind === 'method') {
      return <span className={criterion.authority_verified ? 'authority' : 'authority authority-unverified'}>Authority: method {criterion.requirement_id} criterion {(criterion.criterion_ordinal ?? 0) + 1} · {state}</span>;
    }
    return <span className={criterion.authority_verified ? 'authority' : 'authority authority-unverified'}>Authority: source · {state}{criterion.authority_source ? chip([criterion.authority_source]) : null}</span>;
  };
  const verdictClass = (evaluation: AssessmentEvaluation) => evaluation.verdict === 'not_met' ? 'verdict verdict-exception' : 'verdict';
  return <section className="task-assessment" aria-label="Assessment basis">
    <h4>Assessment basis</h4>
    <p className="context-note">What Zobba's assessment rests on. Facts are checked against their exact source and re-read under a declared rule. Zobba proposes each rule (its facts, operator and threshold); the platform evaluates it and verifies the authority text it cites, but does not prove that the rule follows from that text. Missing or unavailable evidence is never an exception.</p>
    {assessment.bases.length ? <>
      <h5>Basis versions</h5>
      {omitted(assessment.total_bases, assessment.bases.length, 'basis versions are')}
      <ul className="assessment-bases">{assessment.bases.map(basis => <li key={basis.id}>
        <p><strong>Basis {short(basis.id)}</strong> · period {basis.period_from} to {basis.period_to}{basis.as_of ? ` · as of ${basis.as_of}` : ''}{basis.supersedes ? <> · supersedes {short(basis.supersedes)}</> : null}</p>
        <p className="retained-text">{basis.objective}</p>
        <p>Criteria: {basis.criteria.map(criterionName).join(', ')}</p>
        {basis.population.length ? <ul aria-label="Population references">{basis.population.map(p => <li key={p.original_id}>{p.filename ?? 'A source you cannot open'} · {p.unit} · <span className="retained-text">{p.selection}</span> · {p.sha256 ? <>digest {short(p.sha256)}</> : 'not a registered original'}</li>)}</ul> : null}
        {basis.limitations.length ? <ul aria-label="Basis limitations">{basis.limitations.map((l, i) => <li key={i} className="retained-text">{l}</li>)}</ul> : null}
      </li>)}</ul>
    </> : <p className="context-note">No assessment basis recorded.</p>}
    {assessment.criteria.length ? <>
      <h5>Criteria</h5>
      {omitted(assessment.total_criteria, assessment.criteria.length, 'criterion versions are')}
      <ul className="assessment-criteria">{assessment.criteria.map(criterion => <li key={criterion.id}>
        <p><strong>{criterion.key}</strong> · {criterion.kind === 'rule' ? 'Rule' : 'Judgment'} · <span className="retained-text">{criterion.assertion}</span></p>
        <p>{authority(criterion)}{criterion.effective_from || criterion.effective_to ? ` · effective ${criterion.effective_from ?? '…'} to ${criterion.effective_to ?? '…'}` : ''}</p>
        {criterion.applicability ? <p>Applies when {criterion.applicability}</p> : null}
        {criterion.rule ? <p>Rule proposed by Zobba: {criterion.rule}</p> : null}
        {criterion.rubric ? <p>Rubric: <span className="retained-text">{criterion.rubric}</span></p> : null}
        <p>Needs {criterion.required_facts.map(r => `${r.name} (${r.fact_type}${r.measure ? `, ${r.measure}` : ''})`).join(', ') || 'no facts'}</p>
      </li>)}</ul>
    </> : null}
    {assessment.facts.length ? <>
      <h5>Facts</h5>
      {omitted(assessment.total_facts, assessment.facts.length, 'facts are')}
      <ul className="assessment-facts">{assessment.facts.map(fact => <li key={fact.id} className={fact.support === 'supported' ? 'fact-supported' : 'fact-unsupported'}>
        <span className="fact-subject">{fact.subject_unit} {fact.subject}</span> · {fact.name} · <span className="fact-value">{valueLabel(fact)}</span> · {supportLabel(fact)}{groundingLabel(fact) ? <span className="fact-grounding"> · {groundingLabel(fact)}</span> : null}{fact.rule ? ` · read as ${fact.rule.replaceAll('_', ' ')}` : ''}{chip(fact.sources)}
      </li>)}</ul>
    </> : null}
    {assessment.evaluations.length ? <>
      <h5>Evaluations</h5>
      {omitted(assessment.total_evaluations, assessment.evaluations.length, 'evaluations are')}
      <ul className="assessment-evaluations">{assessment.evaluations.map(evaluation => <li key={evaluation.id}>
        <p><strong>{criterionName(evaluation.criterion_id)}</strong> · {evaluation.subject}</p>
        <dl className="evaluation-fields">
          <div><dt>Applicability</dt><dd>{applicabilityLabel[evaluation.applicability]}</dd></div>
          <div><dt>Execution</dt><dd>{executionLabel[evaluation.execution]}</dd></div>
          <div><dt>Verdict</dt><dd className={verdictClass(evaluation)}>{verdictLabel(evaluation.verdict)}{evaluation.reason ? ` · ${reasonLabel(evaluation.reason)}` : ''}</dd></div>
          <div><dt>Origin</dt><dd>{originLabel[evaluation.origin]}</dd></div>
        </dl>
        {evaluation.judgment ? <div className="judgment">
          <p><span className="retained-text">{evaluation.judgment.rationale}</span></p>
          {evaluation.judgment.uncertainty ? <p>Uncertainty: <span className="retained-text">{evaluation.judgment.uncertainty}</span></p> : null}
          <p>{evaluation.judgment.supporting.length} supporting · {evaluation.judgment.contrary.length} contrary {evaluation.judgment.contrary.length === 1 ? 'fact' : 'facts'}</p>
        </div> : null}
        <p className="context-note">Inputs {evaluation.inputs.length} · output digest {short(evaluation.output_digest)}</p>
      </li>)}</ul>
    </> : null}
  </section>;
}
