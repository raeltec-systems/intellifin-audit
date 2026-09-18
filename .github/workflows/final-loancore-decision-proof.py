"""Require the database decisions to identify the same distinct users who used the UI."""
from pathlib import Path
p=Path('strict-loancore-acceptance.mjs');s=p.read_text()
def replace(before,after):
    global s
    assert s.count(before)==1,(before[:120],s.count(before))
    s=s.replace(before,after,1)
replace("  if(!prefix) report.submitted=draftEvidence(submitted);", "  assert.equal(submitted.authorship?.createdBy?.id,accounts.auditor.userId);\n  assert(submitted.decisions.some(decision=>decision.decision==='submit'&&decision.actorId===accounts.auditor.userId&&decision.priorState==='DRAFT'));\n  if(!prefix) report.submitted=draftEvidence(submitted);")
replace("  if(!prefix) report.approved=draftEvidence(approved);", "  assert(approved.decisions.some(decision=>decision.decision==='approve'&&decision.actorId===accounts.manager.userId&&decision.priorState==='SUBMITTED'));\n  assert(!approved.authorship.humanAuthorIds.includes(accounts.manager.userId));\n  assert.notEqual(accounts.manager.userId,accounts.auditor.userId);\n  if(!prefix){report.approved=draftEvidence(approved);report.checks.approvalActorsPersisted=true;}")
replace("  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);", "  report.required.push('approvalActorsPersisted');\n  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);")
p.write_text(s);Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
