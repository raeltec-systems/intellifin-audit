# Walk the PoC end to end

**Create a procedure, get it approved, run it, read what it found.** Every step below is
proved by `tests/e2e/owner-walkthrough.spec.ts`, which does exactly this against a real
web server, a real worker, a real PostgreSQL and the real synthetic systems.

Use **Segregation-of-Duties Conflicts (P-2)**. It reads AccessGate, which is an API, so
the Run needs no browser. Nothing about it is deferred and nothing about it is missing.

---

## Before you start: you need a third account

There were two demo accounts: `auditor@example.test` and `administrator@example.test`.
**Two are not enough.** The rules say:

- Only an **Audit Manager** can approve a Procedure Version.
- **Nobody can approve a version they wrote.**

So the auditor writes it and is refused as its author; the administrator is refused by
role. Approval was impossible, and the Approve button said so correctly while offering no
way out.

**This is already done.** `manager@example.test` (role: Audit Manager) was seeded into
production on 2026-09-10. Its password is in the run summary of
[Seed demo accounts, run #4](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34507859024).
Your other two accounts kept the passwords they already had — the seeder never resets one.

If you would rather set the password yourself: sign in as `administrator@example.test`,
go to **Administration → Users**, and add a user with role **Audit Manager**. Same command,
same audit event.

---

## About LedgerDesk

**No procedure requires it.** Segregation-of-Duties needs AccessGate and nothing else.

LedgerDesk is a **desktop** system from the 24-hour-access template (P-1). It is not set
up anywhere, and this release could not run it if it were — the desktop path is Epic 7.
The Builder used to list it beside systems that *are* set up, with nothing telling the two
apart, so it read as a missing requirement. It now says, per system:

> **LoanCore** (web) — ready to add below.
> **LedgerDesk** (desktop) — no system with this name is set up here, and this release
> cannot run a desktop system anyway. Leave it out.

---

## The journey

Sign in as **`auditor@example.test`**.

### 1. Create it
**Procedures → New procedure.**
Template: **Segregation-of-Duties Conflicts**. Control name: anything. **Create Procedure**,
then confirm.

The Builder opens. It is a short list of questions. Answer four of them.

### 2. Period and scope
Open **Period and scope**.
Start `2026-08-01`, end `2026-08-31`. Scope: your own sentence, e.g.
`Every active AccessGate account for August 2026.`
**Save Period and scope.**

> If it says *"That procedure changed since this page was loaded"*, reload and do it
> again. The platform re-derives the plan in the background right after you create a
> Procedure, and that moves the page underneath you once. It does not happen twice.

### 3. Records to test
Open **Records to test**. Choose **AccessGate active accounts (read-only API)**.
**Save records to test.**

### 4. Systems to check
Open **Systems to check**. Add **two** systems, one at a time — choose it, then click
**Add Target System**:

1. **AccessGate** (API) — where the accounts and their roles are read.
2. **RoleMatrix (published file)** (versioned file) — the list that turns a role name into
   permissions. Without it no role can be expanded, so nothing can be judged.

Then **Save Target Systems** and confirm. (Adding a system widens scope, so this one asks.)

### 5. How often it runs
Open **How often it runs**. Frequency **monthly**, start time **00:00**.
**Save Schedule.**

> P-2 names no schedule of its own, so **both** fields start empty. The save refuses until
> the start time is filled.

### 6. Wait a moment, then submit
**Submit for approval** stays greyed out until the platform has re-derived the plan —
a few seconds. It says *"Wait for the executable plan to finish deriving."* while it does.
When it goes live, click it and confirm.

You will see **Approve** is greyed out for you, and it says why:
*"You cannot approve a version you authored."* That is correct.

### 7. Approve it
Sign in as **`manager@example.test`** (another browser, or sign out first).
The bell has a notice: **Procedure Version submitted**. Click it.
Read the diff, then **Approve** and confirm.

The version goes straight to **Active**.

### 8. Run it
Back as the auditor, open the Procedure page. It now has **Initiate Run**.
Period from `2026-08-01`, to `2026-08-31`. **Initiate Run**, confirm.

You land on the Run page. Watch it on **Live**, or wait about ten seconds.

### 9. Read what it found

The Run ends **Inconclusive**, and that is the right answer. Eleven accounts are read,
and four checks fail:

| Check | What it says |
|---|---|
| No duplicate Source primary key | AccessGate lists account `AG-1007` twice |
| No unnamed value | `AG-1006` holds `UNKNOWN_ROLE_X`, which RoleMatrix does not declare |
| No ambiguous match | The duplicate account matches two records |
| Per-record coverage | Those records could not be judged |

The source data has deliberate defects. The platform refuses to conclude over a population
that names one identity twice, or over a role nobody has defined — that is the whole point.
Your scope sentence is printed on the Result, word for word.

**Want to see a Pass instead?** Do it all again, and at step 3 choose
**CoreDirectory accounts, no prohibited pair (versioned file)** and at step 4 add
**CoreDirectory (API)**. That source seeds no defect. Choose the *one prohibited pair*
source instead and you get a **Control Failure** with one Exception.

---

## If it stops somewhere

- **Submit stays greyed out.** Read the sentence beside it. It names the missing thing.
- **"That procedure changed since this page was loaded."** Reload, redo that one step.
- **The Run stays Queued.** The worker is not consuming. Check the worker service is up.
- **Every record comes back uninspected, and the Timeline says the credential could not
  be resolved.** The worker's `CREDENTIAL_TOKENS` has no entry for
  `cred://synthetic/northstar-readonly`, which is the reference the seeded systems carry.
  Add one. The value is synthetic and authenticates nothing — every Northstar system is
  read-only at the system level and ignores it — but the Run refuses to present a
  credential it was never given.
- **The Run fails on evidence.** The object store is configured in the worker but this
  session never proved the bucket answers. The Run page names the failure.

## What is not in production yet

Production runs the merged code (schema 44). **Live View and Replay are not merged** — they
are on `codex/epic-5-controls` in the open pull request. Everything above works today.
