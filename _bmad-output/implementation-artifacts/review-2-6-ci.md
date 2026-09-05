# Story 2.6 — clean-checkout CI repair review

[CI run 49](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33928436568) passed unit/type/boundary checks but exposed three fresh-environment failures: the database migrator lacked built upstream packages, the Docker web typecheck included a colocated test whose root fixture was excluded, and the Period concurrency browser assertion exceeded its polling deadline.

The repair builds the migrator's transitive dependency closure, excludes colocated tests from Docker inputs while retaining checkout coverage, and proves browser hydration/foreground polling without removing conflict or response-loss assertions.

A context-preserving technical reviewer inspected all three code changes and found no material issues or weakened assertions. The reviewer did not run tests. Local verification was performed in a separate fresh checkout, including migration with upstream build output absent and a production web build with the Docker-excluded test inputs temporarily preserved outside the checkout and restored afterward. Actual Docker image verification remains the remote CI job, not this local build-context check.

Observed local results: frozen-lockfile install passed; fresh `pnpm db:migrate` built all three dependency packages and migrated to schema 12; the reduced-input production web build passed compilation and TypeScript; restored full-checkout `pnpm typecheck` passed; the focused Period conflict/committed-response-loss browser scenario passed three repetitions, six total checks including setup, in 2.3 minutes. The initial browser launch needed the documented Northstar build prerequisite in the fresh checkout; after building it, verification passed. No application behavior was changed for the browser timing repair.

Remote [CI run 50](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33929302513) passed for repair commit `66579c982fb1ecaf7e60ba45f4ce92ae39fb9412`, including the actual container build, clean database migration and browser checks. This confirms the remote results independently of the local build-context simulation.
