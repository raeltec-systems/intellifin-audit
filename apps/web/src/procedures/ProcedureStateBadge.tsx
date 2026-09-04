import type { ProcedureVersionState } from '@intellifin/domain';

import { StatusBadge } from '../design/StatusBadge';
import type { StatusState } from '../design/status';

/**
 * The badge for a stored Procedure Version state.
 *
 * The words `STATUS_VOCABULARY` spells the states with are mapped here, once, from the
 * domain's upper-case vocabulary: the domain stores `DRAFT`, DESIGN.md's family spells
 * it "Draft", and the mapping lives beside the badge that renders it so no two surfaces
 * render one state under two spellings. `STATUS_VOCABULARY` remains the only place a
 * word and its treatment are chosen.
 */

const STATE_WORDS: Readonly<Record<ProcedureVersionState, StatusState<'procedure-version'>>> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  RETIRED: 'Retired',
};

export function ProcedureStateBadge({
  state,
  size = 'sm',
}: {
  readonly state: ProcedureVersionState;
  readonly size?: 'sm' | 'md';
}): React.JSX.Element {
  return <StatusBadge family="procedure-version" state={STATE_WORDS[state]} size={size} />;
}
