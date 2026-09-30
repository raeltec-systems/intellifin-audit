import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCursors, parseCommand, parseEvents, parseHistory, parseMessage, parseReceipt, parseSnapshot, parseTask, postCommand } from '../src/conversation.ts';
const scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
const task = { id: 'task-a', cycle_id: 'cycle-a', objective: 'Objective', working_brief: 'Retained guidance', state: 'waiting', cessation: 'confirmed', intent_revision: '2', revision: '3', execution_epoch: '1', accountable_actor: 'actor-a', accountable_label: 'Alex' };
const message = { command_id: 'command-a', key: 'key-a', author_id: 'actor-a', author_label: 'Alex', kind: 'create', task_id: 'task-a', cycle_id: 'cycle-a', target_task_id: null, target_cycle_id: null, content: 'Objective', received_cursor: '9007199254740993', applied_cursor: '9007199254740994' };
const snapshot = { scope, audience: 'engagement_members', watermark: '9007199254740994', latest_activity: { cursor: '9007199254740994', task_id: 'task-a' }, messages: [message], before_cursor: null, tasks: [task], next_task_cursor: null };

test('decimal cursors retain precision and bounded canonical integer representation', () => {
  assert.ok(compareCursors('9007199254740993', '9007199254740992') > 0);
  assert.ok(compareCursors('9', '10') < 0);
  for (const bad of [1, '', '01', '-1', '1e3', '9223372036854775808', '9'.repeat(100)]) assert.throws(() => compareCursors(bad, '0'));
});
test('snapshot validates audience, composite scope, author and command binding before exposure', () => {
  assert.deepEqual(parseSnapshot(snapshot, scope), snapshot);
  for (const bad of [{ ...snapshot, audience: 'private' }, { ...snapshot, scope: { ...scope, client_id: 'other' } },
    { ...snapshot, tasks: [task, task] }, { ...snapshot, messages: [message, message] },
    { ...snapshot, messages: [{ ...message, target_task_id: 'task-a' }] },
    { ...snapshot, messages: [{ ...message, received_cursor: '9007199254740995' }] },
    { ...snapshot, tasks: Array(101).fill(task) }]) assert.throws(() => parseSnapshot(bad, scope));
  for (const bad of [{ ...task, state: 'completed' }, { ...task, cessation: 'paused' }, { ...task, accountable_label: null }, { ...task, working_brief: 'x'.repeat(4001) }]) assert.throws(() => parseTask(bad));
});
test('latest activity is bounded and remains independent of the displayed message and Task pages', () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ ...message, key: `recent-key-${index}`, command_id: `recent-command-${index}`,
    received_cursor: String(9007199254740894n + BigInt(index)), applied_cursor: null }));
  const latest_activity = { cursor: '9007199254740994', task_id: 'older-task-outside-page' };
  const current = { ...snapshot, messages, before_cursor: messages[0].received_cursor, latest_activity };
  assert.deepEqual(parseSnapshot(current, scope).latest_activity, latest_activity);
  assert.ok(!messages.some(message => message.task_id === latest_activity.task_id));
  assert.ok(!current.tasks.some(task => task.id === latest_activity.task_id));
  const empty = { ...snapshot, watermark: '0', latest_activity: null, messages: [], tasks: [] };
  assert.equal(parseSnapshot(empty, scope).latest_activity, null);
  for (const invalid of [undefined, [], 'latest', {}, { cursor: '1' }, { task_id: 'task-a' },
    { ...latest_activity, cursor: '0' }, { ...latest_activity, cursor: '01' }, { ...latest_activity, cursor: 1 },
    { ...latest_activity, cursor: '9007199254740995' }, { ...latest_activity, cursor: '9223372036854775808' },
    { ...latest_activity, task_id: '' }, { ...latest_activity, task_id: 'task/foreign' }, { ...latest_activity, task_id: 'a'.repeat(129) }]) {
    assert.throws(() => parseSnapshot({ ...snapshot, latest_activity: invalid }, scope));
  }
  const { latest_activity: omitted, ...missing } = snapshot;
  assert.throws(() => parseSnapshot(missing, scope));
  assert.throws(() => parseSnapshot({ ...empty, latest_activity: { cursor: '1', task_id: 'task-a' } }, scope));
});
test('guidance and continuation retain source target and original receipt distinctions', () => {
  const guide = { ...message, kind: 'guide', target_task_id: 'task-a', target_cycle_id: 'cycle-a' };
  assert.equal(parseMessage(guide, snapshot.watermark).content, 'Objective');
  assert.throws(() => parseMessage({ ...guide, cycle_id: 'other' }, snapshot.watermark));
  assert.throws(() => parseMessage({ ...guide, applied_cursor: guide.received_cursor }, snapshot.watermark));
  const continued = { ...guide, kind: 'continue', cycle_id: 'cycle-new', content: null };
  assert.equal(parseMessage(continued, snapshot.watermark).target_cycle_id, 'cycle-a');
  assert.throws(() => parseReceipt({ command_id: 'command-a', task_id: 'task-a', cycle_id: 'wrong', event_cursor: '1', status: 'received' }, { key: 'k', kind: 'guide', task_id: 'task-a', cycle_id: 'cycle-a', content: 'Text' }));
});
test('history is complete bounded descending pagination with ascending immutable page rows', () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ ...message, key: `key-${index}`, command_id: `command-${index}`, received_cursor: String(index + 1), applied_cursor: null }));
  const page = { scope, audience: 'engagement_members', watermark: '200', messages, before_cursor: '1' };
  assert.equal(parseHistory(page, scope, '200', '101').messages.length, 100);
  for (const bad of [{ ...page, before_cursor: '2' }, { ...page, messages: messages.slice(1) }, { ...page, watermark: '201' }, { ...page, messages: [...messages].reverse() }]) assert.throws(() => parseHistory(bad, scope, '200', '101'));
  assert.throws(() => parseHistory(page, scope, '200', '100'));
});
test('delivery validates contiguous bounded feed without advancing over omitted rows', () => {
  const event = { cursor: '9007199254740993', task_id: 'task-a', cycle_id: 'cycle-a', command_id: 'command-a', kind: 'received' };
  const page = { scope, audience: 'engagement_members', watermark: event.cursor, events: [event], next_cursor: event.cursor, has_more: false, resync_required: false };
  assert.deepEqual(parseEvents(page, scope, '9007199254740992'), page);
  for (const bad of [{ ...page, next_cursor: '9007199254740994' }, { ...page, events: [] }, { ...page, events: [event, event] }, { ...page, has_more: true }, { ...page, resync_required: true }, { ...page, audience: 'private' }]) assert.throws(() => parseEvents(bad, scope, '9007199254740992'));
  assert.throws(() => parseEvents(page, scope, '9007199254740991'));
  assert.equal(parseEvents({ ...page, events: [], resync_required: true, next_cursor: '9007199254740992' }, scope, '9007199254740992').resync_required, true);
});
test('content uses exact Rust whitespace, Unicode byte and control bounds', () => {
  for (const content of ['x', '\ufeff', '😀'.repeat(1000), 'Line\nNext\tTab']) assert.equal(parseCommand({ kind: 'create', key: 'key', content }).content, content);
  for (const content of ['', ' \u0085', '😀'.repeat(1001), '\ud800', 'bad\u007f']) assert.throws(() => parseCommand({ kind: 'create', key: 'key', content }));
});
test('every command routes to its authoritative admission lane with exact body and fresh CSRF', async (context) => {
  const session = { identity: { id: 'actor-a', display_name: 'Alex' }, csrf_token: 'fresh-csrf' };
  for (const kind of ['create', 'guide', 'pause', 'stop', 'resume', 'continue']) {
    const command = parseCommand({ key: 'original-key', kind, task_id: kind === 'create' ? null : 'task-a', cycle_id: kind === 'create' ? null : 'cycle-a', content: ['create', 'guide'].includes(kind) ? ' exact text ' : null });
    context.mock.method(globalThis, 'fetch', async (path, options) => {
      assert.equal(new URL(path, 'https://local').pathname, `/api/engagements/engagement-a/${['guide', 'pause', 'stop'].includes(kind) ? 'task-controls' : 'task-commands'}`);
      assert.equal(options.headers['X-CSRF-Token'], 'fresh-csrf');
      assert.equal(options.headers['X-Expected-Actor'], 'actor-a');
      assert.equal(options.body, JSON.stringify(command));
      return Response.json({ command_id: 'command-a', task_id: 'task-a', cycle_id: kind === 'continue' ? 'cycle-new' : 'cycle-a', status: 'received', event_cursor: '1' });
    });
    assert.equal((await postCommand(scope, session, command, new AbortController().signal)).status, 'received');
    context.mock.restoreAll();
  }
});

test('future cursors, explicit gaps, and impossible Applied facts cannot become current state', () => {
  const feed = { scope, audience: 'engagement_members', watermark: '2', events: [], next_cursor: '3', has_more: false, resync_required: true };
  assert.equal(parseEvents(feed, scope, '3').resync_required, true);
  assert.throws(() => parseEvents({ ...feed, resync_required: false }, scope, '3'));
  assert.throws(() => parseMessage({ ...message, applied_cursor: '9007199254740995' }, snapshot.watermark));
  assert.throws(() => parseMessage({ ...message, target_task_id: undefined, target_cycle_id: undefined, content: undefined }, snapshot.watermark));
});
