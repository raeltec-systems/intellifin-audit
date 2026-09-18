"""Bounded browser-visible API scans; provider handles never enter browser arguments."""
from pathlib import Path
p=Path('strict-loancore-acceptance.mjs');s=p.read_text()
helper=r'''
async function scanTimelineAPI(page,runId,label) {
  const before=await facts(runId);
  const path=`/api/runs/${runId}/events?after=0`;
  const observed=await page.evaluate(async path=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
    let status=null,mediaType=null,text='';
    try {
      const response=await fetch(path,{credentials:'same-origin',signal:controller.signal});
      status=response.status;mediaType=response.headers.get('content-type');
      const reader=response.body?.getReader(),decoder=new TextDecoder();
      if(reader)try{while(text.length<262144){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
    }catch(error){if(error?.name!=='AbortError')throw new Error('Bounded timeline read failed');}
    finally{clearTimeout(timer);}
    return {status,mediaType,text};
  },path);
  assert.equal(observed.status,200);assert(observed.mediaType?.startsWith('text/event-stream'));assert(observed.text.length>0);
  checkSecretFree(observed.text);
  assert(!/X-Amz-(?:Signature|Credential)|[?&]signature=/i.test(observed.text),'Signed capability exposed');
  const item={runId,label,at:new Date().toISOString(),stateAtStart:before.run.state,status:observed.status,bytes:Buffer.byteLength(observed.text),sha256:createHash('sha256').update(observed.text).digest('hex'),secretScanPassed:true};
  (report.timelineAPIScans??=[]).push(item);
}
'''
anchor='async function verifyReplayAssets(runId, prefix) {'
assert s.count(anchor)==1;s=s.replace(anchor,helper+'\n'+anchor,1)
anchor="  await facts(report.runId); await shot(watch, '03-watch-start');"
assert s.count(anchor)==1;s=s.replace(anchor,anchor+"\n  await scanTimelineAPI(watch,report.runId,'active-watch');",1)
anchor="  const pills=auditor.locator('.ls-session__scrubber button'); await expect(pills).toHaveCount(set.total);"
assert s.count(anchor)==1;s=s.replace(anchor,"  await scanTimelineAPI(auditor,runId,prefix);\n"+anchor,1)
anchor="  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);"
assert s.count(anchor)==1;s=s.replace(anchor,"  report.checks.timelineAPISecrecy=(report.timelineAPIScans??[]).length>=3&&report.timelineAPIScans.every(scan=>scan.secretScanPassed)&&report.timelineAPIScans.some(scan=>scan.label==='active-watch'&&scan.stateAtStart==='RUNNING');\n  report.required.push('timelineAPISecrecy');\n"+anchor,1)
p.write_text(s);Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
