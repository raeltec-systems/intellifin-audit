-- Generation 27 (Story 4.1): the isolated Agent Workspace, one row per Run.
--
-- Its own table rather than a field on another stage's checkpoint. The workspace outlives
-- every one of them: it is created at the frozen `create-workspace` Session Step, which
-- the compiler emits FIRST whenever a selected Target System is web or desktop, and it is
-- released at the Run's terminal transition. The reaper also needs its OWN read, and a
-- background job must not borrow a surface's or another stage's -- the probe sweep that
-- borrowed `listRegistrations` probed nothing while exiting 0 (Story 1.8).
--
-- `workspace_id` is the PROVIDER session identifier (`browser.id` under Solari). It is an
-- opaque identifier and NOT a capability: releasing a Solari session still needs the
-- deployment's API key. That is why it may be stored and named in a Timeline event, while
-- the API key, any session token and the wire-protocol endpoint may not -- and there is
-- nowhere in this row for any of those three. Under Solari the endpoint is loopback-
-- wrapped by the client anyway and means nothing outside the process that created it.
--
-- `expires_at` is the provider's HARD deadline, at which a Solari session auto-releases;
-- nothing a Run does resets it. Null for a locally launched browser, which has no plan-tier
-- deadline at all -- it lives exactly as long as the worker process does, and a far-future
-- timestamp invented to fill the column would be a fact nobody measured. A resumed claim
-- reads it and treats an expired identity as GONE rather than as an outage.
--
-- `mode` records which guarantee this Run's workspace actually had. `solari` is a separate
-- managed browser with provider-side egress; `local` isolates browser state per Run and
-- does NOT isolate the worker process at all. A Run that ran under the weaker one has to
-- say so rather than inherit the stronger sentence.
--
-- ON DELETE CASCADE, unlike `run_gate_check`, `run_result`, `run_evidence_package` and
-- `run_evidence_integrity`, each of which every test teardown deletes by name. Those four
-- record an OUTCOME and should not be silently removable; a workspace row is operational
-- state, and removing a whole Run is a different act that takes it along -- the same
-- reading that makes `run_exception` cascade from `run_observation`. Nothing requires a
-- workspace row the way generations 21 and 25 require a package and a Result, so the
-- cascade breaks no invariant. It also means the ten teardowns that already delete
-- `audit_run` keep working: a foreign key nobody knew about does not fail its own suite,
-- it leaves rows behind and fails an unrelated one later on a count.
--
-- `run_workspace_open_identity`: an OPEN workspace nobody can name is one nobody can
-- release. `run_workspace_released_at` is written `boolean = boolean`, which is never
-- NULL -- a CHECK that evaluated to NULL would PASS, the trap `array_length` set in
-- generation 5 and `<> ALL` set in generation 7.
--
-- `attempts <= 4` is `sessionStepAttemptBudget` for compiler 1 -- `retriesPerStep` 3 plus
-- the first attempt, times the one cycle addendum E gives a Run-level Session Step --
-- restated as a constant exactly as `population_execution_counts` restates it. A CHECK
-- cannot read a frozen plan, and the bound this row must never exceed is schema.

CREATE TABLE "run_workspace" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"step_id" text NOT NULL,
	"workspace_id" text,
	"mode" text NOT NULL,
	"expires_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"attempt_started_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"diagnostic" text,
	CONSTRAINT "run_workspace_status" CHECK ("run_workspace"."status" IN ('PROVISIONING','OPEN','RETRY','RELEASED','FAILED')),
	CONSTRAINT "run_workspace_mode" CHECK ("run_workspace"."mode" IN ('solari','local')),
	CONSTRAINT "run_workspace_counts" CHECK ("run_workspace"."revision">0 AND "run_workspace"."attempts">0 AND "run_workspace"."attempts"<=4),
	CONSTRAINT "run_workspace_open_identity" CHECK ("run_workspace"."status"<>'OPEN' OR "run_workspace"."workspace_id" IS NOT NULL),
	CONSTRAINT "run_workspace_released_at" CHECK (("run_workspace"."released_at" IS NULL) = ("run_workspace"."status" <> 'RELEASED')),
	CONSTRAINT "run_workspace_identity_shape" CHECK ("run_workspace"."workspace_id" IS NULL OR (length("run_workspace"."workspace_id") BETWEEN 1 AND 200))
);
--> statement-breakpoint
ALTER TABLE "run_workspace" ADD CONSTRAINT "run_workspace_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (28);
