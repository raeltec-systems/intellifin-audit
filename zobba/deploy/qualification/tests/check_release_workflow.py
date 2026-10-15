"""Static checks of the qualification release workflow (no AWS access).

Run: python3 zobba/deploy/qualification/tests/check_release_workflow.py
Requires PyYAML (installed with checkov in CI).
"""
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORKFLOW = ROOT / ".github/workflows/zobba-qualification-release.yml"


def main() -> int:
    text = WORKFLOW.read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
    errors = []
    # PyYAML reads the bare key `on` as boolean True.
    triggers = doc.get("on", doc.get(True))
    if triggers != {"workflow_dispatch": None}:
        errors.append(f"release must be workflow_dispatch only, got {triggers!r}")
    jobs = doc["jobs"]
    if list(jobs) != ["release"]:
        errors.append("a single sequential job keeps migration before deploy")
    job = jobs["release"]
    if job.get("environment") != "qualification":
        errors.append("the job must use the qualification environment (approval)")
    if job.get("permissions", {}).get("id-token") != "write":
        errors.append("GitHub OIDC needs id-token: write")
    names = [step.get("name", step.get("uses", "")) for step in job["steps"]]

    def index(fragment: str) -> int:
        matches = [i for i, name in enumerate(names) if fragment in name]
        if len(matches) != 1:
            errors.append(f"expected exactly one step matching {fragment!r}")
            return -1
        return matches[0]

    order = [
        index("Build and push the image"),
        index("Run the release migration"),
        index("Deploy the API and worker"),
        index("Sync the web shell"),
    ]
    if -1 not in order and order != sorted(order):
        errors.append(f"release order must be build, migrate, deploy, web; got step indexes {order}")
    steps = job["steps"]
    migrate_run = steps[order[1]].get("run", "") if order[1] != -1 else ""
    deploy_run = steps[order[2]].get("run", "") if order[2] != -1 else ""
    if "zobba/deploy/release/migrate.sh" not in migrate_run:
        errors.append("migration step must run zobba/deploy/release/migrate.sh")
    if "zobba/deploy/release/deploy-services.sh" not in deploy_run:
        errors.append("deploy step must run zobba/deploy/release/deploy-services.sh")
    release = ROOT / "zobba/deploy/release"
    migrate = (release / "migrate.sh").read_text(encoding="utf-8")
    for required in ('"$exit_code" != "0"', "migration outcome unknown", "stop-task", "--started-by", "MIGRATION_DEADLINE_SECONDS"):
        if required not in migrate:
            errors.append(f"migrate.sh must contain {required!r}")
    deploy = (release / "deploy-services.sh").read_text(encoding="utf-8")
    for required in ('"PRIMARY"', '"COMPLETED"', "roll_back", "previous_api", "previous_worker"):
        if required not in deploy:
            errors.append(f"deploy-services.sh must contain {required!r}")
    if not any("refs/heads/$RELEASE_BRANCH" in step.get("run", "") for step in steps[:1]):
        errors.append("the first step must refuse a ref other than the release branch")
    for step in steps:
        uses = step.get("uses")
        if not uses or uses.startswith("./"):
            continue
        if uses.startswith("docker://"):
            if not re.search(r"@sha256:[0-9a-f]{64}$", uses):
                errors.append(f"docker action not pinned by digest: {uses}")
            continue
        ref = uses.split("@", 1)[1] if "@" in uses else ""
        if not re.fullmatch(r"[0-9a-f]{40}", ref):
            errors.append(f"action not pinned to a commit SHA: {uses}")
    for forbidden in ("aws-access-key-id", "aws-secret-access-key", "AWS_SECRET_ACCESS_KEY", "secrets."):
        if forbidden in text:
            errors.append(f"release must not use long-lived keys or repository secrets ({forbidden})")
    for line in errors:
        print(f"release workflow: {line}", file=sys.stderr)
    if not errors:
        print("release workflow: checks passed")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
