'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProcedureVersionView } from '@intellifin/application';
import { PREPARATION_SECTIONS, draftContext, preparationStatus, preparationReviewBlocker, sectionReview, type PreparationSectionId } from '@intellifin/domain';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { countNoun } from '../design/words';
import { ActorName } from '../runs/ActorName';
import { NO_AUTOMATIC_RUNS_SENTENCE, SCHEDULE_TIME_STARTS_NOTHING_SENTENCE } from '../design/run-start-words';
import { CONDITION_NOT_IN_WORDS, conditionLabel, conditionSentence } from './condition-words';
import { PREPARATION_PANEL_PREFIX, preparationPanelId } from './preparation-anchors';
import { UNKNOWN_SAVE_OUTCOME, UnknownSaveOutcome } from './UnknownSaveOutcome';
import { useSectionSubmissionStatus, useSubmissionGuard } from './use-section';
import { usePreparationGuide, type PreparationActionResult } from './PreparationActions';
import './guided-preparation.css';

type PreparationStep = PreparationSectionId | 'review';
type PreparationDecision = 'review' | 'clarify' | 'draft';

export interface GuidedPreparationProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onRowVersion: (rowVersion: string) => void;
  readonly onReview: (fields: {
    procedureId: string;
    versionId: string;
    expectedRowVersion: string;
    section: PreparationSectionId;
    decision: PreparationDecision;
  }) => Promise<{ ok: true; rowVersion: string } | { ok: false; reason: string }>;
  readonly editors: Readonly<Record<PreparationSectionId, ReactNode>>;
  readonly review: ReactNode;
  readonly help?: ReactNode;
  readonly assistant?: (step: PreparationStep) => ReactNode;
  readonly onStepChange?: (step: PreparationStep) => void;
  /**
   * User id → person's name, for the auditor named on each section's review record. The
   * server page reads it through `ActorNameReader` (a client component cannot), and an id
   * with no name here is printed as itself in monospace — never blank, never a UUID
   * dressed as a name. Owner finding UX-11: the record printed the raw id.
   */
  readonly actorNames?: Readonly<Record<string, string>>;
}

const SECTION_WORDS: Readonly<Record<PreparationStep, {
  title: string;
  question: string;
  help: readonly string[];
}>> = {
  context: {
    title: 'Risk, control and objective',
    question: 'This context came from your Template. Does it describe the control you intend to test?',
    help: [
      'Start with the risk and control in the Template. State what this procedure must establish.',
      'Name the policy or standard clause separately. If the Template does not supply one, keep that uncertainty visible.',
      'Check that the objective describes the work you intend to delegate.',
    ],
  },
  scope: {
    title: 'Scope and period',
    question: 'I’ll help you describe the population, then we’ll set the exact dates.',
    help: [
      'Set the testing period and describe the records included in the assignment.',
      'Check the source and any filters. A filter changes which records will be tested.',
      'Use only the approved systems needed for this work.',
    ],
  },
  evidence: {
    title: 'Evidence to review',
    question: 'Let’s choose the records, the systems to inspect, and the proof to keep.',
    help: [
      'Identify the reports, files, logs or system settings needed to answer the audit question.',
      'State the fields or content the agent must capture, and check where that evidence is available.',
      'Missing evidence must remain an unresolved question, rather than be treated as proof that a control passed.',
    ],
  },
  instructions: {
    title: 'Audit steps',
    question: 'Let’s design the test using the control, scope and evidence you selected.',
    help: [
      'Describe the work in order, including what to inspect and what to compare.',
      'Keep the steps within the saved scope and approved systems.',
      'Save your changes before reviewing. Drafted text still needs your acceptance.',
    ],
  },
  assessment: {
    title: 'Assessment criteria',
    question: 'Check the Template’s test criteria. What counts as compliance, an exception, or an unresolved item?',
    help: [
      'State the conditions and thresholds that distinguish compliance from a finding.',
      'Ground each criterion in the supplied control or policy. Do not invent a requirement to fill a gap.',
      'Check how missing or ambiguous evidence leaves an item unresolved.',
    ],
  },
  // "Frequency and handling" named an editor half of which is not here: the section
  // takes a frequency and a time, and the handling — when the agent stops, retries or
  // asks — is frozen by the compiler and only shown. The title says what the section
  // does, and the step itself reads the handling facts out of the plan.
  // UX-14: "Planned frequency" says it is a plan, because nothing starts a Run by itself
  // in this release; the step's own caption names the one action that does.
  frequency: {
    title: 'Planned frequency',
    question: 'How often is this test meant to happen, and which dates would each one cover? Nothing runs by itself yet.',
    help: [
      'Set how often the assignment is meant to repeat and check the period that each run would cover.',
      'Check that the evidence can be obtained at that frequency.',
      `${NO_AUTOMATIC_RUNS_SENTENCE} ${SCHEDULE_TIME_STARTS_NOTHING_SENTENCE}`,
      'When the agent stops, retries or asks a person is decided by the plan, not here. The section shows those settings; the full plan below repeats them with their exact numbers.',
    ],
  },
  review: {
    title: 'Review and submission',
    question: 'Does this accurately describe the work you intend to delegate?',
    help: [
      'Read the complete procedure and the plan showing what the agent will perform.',
      'Resolve open questions and check each saved section before submitting this exact version.',
      'Submission is your approval of the whole assignment. Independent manager approval and activation are required before execution.',
    ],
  },
};

