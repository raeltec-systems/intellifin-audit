import json,re
from pathlib import Path
log=Path('/tmp/zobba-story-21-2/repair-1/rust-tests.txt')
current=''
sections=[]
for line_no,line in enumerate(log.read_text().splitlines(),1):
    if line.lstrip().startswith(('Running ','Doc-tests ')):
        current=line.strip()
    if line.startswith('test result:'):
        sections.append({'section':current,'line':line_no,'result':line})
Path('/tmp/zobba-story-21-2/repair-1/rust-results.json').write_text(json.dumps(sections,indent=2)+'\n')
counts=[int(re.search(r'(\d+) passed', s['result']).group(1)) for s in sections]
print(f'{len(sections)} sections; {sum(counts)} passed assertions/test cases (including doc tests).')
for section in sections:
    print(f"{section['line']}: {section['section']} — {section['result']}")
