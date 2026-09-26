import { ActorName } from './ActorName';
import { aroundName } from './decision-words';

/**
 * A sentence with a `{name}` slot, the slot filled by `ActorName` — the one way a surface
 * prints a person — and the rest of the sentence exactly as the words module holds it
 * (Story 10.10). A sentence with no slot, or no person to put in it, is said as it is.
 */
export function NamedSentence({ sentence, id, names }: {
  readonly sentence: string;
  /** The person the slot names; `null` when the record names nobody. */
  readonly id: string | null;
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const parts = aroundName(sentence);
  if (parts === null || id === null) return <>{sentence}</>;
  return <>{parts[0]}<ActorName id={id} names={names} />{parts[1]}</>;
}
