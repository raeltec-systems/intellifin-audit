#!/usr/bin/env bash
# Register a new revision of a task definition family with only the image
# changed, and print its ARN.
#
# The base is the latest revision Terraform registered (no `ReleasedBy` tag),
# never an earlier release revision: roles, environment, secrets and every
# other field come from the reviewed Terraform definition of the same family.
# Read-only fields are removed and the tags are carried over, plus release tags.
#
# Usage: register-revision.sh <family>     (IMAGE must be set: repo@sha256:...)
set -euo pipefail
family="$1"
: "${IMAGE:?IMAGE must be set}"
case "$IMAGE" in *@sha256:*) ;; *) echo "register-revision: IMAGE must be pinned by digest" >&2; exit 1 ;; esac
max_revisions="${MAX_REVISIONS_SCANNED:-100}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

aws ecs list-task-definitions --family-prefix "$family" --status ACTIVE --sort DESC \
  --max-items "$max_revisions" --query 'taskDefinitionArns' --output json > "$work/arns.json"

base=""
for arn in $(jq -r '.[]' "$work/arns.json"); do
  aws ecs describe-task-definition --task-definition "$arn" --include TAGS --output json > "$work/candidate.json"
  if [ "$(jq -r '.taskDefinition.family' "$work/candidate.json")" != "$family" ]; then
    continue # a longer family name sharing the prefix
  fi
  if jq -e '(.tags // []) | any(.key == "ReleasedBy")' "$work/candidate.json" > /dev/null; then
    continue # a revision a release registered; never a base
  fi
  base="$arn"
  break
done
if [ -z "$base" ]; then
  echo "register-revision: no Terraform-registered revision of $family found" >&2
  exit 1
fi

tags="$(jq -c '[(.tags // [])[] | select(.key | startswith("aws:") | not)]' "$work/candidate.json")"
jq --arg image "$IMAGE" --argjson tags "$tags" '
  .taskDefinition
  | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
        .registeredAt, .registeredBy, .deregisteredAt)
  | .containerDefinitions |= map(.image = $image)
  | .tags = $tags
' "$work/candidate.json" > "$work/register.json"

# Release tags: identify release revisions so they are never used as a base.
jq --arg run "${GITHUB_RUN_ID:-local}" --arg base "$base" '
  .tags = ([.tags[] | select(.key != "ReleasedBy" and .key != "ReleaseRun" and .key != "ReleaseBase")]
           + [{key: "ReleasedBy", value: "github-actions"}, {key: "ReleaseRun", value: $run},
              {key: "ReleaseBase", value: ($base | split("/") | last)}])
' "$work/register.json" > "$work/register-tagged.json"

aws ecs register-task-definition --cli-input-json "file://$work/register-tagged.json" \
  --query 'taskDefinition.taskDefinitionArn' --output text
