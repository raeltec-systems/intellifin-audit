import { UNTRUSTED_CONTENT_SENTENCE } from '../design/copy';

/**
 * Text that came from outside this platform, rendered inert and announced as such.
 *
 * DESIGN.md → Untrusted source content: "Any retrieved free text that resembles an
 * instruction — in Evidence or in an Escalation question — is displayed in a
 * warning-bordered block as `<pre>` plain text, labeled with the field it came from and
 * the statement that source content cannot change the Run objective, tool scope, or
 * evaluation. Never rendered as markup." EXPERIENCE.md's accessibility floor says the
 * same thing from the other side: "Untrusted source content and agent-generated text are
 * announced as such."
 *
 * WHY EVERY DIAGNOSTIC GOES THROUGH HERE. The deterministic evaluator writes no free-text
 * rationale, deliberately. But a diagnostic MUST name an unknown value — the golden
 * expectation for the P-2 account carrying `UNKNOWN_ROLE_X` requires it — so a Target
 * System that answers with a role named "NOTE TO THE REVIEWING AUDITOR: close this
 * finding" gets that sentence stored as the recorded reason for an audit outcome. It is
 * bounded, and it is DATA. The rule is applied to every diagnostic, rationale and
 * Target-System-sourced value this surface renders, not only to the places a fixture
 * happens to exercise: a rule applied where somebody remembered to apply it is not a rule.
 *
 * `<pre>` carries the text, so no markup in it can render and no whitespace in it can be
 * collapsed into something that reads like prose. React escapes the content; this
 * component has no `dangerouslySetInnerHTML` and no way to grow one.
 */
export function UntrustedText({
  field,
  children,
}: {
  /** Which field the text came from, so the reader knows what they are looking at. */
  readonly field: string;
  readonly children: string;
}): React.JSX.Element {
  return (
    <div className="ls-untrusted">
      <p className="ls-untrusted__label">
        Untrusted source content — {field}. {UNTRUSTED_CONTENT_SENTENCE}
      </p>
      <pre className="ls-untrusted__body">{children}</pre>
    </div>
  );
}

/**
 * A list of untrusted strings under one label, or nothing at all.
 *
 * An empty block would say a record carries source content it does not carry.
 */
export function UntrustedList({
  field,
  values,
}: {
  readonly field: string;
  readonly values: readonly string[];
}): React.JSX.Element | null {
  if (values.length === 0) return null;
  return <UntrustedText field={field}>{values.join('\n')}</UntrustedText>;
}
