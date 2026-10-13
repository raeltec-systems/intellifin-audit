"""Static checks of the qualification release workflow (no AWS access).

Run: python3 zobba/deploy/qualification/tests/check_release_workflow.py
Requires PyYAML (installed with checkov in CI).
"""
import pathlib
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
    migrate = job["steps"][order[1]]["run"] if order[1] != -1 else ""
    for required in ('exit_code" != "0"', "exit 1", "--started-by", "aws ecs wait tasks-stopped"):
        if required not in migrate:
            errors.append(f"migration step must contain {required!r}")
    for step in job["steps"]:
        uses = step.get("uses")
        if uses and "@" in uses:
            ref = uses.split("@", 1)[1]
            if len(ref) != 40 or any(c not in "0123456789abcdef" for c in ref):
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
