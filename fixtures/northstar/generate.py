# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Write the Northstar cover sheets, the served file artifacts, and the declared counts.

Run it from the repository root:

    uv run fixtures/northstar/generate.py

**A declared count is generated, never typed.** That is the whole point of the file.
A number typed beside the rows it counts is wrong the first time somebody edits the
dataset, and an Evidence Quality Gate reconciling against a stale declaration reports a
truncation that never happened. Every count and every digest in `generated/` is derived
here, from `datasets/`, by code that is NOT the code the product will later count with:
this is Python and the standard library, and the product's Adapters are TypeScript.

The digest on a cover sheet is taken over THE BYTES THIS FILE WROTE, which are the exact
bytes the Northstar service serves back — it reads the artifact off disk and streams it
unchanged. A digest over the dataset, or over a re-serialization, would be a digest of
something nobody can fetch. API declarations use a separate digest over the explicitly
versioned `{"schema_version": 1, "rows": [...]}` projection. The API response's raw
bytes remain a separate Evidence digest.

The signature is a synthetic HMAC over the cover sheet's own fields. Its key is published
below and in this folder's README: it makes a cover sheet tamper-EVIDENT for a fixture,
and it is not a security control. Nothing in this repository treats it as one.

Nothing here evaluates a rule, and nothing that evaluates a rule may import what it
writes (AD-12).
"""

from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATASETS = HERE / "datasets"
GENERATED = HERE / "generated"

MARKER = "SYNTHETIC-NORTHSTAR-FIXTURE"
ORGANIZATION = "Northstar Financial Group"
STATEMENT = (
    "Every value in this file is invented. No production data, no personal data, no real "
    "person, no real address and no real domain. Every origin is .synthetic.invalid or a "
    "loopback port."
)

SYNTHETIC_BLOCK = {
    "marker": MARKER,
    "organization": ORGANIZATION,
    "statement": STATEMENT,
}

PRODUCED_BY = "Python fixtures/northstar/generate.py (standard library only)"

# Published on purpose. A fixture's cover sheet must be checkable by anybody who has the
# fixture; a secret here would only pretend to be a security control.
SIGNING_KEY = b"northstar-synthetic-cover-sheet-key-2026"

COMMENT_PREFIX = "#"
LINE_TERMINATOR = "\n"

# The synthetic API snapshots all describe the August 2026 Run fixture. Keep this
# producer timestamp explicit and stable: `generation` is an identifier, not a
# timestamp, and using the wall clock would make regeneration change the declaration.
API_GENERATED_AT = "2026-09-01T00:00:00Z"
API_EFFECTIVE_PERIOD = {"from": "2026-08-01", "to": "2026-08-31"}

# The current file fixtures use the same producer timestamp. The intentionally stale
# July cover gets its own timestamp at the call site below.
CURRENT_FILE_GENERATED_AT = API_GENERATED_AT
STALE_FILE_GENERATED_AT = "2026-07-31T23:59:59Z"


def read_dataset(name: str) -> dict:
    data = json.loads((DATASETS / name).read_text(encoding="utf-8"))
    if data.get("synthetic", {}).get("marker") != MARKER:
        raise SystemExit(f"{name}: dataset does not carry the synthetic marker")
    return data


def csv_bytes(header: list[str], rows: list[list[str]], title: str, generation: str) -> bytes:
    """One comment line, then RFC 4180 with LF terminators.

    The comment line carries the synthetic marker into the served artifact itself, so a
    file that escapes this folder still says what it is. The cover sheet declares the
    prefix and the header line number, so a reader never has to guess.
    """
    buffer = io.StringIO()
    buffer.write(f"{COMMENT_PREFIX} {MARKER} | {ORGANIZATION} | {title} | generation {generation}\n")
    writer = csv.writer(buffer, lineterminator=LINE_TERMINATOR, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue().encode("utf-8")


def _utf16_key(key: str) -> bytes:
    """Sort object keys like JavaScript's UTF-16 string comparator."""
    return key.encode("utf-16-be", "surrogatepass")


def canonical(value: object) -> bytes:
    """Deterministic UTF-8 JSON bytes: sorted object keys, ordered arrays, no spaces."""
    if isinstance(value, dict):
        members = [
            json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            + ":"
            + canonical(item).decode("utf-8")
            for key, item in sorted(value.items(), key=lambda pair: _utf16_key(pair[0]))
        ]
        return ("{" + ",".join(members) + "}").encode("utf-8")
    if isinstance(value, list):
        return ("[" + ",".join(canonical(item).decode("utf-8") for item in value) + "]").encode(
            "utf-8"
        )
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode(
        "utf-8"
    )


