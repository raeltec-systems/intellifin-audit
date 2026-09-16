/**
 * A person, named.
 *
 * A Run records who started, paused, cancelled or flagged it as a user ID, because an
 * address cannot enter the audit chain (`SAFE_ID_PATTERN` has no `@`). `ActorNameReader`
 * is the one place an id becomes a name, and this is the one way a surface prints what it
 * answered: the name when one is known, otherwise the id itself in monospace — which is
 * honest about what is known, and never a blank.
 */
export function ActorName({ id, names }: {
  readonly id: string;
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const name = names.get(id);
  return name === undefined ? <span className="ls-mono">{id}</span> : <>{name}</>;
}
