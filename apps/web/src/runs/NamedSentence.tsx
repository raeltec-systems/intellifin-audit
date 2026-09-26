import { Fragment } from 'react';

import { Timestamp } from '../design/Timestamp';
import { ActorName } from './ActorName';

/**
 * A sentence with a `{name}` slot, the slot filled by `ActorName` — the one way a surface
 * prints a person — and the rest of the sentence exactly as the words module holds it
 * (Story 10.10). A time slot uses the shared exact Timestamp; unresolved slots stay literal.
 */
export function NamedSentence({ sentence, id, names, at }: {
  readonly sentence: string;
  /** The person the slot names; `null` when the record names nobody. */
  readonly id: string | null;
  readonly names: ReadonlyMap<string, string>;
  /** Exact stored instant for a sentence that leaves a `{time}` slot. */
  readonly at?: string | null;
}): React.JSX.Element {
  return <>{sentence.split(/(\{name\}|\{time\})/u).map((part, index) => (
    <Fragment key={index}>
      {part === '{name}' && id !== null ? <ActorName id={id} names={names} />
        : part === '{time}' && at != null ? <Timestamp value={at} /> : part}
    </Fragment>
  ))}</>;
}
