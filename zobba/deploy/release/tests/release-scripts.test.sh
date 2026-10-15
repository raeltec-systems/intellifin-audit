#!/usr/bin/env bash
# Offline tests of the release scripts against a stubbed `aws` (no AWS calls).
# Needs bash, jq and a python3 with jmespath (installed with checkov in CI).
set -euo pipefail
# A missing stub dependency must stop the suite, not pass a must_fail case by crashing.
python3 -c 'import jmespath' 2>/dev/null || { echo "FAIL: python3 module jmespath is required by the aws stub" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
release="$(cd "$here/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export PATH="$here/stub:$PATH" POLL_SECONDS=0
export ECS_CLUSTER=zobba-qualification ECS_TASK_NETWORK='{"awsvpcConfiguration":{"subnets":["s"]}}'
export ECS_MIGRATION_FAMILY=zobba-qualification-migrate ECS_API_FAMILY=zobba-qualification-api ECS_WORKER_FAMILY=zobba-qualification-worker
export ECS_API_SERVICE=zobba-qualification-api ECS_WORKER_SERVICE=zobba-qualification-worker
export IMAGE=123456789012.dkr.ecr.eu-west-1.amazonaws.com/zobba-qualification@sha256:aaaa
export GITHUB_RUN_ID=777

td() { # family revision released?
  local tags='[{"key":"Project","value":"zobba"},{"key":"ManagedBy","value":"terraform"}]'
  [ "$3" = released ] && tags='[{"key":"Project","value":"zobba"},{"key":"ReleasedBy","value":"github-actions"}]'
  jq -n --arg f "$1" --arg r "$2" --argjson tags "$tags" '{
    taskDefinition: {
      taskDefinitionArn: "arn:aws:ecs:eu-west-1:123456789012:task-definition/\($f):\($r)",
      family: $f, revision: ($r|tonumber), status: "ACTIVE", registeredAt: 1, registeredBy: "x",
      compatibilities: ["EC2","FARGATE"], requiresAttributes: [{name: "a"}],
      executionRoleArn: (if $tags[1].key == "ReleasedBy" then "arn:aws:iam::123456789012:role/WRONG" else "arn:aws:iam::123456789012:role/\($f)-execution" end),
      networkMode: "awsvpc", cpu: "256", memory: "512", requiresCompatibilities: ["FARGATE"],
      runtimePlatform: {operatingSystemFamily: "LINUX"}, ephemeralStorage: {sizeInGiB: 21},
      containerDefinitions: [{name: "c", image: "old", secrets: [{name: "S", valueFrom: "arn:secret"}]}]
    },
    tags: ($tags + [{key: "aws:cloudformation:x", value: "drop"}])
  }'
}
scenario() { # extra-json
  local defs="{}" revs="{}" f
  for f in "$ECS_MIGRATION_FAMILY" "$ECS_API_FAMILY" "$ECS_WORKER_FAMILY"; do
    defs="$(jq --arg f "$f" --argjson a "$(td "$f" 3 released)" --argjson b "$(td "$f" 2 terraform)" \
      '. + {("arn:aws:ecs:eu-west-1:123456789012:task-definition/\($f):3"): $a, ("arn:aws:ecs:eu-west-1:123456789012:task-definition/\($f):2"): $b}' <<<"$defs")"
    revs="$(jq --arg f "$f" '. + {($f): ["arn:aws:ecs:eu-west-1:123456789012:task-definition/\($f):3", "arn:aws:ecs:eu-west-1:123456789012:task-definition/\($f):2"]}' <<<"$revs")"
  done
  jq -n --argjson defs "$defs" --argjson revs "$revs" --argjson extra "$1" '{
    definitions: $defs, revisions: $revs,
    services: {"zobba-qualification-api": "arn:aws:ecs:eu-west-1:123456789012:task-definition/zobba-qualification-api:1",
               "zobba-qualification-worker": "arn:aws:ecs:eu-west-1:123456789012:task-definition/zobba-qualification-worker:1"}
  } + $extra' > "$work/scenario.json"
  : > "$work/log"; rm -f "$work/state.json" "$work/summary"
  export AWS_STUB_SCENARIO="$work/scenario.json" AWS_STUB_LOG="$work/log" AWS_STUB_STATE="$work/state.json" GITHUB_STEP_SUMMARY="$work/summary"
}
must_fail() { # name command...
  local name="$1"; shift
  if "$@" > "$work/out" 2>&1; then echo "FAIL: $name succeeded"; cat "$work/out"; exit 1; fi
  if grep -q '^ecs update-service' "$work/log" && [ "${ALLOW_UPDATE:-}" != 1 ]; then echo "FAIL: $name called update-service"; exit 1; fi
  echo "ok: $name fails"
}

