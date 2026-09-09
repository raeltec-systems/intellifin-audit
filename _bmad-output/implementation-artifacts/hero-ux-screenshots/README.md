# Hero workflow screenshots

One picture per state of the hero workflow — create a Procedure from P-1, author it in
business language, watch readiness clear, submit — taken by
`tests/e2e/hero-workflow.spec.ts` in a real Chromium against the development server, a
migrated PostgreSQL 18 and the seeded auditor account. The journey drives every control
by keyboard where the contract requires it and runs the WCAG 2.1 AA scan on each surface
it changes; a screenshot is taken only after the assertions for that state passed, so a
picture here is a state the suite proved, not a mock-up. Each picture frames the element
the state is about (the readiness panel, one condition, the dialog) rather than the whole
Builder, which is ten thousand pixels tall.

Regenerate the set from one verified run:

```
HERO_UX_SCREENSHOTS="$PWD/_bmad-output/implementation-artifacts/hero-ux-screenshots" \
  pnpm exec playwright test tests/e2e/hero-workflow.spec.ts
```

An ordinary run writes them under `test-results/` instead, which git ignores.

| Step | File | What it shows |
|---|---|---|
| 01 | `01-new-procedure-form.jpg` | The Template picker with no default selection and the Control name filled in. |
| 02 | `02-builder-opened.jpg` | The Builder on the new Draft: the editable Control section and what follows it. |
| 03 | `03-readiness-on-a-fresh-draft.jpg` | Readiness naming the three gaps of a fresh P-1 Draft: no Target System, no source, C2 without a policy. |
| 04 | `04-compliance-simple-mode.jpg` | C1 in the simple editor, opened on the Template's own frozen values. |
| 05 | `05-compliance-advanced-mode.jpg` | The same C1 as its authored text, one radio away, byte for byte. |
| 06 | `06-role-privilege-policy.jpg` | The C2 role-privilege policy, with counts per list. |
| 07 | `07-compliance-saved-directly.jpg` | The Compliance Rule after a direct save by keyboard: no dialog, the saved banner, focus where it was. |
| 08 | `08-readiness-after-policy.jpg` | After reload: the policy survived and its readiness item is gone. |
| 09 | `09-builder-scanned.jpg` | C1 after the keyboard pass and a clean accessibility scan. |
| 10 | `10-readiness-after-source.jpg` | Period, scope and the source bound; the source item cleared. |
| 11 | `11-timing-window-condition.jpg` | The 24-hour window added as C3, with its hours and inclusive boundary. |
| 12 | `12-timing-window-readiness.jpg` | Readiness naming the date-only source and the missing `disabled_time` capture. |
| 13 | `13-timing-capture-declared.jpg` | Evidence Requirements after accepting the offered `disabled_time` requirement. |
| 14 | `14-scope-expansion-confirmation.jpg` | The one save that still confirms: adding a Target System names the system being added. |
| 15 | `15-draft-complete.jpg` | What the agent will do, and readiness, on the completed Draft. |
| 16 | `16-submit-unavailable-with-its-reason.jpg` | Submit unavailable for the one remaining reason, the executable plan, stated where the action is. |
