"""Observe actual pixels in the deployed viewport; never change production CSS or DOM."""
from pathlib import Path
p=Path('strict-loancore-acceptance.mjs');s=p.read_text()
def replace(before,after):
    global s
    assert s.count(before)==1,(before[:120],s.count(before))
    s=s.replace(before,after,1)

helper=r'''
async function workspacePixels(image) {
  await expect(image).toBeInViewport({ratio:0.9,timeout:10000});
  const proof=await image.evaluate(async img=>{
    await img.decode();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const box=img.getBoundingClientRect(),width=window.innerWidth,height=window.innerHeight;
    const intersectionWidth=Math.max(0,Math.min(box.right,width)-Math.max(box.left,0));
    const intersectionHeight=Math.max(0,Math.min(box.bottom,height)-Math.max(box.top,0));
    const fraction=box.width>0&&box.height>0?intersectionWidth*intersectionHeight/(box.width*box.height):0;
    const centre=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    return {src:img.getAttribute('src'),decoded:img.complete&&img.naturalWidth>200,
      x:box.x,y:box.y,width:box.width,height:box.height,viewportWidth:width,viewportHeight:height,
      visibleFraction:fraction,centreUnobscured:centre===img,scrollY:window.scrollY};
  });
  assert(proof.decoded&&proof.visibleFraction>=0.9&&proof.centreUnobscured,'Workspace pixels were not visibly available to the auditor');
  return proof;
}
'''
replace('async function verifyReplayAssets(runId, prefix) {',helper+'\nasync function verifyReplayAssets(runId, prefix) {')
replace("        if(state==='RUNNING') report.checks.visibleInspection = true;\n        (report.visibleFrames??=[]).push({at:new Date().toISOString(),runId:report.runId,state,src});\n        await shot(watch, `04-watch-frame-${String(captures++).padStart(2,'0')}`); lastFrame = src;",r'''
        const stateBeforePixels=(await runs.findRun(report.runId))?.state??null;
        // No scroll or layout changes in Watch: the image must stay in the natural
        // first viewport as actual evidence rows grow beside it.
        const pixels=await workspacePixels(image);assert.equal(pixels.src,src);
        const screenshot=`04-watch-frame-${String(captures++).padStart(2,'0')}`;
        await shot(watch,screenshot);
        const stateAfterPixels=(await runs.findRun(report.runId))?.state??null;
        assert.equal(await image.getAttribute('src'),src,'Workspace frame changed during its evidence capture');
        const visibleState=stateBeforePixels==='RUNNING'&&stateAfterPixels==='RUNNING'?'RUNNING':stateAfterPixels;
        if(visibleState==='RUNNING')report.checks.visibleInspection=true;
        (report.visibleFrames??=[]).push({at:new Date().toISOString(),runId:report.runId,state:visibleState,src,pixels,screenshot,stateBeforePixels,stateAfterPixels});
        lastFrame=src;
''')
replace("    await shot(auditor,`${prefix}-screen-${String(index).padStart(2,'0')}`);",r'''
    // Selecting a Replay pill may scroll the scrubber into view. Scroll normally back
    // to the chosen image, then prove its pixels, not only its source URL.
    await image.scrollIntoViewIfNeeded();
    const pixels=await workspacePixels(image);
    (report.replayViewportProof??=[]).push({runId,prefix,index,evidenceId:frame.evidenceId,pixels});
    await shot(auditor,`${prefix}-screen-${String(index).padStart(2,'0')}`);
''')
replace("  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);",r'''
  const visible=(report.visibleFrames??[]).filter(frame=>frame.state==='RUNNING');
  report.checks.watchPixelsInViewport=visible.length>=2&&visible.every(frame=>frame.pixels?.visibleFraction>=0.9&&frame.pixels.centreUnobscured&&frame.stateBeforePixels==='RUNNING'&&frame.stateAfterPixels==='RUNNING');
  report.checks.replayPixelsInViewport=(report.replayViewportProof??[]).length>=report.replayAll.total+report.historicalReadback.total&&report.replayViewportProof.every(frame=>frame.pixels.visibleFraction>=0.9&&frame.pixels.centreUnobscured);
  report.required.push('watchPixelsInViewport','replayPixelsInViewport');
  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);
''')
p.write_text(s);Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
