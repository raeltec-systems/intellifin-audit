import type { TemplateId } from '@intellifin/domain';

import { TechnicalDetails } from '../design/TechnicalDetails';
import { CONDITION_NOT_IN_WORDS, conditionSentence } from '../procedures/condition-words';

/**
 * One Compliance Rule criterion, said the way an auditor says it
 * (UI cleanup 2026-09-22, UX-21).
 *
 * The walkthrough met `found = false or account_status in [Disabled] else [Active]` as the
 * PRIMARY text of the Exception view — the compiler's own grammar in front of a person who
 * has to explain the finding to somebody else. `conditionSentence` is the one place that
 * grammar becomes a sentence, and it is package 1's module, shared with the Builder, so
 * the criterion a person approved and the criterion a finding cites read alike.
 *
 * A criterion the simple reader cannot express — compiler grammar the editor never offered,
 * or free prose a Template pinned — gets `null` from it, and then this says so in
 * `CONDITION_NOT_IN_WORDS` and shows the approved text inert, as what it is. It is never a
 * sentence this module guessed at.
 *
 * The approved text is NOT rendered as untrusted source content. It is the auditor's own
 * frozen authoring input, and `UntrustedText`'s label states that the text came from outside
 * this platform — a false statement about this value's provenance, which is worse than no
 * label. It is rendered inert as `<pre>`, which is the part of that treatment this text
 * actually needs, and the compiled text rides under Technical details.
 */
export function Criterion({
  conditionId,
  text,
  templateId,
  technical = true,
}: {
  readonly conditionId: string;
  /** The frozen authored text, or `null` when the plan could not be read. */
  readonly text: string | null;
  /** The frozen Template, or `null`; without it no sentence can be derived. */
  readonly templateId: TemplateId | null;
  /** Whether the compiled text rides under a Technical details disclosure of its own. */
  readonly technical?: boolean;
}): React.JSX.Element {
  const sentence = text === null || templateId === null ? null : conditionSentence(text, templateId, conditionId);
  return (
    <div className="ls-criterion ls-stack">
      {sentence === null ? (
        <>
          <p className="ls-criterion__sentence">{CONDITION_NOT_IN_WORDS}</p>
          {text === null ? null : <pre className="ls-criterion__text">{text}</pre>}
        </>
      ) : (
        <p className="ls-criterion__sentence">{sentence}</p>
      )}
      {!technical ? null : (
        <TechnicalDetails
          items={[
            { label: 'Condition identifier', value: conditionId, mono: true },
            ...(text === null || sentence === null ? [] : [{ label: 'Criterion as approved', value: text, mono: true }]),
          ]}
        />
      )}
    </div>
  );
}
