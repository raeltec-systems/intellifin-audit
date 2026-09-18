"""Use an honest negative-case scope; the source bytes and domain rules remain unchanged."""
from pathlib import Path
p=Path('strict-loancore-acceptance.mjs');s=p.read_text()
def replace(before,after):
    global s
    assert s.count(before)==1,(before[:120],s.count(before))
    s=s.replace(before,after,1)
replace("const OUT = 'deployed-loancore-evidence';", "let authoredScope=SCOPE;\nconst OUT = 'deployed-loancore-evidence';")
replace("row.scope===SCOPE;", "row.scope===authoredScope;")
replace("async function authorApproveAndRun({ control, sourceName, prefix, accounts }) {", "async function authorApproveAndRun({ control, sourceName, prefix, accounts }) {\n  authoredScope=prefix?'The original synthetic August 2026 leavers export, declared as 27 records, checked in LoanCore only. This negative regression must refuse unresolved population identity and invalid source dates rather than manufacture observations.':SCOPE;")
replace("await auditor.getByLabel('Scope statement').fill(SCOPE);", "await auditor.getByLabel('Scope statement').fill(authoredScope);")
p.write_text(s);Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
