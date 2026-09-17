from pathlib import Path
import json
import subprocess

root = Path('.')
p = root / 'tests/e2e/live-view.spec.ts'
s = p.read_text()
old = "    await expect(page.getByText('sess_live_view')).toBeVisible();"
assert s.count(old) == 1
p.write_text(s.replace(old, """    await expect(page.locator('.ls-session__workspace')).toContainText(`workspace-${seeded.runId}`);
    // The worker keeps its operational handle, but HTML/RSC must not expose it.
    expect(await page.content()).not.toContain('sess_live_view');
    const [workspace] = await sql`SELECT workspace_id FROM run_workspace WHERE run_id=${seeded.runId}`;
    expect(workspace?.workspace_id).toBe('sess_live_view');"""))

p = root / 'CLAUDE.md'
p.write_text("""## 2026-09-17 — Verify the public reference, not the provider capability

The Live View browser test still expected the provider handle after redaction.
Require the platform workspace reference, reject the handle anywhere in HTML/RSC,
and prove that the operational row still retains it for the worker. Never restore a
capability to satisfy an obsolete display assertion.

The separate three-record live acceptance population preserves canonical HR rows and
leaves the defective full export unchanged. Expected findings are test-only data,
never source CSV fields or agent prompts. A valid source is not an all-compliant source:
E-000103 deliberately retains Active access.

""" + p.read_text())

golden = json.loads(Path('fixtures/northstar/datasets/leavers-export.json').read_text())
keys = ['E-000102', 'E-000103', 'E-000105']
rows = []
for key in keys:
    found = [row for row in golden['rows'] if row['employee_id'] == key]
    assert len(found) == 1
    rows.append(found[0])
live = {
    'synthetic': golden['synthetic'], 'dataset_id': 'leavers-live-acceptance',
    'title': 'Leaver access — separate live acceptance population',
    'generation': '2026-09-01.live-acceptance-1',
    'effective_period': {'from': '2026-08-01', 'to': '2026-08-31'},
    'declared_schema': golden['declared_schema'],
    'note': 'Separate canonical HR rows. The full adversarial export is unchanged. No target findings in this source.',
    'rows': rows,
}
Path('fixtures/northstar/datasets/leavers-live-acceptance.json').write_text(json.dumps(live, indent=2, ensure_ascii=False) + '\n')
p = Path('fixtures/northstar/generate.py')
s = p.read_text()
anchor = "    # The seeded INCOMPLETE population: the full export's cover sheet over a short file."
assert s.count(anchor) == 1
p.write_text(s.replace(anchor, """    # Distinct acceptance source; no repair of the negative fixture.
    live = read_dataset("leavers-live-acceptance.json")
    live_schema = live["declared_schema"]
    live_rows = [[row[field] for field in live_schema] for row in live["rows"]]
    live_payload = csv_bytes(live_schema, live_rows, live["title"], live["generation"])
    write_bytes("leavers-live-acceptance.csv", live_payload)
    write_json("leavers-live-acceptance.cover-sheet.json", cover_sheet(
        source=live["dataset_id"], covers="leavers-live-acceptance.csv",
        title=live["title"], generation=live["generation"],
        effective_period=live["effective_period"], row_count=len(live_rows),
        payload=live_payload, declared_schema=live_schema,
        generated_at=CURRENT_FILE_GENERATED_AT,
    ))

""" + anchor))
subprocess.run(['python3', 'fixtures/northstar/generate.py'], check=True)
p = Path('apps/northstar/src/files.ts')
s = p.read_text()
anchor = 'export const ARTIFACTS: ReadonlyMap<string, Artifact> = new Map([\n'
assert s.count(anchor) == 1
p.write_text(s.replace(anchor, anchor + """  ['leavers-live-acceptance.csv', {
    file: 'leavers-live-acceptance.csv', contentType: CSV,
    description: 'Separate three-record leaver population for live browser acceptance.',
  }],
  ['leavers-live-acceptance.cover-sheet.json', {
    file: 'leavers-live-acceptance.cover-sheet.json', contentType: JSON_TYPE,
    description: 'Independent count, digest and effective period for the acceptance population.',
  }],
"""))
p = Path('fixtures/northstar/datasets/systems.json')
s = p.read_text()
catalogue = json.loads(s)
binding = next(row.copy() for row in catalogue['population_source_bindings'] if row['id'] == 'leavers-export-versioned')
binding.update({
    'id': 'leavers-live-acceptance',
    'display_name': 'Leavers — live acceptance (three canonical records)',
    'location_path': '/files/leavers-live-acceptance.csv',
    'note': 'Separate complete population for LoanCore browser acceptance. Full export preserved for negative tests.',
})
ending = '\n  ]\n}\n'
assert s.endswith(ending)
p.write_text(s[:-len(ending)] + ',\n' + '\n'.join('    ' + line for line in json.dumps(binding, indent=2, ensure_ascii=False).splitlines()) + ending)

