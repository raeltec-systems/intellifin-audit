"""Validation-only additions; never edits a released application file."""
from pathlib import Path
p = Path('strict-loancore-acceptance.mjs')
s = p.read_text()
def replace(before, after):
    global s
    assert s.count(before) == 1, (before[:100], s.count(before))
    s = s.replace(before, after, 1)

replace("    inspection: await one(sql`SELECT status,diagnostic FROM run_agent_work WHERE run_id=${runId}::uuid`),",
        "    inspection: await one(sql`SELECT status,diagnostic FROM run_agent_work WHERE run_id=${runId}::uuid`),\n    modelIdentity: await one(sql`SELECT model->>'provider' AS provider,model->>'modelId' AS model_id FROM run_agent_work WHERE run_id=${runId}::uuid`),")
replace("      report.frames.push(frame); emit('verified-frame-delivered', { digest: frame.digest, bytes: frame.bytes });",
        "      frame.state=(await runs.findRun(report.runId))?.state??null;\n      checkSecretFree(bytes.toString('latin1'));\n      writeFileSync(`${OUT}/watch-asset-${url.pathname.split('/').at(-1)}.png`,bytes);\n      report.frames.push(frame); emit('verified-frame-delivered', { digest: frame.digest, bytes: frame.bytes, state:frame.state });")

