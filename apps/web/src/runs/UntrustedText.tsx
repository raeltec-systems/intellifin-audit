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
 * HOW OFTEN IT IS SAID (UI cleanup 2026-09-22, UX-27). The walkthrough met the policy
 * sentence four times on one Replay frame — under the rationale, the captured values, the
 * URL and the Replay action — so the warning that exists to make a reader look carefully
 * became the page's most repeated line. The rule is unchanged and nothing is weakened: a
 * surface that renders SEVERAL untrusted blocks says the sentence ONCE, in an
 * `UntrustedRegion` caption above them, and each block keeps its own short source label.
 * A surface with a single block still says it on the block, which is why `policy` defaults
 * to `true` and an omission cannot quietly drop the statement.
 *
 * `<pre>` carries the text, so no markup in it can render and no whitespace in it can be
 * collapsed into something that reads like prose. React escapes the content; this
 * component has no `dangerouslySetInnerHTML` and no way to grow one.
 */
export function UntrustedText({
  field,
  children,
  policy = true,
}: {
  /** Which field the text came from, so the reader knows what they are looking at. */
  readonly field: string;
  readonly children: string;
  /**
   * Whether this block states the policy itself. `false` only where an
   * `UntrustedRegion` above it has already said it for the whole set.
   */
  readonly policy?: boolean;
}): React.JSX.Element {
  return (
    <div className="ls-untrusted">
      <p className="ls-untrusted__label">
        Untrusted source content — {field}.{policy ? ` ${UNTRUSTED_CONTENT_SENTENCE}` : ''}
      </p>
      <pre className="ls-untrusted__body">{children}</pre>
    </div>
  );
}

/**
 * The policy sentence, said once above a set of untrusted blocks (UX-27).
 *
 * It is a real paragraph rather than a `title` or a tooltip, and it sits immediately above
 * the blocks it governs, so a reader meets it before the content it is about. The heading
 * is the caller's: this is the statement, not a section.
 */
export function UntrustedRegion({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ls-untrusted-region">
      <UntrustedPolicy />
      {children}
    </div>
  );
}

/**
 * The policy sentence on its own, for a surface whose untrusted blocks are not siblings —
 * the session viewers' rails, whose blocks sit in separate sections under one heading
 * each. It is said once, before the first of them, exactly as `UntrustedRegion` says it.
 */
export function UntrustedPolicy(): React.JSX.Element {
  return <p className="ls-untrusted-region__policy">{UNTRUSTED_CONTENT_SENTENCE}</p>;
}

/**
 * A list of untrusted strings under one label, or nothing at all.
 *
 * An empty block would say a record carries source content it does not carry.
 */
export function UntrustedList({
  field,
  values,
  policy = true,
}: {
  readonly field: string;
  readonly values: readonly string[];
  readonly policy?: boolean;
}): React.JSX.Element | null {
  if (values.length === 0) return null;
  return <UntrustedText field={field} policy={policy}>{values.join('\n')}</UntrustedText>;
}