const STATUS_WORDS = {
  'not-started': 'Not started',
  drafting: 'Drafting',
  'needs-clarification': 'Needs clarification',
  reviewed: 'Reviewed by auditor',
} as const;


/**
 * One saved Procedure Version, with a path through its existing editors. Hidden panels
 * stay mounted: removing one would discard useSection's unsaved state and unregister
 * its submission guard, making an unfinished section look safe to review or submit.
 */
export function GuidedPreparation({ draft, rowVersion, onRowVersion, onReview, editors, review, help, assistant, onStepChange, actorNames }: GuidedPreparationProps): React.JSX.Element {
  // Fixed prefix (UX-15): exactly one GuidedPreparation is mounted per page, so a
  // stable id lets ReadinessPanel link to a step without threading this component's
  // internal state out through a render-prop. See preparation-anchors.ts.
  const id = PREPARATION_PANEL_PREFIX;
  const names = new Map(Object.entries(actorNames ?? {}));
  const [selected, setSelected] = useState<PreparationStep>('context');
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; title: string } | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const changing = useRef(false);
  const headings = useRef<Partial<Record<PreparationStep, HTMLHeadingElement | null>>>({});
  const firstRender = useRef(true);
  const helpStartsOpen = useRef(false).current;
  const guard = useSubmissionGuard();
  useEffect(() => { onStepChange?.(selected); }, [selected, onStepChange]);

  // A lost acknowledgement might already have recorded the decision. Keep submission
  // blocked until the saved version is inspected, just as each content editor does.
  useSectionSubmissionStatus('Section review', {
    status: () => ({ dirty: false, conflict: false, pending: busy }),
  }, busy, unknownOutcome);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headings.current[selected]?.focus();
  }, [selected]);

  useEffect(() => {
    // Native outline links work before hydration. Keep the section a reader chose
    // while JavaScript was loading, then switch to the focused editing layout.
    function selectFromHash(): void {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const linked = [...PREPARATION_SECTIONS, 'review' as const].find(section => preparationPanelId(section) === hash);
      if (linked) setSelected(linked);
    }
    selectFromHash();
    setHydrated(true);
    // UX-15: a reader who is already on this page and follows a readiness link (a
    // same-page `href` change) fires `hashchange` without a navigation -- the
    // mount-only read above cannot see that. `ReadinessPanel` is the one caller.
    window.addEventListener('hashchange', selectFromHash);
    return () => window.removeEventListener('hashchange', selectFromHash);
  }, []);

  const reviewed = PREPARATION_SECTIONS.filter(section => preparationStatus(draft, section) === 'reviewed').length;
  const complete = reviewed === PREPARATION_SECTIONS.length;
  const actionReason = draft.state !== 'DRAFT' ? 'Only a Draft can be prepared.'
    : unknownOutcome ? UNKNOWN_SAVE_OUTCOME
    : busy ? 'Wait for this preparation change to be acknowledged.'
    : guard.reason ?? undefined;

  function announce(tone: 'success' | 'danger' | 'warning', title: string): void {
    setMessage({ tone, title });
    setAnnouncement(value => value + 1);
  }

  async function decide(section: PreparationSectionId, decision: PreparationDecision): Promise<PreparationActionResult> {
    if (changing.current || unknownOutcome || draft.state !== 'DRAFT') return { ok: false, message: unknownOutcome ? UNKNOWN_SAVE_OUTCOME : 'Only an available Draft section can be reviewed.' };
    // Read the live registry again at activation, including editors in hidden panels.
    // A rendered enabled button is not a durable acknowledgement of their latest save.
    const reason = guard.check();
    if (reason !== null) { announce('warning', reason); return { ok: false, message: reason }; }
    if (decision === 'review' && preparationStatus(draft, section) === 'needs-clarification') {
      announce('warning', 'Resolve the question, save this section and choose Continue drafting before marking it reviewed.');
      return { ok: false, message: 'Resolve the open question before reviewing this section.' };
    }
    const reviewBlocker = decision === 'review' ? preparationReviewBlocker(draft, section) : null;
    if (reviewBlocker) { announce('warning', reviewBlocker); return { ok: false, message: reviewBlocker }; }
    changing.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await onReview({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: rowVersion, section, decision });
      if (!outcome.ok) { announce('danger', outcome.reason); return { ok: false, message: outcome.reason }; }
      onRowVersion(outcome.rowVersion);
      announce('success', decision === 'review' ? `Review recorded for ${SECTION_WORDS[section].title}.`
        : decision === 'clarify' ? `${SECTION_WORDS[section].title} needs clarification.`
        : `${SECTION_WORDS[section].title} is back in drafting.`);
      if (decision === 'review') {
        const next = PREPARATION_SECTIONS[PREPARATION_SECTIONS.indexOf(section) + 1] ?? 'review';
        // If the auditor jumped elsewhere while the response arrived, leave them there.
        setSelected(current => current === section ? next : current);
      }
      return { ok: true, message: `Review recorded for ${SECTION_WORDS[section].title}.` };
    } catch {
      setUnknownOutcome(true);
      setMessage(null);
      return { ok: false, message: UNKNOWN_SAVE_OUTCOME };
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  usePreparationGuide({
    navigate(destination) { setSelected(destination); },
    async review(section) {
      if (section === 'review') return { ok: false, message: 'Review the complete saved plan and use Submit for approval. A chat section review does not submit or approve the procedure.' };
      if (section !== selected) return { ok: false, message: 'The active section changed. Review the section now shown before confirming it.' };
      if (draft.state !== 'DRAFT' || unknownOutcome || changing.current) return { ok: false, message: 'This section is not available for review. Inspect the saved draft first.' };
      return decide(section, 'review');
    },
  });

  return <div className="ls-guided ls-stack" data-guided-preparation data-guided-ready={hydrated}>
    <header className="ls-guided__intro ls-stack">
      <h2 className="ls-card__title">Prepare an audit procedure</h2>
      <p>I’ll guide you through the choices and help prepare the test. Start by confirming the selected control. You can jump to any section.</p>
      <p className="ls-caption" data-preparation-progress>{reviewed} of {PREPARATION_SECTIONS.length} sections reviewed by auditor. Section review does not authorise execution.</p>
    </header>
    <UnknownSaveOutcome visible={unknownOutcome} />
    {message === null ? null : <Banner key={announcement} tone={message.tone} title={message.title} />}

    <div className="ls-guided__layout">
      <nav className="ls-guided__outline" aria-label="Procedure outline" data-preparation-outline>
        <h3 className="ls-guided__outline-title">Procedure outline</h3>
        <ol className="ls-guided__steps">
          {PREPARATION_SECTIONS.map((section, index) => {
            const status = preparationStatus(draft, section);
            return <li key={section}>
              <a className="ls-guided__step" aria-current={selected === section ? 'step' : undefined} href={`#${id}-panel-${section}`} aria-controls={`${id}-panel-${section}`} onClick={event => { event.preventDefault(); setSelected(section); }} data-preparation-nav={section}>
                <span className="ls-guided__number" aria-hidden="true">{index + 1}</span>
                <span className="ls-guided__step-copy">
                  <span className="ls-guided__step-title">{SECTION_WORDS[section].title}</span>
                  <span className={`ls-guided__status ls-guided__status--${status}`} data-preparation-status={status}>{STATUS_WORDS[status]}</span>
                </span>
              </a>
            </li>;
          })}
          <li>
            <a className="ls-guided__step" aria-current={selected === 'review' ? 'step' : undefined} href={`#${id}-panel-review`} aria-controls={`${id}-panel-review`} onClick={event => { event.preventDefault(); setSelected('review'); }} data-preparation-nav="review">
              <span className="ls-guided__number" aria-hidden="true">{PREPARATION_SECTIONS.length + 1}</span>
              <span className="ls-guided__step-copy"><span className="ls-guided__step-title">{SECTION_WORDS.review.title}</span><span className="ls-caption">Review the whole assignment</span></span>
            </a>
          </li>
        </ol>
      </nav>

      <aside className="ls-guided__help" aria-label="Section help">
        <details className="ls-disclosure ls-guided__help-disclosure" open={helpStartsOpen}>
          <summary>Help for this section</summary>
          <div className="ls-disclosure__body">
            <h3 className="ls-guided__help-title">{SECTION_WORDS[selected].title}</h3>
            <ul className="ls-guided__help-list">{SECTION_WORDS[selected].help.map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
            {help}
          </div>
        </details>
      </aside>

      {/* Saved sections remain readable before hydration, but these forms need their
          change handlers and submission registry before they can accept an edit. Keep
          this one native fieldset mounted while enabling its controls; replacing the
          editor tree at that boundary would discard state and keyboard focus. */}
      <fieldset className="ls-guided__work" aria-label="Procedure editing controls" disabled={!hydrated}>
        {!hydrated ? <p className="ls-caption" role="status">Editing controls are loading. You can read the saved sections below.</p> : null}
        <noscript><p>JavaScript is required to edit this procedure. The saved sections and outline remain available to read.</p></noscript>
        {PREPARATION_SECTIONS.map((section, index) => {
          const status = preparationStatus(draft, section);
          const acknowledgement = sectionReview(draft, section);
          const reviewReason = actionReason ?? (status === 'needs-clarification'
            ? 'Resolve the question, save this section and choose Continue drafting before marking it reviewed.' : preparationReviewBlocker(draft, section) ?? undefined);
          return <section key={section} className="ls-guided__panel ls-card ls-stack" id={`${id}-panel-${section}`} hidden={hydrated && selected !== section} aria-labelledby={`${id}-heading-${section}`} data-preparation-panel={section}>
            <header className="ls-guided__panel-heading ls-stack">
              <p className="ls-caption">Step {index + 1} of {PREPARATION_SECTIONS.length + 1}</p>
              <h2 className="ls-card__title" id={`${id}-heading-${section}`} tabIndex={-1} ref={element => { headings.current[section] = element; }}>{SECTION_WORDS[section].title}</h2>
              <p>{SECTION_WORDS[section].question}</p>
              <span className={`ls-guided__status ls-guided__status--${status}`}>{STATUS_WORDS[status]}</span>
            </header>

            {status === 'needs-clarification' ? <Banner tone="warning" title="Resolve the open question before reviewing this section."><p>Save any changes, then choose Continue drafting when the question is resolved.</p></Banner> : null}

            {section === 'context' ? <div className="ls-guide-facts ls-stack" data-control-confirmation>
              <h3 className="ls-guide-question__heading">{draft.controlName}</h3>
              <dl>{Object.entries({ Risk: draftContext(draft.sections).risk, Control: draftContext(draft.sections).control,
                Objective: draftContext(draft.sections).objective, 'Criterion reference': draftContext(draft.sections).criterionReference }).map(([label, value]) =>
                <div key={label}><dt>{label}</dt><dd>{value || 'Not supplied'}</dd></div>)}</dl>
              <p className="ls-caption">This is the saved context for your procedure. A missing reference stays unknown; it is not an approved policy requirement.</p>
            </div> : null}
            {section === 'assessment' ? <div className="ls-guide-facts ls-stack" data-criteria-confirmation>
              <p>I’ll use these saved criteria to distinguish a finding from a compliant result. Missing or ambiguous evidence stays unresolved.</p>
              {draft.complianceConditions.length === 0 ? <Banner tone="warning" title="No assessment criteria have been supplied." />
                : <ol className="ls-stack">{draft.complianceConditions.map((condition) => {
                    // UX-13: the rule's own vocabulary — `found = false`, a field name,
                    // a condition id like `C1` — is what an auditor met here before this
                    // was said in audit language. `conditionSentence` is the one place a
                    // Compliance Rule condition becomes a sentence; a condition it cannot
                    // read (free prose the Template pinned) keeps its authored text, said
                    // as what it is rather than a sentence this surface guessed.
                    const sentence = conditionSentence(condition.text, draft.templateId, condition.conditionId);
                    return <li key={condition.conditionId} data-condition-sentence={condition.conditionId}>
                      <p><strong>{conditionLabel(condition.conditionId)}.</strong> {sentence ?? condition.text}</p>
                      {sentence === null ? <p className="ls-caption">{CONDITION_NOT_IN_WORDS}</p> : null}
                      <TechnicalDetails items={[
                        { label: 'Compiled rule text', value: condition.text, mono: true },
                        { label: 'Applies to', value: condition.applicability, mono: true },
                      ]} />
                    </li>;
                  })}</ol>}
              <p className="ls-caption">Confirm these criteria if they match the intended test, or change them explicitly below.</p>
            </div> : null}
            {selected === section ? assistant?.(section) : null}
            <div className="ls-guided__editor ls-stack">
              {section === 'context' || section === 'instructions' || section === 'assessment'
                ? <details className="ls-disclosure" data-guided-manual={section}>
                  <summary>{section === 'context' ? 'Edit risk, control or objective manually' : section === 'instructions' ? 'Write or edit the steps myself' : 'Change the assessment criteria'}</summary>
                  <div className="ls-disclosure__body">{editors[section]}</div>
                </details> : editors[section]}
            </div>

            <footer className="ls-guided__acceptance ls-stack">
              {acknowledgement === null ? <p className="ls-caption">{section === 'context' ? 'Confirming records your review of the saved risk, control and objective. It does not submit the procedure.' : 'When the saved content is correct, confirm your review and continue.'}</p> : <div className="ls-guided__review-record ls-stack">
                <p>Reviewed by auditor on <Timestamp value={acknowledgement.at} />.</p>
                <p className="ls-caption">This review covers the saved section. Changes to it need another review.</p>
                <details className="ls-disclosure"><summary>Review record</summary><dl className="ls-guided__review-facts ls-disclosure__body">
                  <div><dt>Auditor</dt><dd><ActorName id={acknowledgement.actorId} names={names} /></dd></div>
                  <div><dt>Saved section revision</dt><dd>{acknowledgement.revision}</dd></div>
                  <div><dt>Saved section reference</dt><dd>{acknowledgement.basis}</dd></div>
                </dl></details>
              </div>}
              {reviewReason === undefined ? null : <p className="ls-caption" id={`${id}-reason-${section}`}>{reviewReason}</p>}
              <div className="ls-actions">
                <span data-section-review={section}><Button variant="primary" type="button" busy={busy} disabledReason={reviewReason} disabledReasonId={`${id}-reason-${section}`} onClick={() => { void decide(section, 'review'); }}>{section === 'context' ? 'Yes, use this control' : 'Mark reviewed and continue'}</Button></span>
                {status === 'needs-clarification' || status === 'reviewed'
                  ? <Button type="button" busy={busy} disabledReason={actionReason} disabledReasonId={actionReason === undefined ? undefined : `${id}-reason-${section}`} onClick={() => { void decide(section, 'draft'); }}>Continue drafting</Button>
                  : <Button type="button" busy={busy} disabledReason={actionReason} disabledReasonId={actionReason === undefined ? undefined : `${id}-reason-${section}`} onClick={() => { void decide(section, 'clarify'); }}>Needs clarification</Button>}
              </div>
            </footer>
          </section>;
        })}

        <section className="ls-guided__panel ls-card ls-stack" id={`${id}-panel-review`} hidden={hydrated && selected !== 'review'} aria-labelledby={`${id}-heading-review`} data-preparation-panel="review">
          <header className="ls-guided__panel-heading ls-stack">
            <h2 className="ls-card__title" id={`${id}-heading-review`} tabIndex={-1} ref={element => { headings.current.review = element; }}>{SECTION_WORDS.review.title}</h2>
            <p>{SECTION_WORDS.review.question}</p>
          </header>
          {complete ? <Banner tone="info" title="Preparation complete"><p>Review the whole procedure and submit it for independent manager approval. Execution is unavailable until approval and activation.</p></Banner> : <p>{countNoun(PREPARATION_SECTIONS.length - reviewed, 'section')} not yet marked reviewed. Check the whole assignment before submission.</p>}
          <ul className="ls-guided__review-list" aria-label="Section review overview">
            {PREPARATION_SECTIONS.map(section => <li key={section}><a className="ls-guided__review-link" href={`#${id}-panel-${section}`} onClick={event => { event.preventDefault(); setSelected(section); }}>{SECTION_WORDS[section].title}</a><span className={`ls-guided__status ls-guided__status--${preparationStatus(draft, section)}`}>{STATUS_WORDS[preparationStatus(draft, section)]}</span></li>)}
          </ul>
          {review}
        </section>
      </fieldset>


    </div>
  </div>;
}
