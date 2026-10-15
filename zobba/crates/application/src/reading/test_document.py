# Unit checks of the trusted document program's Story 24.2 `enumerate` mode,
# run over real workbooks (the committed fixtures and small in-test ones):
#   python3 -I -B crates/application/src/reading/test_document.py
# It needs openpyxl, as the pinned analysis image has.
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "..", "..", "..", "..", "fixtures", "documents")


def load():
    spec = importlib.util.spec_from_file_location("document", os.path.join(HERE, "document.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def workbook(rows, sheet="Invoices"):
    import openpyxl

    book = openpyxl.Workbook()
    ws = book.active
    ws.title = sheet
    for row in rows:
        ws.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


class Enumerate(unittest.TestCase):
    def run_enumerate(self, data, sheet, header_row, columns, max_rows=20000, chunk_rows=500, max_text=256):
        document = load()
        with tempfile.TemporaryDirectory() as root:
            document.INPUT = os.path.join(root, "input")
            document.OUTPUT = os.path.join(root, "output")
            os.makedirs(document.INPUT)
            os.makedirs(document.OUTPUT)
            with open(os.path.join(document.INPUT, "original"), "wb") as handle:
                handle.write(data)
            document.main(
                {
                    "mode": "enumerate",
                    "original": "original",
                    "sheet": sheet,
                    "header_row": header_row,
                    "columns": columns,
                    "max_rows": max_rows,
                    "chunk_rows": chunk_rows,
                    "max_text": max_text,
                }
            )
            with open(os.path.join(document.OUTPUT, "enumerated.json")) as handle:
                manifest = json.load(handle)
            rows = []
            for chunk in manifest.get("chunks", []):
                with open(os.path.join(document.OUTPUT, chunk)) as handle:
                    rows.extend(json.load(handle))
            return manifest, rows

    def test_every_row_to_the_last_row_and_only_named_columns(self):
        data = workbook(
            [
                ("AP export", None, None),
                (None, None, None),
                ("Invoice", "Amount", "Note"),
                ("000123", 1250, "first"),
                ("INV-2", 980.5, "second"),
            ]
        )
        manifest, rows = self.run_enumerate(data, "Invoices", 3, ["Amount", "Invoice"], chunk_rows=1)
        self.assertEqual(manifest["status"], "read")
        self.assertEqual((manifest["header_row"], manifest["last_row"], manifest["rows_read"], manifest["truncated"]), (3, 5, 2, False))
        self.assertEqual(manifest["columns"], [2, 1])
        self.assertEqual(len(manifest["chunks"]), 2)
        self.assertEqual(rows[0][0], 4)
        # Leading zeros kept; a number keeps its display forms.
        self.assertEqual(rows[0][1][1], ["000123"])
        self.assertIn("1,250", rows[0][1][0])
        self.assertEqual(rows[1][1][0][0], "980.5")

    def test_the_row_bound_reports_truncation(self):
        data = workbook([("Invoice",)] + [("INV-%d" % i,) for i in range(1, 8)])
        manifest, rows = self.run_enumerate(data, "Invoices", 1, ["Invoice"], max_rows=5)
        self.assertEqual((manifest["rows_read"], manifest["last_row"], manifest["truncated"]), (5, 8, True))
        self.assertEqual(len(rows), 5)

    def test_headers_must_match_exactly_once(self):
        data = workbook([("Invoice", "Amount ", "Amount2")])
        manifest, _ = self.run_enumerate(data, "Invoices", 1, ["Invoice", "Amount"])
        self.assertEqual(manifest, {"status": "header_mismatch", "reason": None, "column": "Amount"})
        twice = workbook([("Invoice", "Invoice")])
        manifest, _ = self.run_enumerate(twice, "Invoices", 1, ["Invoice"])
        self.assertEqual(manifest["status"], "header_mismatch")
        manifest, _ = self.run_enumerate(data, "Missing", 1, ["Invoice"])
        self.assertEqual(manifest["status"], "sheet_missing")

    def test_an_over_bound_text_is_null_never_cut(self):
        data = workbook([("Invoice", "Note"), ("INV-1", "x" * 300)])
        _, rows = self.run_enumerate(data, "Invoices", 1, ["Invoice", "Note"])
        self.assertEqual(rows[0][1], [["INV-1"], None])

    def test_not_a_workbook_is_unsupported_and_hostile_is_unreadable(self):
        manifest, _ = self.run_enumerate(b"Invoice,Amount\nINV-1,5\n", "Invoices", 1, ["Invoice"])
        self.assertEqual(manifest["status"], "unsupported")
        with open(os.path.join(FIXTURES, "Zip bomb.xlsx"), "rb") as handle:
            manifest, _ = self.run_enumerate(handle.read(), "Sheet1", 1, ["Invoice"])
        self.assertEqual(manifest["status"], "unreadable")
        with open(os.path.join(FIXTURES, "Encrypted.xlsx"), "rb") as handle:
            manifest, _ = self.run_enumerate(handle.read(), "Sheet1", 1, ["Invoice"])
        self.assertEqual(manifest["status"], "unreadable")

    def test_the_committed_population_fixture(self):
        with open(os.path.join(FIXTURES, "AP population.xlsx"), "rb") as handle:
            data = handle.read()
        with open(os.path.join(FIXTURES, "AP population expected.json")) as handle:
            expected = json.load(handle)
        manifest, rows = self.run_enumerate(data, "Invoices", 3, ["Invoice", "Invoice date", "Amount", "Approved", "Approved before payment", "Currency"])
        self.assertEqual(manifest["status"], "read")
        self.assertEqual(manifest["rows_read"], expected["received_rows"])
        self.assertEqual(len(rows), expected["received_rows"])
        self.assertFalse(manifest["truncated"])


if __name__ == "__main__":
    unittest.main()
