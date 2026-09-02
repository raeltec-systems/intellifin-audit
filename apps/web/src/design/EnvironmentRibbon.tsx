import { ENVIRONMENT_RIBBON_SENTENCE } from './copy';
import { Icon } from './Icon';

export { ENVIRONMENT_RIBBON_SENTENCE };

/**
 * The `{spacing.ribbon}` ribbon above the top bar, for the whole PoC.
 *
 * The sentence is a quotation, so it lives in `copy.ts` where `copy.test.ts` pins it
 * against DESIGN.md on disk. Nothing here retypes it.
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
