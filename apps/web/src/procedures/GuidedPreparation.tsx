'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProcedureVersionView } from '@intellifin/application';
import { PREPARATION_SECTIONS, preparationStatus, sectionReview, type PreparationSectionId } from '@intellifin/domain';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { UNKNOWN_SAVE_OUTCOME, UnknownSaveOutcome } from './UnknownSaveOutcome';
import { useSectionSubmissionStatus, useSubmissionGuard } from './use-section';
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
}

const SECTION_WORDS: Readonly<Record<PreparationStep, {
  title: string;
  question: string;
  help: readonly string[];
}>> = {
  context: {
    title: 'Risk, control and objective',
    question: 'Which control are we testing, and what do we need to establish?',
    help: [
      'Start with the risk and control in the Template. State what this procedure must establish.',
      'Name the policy or standard clause separately. If the Template does not supply one, keep that uncertainty visible.',
      'Check that the objective describes the work you intend to delegate.',
    ],
  },
  scope: {
    title: 'Scope and period',
    question: 'Which records, entities, systems and period are included?',
    help: [
      'Set the testing period and describe the records included in the assignment.',
      'Check the source and any filters. A filter changes which records will be tested.',
      'Use only the approved systems needed for this work.',
    ],
  },
  evidence: {
    title: 'Evidence to review',
    question: 'What evidence should the agent examine?',
    help: [
      'Identify the reports, files, logs or system settings needed to answer the audit question.',
      'State the fields or content the agent must capture, and check where that evidence is available.',
      'Missing evidence must remain an unresolved question, rather than be treated as proof that a control passed.',
    ],
  },
  instructions: {
    title: 'Audit steps',
    question: 'What should the agent do with that evidence?',
    help: [
      'Describe the work in order, including what to inspect and what to compare.',
      'Keep the steps within the saved scope and approved systems.',
      'Save your changes before reviewing. Drafted text still needs your acceptance.',
    ],
  },
  assessment: {
    title: 'Assessment criteria',
    question: 'What is compliance, an exception, or an unresolved item?',
    help: [
      'State the conditions and thresholds that distinguish compliance from a finding.',
      'Ground each criterion in the supplied control or policy. Do not invent a requirement to fill a gap.',
      'Check how missing or ambiguous evidence leaves an item unresolved.',
    ],
  },
  frequency: {
    title: 'Frequency and handling',
    question: 'When should this repeat, and when should the agent stop or ask?',
    help: [
      'Set how often the assignment repeats and check the period that each run would cover.',
      'Check that the evidence can be obtained at that frequency.',
      'Review the full plan for operating limits and how the agent handles uncertainty before submission.',
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

const REVIEW_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
});

/**
 * One saved Procedure Version, with a path through its existing editors. Hidden panels
 * stay mounted: removing one would discard useSection's unsaved state and unregister
 * its submission guard, making an unfinished section look safe to review or submit.
 */
export function GuidedPreparation({ draft, rowVersion, onRowVersion, onReview, editors, review, help }: GuidedPreparationProps): React.JSX.Element {
  const id = useId();
  const [selected, setSelected] = useState<PreparationStep>('context');
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; title: string } | null>(null);
  const [announcement, setAnnouncement] = useState(0);
  const changing = useRef(false);
  const headings = useRef<Partial<Record<PreparationStep, HTMLHeadingElement | null>>>({});
  const firstRender = useRef(true);
  const helpStartsOpen = useRef(true).current;
  const guard = useSubmissionGuard();

  // A lost acknowledgement might already have recorded the decision. Keep submission
  // blocked until the saved version is inspected, just as each content editor does.
  useSectionSubmissionStatus('Section review', {
    status: () => ({ dirty: false, conflict: false, pending: busy }),
  }, busy, unknownOutcome);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headings.current[selected]?.focus();
  }, [selected]);

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

  async function decide(section: PreparationSectionId, decision: PreparationDecision): Promise<void> {
    if (changing.current || unknownOutcome || draft.state !== 'DRAFT') return;
    // Read the live registry again at activation, including editors in hidden panels.
    // A rendered enabled button is not a durable acknowledgement of their latest save.
    const reason = guard.check();
    if (reason !== null) { announce('warning', reason); return; }
    if (decision === 'review' && preparationStatus(draft, section) === 'needs-clarification') {
      announce('warning', 'Resolve the question, save this section and choose Continue drafting before marking it reviewed.');
      return;
    }
    changing.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await onReview({ procedureId: draft.procedureId, versionId: draft.versionId, expectedRowVersion: rowVersion, section, decision });
      if (!outcome.ok) { announce('danger', outcome.reason); return; }
      onRowVersion(outcome.rowVersion);
      announce('success', decision === 'review' ? `Review recorded for ${SECTION_WORDS[section].title}.`
        : decision === 'clarify' ? `${SECTION_WORDS[section].title} needs clarification.`
        : `${SECTION_WORDS[section].title} is back in drafting.`);
      if (decision === 'review') {
        const next = PREPARATION_SECTIONS[PREPARATION_SECTIONS.indexOf(section) + 1] ?? 'review';
        // If the auditor jumped elsewhere while the response arrived, leave them there.
        setSelected(current => current === section ? next : current);
      }
    } catch {
      setUnknownOutcome(true);
      setMessage(null);
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  return <div className="ls-guided ls-stack" data-guided-preparation>
    <header className="ls-guided__intro ls-stack">
      <h2 className="ls-card__title">Prepare an audit procedure</h2>
      <p>Work through the outline or choose any section. Your unsaved edits stay in place when you move.</p>
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
              <button type="button" className="ls-guided__step" aria-current={selected === section ? 'step' : undefined} aria-controls={`${id}-panel-${section}`} onClick={() => setSelected(section)} data-preparation-nav={section}>
                <span className="ls-guided__number" aria-hidden="true">{index + 1}</span>
                <span className="ls-guided__step-copy">
                  <span className="ls-guided__step-title">{SECTION_WORDS[section].title}</span>
                  <span className={`ls-guided__status ls-guided__status--${status}`} data-preparation-status={status}>{STATUS_WORDS[status]}</span>
                </span>
              </button>
            </li>;
          })}
          <li>
            <button type="button" className="ls-guided__step" aria-current={selected === 'review' ? 'step' : undefined} aria-controls={`${id}-panel-review`} onClick={() => setSelected('review')} data-preparation-nav="review">
              <span className="ls-guided__number" aria-hidden="true">{PREPARATION_SECTIONS.length + 1}</span>
              <span className="ls-guided__step-copy"><span className="ls-guided__step-title">{SECTION_WORDS.review.title}</span><span className="ls-caption">Review the whole assignment</span></span>
            </button>
          </li>
        </ol>
      </nav>

      <div className="ls-guided__work">
        {PREPARATION_SECTIONS.map((section, index) => {
          const status = preparationStatus(draft, section);
          const acknowledgement = sectionReview(draft, section);
          const reviewReason = actionReason ?? (status === 'needs-clarification'
            ? 'Resolve the question, save this section and choose Continue drafting before marking it reviewed.' : undefined);
          return <section key={section} className="ls-guided__panel ls-card ls-stack" id={`${id}-panel-${section}`} hidden={selected !== section} aria-labelledby={`${id}-heading-${section}`} data-preparation-panel={section}>
            <header className="ls-guided__panel-heading ls-stack">
              <p className="ls-caption">Section {index + 1} of {PREPARATION_SECTIONS.length}</p>
              <h2 className="ls-card__title" id={`${id}-heading-${section}`} tabIndex={-1} ref={element => { headings.current[section] = element; }}>{SECTION_WORDS[section].title}</h2>
              <p>{SECTION_WORDS[section].question}</p>
              <span className={`ls-guided__status ls-guided__status--${status}`}>{STATUS_WORDS[status]}</span>
            </header>

            {status === 'needs-clarification' ? <Banner tone="warning" title="Resolve the open question before reviewing this section."><p>Save any changes, then choose Continue drafting when the question is resolved.</p></Banner> : null}

            <div className="ls-guided__editor ls-stack">{editors[section]}</div>

            <footer className="ls-guided__acceptance ls-stack">
              {acknowledgement === null ? <p className="ls-caption">Save this section, then mark it reviewed when it accurately describes your intended work.</p> : <div className="ls-guided__review-record ls-stack">
                <p>Reviewed by auditor on <time dateTime={acknowledgement.at}>{REVIEW_DATE.format(new Date(acknowledgement.at))} UTC</time>.</p>
                <p className="ls-caption">This review covers the saved section. Changes to it need another review.</p>
                <details className="ls-disclosure"><summary>Review record</summary><dl className="ls-guided__review-facts ls-disclosure__body">
                  <div><dt>Auditor</dt><dd>{acknowledgement.actorId}</dd></div>
                  <div><dt>Saved section revision</dt><dd>{acknowledgement.revision}</dd></div>
                  <div><dt>Saved section reference</dt><dd>{acknowledgement.basis}</dd></div>
                </dl></details>
              </div>}
              {reviewReason === undefined ? null : <p className="ls-caption" id={`${id}-reason-${section}`}>{reviewReason}</p>}
              <div className="ls-actions">
                <Button variant="primary" type="button" busy={busy} disabledReason={reviewReason} disabledReasonId={`${id}-reason-${section}`} onClick={() => { void decide(section, 'review'); }}>Mark reviewed and continue</Button>
                {status === 'needs-clarification' || status === 'reviewed'
                  ? <Button type="button" busy={busy} disabledReason={actionReason} disabledReasonId={actionReason === undefined ? undefined : `${id}-reason-${section}`} onClick={() => { void decide(section, 'draft'); }}>Continue drafting</Button>
                  : <Button type="button" busy={busy} disabledReason={actionReason} disabledReasonId={actionReason === undefined ? undefined : `${id}-reason-${section}`} onClick={() => { void decide(section, 'clarify'); }}>Needs clarification</Button>}
              </div>
            </footer>
          </section>;
        })}

        <section className="ls-guided__panel ls-card ls-stack" id={`${id}-panel-review`} hidden={selected !== 'review'} aria-labelledby={`${id}-heading-review`} data-preparation-panel="review">
          <header className="ls-guided__panel-heading ls-stack">
            <h2 className="ls-card__title" id={`${id}-heading-review`} tabIndex={-1} ref={element => { headings.current.review = element; }}>{SECTION_WORDS.review.title}</h2>
            <p>{SECTION_WORDS.review.question}</p>
          </header>
          {complete ? <Banner tone="info" title="Preparation complete"><p>Review the whole procedure and submit it for independent manager approval. Execution is unavailable until approval and activation.</p></Banner> : <p>{PREPARATION_SECTIONS.length - reviewed} {PREPARATION_SECTIONS.length - reviewed === 1 ? 'section has' : 'sections have'} not been marked reviewed. Check the whole assignment before submission.</p>}
          <ul className="ls-guided__review-list" aria-label="Section review overview">
            {PREPARATION_SECTIONS.map(section => <li key={section}><button type="button" className="ls-guided__review-link" onClick={() => setSelected(section)}>{SECTION_WORDS[section].title}</button><span className={`ls-guided__status ls-guided__status--${preparationStatus(draft, section)}`}>{STATUS_WORDS[preparationStatus(draft, section)]}</span></li>)}
          </ul>
          {review}
        </section>
      </div>

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
    </div>
  </div>;
}
