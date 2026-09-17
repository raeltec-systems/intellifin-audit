from pathlib import Path
p = Path('packages/application/src/runs/provision-workspace.test.ts')
s = p.read_text()
a = "diagnostic: 'workspace-release-failed',\n      workspaceId: 'ws-1',"
assert s.count(a) == 1
p.write_text(s.replace(a, "diagnostic: 'workspace-release-failed',\n      workspaceReference: `workspace-${RUN.runId}`,"))
