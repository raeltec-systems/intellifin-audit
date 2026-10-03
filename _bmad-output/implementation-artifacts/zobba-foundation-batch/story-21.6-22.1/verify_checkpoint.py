#!/usr/bin/env python3
"""Verify this checkpoint's source and evidence digests without network or writes."""
from pathlib import Path
import hashlib
import json

pack = Path(__file__).resolve().parent
root = pack.parents[3]


def checked_path(base: Path, relative: str) -> Path:
    target = (base / relative).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise ValueError(f"Missing or out-of-scope file: {relative}")
    return target


def verify_files(base: Path, records: dict[str, str]) -> None:
    for relative, expected in records.items():
        actual = hashlib.sha256(checked_path(base, relative).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"Digest mismatch: {relative}")


source = json.loads((pack / "checkpoint-files.json").read_text())
evidence = json.loads((pack / "evidence-files.json").read_text())
verify_files(root, source["files"])
verify_files(pack, evidence["files"])
for item in json.loads((pack / "gates/index.json").read_text()):
    receipt = json.loads(checked_path(pack / "gates", item["receipt"]).read_text())
    verify_files(pack / "gates", {receipt["log"]: receipt["log_sha256"]})
print(f"Verified {len(source['files'])} checkpoint files and {len(evidence['files'])} evidence files.")
print("Digest agreement verifies the packaged record; it does not rerun tests or establish live qualification.")
