# Stories 21.2–21.4 checkpoint

All three stories are implemented, verified and independently reviewed on `codex/zobba-foundation-batch`. No merge or deployment is included.

This slice adds firm methodology, deliberately installed skills and scoped working knowledge to the continuing Task foundation. Admin configuration remains separate from authority over client evidence.

| Story | Result | Commit |
| --- | --- | --- |
| 21.2 — applicable firm methodology | Immutable configuration, exact Task bindings, inspectable gaps and current recall/revision handling | `643ed095314d42f576106effd287703824003c73` |
| 21.3 — trusted skills | Deliberate immutable installation, exact-version selection, current eligibility and attributable restrictions/history | `d38e1daed736415ef13e7606345dac71bd1d9f01` |
| 21.4 — scoped working knowledge | Attributed records, source-aware correction/retrieval, exact recovery and private preference Undo | This checkpoint |

The 21.4 checkpoint also addresses unsent methodology edit/recall recovery discovered during 21.3 review. Its evidence distinguishes unsent draft custody from recovery of a submitted request and includes a failing prior-component control.

Final verification passed **305 Rust tests, 181 web unit tests and 145 Chromium cases with zero retries**, plus 56 OIDC fixture and 47 Python checks, format, Clippy, builds, boundaries and process smoke. Historical public acquisition/upgrade/recovery passed separately. The [Story 21.4 report](STORY-21.4-CHECKPOINT.md) links source reconciliation, independent review, browser evidence and declared limits.

## Next dependency-ready batch

Recommend **21.6** (find working material without losing provenance) and **22.1** (native model routing through the current tool catalogue) as independent tracks. **22.2** follows 22.1 and also depends on completed 21.4/20.4. Story 21.6 is not its canonical prerequisite.

**21.5** is also locally ready. Its Microsoft Graph qualification needs a named real tenant and consent; fixture coverage will not establish live qualification. OpenAI/Anthropic smoke calls for 22.1 need provider credentials and separate spend ceilings.

Keep **23.1 real-computer qualification early**; its foundation dependencies are already complete. The existing [qualification proposal](QUALIFICATION-PROPOSAL.md) remains **proposed, not approved**: one nonproduction AWS stack in **us-east-1**, two Availability Zones, at most seven days and a **USD 300 all-in spend ceiling**, with estimated services of USD 214.13. The initial profile is Ubuntu 24.04/Chromium on one `m6i.large`, at most 24 running hours, Rust gateway, VNC/guacd/Guacamole, and an owned synthetic password/TOTP target.

Before provisioning, the owner must confirm the account, operator, UTC window, target URL/revision, entitlements, region and ceiling. The proposal's USD 150/200 alerts and USD 225 accrued-plus-committed shutdown estimate do not guarantee the final invoice. Model usage, Windows and paid app seats are excluded. Qualification-region approval does not decide customer-data residency.

No merge, deployment, paid qualification or later-story implementation is included in this checkpoint. Knowledge inspection and skill selection do not yet demonstrate model invocation or autonomous audit work.