# Migration: exit code 1, None (no exit code), empty, timeout, and a running earlier migration.
scenario '{"migration": {"exit_code": 1}}';  must_fail "migration exit 1" "$release/migrate.sh"
scenario '{"migration": {}}';                must_fail "migration exit None" "$release/migrate.sh"
grep -q "exited with 'None'" "$work/out" || { echo "FAIL: None not reported"; exit 1; }
scenario '{"migration": {"exit_code": ""}}'; must_fail "migration exit empty" "$release/migrate.sh"
scenario '{"migration": {"exit_code": 0, "stops_after_polls": 99}}'
MIGRATION_DEADLINE_SECONDS=0 must_fail "migration timeout" "$release/migrate.sh"
grep -q '^ecs stop-task' "$work/log" || { echo "FAIL: timeout did not stop the task"; exit 1; }
grep -q 'migration outcome unknown' "$work/summary" || { echo "FAIL: unknown outcome not recorded"; exit 1; }
scenario '{"migration": {"exit_code": 0}, "running_migrations": ["arn:aws:ecs:eu-west-1:123456789012:task/cluster/old"]}'
must_fail "earlier migration still running" "$release/migrate.sh"
grep -q '^ecs run-task' "$work/log" && { echo "FAIL: started a second migration"; exit 1; }

scenario '{"migration": {"exit_code": 0}}'
"$release/migrate.sh" > "$work/out" 2>&1 || { echo "FAIL: migration exit 0"; cat "$work/out"; exit 1; }
echo "ok: migration exit 0 succeeds"

# The registered revision is the Terraform revision (not the newer release one)
# with only the image changed, read-only fields removed and tags carried over.
payload="$(jq '.registered[0].payload' "$work/state.json")"
jq -e --arg image "$IMAGE" '
  .executionRoleArn == "arn:aws:iam::123456789012:role/zobba-qualification-migrate-execution"
  and .containerDefinitions[0].image == $image
  and .containerDefinitions[0].secrets == [{name: "S", valueFrom: "arn:secret"}]
  and .ephemeralStorage.sizeInGiB == 21
  and ([has("taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
            "registeredAt", "registeredBy", "deregisteredAt")] | any | not)
  and ([.tags[] | select(.key == "Project" and .value == "zobba")] | length == 1)
  and ([.tags[] | select(.key | startswith("aws:"))] | length == 0)
  and ([.tags[] | select(.key == "ReleasedBy")] | length == 1)
  and ([.tags[] | select(.key == "ReleaseBase" and .value == "zobba-qualification-migrate:2")] | length == 1)
' <<<"$payload" > /dev/null || { echo "FAIL: registered payload: $payload"; exit 1; }
echo "ok: revision based on the Terraform revision, image only, tags kept"

# Deploy: success, and worker failure rolls both back.
scenario '{}'
"$release/deploy-services.sh" > "$work/out" 2>&1 || { echo "FAIL: deploy"; cat "$work/out"; exit 1; }
jq -e '.services["zobba-qualification-api"] | endswith(":100")' "$work/state.json" > /dev/null || { echo "FAIL: api not deployed"; exit 1; }
echo "ok: deploy succeeds with both services on new revisions"

scenario '{"rollouts": {"zobba-qualification-worker": "FAILED"}}'
ALLOW_UPDATE=1 must_fail "worker rollout failure" "$release/deploy-services.sh"
jq -e '.services["zobba-qualification-api"] == "arn:aws:ecs:eu-west-1:123456789012:task-definition/zobba-qualification-api:1"
       and .services["zobba-qualification-worker"] == "arn:aws:ecs:eu-west-1:123456789012:task-definition/zobba-qualification-worker:1"' \
  "$work/state.json" > /dev/null || { echo "FAIL: services not both rolled back: $(jq -c .services "$work/state.json")"; exit 1; }
grep -q 'FAILED (worker rollout did not complete); both services are back' "$work/summary" || { echo "FAIL: rollback reason: $(cat "$work/summary")"; exit 1; }
echo "ok: worker failure returns both services to their previous revisions"

scenario '{"rollouts": {"zobba-qualification-api": "FAILED"}}'
ALLOW_UPDATE=1 must_fail "api rollout failure" "$release/deploy-services.sh"
jq -e '.services["zobba-qualification-api"] | endswith(":1")' "$work/state.json" > /dev/null || { echo "FAIL: api not rolled back"; exit 1; }
grep -q -- '--service zobba-qualification-worker --task-definition arn:aws:ecs:eu-west-1:123456789012:task-definition/zobba-qualification-worker:10' "$work/log" \
  && { echo "FAIL: worker updated after API failure"; exit 1; }
grep -q 'API rollout did not complete' "$work/summary" || { echo "FAIL: api rollback reason"; exit 1; }
echo "ok: api failure never deploys the worker"
echo "release script tests passed"
