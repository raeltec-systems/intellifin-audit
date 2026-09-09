/** CI progress contains file identities only, never SQL, test payloads or credentials. */
export default class IntegrationProgressReporter {
  onTestModuleStart(module) {
    process.stdout.write(`[integration:start] ${module.moduleId}\n`);
  }
  onTestModuleEnd(module) {
    process.stdout.write(`[integration:end] ${module.moduleId}\n`);
  }
}
