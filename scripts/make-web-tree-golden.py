# /// script
# requires-python = ">=3.11"
# ///
"""Produce the independent Story 4.4 web-tree fixture.

This deliberately uses only Python's own JSON and regular-expression implementations. The
TypeScript parser is the code under test; this file describes the wire document and expected
locator reads independently so a change in that parser cannot regenerate its own oracle.

Run from the repository root with::

    uv run scripts/make-web-tree-golden.py
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "web-tree-golden.json"

LOCATOR = re.compile(r"^\$\.nodes\[(0|[1-9][0-9]*)\]\.value$")

DOCUMENT = {
    "schemaVersion": 1,
    "nodes": [
        {"group": "record:0", "role": "datum", "label": "Employee ID", "value": "E-000105", "target": None},
        {"group": "record:0", "role": "datum", "label": "Full name", "value": "Esther Kabwe", "target": None},
        {"group": "record:0", "role": "status", "label": "Status", "value": "Disabled", "target": None},
        {"group": "page", "role": "input", "label": "Username", "value": "e.kabwe", "target": "username"},
        {"group": "record:0", "role": "datum", "label": "Roles", "value": ["COLLECTIONS_AGENT"], "target": None},
    ],
}

CELLS = [
    ("employee-id", "$.nodes[0].value"),
    ("status", "$.nodes[2].value"),
    ("input-value", "$.nodes[3].value"),
    ("roles", "$.nodes[4].value"),
    ("wrong-field", "$.nodes[2].label"),
    ("wrong-collection", "$.rows[2].value"),
    ("out-of-range", "$.nodes[9].value"),
]


def read(locator: str):
    match = LOCATOR.fullmatch(locator)
    if match is None:
        return None
    index = int(match.group(1))
    nodes = DOCUMENT["nodes"]
    if index >= len(nodes):
        return None
    node = nodes[index]
    return {"value": node["value"], "label": node["label"]}


MUTATIONS = [
    {"name": "unknown-role", "document": {**DOCUMENT, "nodes": [{**DOCUMENT["nodes"][0], "role": "heading"}] + DOCUMENT["nodes"][1:]}, "valid": False},
    {"name": "datum-target", "document": {**DOCUMENT, "nodes": [{**DOCUMENT["nodes"][0], "target": "unexpected"}] + DOCUMENT["nodes"][1:]}, "valid": False},
    {"name": "completion-extra-key", "document": {**DOCUMENT, "completion": {"complete": True, "returned": None, "extra": True}}, "valid": False},
    {"name": "completion-invalid-count", "document": {**DOCUMENT, "completion": {"complete": False, "returned": -1}}, "valid": False},
    {"name": "incomplete-page", "document": {**DOCUMENT, "completion": {"complete": False, "returned": 10}, "nodes": DOCUMENT["nodes"][:2]}, "valid": True},
]


def main() -> int:
    cells = []
    for name, locator in CELLS:
        found = read(locator)
        cells.append(
            {
                "name": name,
                "locator": locator,
                "resolves": found is not None,
                "value": None if found is None else found["value"],
                "label": None if found is None else found["label"],
            }
        )
    fixture = {
        "producer": f"Python {sys.version.split()[0]} + json + re",
        "producedBy": "scripts/make-web-tree-golden.py",
        "regenerateWith": "uv run scripts/make-web-tree-golden.py",
        "why": (
            "Story 4.4 web-tree vectors are produced by Python rather than the TypeScript "
            "parser under test. The fixture preserves grouped semantic nodes, action targets "
            "and completion metadata while checking only the bounded locator projection."
        ),
        "document": json.dumps({**DOCUMENT, "completion": {"complete": True, "returned": None}}, ensure_ascii=False, separators=(",", ":")),
        "cells": cells,
        "mutations": MUTATIONS,
    }
    OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cells)} cells, {len(MUTATIONS)} mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
