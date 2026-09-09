"""Test-only canonical single-leaver CSV/cover generator; independent of TS reconciliation."""
import csv
import hashlib
import hmac
import io
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
dataset = json.loads((root / 'fixtures/northstar/datasets/leavers-export.json').read_text())
selected = [row for row in dataset['rows'] if row['employee_id'] == sys.argv[1]]
if len(selected) != 1:
    raise SystemExit('Single-case source requires exactly one canonical employee row')
schema = list(dataset['declared_schema'])
# D3: the optional termination INSTANT, joined from PeopleHub by employee id and declared as
# one more column, so a bound version's explicit field mapping has a column to read. The
# date column stays: inclusion still uses it, and the two are different facts.
with_time = len(sys.argv) > 2 and sys.argv[2] == 'with-termination-time'
if with_time:
    people = json.loads((root / 'fixtures/northstar/datasets/peoplehub-employees.json').read_text())
    matches = [row for row in people['employees'] if row['employee_id'] == sys.argv[1]]
    if len(matches) != 1:
        raise SystemExit('Single-case source with a termination instant requires exactly one PeopleHub record')
    schema.append('termination_effective_time')
    selected = [{**selected[0], 'termination_effective_time': matches[0]['termination_effective_time']}]
stream = io.StringIO(newline='')
stream.write('# SYNTHETIC-NORTHSTAR-FIXTURE | canonical single-case source\n')
writer = csv.writer(stream, lineterminator='\n')
writer.writerow(schema)
for row in selected:
    writer.writerow([row[column] for column in schema])
raw = stream.getvalue()
# This is a separately published case source. Canonical row values, effective period and
# original generation timestamp are retained; no date/count is invented to mask bad input.
base = json.loads((root / 'fixtures/northstar/generated/leavers-export.cover-sheet.json').read_text())
cover = {key: base[key] for key in ['source', 'covers', 'generation', 'generated_at', 'effective_period', 'complete', 'row_count', 'declared_schema', 'content_digest', 'format']}
cover.update(source='canonical-single-leaver', covers='single-leaver.csv', generation=dataset['generation'] + '.single-' + sys.argv[1] + ('.with-termination-time' if with_time else ''),
             row_count=len(selected), declared_schema=schema, content_digest={'algorithm': 'sha256', 'value': hashlib.sha256(raw.encode('utf-8')).hexdigest()})
signed = json.dumps(cover, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
cover['signature'] = {'scheme': 'synthetic-hmac-sha256', 'key_id': 'northstar-cover-sheet-2026', 'key_is_published': True,
                      'value': hmac.new(b'northstar-synthetic-cover-sheet-key-2026', signed.encode('utf-8'), hashlib.sha256).hexdigest()}
print(json.dumps({'csv': raw, 'cover': cover, 'row': selected[0], 'schema': schema, 'period': dataset['hero_period']}))
