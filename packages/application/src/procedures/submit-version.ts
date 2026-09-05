import { transitionVersion, type VersionTransitionInput } from './decide-version.js';
import type { ProcedureDependencies } from './create-procedure.js';
export { submissionUnavailableReason } from './submission-guard.js';
export function submitVersion(dependencies: ProcedureDependencies, input: VersionTransitionInput) {
  return transitionVersion(dependencies, input, 'submit');
}