oracle = {
    'synthetic': golden['synthetic'],
    'scope': 'Separate three-record population, LoanCore, August 2026. C1 exact Disabled/Active; C2 explicit canonical privilege policy. No 24-hour condition is asserted.',
    'expected_c1': {'E-000102': 'COMPLIANT', 'E-000103': 'EXCEPTION', 'E-000105': 'COMPLIANT'},
    'expected_c2_with_canonical_policy': {key: 'COMPLIANT' for key in keys},
    'expected_outcome_after_required_human_confirmation': 'CONTROL_FAILURE',
    'inspection_count': 3,
    'note': 'Independent oracle. Never serve to, import into, or quote to the audit agent.',
}
Path('fixtures/northstar/expectations/p-1-live-acceptance.json').write_text(json.dumps(oracle, indent=2, ensure_ascii=False) + '\n')
p = Path('apps/northstar/src/fixtures.test.ts')
p.write_text(p.read_text() + r'''

describe('the separate live LoanCore population', () => {
  const live = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'datasets', 'leavers-live-acceptance.json'), 'utf8')) as {
    rows: { employee_id: string; employment_status: string; termination_effective_date: string }[];
  };
  it('contains three unique, complete canonical rows and preserves the negative source', () => {
    expect(live.rows.map(row => row.employee_id)).toEqual(['E-000102', 'E-000103', 'E-000105']);
    expect(new Set(live.rows.map(row => row.employee_id)).size).toBe(3);
    for (const row of live.rows) {
      expect(datasets.leavers().rows.filter(source => source.employee_id === row.employee_id)).toEqual([row]);
      expect(row.employment_status).toBe('Terminated');
      expect(row.termination_effective_date).toMatch(/^2026-08-\d{2}$/);
      expect(datasets.loancore().accounts.filter(account => account.employee_id === row.employee_id)).toHaveLength(1);
    }
    expect(datasets.leavers().rows.filter(row => row.employee_id === 'E-000107')).toHaveLength(2);
  });
  it('has disabled and active accounts without adversarial page behavior', () => {
    const accounts = live.rows.map(row => datasets.loancore().accounts.find(account => account.employee_id === row.employee_id)!);
    expect(accounts.map(account => account.status)).toEqual(['Disabled', 'Active', 'Disabled']);
    expect(accounts.every(account => account.page_behaviour === 'normal')).toBe(true);
  });
  it('publishes only the HR source and its declaration, never the answer oracle', () => {
    expect(ARTIFACTS.has('leavers-live-acceptance.csv')).toBe(true);
    expect(ARTIFACTS.has('leavers-live-acceptance.cover-sheet.json')).toBe(true);
    expect(ARTIFACTS.has('p-1-live-acceptance.json')).toBe(false);
    expect(readFileSync(join(GENERATED, 'leavers-live-acceptance.csv'), 'utf8'))
      .not.toMatch(/COMPLIANT|EXCEPTION|CONTROL_FAILURE|PENDING_CONFIRMATION/);
    expect(readSheet('leavers-live-acceptance.cover-sheet.json').row_count).toBe(3);
  });
});
''')
subprocess.run(['git', 'add', '-N', '.'], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
