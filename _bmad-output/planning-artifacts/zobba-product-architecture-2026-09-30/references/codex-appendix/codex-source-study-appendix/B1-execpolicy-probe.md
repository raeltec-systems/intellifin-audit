# B1 — execpolicy focused probe (executed 2026-09-29T19:58Z)

Binary: `codex-execpolicy` built from commit `8ffd91e42aa001b7e897bea812b02f89264f9fa0` (debug profile). Rule files are synthetic and exist only for this probe. Paths are sanitised.

## `admin.rules`

```python
prefix_rule(pattern=["git", "push"], decision="forbidden", justification="admin: no pushes")
```

## `user-exact.rules`

```python
prefix_rule(pattern=["/usr/bin/git"], decision="allow")
```

## `user-basename.rules`

```python
prefix_rule(pattern=["git"], decision="allow")
```

## Invocations and answers (`results.txt`, verbatim apart from path sanitisation)

```text
execpolicy focused probe — 2026-09-29T19:58:48Z — binary built from commit 8ffd91e42aa001b7e897bea812b02f89264f9fa0

--- case A admin only, absolute path ---
cmd: <study-target-dir>/debug/codex-execpolicy check -r admin.rules --resolve-host-executables -- /usr/bin/git push
{"matchedRules":[{"prefixRuleMatch":{"matchedPrefix":["git","push"],"decision":"forbidden","resolvedProgram":"/usr/bin/git","justification":"admin: no pushes"}}],"decision":"forbidden"}


--- case B admin + user exact-path allow ---
cmd: <study-target-dir>/debug/codex-execpolicy check -r admin.rules -r user-exact.rules --resolve-host-executables -- /usr/bin/git push
{"matchedRules":[{"prefixRuleMatch":{"matchedPrefix":["/usr/bin/git"],"decision":"allow"}}],"decision":"allow"}


--- case C admin + user exact-path allow, bare git ---
cmd: <study-target-dir>/debug/codex-execpolicy check -r admin.rules -r user-exact.rules --resolve-host-executables -- git push
{"matchedRules":[{"prefixRuleMatch":{"matchedPrefix":["git","push"],"decision":"forbidden","justification":"admin: no pushes"}}],"decision":"forbidden"}


--- case D admin + user basename allow ---
cmd: <study-target-dir>/debug/codex-execpolicy check -r admin.rules -r user-basename.rules --resolve-host-executables -- git push
{"matchedRules":[{"prefixRuleMatch":{"matchedPrefix":["git","push"],"decision":"forbidden","justification":"admin: no pushes"}},{"prefixRuleMatch":{"matchedPrefix":["git"],"decision":"allow"}}],"decision":"forbidden"}


--- case E admin + user basename allow, absolute path ---
cmd: <study-target-dir>/debug/codex-execpolicy check -r admin.rules -r user-basename.rules --resolve-host-executables -- /usr/bin/git push
{"matchedRules":[{"prefixRuleMatch":{"matchedPrefix":["git","push"],"decision":"forbidden","resolvedProgram":"/usr/bin/git","justification":"admin: no pushes"}},{"prefixRuleMatch":{"matchedPrefix":["git"],"decision":"allow","resolvedProgram":"/usr/bin/git"}}],"decision":"forbidden"}
```
