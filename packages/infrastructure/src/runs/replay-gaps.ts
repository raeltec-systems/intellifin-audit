import { sql, type SQL } from 'drizzle-orm';

/**
 * Which Tool Actions leave a gap in a Run's Replay, and why (Story 5.2's
 * `failure.frame-missing`; Story 10.6, legacy 5.2).
 *
 * ONE definition of a missing frame, read by the terminal transition that records
 * `failure.frame-missing` and counts `framesMissing` on the Result, and by Replay, which
 * marks each gap where it sits in the session. Two copies of this predicate would agree on
 * every case anybody tried and diverge on the first one nobody did — and the divergence
 * would be a Replay that disagreed with the Result it replays.
 *
 * A suppressed capture is a DIFFERENT fact and has its own predicate. The platform withheld
 * the frame on purpose while a credential was on the wire (AD-4), so counting it as missing
 * would raise a finding against the guarantee that produced it.
 *
 * `action` names the `run_tool_action` relation in the caller's query — the bare table name
 * or an alias. It is written out rather than interpolated as a Drizzle column, because a
 * correlated subquery must keep its outer qualifier (the "Correlated subqueries must retain
 * the outer SQL qualifier" rule): the NOT EXISTS below compares the INNER capture row with
 * the OUTER action, and an unqualified column there would compare a row with itself.
 */
const IDENTIFIER = /^(?:[a-z_][a-z0-9_]*|"[a-z_][a-z0-9_]*")$/;

function relation(action: string): SQL {
  // A trusted identifier chosen in this package, never request input; refused otherwise so
  // `sql.raw` can never carry anything but a relation name.
  if (!IDENTIFIER.test(action)) throw new Error('Replay gap predicates take a relation name.');
  return sql.raw(action);
}

/** A performed, capture-PERMITTED Tool Action with no REGISTERED screenshot bound to it. */
export function frameMissingPredicate(action: string): SQL {
  const a = relation(action);
  return sql`(${a}.outcome = 'performed'
    AND ${a}.capture = 'PERMITTED'
    AND NOT EXISTS (
      SELECT 1 FROM run_evidence_capture gap_capture
      JOIN run_evidence gap_evidence ON gap_evidence.evidence_id = gap_capture.evidence_id
      WHERE gap_capture.tool_action_id = ${a}.tool_action_id
        AND gap_evidence.kind = 'screenshot'
        AND gap_evidence.state = 'REGISTERED'))`;
}

/**
 * A performed Tool Action whose capture the platform SUPPRESSED (generation 29).
 *
 * `performed` for the same reason the missing predicate says it: an action the gate refused
 * never reached a screen, so there was nothing to withhold and no position in the session.
 */
export function captureSuppressedPredicate(action: string): SQL {
  const a = relation(action);
  return sql`(${a}.outcome = 'performed' AND ${a}.capture = 'SUPPRESSED')`;
}
