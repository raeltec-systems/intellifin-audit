import { Icon } from './Icon';

/**
 * The standing disclaimer, verbatim from DESIGN.md → Layout & Spacing.
 *
 * It is one exported constant rather than inline copy so that a test, a later surface,
 * or an export header can quote the same sentence instead of paraphrasing it. The
 * prototype's wording predates the Population Source / Target System split; this is
 * the sentence that ships.
 */
export const ENVIRONMENT_RIBBON_SENTENCE =
  'Synthetic PoC environment — Population Sources and Target Systems are read-only synthetic systems. Results are not assurance conclusions.';

/**
 * The `{spacing.ribbon}` ribbon above the top bar, for the whole PoC.
 *
 * Not a live region and not dismissible: it states a permanent property of this
 * deployment, so it must be present on every page rather than announced once.
 */
export function EnvironmentRibbon(): React.JSX.Element {
  return (
    <div className="ls-ribbon">
      <Icon name="alert-triangle" size={14} />
      <p>{ENVIRONMENT_RIBBON_SENTENCE}</p>
    </div>
  );
}
