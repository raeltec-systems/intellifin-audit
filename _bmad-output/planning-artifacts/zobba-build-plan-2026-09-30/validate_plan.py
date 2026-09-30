#!/usr/bin/env python3
"""Validate planning structure and traceability; performs no runtime qualification."""
from pathlib import Path
import hashlib, json, re
D=Path(__file__).resolve().parent
EP=D.parent/'epics.md'
graph=json.loads((D/'dependencies.json').read_text())
coverage=json.loads((D/'coverage.json').read_text())
text=EP.read_text()
nodes={n['id']:n for n in graph['nodes']}
assert len(nodes)==len(graph['nodes'])==55, 'story identity/count mismatch'
blocks={m.group(1):m.group(2) for m in re.finditer(r'^### Story (\d+\.\d+): ([\s\S]*?)(?=^### Story |^## Epic |\Z)',text,re.M)}
assert set(blocks)==set(nodes), 'canonical backlog and graph differ'
for sid,n in nodes.items():
 b=blocks[sid]
 for label in ['Requirements','Depends on','Scope','Non-goals','Acceptance Criteria','Validation']:
  assert '**'+label+':**' in b,(sid,label)
 assert all(token in b for token in ['As an ','I want ','So that ','**Given**','**when**','**then**']),sid
 deps=re.findall(r'\d+\.\d+',re.search(r'\*\*Depends on:\*\* ([^\n]+)',b).group(1))
 assert deps==n['depends_on'],('dependency mismatch',sid)
 reqline=re.search(r'\*\*Requirements:\*\* ([^\n]+)',b).group(1)
 for f in ['requirements','capabilities','quality','ux']:
  assert all(r in reqline for r in n[f]),('missing story requirement',sid,f)
 for dep in deps:
  assert dep in nodes,('unknown',sid,dep)
  if sid.split('.')[0]==dep.split('.')[0]:assert int(dep.split('.')[1])<int(sid.split('.')[1]),('forward within epic',sid,dep)
order=graph['topological_order']; assert set(order)==set(nodes) and len(order)==len(nodes)
rank={s:i for i,s in enumerate(order)}
expected_edges={(d,s) for s,n in nodes.items() for d in n['depends_on']}
assert expected_edges=={(e['from'],e['to']) for e in graph['edges']}
assert len(expected_edges)==143
assert all(rank[a]<rank[b] for a,b in expected_edges),'cycle or invalid topological order'
for sid in graph['first_batch']:assert set(nodes[sid]['depends_on'])<=set(graph['first_batch'])
def closure(sid):
 seen=set()
 def walk(s):
  if s in seen:return
  seen.add(s)
  for d in nodes[s]['depends_on']:walk(d)
 walk(sid);return seen
for g in graph['gates']:
 if 'exit_story' in g:assert set(g['required_stories'])==closure(g['exit_story']),g['id']
assert {'20.7','27.4'}<=closure('25.4')
required=[*(f'FR-{n}' for n in range(97,141)),*(f'NFR-{n}' for n in range(18,32)),*(f'CAP-{n}' for n in range(17,31)),*(f'UX-DR{n}' for n in range(42,50))]
assert set(required)==set(coverage['requirements'])
for r,record in coverage['requirements'].items():
 actual={s for s,n in nodes.items() if r in n['requirements']+n['capabilities']+n['quality']+n['ux']}
 assert actual and actual==set(record['stories']),r
legacy=json.loads((D/'legacy/archive-metadata.json').read_text())
old=(D/'legacy/epics-before-rev3.md').read_bytes()
assert hashlib.sha256(old).hexdigest()==legacy['source_sha256'],'legacy bytes mismatch'
print(json.dumps({'ok':True,'kind':'planning-structure-only','epics':9,'stories':55,'dependency_edges':143,'requirements':80,'first_batch':graph['first_batch'],'runtime_tests_run':False},indent=2))
