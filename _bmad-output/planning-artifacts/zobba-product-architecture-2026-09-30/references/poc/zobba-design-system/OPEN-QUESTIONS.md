# Open questions

Only genuine unresolved items. Types: **Selection** (an implementation choice within the approved system) · **Missing input** (an asset or reference not supplied) · **Owner decision** (a product decision needing approval) · **Validation** (a step still to be performed).

| # | Type | Question | Default until resolved |
|---|---|---|---|
| Q1 | Missing input · Validation | **Kobba comparison.** Kobba's current wordmark, symbol, palette and icon have not been supplied. Compare them against BRAND §1 on the wordmark, doubled-letter treatment, symbol, palette, typography, icon shape and endorsement. | Zobba stays as approved. Don't change Iris or prescribe changes to Kobba before the comparison. |
| Q2 | Missing input | **Type-designer drawing** of the stepped-b wordmark, and optical versions for 16–24px. | Use the supplied outlined SVGs. |
| Q3 | Owner decision | **Provenance footer default.** Is "Prepared with Zobba" on by default for every firm, and is it also embedded in document metadata? | On by default; firm can turn it off; the record stays in Zobba. |
| Q4 | Owner decision | **Dark mode** for the working application in the first release. The dark tokens exist, but that doesn't decide it. | Light only in the first release; dark surfaces used for marketing and notifications. |
| Q5 | Selection | **Icon library** matching DESIGN-SYSTEM §3 (2px, round caps). | Lucide at 2px, subject to engineering choice. |
| Q6 | Selection | **OS icon packaging** (.icns, .ico, maskable PWA). | Build from the supplied 512px PNG and SVG. |
| Q7 | Owner decision | **Workspace auto-open threshold.** R2.2 uses "interacted with in the last 30 seconds" to protect the panel. Confirm or tune. | 30 seconds. |
| Q8 | Owner decision | **Promotion to scheduled check.** Which tasks are eligible (for example, only tasks using approved skills)? | Tasks using skills marked Available to auditors. |
| Q9 | Validation | **Notification rendering** of the template icon and result wording on Windows and macOS. | — |
| Q10 | Validation | **Accessibility items that need a built product** (DESIGN-SYSTEM §14): screen-reader streaming, focus return, forced colours, 400% zoom. | — |
| Q11 | Validation | **Trademark and domain clearance** for Zobba, and a similarity search for the symbol in software classes. | — |
| Q13 | Owner decision | **Model list and defaults.** Which providers and models ship, their processing regions, and the default model and effort. The reference screens use current examples. | Claude Opus 5.5 · High as default; admin-configurable. |
| Q14 | Owner decision | **Approval step.** Is approval separate from review (manager reviews, partner approves), or does the manager's review count as approval? | Separate steps; the approver role is to be confirmed. |
| Q15 | Owner decision | **Cost visibility.** Should higher effort or model choice show an indicative cost to auditors or only to administrators? | Administrators only (Usage by engagement). |
| Q12 | Owner decision | **Firm template ownership.** Who supplies and maintains the working-paper templates per client or firm, and whether Zobba ships a neutral default template. | The firm supplies them; a neutral default is to be designed later. |
