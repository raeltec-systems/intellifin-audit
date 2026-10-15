#!/usr/bin/env bash
# Release step 2: run `zobba-cli migrate --runtime-role zobba_app` as a one-off
# ECS task and succeed only on container exit code 0. Bounded: on timeout the
# task is stopped and the outcome is reported as unknown (the migration may or
# may not have committed), and the release fails before any service change.
#
# Env: ECS_CLUSTER ECS_MIGRATION_FAMILY ECS_TASK_NETWORK IMAGE
#      MIGRATION_DEADLINE_SECONDS (default 900) POLL_SECONDS (default 10)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${ECS_CLUSTER:?}" "${ECS_MIGRATION_FAMILY:?}" "${ECS_TASK_NETWORK:?}" "${IMAGE:?}"
deadline_seconds="${MIGRATION_DEADLINE_SECONDS:-900}"
poll_seconds="${POLL_SECONDS:-10}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

fail() { echo "::error::$1"; echo "Migration: $1" >> "$summary"; exit 1; }

# Refuse to start while an earlier release migration is still running/pending.
running="$(aws ecs list-tasks --cluster "$ECS_CLUSTER" --family "$ECS_MIGRATION_FAMILY" \
  --desired-status RUNNING --query 'taskArns' --output json)"
if [ "$(jq 'length' <<<"$running")" -gt 0 ]; then
  mapfile -t running_tasks < <(jq -r '.[]' <<<"$running")
  started_by="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "${running_tasks[@]}" \
    --query 'tasks[].startedBy' --output json)"
  if jq -e 'any(.[]; (. // "") | startswith("release-"))' <<<"$started_by" > /dev/null; then
    fail "an earlier release migration is still RUNNING or PENDING; services were not changed"
  fi
fi

definition="$("$here/register-revision.sh" "$ECS_MIGRATION_FAMILY")"
task_arn="$(aws ecs run-task --cluster "$ECS_CLUSTER" --task-definition "$definition" \
  --launch-type FARGATE --network-configuration "$ECS_TASK_NETWORK" \
  --started-by "release-${GITHUB_RUN_ID:-local}" --query 'tasks[0].taskArn' --output text)"
case "$task_arn" in arn:*) ;; *) fail "migration task did not start; services were not changed" ;; esac
echo "migration task: $task_arn"

start="$(date +%s)"
while :; do
  status="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].lastStatus' --output text)"
  [ "$status" = "STOPPED" ] && break
  if [ $(( $(date +%s) - start )) -ge "$deadline_seconds" ]; then
    aws ecs stop-task --cluster "$ECS_CLUSTER" --task "$task_arn" \
      --reason "release migration deadline exceeded" > /dev/null || true
    fail "migration outcome unknown: no exit within ${deadline_seconds}s (task stopped; check the schema before retrying); services were not changed"
  fi
  sleep "$poll_seconds"
done

exit_code="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
  --query "tasks[0].containers[?name=='migrate'].exitCode | [0]" --output text)"
if [ "$exit_code" != "0" ]; then
  reason="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].stoppedReason' --output text || true)"
  fail "migration exited with '${exit_code:-<none>}' (${reason:-no reason}); services were not changed"
fi
echo "Migration: exited 0 ($task_arn)" >> "$summary"
echo "migration exited 0"