def cover_sheet(
    *,
    source: str,
    covers: str,
    title: str,
    generation: str,
    effective_period: dict,
    row_count: int,
    payload: bytes,
    declared_schema: list[str],
    generated_at: str,
    complete: bool = True,
    seeded_case: str | None = None,
    seeded_case_note: str | None = None,
) -> dict:
    """The signed cover sheet. `row_count` and the digest are arguments, never guesses.

    `payload` is the bytes the service will serve. For every artifact but the seeded
    truncation case it is the artifact's own bytes; for that one it is deliberately the
    bytes of the FULL export, which is what makes the mismatch the case it is.
    """
    signed = {
        "source": source,
        "covers": covers,
        "generation": generation,
        "generated_at": generated_at,
        "effective_period": effective_period,
        "complete": complete,
        "row_count": row_count,
        "declared_schema": declared_schema,
        "content_digest": {"algorithm": "sha256", "value": hashlib.sha256(payload).hexdigest()},
        "format": {
            "media_type": "text/csv",
            "encoding": "utf-8",
            "comment_prefix": COMMENT_PREFIX,
            "header_line": 2,
            "line_terminator": "\\n",
        },
    }
    sheet = {
        "synthetic": SYNTHETIC_BLOCK,
        "title": title,
        **signed,
        "signature": {
            "scheme": "synthetic-hmac-sha256",
            "key_id": "northstar-cover-sheet-2026",
            "key_is_published": True,
            "value": hmac.new(SIGNING_KEY, canonical(signed), hashlib.sha256).hexdigest(),
        },
        "produced_by": PRODUCED_BY,
    }
    if seeded_case is not None:
        sheet["seeded_case"] = seeded_case
        sheet["seeded_case_note"] = seeded_case_note
    return sheet


def count_file(
    *,
    source: str,
    generation: str,
    declared_count: int,
    counted_from: str,
    count_rule: str,
) -> dict:
    return {
        "synthetic": SYNTHETIC_BLOCK,
        "source": source,
        "generation": generation,
        "declared_count": declared_count,
        "counted_from": counted_from,
        "count_rule": count_rule,
        "produced_by": PRODUCED_BY,
    }


def population_rows_digest(rows: list[dict]) -> str:
    """Digest the exact v1 rows projection, independent of the TypeScript adapter."""
    return hashlib.sha256(canonical({"schema_version": 1, "rows": rows})).hexdigest()


def api_count_file(
    *,
    source: str,
    generation: str,
    schema: list[str],
    rows: list[dict],
    counted_from: str,
    count_rule: str,
) -> dict:
    """Write a v1 declaration for the rows the API location actually binds.

    `rows` is already filtered to the bound population by the caller and is sorted
    here by the same primary key Northstar serves. The count and digest are therefore
    independent producer declarations, while `returned` on the collection response
    remains only a transport diagnostic.
    """
    return {
        "synthetic": SYNTHETIC_BLOCK,
        "source": source,
        "generation": generation,
        "generated_at": API_GENERATED_AT,
        "effective_period": API_EFFECTIVE_PERIOD,
        "schema_version": 1,
        "representation": "population-rows-v1",
        "schema": schema,
        "count": len(rows),
        "sha256": population_rows_digest(rows),
        "complete": True,
        # Compatibility for the existing Northstar pages and Epic 2 probes. The
        # normalized `count` above is the v1 field consumed by population adapters.
        "declared_count": len(rows),
        "counted_from": counted_from,
        "count_rule": count_rule,
        "produced_by": PRODUCED_BY,
    }


