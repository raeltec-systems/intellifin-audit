#!/usr/bin/env bash
# Release step 3: move the API and worker to new revisions of their task
# definitions (image only). Each rollout must finish with the new revision as the
# PRIMARY deployment and rolloutState COMPLETED. If either fails, both services
# are returned to the revisions they had before this release, so they never
# keep running different images, and the release fails (web is not synced).
#
# Env: ECS_CLUSTER ECS_API_SERVICE ECS_WORKER_SERVICE ECS_API_FAMILY
#      ECS_WORKER_FAMILY IMAGE  DEPLOY_DEADLINE_SECONDS (default 1200)
#      POLL_SECONDS (default 15)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${ECS_CLUSTER:?}" "${ECS_API_SERVICE:?}" "${ECS_WORKER_SERVICE:?}" "${ECS_API_FAMILY:?}" "${ECS_WORKER_FAMILY:?}" "${IMAGE:?}"
deadline_seconds="${DEPLOY_DEADLINE_SECONDS:-1200}"
poll_seconds="${POLL_SECONDS:-15}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

current_definition() {
  aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$1" \
    --query 'services[0].taskDefinition' --output text
}

update() { # service definition
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$1" --task-definition "$2" \
    --query 'service.serviceArn' --output text > /dev/null
}

# Wait until the PRIMARY deployment uses <definition> and is COMPLETED with a
# single deployment left. Returns 1 on FAILED or deadline.
await_rollout() { # service definition
  local start state
  start="$(date +%s)"
  while :; do
    state="$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$1" --output json \
      | jq -r --arg td "$2" '.services[0] as $s
          | ($s.deployments // []) as $d
          | ([$d[] | select(.status == "PRIMARY")][0]) as $p
          | if $p == null then "WAIT"
            elif $p.taskDefinition != $td then "WRONG"
            elif $p.rolloutState == "FAILED" then "FAILED"
            elif $p.rolloutState == "COMPLETED" and ($d | length) == 1 and $p.runningCount == $p.desiredCount then "DONE"
            else "WAIT" end')"
    case "$state" in
      DONE) return 0 ;;
      FAILED | WRONG) echo "::error::$1: primary deployment is $state for $2"; return 1 ;;
    esac
    if [ $(( $(date +%s) - start )) -ge "$deadline_seconds" ]; then
      echo "::error::$1: rollout did not complete within ${deadline_seconds}s"
      return 1
    fi
    sleep "$poll_seconds"
  done
}

previous_api="$(current_definition "$ECS_API_SERVICE")"
previous_worker="$(current_definition "$ECS_WORKER_SERVICE")"
new_api="$("$here/register-revision.sh" "$ECS_API_FAMILY")"
new_worker="$("$here/register-revision.sh" "$ECS_WORKER_FAMILY")"

roll_back() { # reason
  echo "::error::$1; returning both services to their previous revisions"
  update "$ECS_API_SERVICE" "$previous_api" || true
  update "$ECS_WORKER_SERVICE" "$previous_worker" || true
  local ok=0
  await_rollout "$ECS_API_SERVICE" "$previous_api" || ok=1
  await_rollout "$ECS_WORKER_SERVICE" "$previous_worker" || ok=1
  if [ "$ok" -eq 0 ]; then
    echo "Deploy: FAILED ($1); both services are back on $previous_api and $previous_worker" >> "$summary"
  else
    echo "Deploy: FAILED ($1) and the rollback did not complete; inspect both services now" >> "$summary"
  fi
  exit 1
}

update "$ECS_API_SERVICE" "$new_api" || roll_back "API update was refused"
await_rollout "$ECS_API_SERVICE" "$new_api" || roll_back "API rollout did not complete"
update "$ECS_WORKER_SERVICE" "$new_worker" || roll_back "worker update was refused"
await_rollout "$ECS_WORKER_SERVICE" "$new_worker" || roll_back "worker rollout did not complete"

desired="$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_API_SERVICE" \
  --query 'services[0].desiredCount' --output text)"
if [ "$desired" = "0" ]; then
  echo "::warning::the API service has 0 desired tasks: set image_digest and apply Terraform (RUNBOOK, first release)"
fi
echo "Deploy: API $new_api, worker $new_worker (image ${IMAGE#*@})" >> "$summary"
