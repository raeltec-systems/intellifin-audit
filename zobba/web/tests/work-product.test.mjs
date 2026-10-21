import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  JUDGMENT_LABEL, MAX_BYTES, NOT_COMPLETED, REVIEW_STATE, editBlocks, editErrorLabel, exportErrorLabel, parseExport, parseShelf, parseSupport, parseVersion,
  refreshReasons, refusalLabel, refusals, textProblem,
} from '../src/work-product.ts';

// The exact JSON `crates/worker/tests/work_product.rs` recorded from the real
// API (identifiers, digests and times replaced by stable ones).
const recorded = JSON.parse(readFileSync(new URL('./fixtures/work-product.json', import.meta.url), 'utf8'));
const stale = JSON.parse(readFileSync(new URL('./fixtures/work-product-stale.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const blocks = v => v.sections.flatMap(s => s.blocks);
const claimBlocks = v => blocks(v).filter(b => b.claim);

test('the recorded shelf, version and support parse exactly', () => {
  const shelf = parseShelf(recorded.shelf);
  assert.deepEqual(shelf, recorded.shelf);
  assert.equal(shelf.total, '1');
  assert.equal(shelf.products[0].review_state, REVIEW_STATE);
  assert.deepEqual(shelf.products[0].missing_required, ['conclusion']);
  const v = recorded.version;
  const version = parseVersion(v, { product: v.product.id, version: v.id });
  assert.deepEqual(version, v);
  assert.deepEqual(version.sections.map(s => s.id), ['objective', 'results', 'conclusion']);
  assert.equal(version.sections[2].not_completed, NOT_COMPLETED);
  assert.equal(blocks(version).find(b => b.label === 'judgment').label_words, JUDGMENT_LABEL);
  assert.deepEqual(claimBlocks(version).map(b => b.claim.number), ['1', '2', '3', '4', '5']);
  assert.ok(claimBlocks(version).every(b => b.claim.current));
  const quote = claimBlocks(version).flatMap(b => b.claim.assertions).find(a => a.kind === 'quote');
  assert.equal(quote.source.original_id, quote.record_id, 'a quote opens its exact original');
  const block = claimBlocks(version)[0].id;
  assert.deepEqual(parseSupport(recorded.support, block), recorded.support);
  assert.throws(() => parseSupport(recorded.support, claimBlocks(version)[1].id), 'support of a different claim');
  const text = JSON.stringify(recorded);
  assert.ok(!text.includes('confidence'));
  assert.ok(!/%|percent/.test(text), 'no percentages');
});

test('a stale version names its refresh reasons and the newer version, never swapping it in', () => {
  const version = parseVersion(stale);
  assert.deepEqual(version, stale);
  assert.ok(version.newer_version_id, 'a newer version is announced');
  assert.equal(version.newer_version_id, version.product.version_id);
  const needing = claimBlocks(version).filter(b => !b.claim.current);
  assert.equal(String(needing.length), version.refresh);
  assert.ok(needing.every(b => b.claim.refresh.length && b.claim.refresh.every(r => refreshReasons.includes(r))));
  // The limitations name them in claim order.
  const numbers = version.limitations.filter(l => l.startsWith('Claim [')).map(l => Number(l.slice(7, l.indexOf(']'))));
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
});

test('each version rule refuses exactly its own defect, and says which', () => {
  const v = recorded.version;
  const claimAt = (w, i) => claimBlocks(w)[i];
  const quoteOf = w => claimBlocks(w).flatMap(b => b.claim.assertions).find(x => x.kind === 'quote');
  const factOf = w => claimBlocks(w).find(b => b.claim.assertions.some(x => x.kind === 'fact'));
  // [what is wrong, the rule that must refuse it (null: the exact field set), mutation]
  const cases = [
    ['an unknown field (for example a confidence score)', null, w => { w.confidence = '0.9'; }],
    ['a review state other than Draft', null, w => { w.review_state = 'Reviewed'; }],
    ['a refresh count that is not its claims', 'refresh', w => { w.refresh = '1'; }],
    ['a stale claim shown as current', 'claim-current', w => { claimAt(w, 0).claim.refresh = ['evaluation_revised']; claimAt(w, 0).claim.refresh_words = ['x']; }],
    ['claims not numbered in order', 'claim-order', w => { claimAt(w, 1).claim.number = '3'; }],
    ['a judgment block without its label', 'judgment-words', w => { blocks(w).find(b => b.label === 'judgment').label_words = null; }],
    ['a missing required section not said', 'missing-required', w => { w.sections[2].not_completed = null; }],
    ['a newer version swapped in silently', 'newer-version', w => { w.product.version_id = w.id.replace(/.$/, 'f'); }],
    ['a withheld quote that still shows its text', 'withheld-value', w => { quoteOf(w).withheld = true; }],
    ['a count without a measure', 'count-measure', w => { claimAt(w, 0).claim.assertions[0].measure = null; }],
    ['a second limitations block', 'limitations-once', w => { const l = clone(w.sections[2].blocks[0]); l.ordinal = String(blocks(w).length); l.id = `blk-${'e'.repeat(40)}`; w.sections[0].blocks.push(l); }],
    ['an agent block not labelled as Zobba', 'agent-label', w => { blocks(w)[0].author_label = 'Someone'; }],
    ['a different version than asked', 'expected-version', w => { w.id = w.product.version_id.replace(/.$/, 'e'); }],
    ['two blocks at one position', 'block-ordinal', w => { blocks(w)[1].ordinal = blocks(w)[0].ordinal; }],
    ['a withheld claim whose sentence still shows', 'claim-withheld', w => { claimAt(w, 0).claim.withheld = true; }],
    ['a sentence withheld from a claim that is not', 'text-withheld', w => { claimAt(w, 0).text_withheld = true; claimAt(w, 0).text = null; }],
    ['a platform refresh count that is not its blocks', 'platform-refresh', w => { w.platform_refresh = '1'; }],
    ['a heading block that needs refresh', 'block-refresh-kind', w => { blocks(w)[0].refresh = ['summary_superseded']; blocks(w)[0].refresh_words = ['x']; }],
    ['a change request on a person\'s version', 'change-request', w => {
      w.author_kind = 'human';
      w.change_request = { requested_by: 'actor-a', requested_by_label: null, request_id: 'cmd-1', proposal_id: `wpp-${'1'.repeat(40)}`, confirmation_id: `wpd-${'1'.repeat(40)}`, words: "Changed by the agent at actor-a's request" };
    }],
    ['a proposal naming a block of another version', 'proposal-blocks', w => {
      w.proposals = [{ id: `wpp-${'1'.repeat(40)}`, request_id: 'cmd-1', version_id: `wpv-${'9'.repeat(40)}`, title: 'T', changes: [{ block_id: `blk-${'9'.repeat(40)}`, change: 'removed', before: 'x', after: null }], decision: null, recorded_us: '1' }];
    }],
  ];
  for (const [name, rule, mutate] of cases) {
    const w = clone(v);
    mutate(w);
    assert.throws(() => parseVersion(w, { product: v.product.id, version: v.id }), rule ? new RegExp(`: ${rule}$`) : undefined, name);
  }
  // A fact withheld for this viewer carries no value, and its claim's
  // sentence is withheld too.
  const w = clone(v);
  const f = factOf(w);
  if (f) {
    const a = f.claim.assertions.find(x => x.kind === 'fact');
    a.withheld = true; a.value = null; f.claim.withheld = true; f.text_withheld = true; f.text = null;
    w.withheld = String(Number(w.withheld) + 1);
    assert.equal(parseVersion(w).withheld, w.withheld);
  }
  // A version recorded before the review round keeps its rule.
  const old = clone(v);
  old.figure_rule = 'statement_figures_v1';
  assert.equal(parseVersion(old).figure_rule, 'statement_figures_v1');
  assert.throws(() => parseVersion({ ...clone(v), figure_rule: 'statement_figures_v3' }));
  // Any identifier the server accepts names a section.
  const ids = clone(v);
  ids.sections[0].id = 'Objective-1';
  for (const b of ids.sections[0].blocks) b.section_id = 'Objective-1';
  assert.equal(parseVersion(ids).sections[0].id, 'Objective-1');
});

test('the shelf pages by ID and counts exactly', () => {
  const s = clone(recorded.shelf);
  s.total = '0';
  assert.throws(() => parseShelf(s), 'more products than the total');
  const t = clone(recorded.shelf);
  t.next_cursor = t.products[0].id;
  assert.throws(() => parseShelf(t), 'a next page after a short page');
  const u = clone(recorded.shelf);
  u.products[0].refresh = '9';
  assert.throws(() => parseShelf(u), 'more claims needing refresh than claims');
});

test('exports are bound to their version and renderer', () => {
  const record = {
    id: `wpx-${'1'.repeat(40)}`, version_id: recorded.version.id, format: 'docx',
    media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', renderer: 'zobba-export-v2',
    digest: 'a'.repeat(64), size: '1024', withheld_digest: 'b'.repeat(64), refresh_count: '0', recorded_us: '1',
  };
  assert.deepEqual(parseExport(record, recorded.version.id), record);
  assert.throws(() => parseExport({ ...record, media_type: 'application/pdf' }), 'the format\'s own media type');
  assert.throws(() => parseExport(record, `wpv-${'2'.repeat(40)}`), 'another version');
  assert.throws(() => parseExport({ ...record, renderer: 'other' }));
  // An export made before the review round keeps its renderer.
  assert.equal(parseExport({ ...record, renderer: 'zobba-export-v1' }).renderer, 'zobba-export-v1');
});

test('a neutral template says so; a firm template\'s own name may end with any words', () => {
  const s = clone(recorded.shelf);
  s.products[0].neutral = true;
  assert.throws(() => parseShelf(s), /: neutral-label$/);
  s.products[0].template = `${s.products[0].template} · Neutral starter (not firm methodology)`;
  assert.equal(parseShelf(s).products[0].neutral, true);
  const t = clone(recorded.shelf);
  t.products[0].template = 'Our Neutral starter (not firm methodology)';
  assert.equal(parseShelf(t).products[0].neutral, false);
});

test('an edit keeps blocks by ID and sends only changed text, bounded in bytes', () => {
  const draft = [
    { id: `blk-${'1'.repeat(40)}`, kind: 'heading', text: 'Approval testing', original: 'Approval testing' },
    { id: `blk-${'2'.repeat(40)}`, kind: 'narrative', text: 'Edited.', original: 'Old.' },
    { id: `blk-${'3'.repeat(40)}`, kind: 'limitations', text: null, original: null },
  ];
  assert.deepEqual(editBlocks(draft), [{ block: draft[0].id }, { block: draft[1].id, text: 'Edited.' }, { block: draft[2].id }]);
  assert.equal(textProblem('claim', 'a'.repeat(MAX_BYTES.claim)), null);
  assert.match(textProblem('claim', 'é'.repeat(MAX_BYTES.claim / 2 + 1)), /bytes/, 'UTF-8 bytes, not characters');
  assert.match(textProblem('narrative', '   '), /Write something/);
  assert.equal(textProblem('limitations', ''), null);
});

test('every closed reason and error has words', () => {
  for (const r of refusals) assert.ok(refusalLabel[r], r);
  for (const e of ['work_product_edit_invalid', 'access_denied', 'work_product_not_found', 'stale_base', 'work_product_refused', 'work_product_edit_conflict', 'work_product_capacity', 'work_product_unavailable']) assert.ok(editErrorLabel[e], e);
  for (const e of ['work_product_export_invalid', 'access_denied', 'work_product_not_found', 'work_product_export_conflict', 'export_scope_changed', 'work_product_export_integrity', 'work_product_export_unfrozen', 'work_product_export_unavailable']) assert.ok(exportErrorLabel[e], e);
  for (const r of refreshReasons) assert.ok(r.length > 0);
  assert.ok(refreshReasons.includes('basis_superseded'));
});