def write_json(name: str, value: dict) -> None:
    (GENERATED / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_bytes(name: str, payload: bytes) -> None:
    (GENERATED / name).write_bytes(payload)


def main() -> int:
    GENERATED.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- Leavers export
    leavers = read_dataset("leavers-export.json")
    schema = leavers["declared_schema"]
    all_rows = [[row[field] for field in schema] for row in leavers["rows"]]
    full = csv_bytes(schema, all_rows, leavers["title"], leavers["generation"])
    write_bytes("leavers-export.csv", full)
    write_json(
        "leavers-export.cover-sheet.json",
        cover_sheet(
            source="leavers-export",
            covers="leavers-export.csv",
            title="Cover sheet for the Northstar HR leavers export",
            generation=leavers["generation"],
            effective_period=leavers["effective_period"],
            row_count=len(all_rows),
            payload=full,
            declared_schema=schema,
            generated_at=CURRENT_FILE_GENERATED_AT,
        ),
    )

    # The seeded INCOMPLETE population: the full export's cover sheet over a short file.
    truncated_rows = all_rows[:24]
    truncated = csv_bytes(schema, truncated_rows, leavers["title"], leavers["generation"])
    write_bytes("leavers-export-truncated.csv", truncated)
    write_json(
        "leavers-export-truncated.cover-sheet.json",
        cover_sheet(
            source="leavers-export",
            covers="leavers-export-truncated.csv",
            title="Cover sheet for the Northstar HR leavers export (seeded truncation case)",
            generation=leavers["generation"],
            effective_period=leavers["effective_period"],
            # The FULL row count and the FULL file's digest, over a file that holds fewer
            # rows. That disagreement IS the case; it is not a mistake to be corrected.
            row_count=len(all_rows),
            payload=full,
            declared_schema=schema,
            generated_at=CURRENT_FILE_GENERATED_AT,
            seeded_case="declared-count-mismatch",
            seeded_case_note=(
                "This cover sheet declares the row count and digest of the FULL export while "
                f"the file it names holds {len(truncated_rows)} rows. The Evidence Quality Gate "
                "must detect the truncation. Addendum D: one stale or incomplete population."
            ),
        ),
    )

    # The seeded STALE population: the previous generation, effective through July.
    july_rows = [
        [row[field] for field in schema]
        for row in leavers["rows"]
        if row["employment_status"] == "Terminated"
        and row["termination_effective_date"] != ""
        and row["termination_effective_date"] <= "2026-07-31"
    ]
    july = csv_bytes(schema, july_rows, leavers["title"], "2026-07-31.1")
    write_bytes("leavers-export-2026-07.csv", july)
    write_json(
        "leavers-export-2026-07.cover-sheet.json",
        cover_sheet(
            source="leavers-export",
            covers="leavers-export-2026-07.csv",
            title="Cover sheet for the Northstar HR leavers export, previous generation",
            generation="2026-07-31.1",
            effective_period={"from": "2026-01-01", "to": "2026-07-31"},
            row_count=len(july_rows),
            payload=july,
            declared_schema=schema,
            generated_at=STALE_FILE_GENERATED_AT,
            seeded_case="stale-population",
            seeded_case_note=(
                "The effective period ends 2026-07-31, so this generation cannot cover an "
                "August period. Addendum D: one stale or incomplete population."
            ),
        ),
    )

    # ------------------------------------------------------- AccessGate file equivalent
    # This is the same bound Active population as the API source, published as a
    # versioned CSV so the file adapter can exercise the same deterministic contract.
    accessgate = read_dataset("accessgate-accounts.json")
    active_accounts = sorted(
        [row for row in accessgate["accounts"] if row["status"] == "Active"],
        key=lambda row: row["account_id"],
    )
    accessgate_schema = accessgate["declared_schema"]
    accessgate_csv_rows = [
        [
            json.dumps(row[field], ensure_ascii=False, separators=(",", ":"))
            if field == "roles"
            else row[field]
            for field in accessgate_schema
        ]
        for row in active_accounts
    ]
    accessgate_csv = csv_bytes(
        accessgate_schema,
        accessgate_csv_rows,
        accessgate["title"],
        accessgate["generation"],
    )
    write_bytes("accessgate-active-accounts.csv", accessgate_csv)
    write_json(
        "accessgate-active-accounts.cover-sheet.json",
        cover_sheet(
            source="accessgate-accounts",
            covers="accessgate-active-accounts.csv",
            title="Cover sheet for the Northstar AccessGate active accounts export",
            generation=accessgate["generation"],
            effective_period=API_EFFECTIVE_PERIOD,
            row_count=len(accessgate_csv_rows),
            payload=accessgate_csv,
            declared_schema=accessgate_schema,
            generated_at=CURRENT_FILE_GENERATED_AT,
        ),
    )

    # Deliberately declare the full CSV over a file one row short. This keeps the
    # existing truncation vector meaningful for a JSON-valued CSV field too.
    accessgate_truncated_rows = accessgate_csv_rows[:-1]
    accessgate_truncated = csv_bytes(
        accessgate_schema,
        accessgate_truncated_rows,
        accessgate["title"],
        accessgate["generation"],
    )
    write_bytes("accessgate-active-accounts-truncated.csv", accessgate_truncated)
    write_json(
        "accessgate-active-accounts-truncated.cover-sheet.json",
        cover_sheet(
            source="accessgate-accounts",
            covers="accessgate-active-accounts-truncated.csv",
            title="Cover sheet for the Northstar AccessGate active accounts export (seeded truncation case)",
            generation=accessgate["generation"],
            effective_period=API_EFFECTIVE_PERIOD,
            row_count=len(accessgate_csv_rows),
            payload=accessgate_csv,
            declared_schema=accessgate_schema,
            generated_at=CURRENT_FILE_GENERATED_AT,
            seeded_case="declared-count-mismatch",
            seeded_case_note=(
                "This cover sheet declares the complete Active export while the file it "
                f"names holds {len(accessgate_truncated_rows)} rows."
            ),
        ),
    )

    # ------------------------------------------------------------------- RoleMatrix
    matrix = read_dataset("rolematrix.json")
    matrix_rows = [
        [entry["role"], permission]
        for entry in matrix["entries"]
        for permission in entry["permissions"]
    ]
    matrix_bytes = csv_bytes(["role", "permission"], matrix_rows, matrix["title"], matrix["generation"])
    write_bytes("role-matrix.csv", matrix_bytes)
    write_json(
        "role-matrix.cover-sheet.json",
        cover_sheet(
            source="rolematrix",
            covers="role-matrix.csv",
            title="Cover sheet for the RoleMatrix reference source",
            generation=matrix["generation"],
            effective_period={"from": "2026-01-01", "to": "2026-12-31"},
            row_count=len(matrix_rows),
            payload=matrix_bytes,
            declared_schema=["role", "permission"],
            generated_at=CURRENT_FILE_GENERATED_AT,
        ),
    )

    # --------------------------------------------------------------- ConfigRegistry
    registry = read_dataset("configregistry-baseline.json")
    registry_schema = registry["declared_schema"]
    registry_rows = [[row[field] for field in registry_schema] for row in registry["parameters"]]
    registry_bytes = csv_bytes(
        registry_schema, registry_rows, registry["title"], registry["generation"]
    )
    write_bytes("config-registry.csv", registry_bytes)
    write_json(
        "config-registry.cover-sheet.json",
        cover_sheet(
            source="configregistry-baseline",
            covers="config-registry.csv",
            title="Cover sheet for the ConfigRegistry approved baseline",
            generation=registry["generation"],
            effective_period={"from": "2026-01-01", "to": "2026-12-31"},
            row_count=len(registry_rows),
            payload=registry_bytes,
            declared_schema=registry_schema,
            generated_at=CURRENT_FILE_GENERATED_AT,
        ),
    )

    # ------------------------------------------------------------- Count endpoints
    write_json(
        "accessgate-accounts.count.json",
        api_count_file(
            source="accessgate-accounts",
            generation=accessgate["generation"],
            schema=accessgate["declared_schema"],
            rows=sorted(active_accounts, key=lambda row: row["account_id"]),
            counted_from="datasets/accessgate-accounts.json",
            count_rule=accessgate["population_rule"],
        ),
    )

    approvenow = read_dataset("approvenow-approvals.json")
    write_json(
        "approvenow-approvals.count.json",
        api_count_file(
            source="approvenow-approvals",
            generation=approvenow["generation"],
            schema=approvenow["declared_schema"],
            rows=sorted(approvenow["approvals"], key=lambda row: row["approval_id"]),
            counted_from="datasets/approvenow-approvals.json",
            count_rule="every approval decision published by ApproveNow",
        ),
    )

    peoplehub = read_dataset("peoplehub-employees.json")
    write_json(
        "peoplehub-employees.count.json",
        api_count_file(
            source="peoplehub-employees",
            generation=peoplehub["generation"],
            schema=peoplehub["declared_schema"],
            rows=sorted(peoplehub["employees"], key=lambda row: row["employee_id"]),
            counted_from="datasets/peoplehub-employees.json",
            count_rule="every employee record PeopleHub publishes",
        ),
    )

    ledgerflow = read_dataset("ledgerflow-transactions.json")
    write_json(
        "ledgerflow-transactions.count.json",
        api_count_file(
            source="ledgerflow-transactions",
            generation=ledgerflow["generation"],
            schema=ledgerflow["declared_schema"],
            rows=sorted(ledgerflow["transactions"], key=lambda row: row["transaction_id"]),
            counted_from="datasets/ledgerflow-transactions.json",
            count_rule="every processed transaction LedgerFlow publishes",
        ),
    )

    prodconsole = read_dataset("prodconsole-parameters.json")
    write_json(
        "prodconsole-parameters.count.json",
        count_file(
            source="prodconsole-parameters",
            generation=prodconsole["generation"],
            declared_count=len(prodconsole["observed_parameters"]),
            counted_from="datasets/prodconsole-parameters.json",
            count_rule="every parameter the ProdConsole configuration page shows",
        ),
    )

    loancore = read_dataset("loancore-accounts.json")
    write_json(
        "loancore-accounts.count.json",
        count_file(
            source="loancore-accounts",
            generation=loancore["generation"],
            declared_count=len(loancore["accounts"]),
            counted_from="datasets/loancore-accounts.json",
            count_rule="every account LoanCore user administration lists",
        ),
    )

    for path in sorted(GENERATED.iterdir()):
        sys.stdout.write(f"wrote {path.relative_to(HERE)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
