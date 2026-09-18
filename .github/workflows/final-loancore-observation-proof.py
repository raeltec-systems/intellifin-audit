"""Independent acceptance assertions; no application source or fixture is changed."""
from pathlib import Path
p=Path('strict-loancore-acceptance.mjs')
s=p.read_text()
anchor="  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);"
assert s.count(anchor)==1
proof=r'''
  const oracleAccounts=JSON.parse(readFileSync('fixtures/northstar/datasets/loancore-accounts.json','utf8')).accounts;
  const captured=await sql`SELECT observation_id,population_record_key,found,identity,attributes,evidence_ids,observed_at,capture_method,match_origin FROM run_observation WHERE run_id=${report.runId}::uuid ORDER BY population_record_key`;
  checkSecretFree(JSON.stringify(captured));
  assert.equal(captured.length,TRUTH_RECORDS.length);
  for(const row of captured) {
    const expected=oracleAccounts.find(account=>account.employee_id===row.population_record_key);assert(expected);
    assert.equal(row.found,'true');assert.equal(row.capture_method,'agent');
    assert.equal(row.identity?.originalValue,expected.employee_id);
    const attribute=name=>row.attributes.find(value=>value.name===name);
    assert.equal(attribute('username')?.originalValue,expected.username);
    assert.equal(attribute('account_status')?.originalValue,expected.status);
    assert.equal(attribute('roles')?.originalValue,expected.roles.join(', '));
    for(const name of ['username','account_status','roles']) {
      const value=attribute(name);assert.equal(value.corroboration,'matched');assert(value.grounding?.evidenceId);
      assert(row.evidence_ids.includes(value.grounding.evidenceId));
    }
  }
  report.capturedObservationProof=captured;report.checks.capturedFieldsMatchFixture=true;
  report.authenticationProof=await sql`SELECT action,state,attempts,diagnostic FROM run_session_step WHERE run_id=${report.runId}::uuid AND action='sign-in' ORDER BY ordinal`;
  report.safeActions=await sql`SELECT tool_action_id,action,status,outcome,capture,capture_suppression,started_at,completed_at,diagnostic FROM run_tool_action WHERE run_id=${report.runId}::uuid ORDER BY started_at,tool_action_id`;
  checkSecretFree(JSON.stringify(report.safeActions));
  report.checks.authenticationCompleted=report.authenticationProof.length===1&&report.authenticationProof.every(step=>step.state==='ACQUIRED'&&step.diagnostic===null);
  report.required.push('capturedFieldsMatchFixture','authenticationCompleted');
'''
s=s.replace(anchor,proof+'\n'+anchor,1)
s=s.replace('  // A person must inspect captured Watch and Replay evidence before the negative phase.','  // Final sign-off still requires inspection of the captured visual evidence.',1)
p.write_text(s)
Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
