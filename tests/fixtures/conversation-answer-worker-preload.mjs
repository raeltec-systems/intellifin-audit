// Test-only target substitution plus synthetic provider responses. No database rows,
// snapshots, waits, options or Observations are seeded by this preload. The compiled
// worker signs in to Northstar and Chromium captures the substituted search response.
import './agent-evaluation-worker-preload.mjs';
import { PlaywrightBrowserExecution } from '../../packages/infrastructure/dist/runs/browser-execution.js';

const runId = process.env.CONVERSATION_ANSWER_RUN_ID;
const targetOrigin = process.env.CONVERSATION_ANSWER_TARGET_ORIGIN;
const fullName = process.env.CONVERSATION_ANSWER_FULL_NAME;
if (!runId || !targetOrigin || !fullName) throw new Error('Missing synthetic answer fixture binding.');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const create = PlaywrightBrowserExecution.prototype.create;
PlaywrightBrowserExecution.prototype.create = async function (input) {
  const workspace = await create.call(this, input);
  if (workspace.ref.runId !== runId) return workspace;
  // Native form submission includes the unused Full name control as `name=`. Keep
  // that exact empty control in scope, while refusing additional/nonempty inputs.
  await workspace.context.route(url => url.origin === targetOrigin && url.pathname === '/loancore/users' &&
    url.searchParams.getAll('employee_id').length === 1 && url.searchParams.get('employee_id') === 'E-000102' &&
    url.searchParams.getAll('name').length <= 1 &&
    [...url.searchParams].every(([key, value]) => key === 'employee_id' || (key === 'name' && value === '')), async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const original = await response.text();
    // Require the real authenticated Northstar result, not a login redirect or a
    // fabricated authentication success, before substituting its synthetic records.
    if (response.status() !== 200 || new URL(response.url()).pathname !== '/loancore/users' ||
        !original.includes('E-000102') || !original.includes('Showing 1 of 1 matching accounts.')) {
      throw new Error('Expected the authenticated synthetic LoanCore search result.');
    }
    const rows = [
      ['answer-unselected', 'Active', 'SYSTEM_ADMIN'],
      ['answer-selected', 'Disabled', 'LOAN_VIEWER'],
    ].map(([username, status, roles]) => `<tr><td>E-000102</td><td>${escape(fullName)}</td><td>${username}</td><td>${status}</td><td>${roles}</td></tr>`).join('');
    const body = `<!doctype html><html lang="en"><head><title>Synthetic LoanCore duplicate account fixture</title></head><body>
      <h1>LoanCore</h1><h2>Search results</h2><p>Showing 2 of 2 matching accounts.</p>
      <table><caption>Accounts matching employee ID E-000102</caption><thead><tr><th>Employee ID</th><th>Full name</th><th>Username</th><th>Status</th><th>Roles</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    await route.fulfill({ response, body, contentType: 'text/html; charset=utf-8' });
    process.stdout.write('Synthetic conversation answer target:duplicate-search-substituted\n');
  });
  return workspace;
};
