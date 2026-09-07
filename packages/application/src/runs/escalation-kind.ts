/** The only Escalation kinds in the PoC. */
export const ESCALATION_KINDS = [
  'choose-candidate',
  'unnamed-value',
  'retry-or-skip',
] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

