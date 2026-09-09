# ProdConsole snapshot time field contract

## Finding

The Northstar ProdConsole page already serves the snapshot's existing `taken_at` value as
`Snapshot taken at` (`apps/northstar/src/prodconsole.ts`). The P-4 evaluator also has an
`observation_time` field and checks that the page publication time is valid for the frozen Run
period. The target registration therefore has to authorize the existing page label before the
agent can ground that field.

## Contract gap

The authoritative addendum is incomplete on this field. Addendum §A.2 describes ProdConsole as
publishing a signed snapshot identifier; §H repeats the signed identifier and expected parameter
count as the page declarations. The P-4 objective in §C refers to the approved baseline in effect
at the observation time, and the P-4 executable plan/compiler carries `observation_time`, but the
addendum does not explicitly say whether the page must publish the timestamp or whether the
platform capture time is sufficient.

This matters because the current runtime deliberately treats capture time and page publication
time as different facts. If the timestamp label is absent from the frozen Target System contract,
the runtime cannot ground `observation_time`; freshness then fails closed and the Run is
`INCONCLUSIVE`. Treating capture time as a substitute would invent publication provenance and
would change the freshness rule.

## Bounded implementation

The catalog now declares `Snapshot taken at`, exactly matching the field already served by the
fixture. No timestamp, count, digest, or expected outcome was changed. The P-4 integration
journey derives its attribute-label list from the catalog rather than constructing a custom
superset, and asserts that the approved snapshot-time tool is offered to the model. Removing the
catalog label makes that regression fail while leaving the existing page data unchanged.

The addendum remains unchanged. Its owner should resolve the identifier/count versus timestamp
wording explicitly before a future canonical specification revision.
