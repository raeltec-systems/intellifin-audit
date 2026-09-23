import { MASKED_BY_BINDING } from '../design/copy';
import type { RecordLabelPart, RecordLabelParts } from './record-words';

/**
 * A record's label as markup (UX-25): the key, then the best permitted name.
 *
 * A masked part shows `••••` to the eye and says why to a screen reader, exactly as the
 * Exception heading always has (FR-41). The value itself never reaches this component —
 * `recordLabelParts` has already replaced it.
 */
export function RecordLabel({ parts }: { readonly parts: RecordLabelParts }): React.JSX.Element {
  return (
    <>
      <Part part={parts.key} />
      {parts.name === null ? null : <> · <Part part={parts.name} /></>}
    </>
  );
}

function Part({ part }: { readonly part: RecordLabelPart }): React.JSX.Element {
  if (!part.masked) return <>{part.text}</>;
  return (
    <>
      <span aria-hidden="true">{part.text}</span>
      <span className="ls-visually-hidden">{MASKED_BY_BINDING}</span>
    </>
  );
}
