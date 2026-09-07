/**
 * The labels a P-4 Target System must freeze before this producer can offer a read.
 *
 * P-4 has no Template-level label map (`declaredAttributeLabels` is null). The frozen
 * registration is therefore the authority for the page labels. These names are the
 * shipped P-4 contract, but the producer still checks that each is present in the frozen
 * Target System rather than manufacturing a label or accepting a page label by similarity.
 */
export const PROD_CONSOLE_LABELS = {
  parameter: 'Parameter',
  value: 'Value',
  snapshotIdentifier: 'Snapshot identifier',
  expectedParameterCount: 'Expected parameter count',
  snapshotTakenAt: 'Snapshot taken at',
} as const;