helpers = r'''
async function verifyReplayAssets(runId, prefix) {
  const released=await facts(runId); assert.equal(released.workspace?.status,'RELEASED');
  const set=await detail.readFrames(runId); assert(set.total>0); assert.equal(set.rows.length,set.total);
  checkSecretFree(JSON.stringify(set.rows));
  const links=await sql`SELECT c.evidence_id,w.subject_key FROM run_evidence_capture c JOIN run_tool_action a ON a.tool_action_id=c.tool_action_id AND a.run_id=c.run_id LEFT JOIN run_step_execution s ON s.step_execution_id=a.step_execution_id AND s.run_id=a.run_id LEFT JOIN run_work_item w ON w.work_item_id=coalesce(s.work_item_id,a.work_item_id) AND w.run_id=a.run_id WHERE c.run_id=${runId}::uuid`;
  const subjects=new Map(links.map(row=>[row.evidence_id,row.subject_key]));
  await auditor.goto(`${BASE}/runs/${runId}/replay`,{waitUntil:'domcontentloaded'});
  const pills=auditor.locator('.ls-session__scrubber button'); await expect(pills).toHaveCount(set.total);
  const image=auditor.locator('img.ls-session__frame');
  const rows=[];
  for(let index=0;index<set.rows.length;index++) {
    const frame=set.rows[index];
    if(index>0)assert(Date.parse(frame.actionStartedAt)>=Date.parse(set.rows[index-1].actionStartedAt),'Replay order is not chronological');
    await pills.nth(index).click();
    const path=`/api/runs/${runId}/frames/${frame.evidenceId}`;
    await expect(image).toHaveAttribute('src',path);
    await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>200),{timeout:30000}).toBe(true);
    const response=await auditor.request.get(BASE+path,{timeout:30000}); assert.equal(response.status(),200);
    assert.equal(response.headers()['content-type'],'image/png');
    const bytes=await response.body(); const digest=createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest,frame.digest);assert.equal(bytes.length,frame.size);checkSecretFree(bytes.toString('latin1'));
    writeFileSync(`${OUT}/${prefix}-asset-${String(index).padStart(2,'0')}.png`,bytes);
    await shot(auditor,`${prefix}-screen-${String(index).padStart(2,'0')}`);
    rows.push({evidenceId:frame.evidenceId,action:frame.action,actionStartedAt:frame.actionStartedAt,capturedAt:frame.capturedAt,record:subjects.get(frame.evidenceId)??null,digest,bytes:bytes.length,decoded:true,httpStatus:200});
  }
  return {runId,workspaceReleasedBeforeRead:true,total:set.total,rows};
}
async function historicalReadback() {
  const runId='01a0b39a-9c62-7671-a424-994f989f6880';
  const before=await sql`SELECT evidence_id,digest,size,media_type FROM run_evidence WHERE run_id=${runId}::uuid AND state='REGISTERED' ORDER BY evidence_id`;
  const result=await verifyReplayAssets(runId,'historical-replay');
  await auditor.goto(`${BASE}/runs/${runId}/evidence`,{waitUntil:'domcontentloaded'});
  const links=await auditor.locator(`a[href^="/runs/${runId}/evidence/"]`).evaluateAll(nodes=>[...new Set(nodes.map(n=>n.getAttribute('href')))]);
  assert(links.length>0);result.snapshotLinks=[];
  for(const href of links){
    await auditor.goto(BASE+href,{waitUntil:'domcontentloaded'});
    const text=await auditor.locator('body').innerText();checkSecretFree(text);
    assert(!text.includes('Snapshot cell unavailable')&&!text.includes("Couldn't load this page."));
    assert(await auditor.getByRole('heading',{level:1}).count()>0);result.snapshotLinks.push({href,opened:true});
  }
  await shot(auditor,'historical-snapshot-readable');
  const after=await sql`SELECT evidence_id,digest,size,media_type FROM run_evidence WHERE run_id=${runId}::uuid AND state='REGISTERED' ORDER BY evidence_id`;
  assert.deepEqual(after,before);result.registeredEvidenceUnchanged=true;return result;
}
async function negativeDigest() {
  const catalog=JSON.parse(readFileSync('fixtures/northstar/datasets/systems.json','utf8'));
  const source=catalog.population_source_bindings.find(row=>row.id==='leavers-export-versioned');assert(source);
  const response=await fetch(TARGET+source.location_path,{redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());
  return createHash('sha256').update(bytes).digest('hex');
}
'''
replace('async function facts(runId) {', helpers + '\nasync function facts(runId) {')
replace("  const clean = await authorApproveAndRun", "  report.negativeSourceBefore=await negativeDigest();\n  const clean = await authorApproveAndRun")
replace("  report.required.push('sectionPersistence','planSucceeded','watchChangingWhileRunning');", r'''
  report.checks.approvedOpenAIProvider=report.facts?.modelIdentity?.provider==='openai'&&report.facts?.modelIdentity?.model_id==='gpt-5.6';
  report.replayAll=await verifyReplayAssets(report.runId,'complete-replay');
  report.checks.replayEveryFrameDecoded=report.replayAll.rows.every(row=>row.decoded&&row.httpStatus===200);
  report.checks.replayCoversEveryRecord=TRUTH_RECORDS.every(record=>report.replayAll.rows.some(row=>row.record===record));
  const deliveredRunning=new Set(report.frames.filter(row=>row.state==='RUNNING').map(row=>row.path.split('/').at(-1)));
  const visibleRunning=new Set((report.visibleFrames??[]).filter(row=>row.state==='RUNNING').map(row=>row.src.split('/').at(-1)));
  const watched=report.replayAll.rows.filter(row=>deliveredRunning.has(row.evidenceId)&&visibleRunning.has(row.evidenceId));
  report.watch.runningDistinctScreens=new Set(watched.map(row=>row.digest)).size;
  report.watch.recordsWatched=[...new Set(watched.map(row=>row.record).filter(Boolean))];
  report.checks.watchChangingWhileRunning=report.watch.runningDistinctScreens>=2;
  report.checks.watchEveryRecord=TRUTH_RECORDS.every(record=>report.watch.recordsWatched.includes(record));
  report.historicalReadback=await historicalReadback();
  report.checks.historicalEvidenceReadable=report.historicalReadback.registeredEvidenceUnchanged&&report.historicalReadback.snapshotLinks.every(row=>row.opened);
  report.required.push('sectionPersistence','planSucceeded','watchChangingWhileRunning','approvedOpenAIProvider','replayEveryFrameDecoded','replayCoversEveryRecord','watchEveryRecord','historicalEvidenceReadable');
''')
replace("  report.negativeDeferred='Positive Watch/replay visual review must complete first';", r'''
  if(report.positiveAutomatedChecksPassed) {
    await negativeCase();
    const terminal=await poll(()=>facts(report.negative.runId),f=>f.workspace===null||f.workspace.status==='RELEASED',90000);
    report.negative.workspace=terminal.workspace;report.negative.population=terminal.population;
    report.negative.version=draftEvidence(await readDraft(report.negative.procedureId));
    report.negativeSourceAfter=await negativeDigest();
    report.checks.negativeSourceUnchanged=report.negativeSourceBefore===report.negativeSourceAfter;
    report.required.push('defectivePopulationRefused','negativeSourceUnchanged');
  } else report.negativeDeferred='Positive automated checks did not all pass';
''')
replace("  report.phaseComplete=report.positiveAutomatedChecksPassed===true;", "  report.phaseComplete=report.positiveAutomatedChecksPassed===true&&report.required.every(name=>report.checks[name]===true);")
replace("  report.finishedAt = new Date().toISOString();", "  report.providerChange={ownerApproved:true,provider:'openai',model:'gpt-5.6'};\n  report.finishedAt = new Date().toISOString();")
p.write_text(s)
Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
