import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessError } from '../src/auth.ts';
import { ConversationController, OutboxStore, OUTBOX_LIMIT, ORDINARY_OUTBOX_LIMIT } from '../src/conversation-state.ts';
import { LegacyRecoveryError } from '../src/conversation-outbox.ts';

const scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
const session = { identity: { id: 'actor-a', display_name: 'Alex' }, csrf_token: 'fresh-token' };
const task = { id: 'task-a', cycle_id: 'cycle-a', objective: 'Objective', working_brief: 'Objective', state: 'ready', cessation: 'none', intent_revision: '1', revision: '1', execution_epoch: '0', accountable_actor: 'actor-a', accountable_label: 'Alex' };
const receipt = { command_id: 'command-a', task_id: 'task-a', cycle_id: 'cycle-a', event_cursor: '1', status: 'received' };
const empty = { scope, audience: 'engagement_members', latest_activity: null, watermark: '0', messages: [], before_cursor: null, tasks: [], next_task_cursor: null };
const command = { key: 'original-key', kind: 'guide', task_id: 'task-a', cycle_id: 'cycle-a', content: 'Exact guidance\n  retained' };
const message = { command_id: 'command-a', key: command.key, author_id: 'actor-a', author_label: 'Alex', kind: command.kind, task_id: 'task-a', cycle_id: 'cycle-a', target_task_id: command.task_id, target_cycle_id: command.cycle_id, content: command.content, received_cursor: '1', applied_cursor: null };
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
async function persistConflict(store, request) {
  if (!(await store.read()).some(item => item.key === request.key)) await store.reserve(request);
  return store.save(request, 'conflict');
}
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}
function controller(context, overrides = {}, storage = memory(), actor = 'actor-a', selectedScope = scope) {
  let failed = 0;
  const store = new OutboxStore(actor, selectedScope, () => storage);
  const client = new ConversationController(actor, selectedScope, () => failed++, {
    store, session: async () => session, engagement: async () => selectedScope,
    snapshot: async () => empty, events: async (_scope, after) => ({ scope, audience: 'engagement_members', watermark: after, events: [], next_cursor: after, has_more: false, resync_required: false }),
    post: async () => receipt, uuid: () => command.key, ...overrides,
  });
  context.after(() => client.setAccess(false));
  return { client, store, storage, get failures() { return failed; } };
}

test('outbox persists immutable meaning per actor and complete scope, never credentials', async () => {
  const storage = memory(), store = new OutboxStore('actor-a', scope, () => storage);
  await store.reserve(command);
  assert.deepEqual((await new OutboxStore('actor-a', scope, () => storage).read())[0].command, command);
  assert.equal((await new OutboxStore('actor-b', scope, () => storage).read()).length, 0);
  for (const part of Object.keys(scope)) assert.equal((await new OutboxStore('actor-a', { ...scope, [part]: 'different' }, () => storage).read()).length, 0);
  await assert.rejects(() => store.save({ ...command, content: 'material edit' }), /chang(?:e|ed) meaning/);
  await assert.rejects(() => store.save({ ...command, cycle_id: 'new-cycle' }), /chang(?:e|ed) meaning/);
  assert.ok([...storage.data.values()].every(value => !value.includes('csrf') && !value.includes('fresh-token')));
});
test('ordinary uncertain work leaves bounded independent Pause/Stop recovery capacity', async () => {
  const storage = memory(), bounded = new OutboxStore('actor-a', scope, () => storage);
  for (let index = 0; index < ORDINARY_OUTBOX_LIMIT; index++) await bounded.reserve({ ...command, key: `guide-${index}` });
  await assert.rejects(() => bounded.reserve({ ...command, key: 'ordinary-overflow' }), /full/);
  await bounded.reserve({ ...command, key: 'pause', kind: 'pause', content: null });
  await bounded.reserve({ ...command, key: 'stop', kind: 'stop', content: null });
  assert.equal((await bounded.read()).length, OUTBOX_LIMIT);
  await assert.rejects(() => bounded.reserve({ ...command, key: 'stop-overflow', kind: 'stop', content: null }), /full/);
});
test('storage failure prevents even starting admission and preserves editable caller input', async context => {
  let posts = 0, accessReads = 0;
  const storage = memory(); storage.setItem = () => { throw new Error('Quota exceeded'); };
  const { client } = controller(context, { session: async () => { accessReads++; return session; }, post: async () => { posts++; return receipt; } }, storage);
  client.setAccess(true); await flush();
  const input = { ...command }; delete input.key;
  assert.equal(await client.submit(input), false);
  assert.equal(input.content, command.content); assert.equal(posts, 0); assert.equal(accessReads, 0);
  assert.match(client.getSnapshot().error, /Not sent/);
});
test('lost committed acknowledgement survives reload and retry sends original meaning with fresh access', async context => {
  const storage = memory(); let posts = 0, accesses = 0;
  const first = controller(context, { post: async (_scope, _session, sent) => { posts++; assert.deepEqual(sent, command); throw new Error('ACK lost'); } }, storage);
  first.client.setAccess(true); await flush();
  assert.equal(await first.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content }), true);
  assert.equal((await first.store.read()).length, 1); first.client.setAccess(false);
  const second = controller(context, {
    session: async () => { accesses++; return session; },
    post: async (_scope, sentSession, sent) => { assert.equal(accesses, 1); assert.equal(sentSession.csrf_token, 'fresh-token'); assert.deepEqual(sent, command); posts++; return receipt; },
  }, storage);
  second.client.setAccess(true); await flush();
  assert.equal(posts, 1, 'reload must never auto replay');
  assert.equal(await second.client.retry(command.key), true);
  assert.equal(posts, 2); assert.equal((await second.store.read()).length, 0);
});
test('reconciliation requires original author plus exact key, content and target, never a similar echo', async context => {
  for (const changed of [{ author_id: 'actor-b' }, { content: 'different' }, { target_cycle_id: 'other-cycle' }, { key: 'other-key' }, {}]) {
    const storage = memory(); const store = new OutboxStore('actor-a', scope, () => storage); await store.reserve(command);
    const { client } = controller(context, { snapshot: async () => ({ ...empty, watermark: '1', messages: [{ ...message, ...changed }], tasks: [task] }) }, storage);
    client.setAccess(true); await flush();
    assert.equal((await store.read()).length, Object.keys(changed).length ? 1 : 0);
    client.setAccess(false);
  }
});
test('retry refuses changed actor and revoked membership before any transmission', async context => {
  for (const access of [{ session: async () => ({ ...session, identity: { id: 'actor-b', display_name: 'Blair' } }) }, { engagement: async () => { throw new AccessError(403); } }]) {
    let posts = 0;
    const state = controller(context, { ...access, post: async () => { posts++; return receipt; } });
    await state.store.reserve(command); state.client.setAccess(true); await flush();
    assert.equal(await state.client.retry(command.key), false);
    assert.equal(posts, 0); assert.equal(state.failures, 1);
    assert.equal(state.client.getSnapshot().messages.length, 0); assert.equal(state.client.getSnapshot().pending.length, 0);
    assert.equal((await state.store.read()).length, 1);
  }
});
test('old snapshot and old acknowledgement cannot repopulate withdrawn projections or remove uncertain recovery', async context => {
  const snapshot = deferred(), acknowledgement = deferred();
  const state = controller(context, { snapshot: () => snapshot.promise, post: () => acknowledgement.promise });
  state.client.setAccess(true);
  const submit = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  await flush(); state.client.setAccess(false);
  snapshot.resolve({ ...empty, watermark: '1', tasks: [task], messages: [message] });
  acknowledgement.resolve(receipt); await submit; await flush();
  assert.deepEqual(state.client.getSnapshot().tasks, []); assert.deepEqual(state.client.getSnapshot().messages, []);
  assert.equal((await state.store.read()).length, 1);
});
test('409 preserves exact original bytes with an explicit refused state', async context => {
  const state = controller(context, { post: async () => { throw new AccessError(409); } });
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  assert.equal(await state.client.retry(command.key), false);
  assert.equal((await state.store.read())[0].status, 'conflict'); assert.deepEqual((await state.store.read())[0].command, command);
  assert.match(state.client.getSnapshot().error, /conflicts/);
});
test('Pause admission remains independent of a blocked read and another pending write', async context => {
  const blocked = deferred(); const posted = [];
  const state = controller(context, { snapshot: () => blocked.promise, post: async (_scope, _session, request) => {
    posted.push(request.kind); return request.kind === 'guide' ? blocked.promise : receipt;
  }, uuid: (() => { let n = 0; return () => `key-${++n}`; })() });
  state.client.setAccess(true);
  const guide = state.client.submit({ kind: 'guide', task_id: task.id, cycle_id: task.cycle_id, content: 'guide' });
  await flush();
  assert.equal(await state.client.control(task, 'pause'), true);
  assert.deepEqual(posted, ['guide', 'pause']);
  state.client.setAccess(false); blocked.resolve(receipt); await guide;
});
test('new access generation ignores a late failure from an older read', async context => {
  const old = deferred(); let count = 0;
  const state = controller(context, { snapshot: () => ++count === 1 ? old.promise : Promise.resolve({ ...empty, watermark: '1', messages: [message], tasks: [task] }) });
  state.client.setAccess(true); state.client.setAccess(false); state.client.setAccess(true); await flush();
  old.reject(new AccessError(403)); await flush();
  assert.equal(state.failures, 0); assert.equal(state.client.getSnapshot().tasks.length, 1); assert.equal(state.client.getSnapshot().connection, 'connected');
});

test('reserved first-send and same-key retry never wait on ordinary access reads', async context => {
  let ordinaryReads = 0, posts = 0;
  const state = controller(context, { initialSession: session,
    session: async () => { ordinaryReads++; throw new Error('ordinary capacity held'); },
    engagement: async () => { ordinaryReads++; throw new Error('ordinary capacity held'); },
    post: async (_scope, current, sent) => {
      assert.equal(current.identity.id, 'actor-a'); assert.equal(sent.kind, 'pause');
      posts++; if (posts === 1) throw new Error('lost acknowledgement'); return receipt;
    },
  });
  state.client.setAccess(true); await flush();
  assert.equal(await state.client.control(task, 'pause'), true);
  assert.equal((await state.store.read()).length, 1);
  assert.equal(await state.client.retry(command.key), true);
  assert.equal(posts, 2); assert.equal(ordinaryReads, 0);
});
test('reserved retry with replaced cookie refuses without adopting another actor', async context => {
  const state = controller(context, { initialSession: session,
    post: async (_scope, current) => { assert.equal(current.identity.id, 'actor-a'); throw new AccessError(403); },
  });
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  assert.equal(await state.client.retry(command.key), false);
  assert.equal(state.failures, 1); assert.equal((await state.store.read()).length, 1);
  assert.deepEqual(state.client.getSnapshot().pending, []);
});
test('only a definite refusal can be dismissed; uncertain requests keep their exact recovery key', async context => {
  const state = controller(context);
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  await state.client.acknowledgeRefusal(command.key); assert.equal((await state.store.read()).length, 1);
  await persistConflict(state.store, command); await state.client.acknowledgeRefusal(command.key); assert.equal((await state.store.read()).length, 0);
});
test('same-scope checking preserves hidden nodes while failures withdraw all projection content', async context => {
  const state = controller(context, { snapshot: async () => ({ ...empty, watermark: '1', messages: [message], tasks: [task] }) });
  state.client.setAccess(true); await flush();
  const saved = state.client.getSnapshot();
  state.client.setAccess(false, true);
  assert.equal(state.client.getSnapshot().tasks, saved.tasks); assert.equal(state.client.getSnapshot().messages, saved.messages);
  assert.equal(await state.client.retry('anything'), false);
  state.client.setAccess(false);
  assert.deepEqual(state.client.getSnapshot().tasks, []); assert.deepEqual(state.client.getSnapshot().messages, []);
});
test('later Task pages refresh after invalidation and never accumulate an unbounded buffer', async context => {
  let taskReads = 0;
  const laterTask = { ...task, id: 'task-z' };
  const state = controller(context, {
    snapshot: async () => ({ ...empty, watermark: '1', tasks: [task], next_task_cursor: 'task-a' }),
    tasks: async (_scope, after) => { assert.equal(after, 'task-a'); taskReads++; return { tasks: [{ ...laterTask, state: taskReads > 1 ? 'paused' : 'running' }], next_cursor: null }; },
  });
  state.client.setAccess(true); await flush();
  await state.client.loadTaskPage();
  assert.equal(state.client.getSnapshot().tasks[0].state, 'running');
  state.client.setAccess(false, true); state.client.setAccess(true, true); await flush();
  assert.equal(taskReads, 2); assert.equal(state.client.getSnapshot().tasks[0].state, 'paused');
  assert.equal(state.client.getSnapshot().tasks.length, 1);
});

test('ordinary retry refreshes access even when an App session is still in memory', async context => {
  let accessReads = 0, posts = 0;
  const create = { ...command, kind: 'create', task_id: null, cycle_id: null };
  const state = controller(context, { initialSession: session,
    session: async () => { accessReads++; return { ...session, csrf_token: 'renewed-csrf' }; },
    post: async (_scope, current) => { posts++; assert.equal(current.csrf_token, 'renewed-csrf'); return receipt; },
  });
  await state.store.reserve(create); state.client.setAccess(true); await flush();
  assert.equal(await state.client.retry(create.key), true);
  assert.equal(accessReads, 1); assert.equal(posts, 1);
});

test('concurrent storage reservations preserve immutable records and the scoped quota', async () => {
  const storage = memory(), tabs = [new OutboxStore('actor-a', scope, () => storage), new OutboxStore('actor-a', scope, () => storage)];
  const writes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => tabs[index % 2].reserve({ ...command, key: `tab-${index}` })));
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, ORDINARY_OUTBOX_LIMIT);
  assert.equal((await tabs[0].read()).length, ORDINARY_OUTBOX_LIMIT);
  assert.equal(new Set((await tabs[0].read()).map(item => item.key)).size, ORDINARY_OUTBOX_LIMIT);
});
test('global recovery capacity and storage scanning are bounded without reading another actor content', async () => {
  const { GLOBAL_OUTBOX_LIMIT, STORAGE_KEY_SCAN_LIMIT } = await import('../src/conversation-state.ts');
  const storage = memory();
  for (let index = 0; index < GLOBAL_OUTBOX_LIMIT; index++) {
    await new OutboxStore(`actor-${index}`, scope, () => storage).reserve({ ...command, key: `key-${index}`, kind: 'pause', content: null });
  }
  const store = new OutboxStore('actor-other', scope, () => storage);
  await assert.rejects(() => store.reserve({ ...command, kind: 'pause', content: null }), /outbox is full/);
  storage.getItem = () => { throw new Error('Other actor payload must not be read'); };
  assert.deepEqual((await store.read()), []);
  while (storage.length <= STORAGE_KEY_SCAN_LIMIT) storage.setItem(`unrelated-${storage.length}`, 'unrelated');
  await assert.rejects(() => store.read(), /unavailable/);
});

test('an obsolete history failure cannot erase a newer explicitly resynchronised view', async context => {
  const history = deferred();
  const state = controller(context, { snapshot: async () => ({ ...empty, watermark: '1', tasks: [task], messages: [message], before_cursor: '1' }), history: () => history.promise });
  state.client.setAccess(true); await flush();
  const earlier = state.client.loadEarlier();
  state.client.resync(); await flush();
  history.reject(new Error('old page unavailable')); await earlier; await flush();
  assert.equal(state.client.getSnapshot().tasks[0].id, 'task-a');
  assert.equal(state.client.getSnapshot().connection, 'connected');
  assert.equal(state.client.getSnapshot().error, null);
});

test('a continued Task stays on its later page so an old composer cycle remains visibly stale', async context => {
  let continued = false;
  const state = controller(context, {
    snapshot: async () => ({ ...empty, watermark: '1', tasks: [task], next_task_cursor: 'task-a' }),
    tasks: async () => ({ tasks: [{ ...task, id: 'task-z', cycle_id: continued ? 'cycle-new' : 'cycle-a' }], next_cursor: null }),
    post: async () => { continued = true; return { ...receipt, task_id: 'task-z', cycle_id: 'cycle-new' }; },
  });
  state.client.setAccess(true); await flush(); await state.client.loadTaskPage();
  const selected = state.client.getSnapshot().tasks[0];
  assert.equal(await state.client.control(selected, 'continue'), true); await flush();
  assert.equal(state.client.getSnapshot().tasks[0].id, 'task-z');
  assert.equal(state.client.getSnapshot().tasks[0].cycle_id, 'cycle-new');
  assert.equal(selected.cycle_id, 'cycle-a', 'saved target is never silently rewritten');
});

test('successful reconnect clears the transient read failure after restoring server content', async context => {
  let unavailable = true;
  const state = controller(context, { snapshot: async () => {
    if (unavailable) throw new Error('temporary outage');
    return { ...empty, watermark: '1', tasks: [task] };
  } });
  state.client.setAccess(true); await flush();
  assert.equal(state.client.getSnapshot().connection, 'reconnecting');
  assert.match(state.client.getSnapshot().error, /Conversation unavailable/);
  unavailable = false; state.client.resync(); await flush();
  assert.equal(state.client.getSnapshot().connection, 'connected');
  assert.equal(state.client.getSnapshot().tasks[0].id, task.id);
  assert.equal(state.client.getSnapshot().error, null);
});

test('successful snapshots and outage recovery preserve unresolved command refusals', async context => {
  let unavailable = false;
  const state = controller(context, {
    post: async () => { throw new AccessError(409); },
    snapshot: async () => { if (unavailable) throw new Error('outage'); return empty; },
  });
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  await state.client.retry(command.key);
  const refusal = state.client.getSnapshot().error;
  assert.match(refusal, /conflicts/);
  state.client.resync(); await flush();
  assert.equal(state.client.getSnapshot().error, refusal);
  unavailable = true; state.client.resync(); await flush();
  assert.match(state.client.getSnapshot().error, /Conversation unavailable/);
  unavailable = false; state.client.resync(); await flush();
  assert.equal(state.client.getSnapshot().connection, 'connected');
  assert.equal(state.client.getSnapshot().error, refusal);
  assert.equal((await state.store.read())[0].status, 'conflict');
});

test('a successful projection cannot clear an unresolved recovery-storage send failure', async context => {
  const storage = memory(); storage.setItem = () => { throw new Error('Quota exceeded'); };
  const state = controller(context, {}, storage);
  state.client.setAccess(true); await flush();
  assert.equal(await state.client.submit({ kind: 'create', content: 'Draft remains editable' }), false);
  const failure = state.client.getSnapshot().error;
  assert.match(failure, /recovery storage/);
  state.client.resync(); await flush();
  assert.equal(state.client.getSnapshot().connection, 'connected');
  assert.equal(state.client.getSnapshot().error, failure);
});

test('a later Task page cannot begin before its snapshot or remain stale behind the installed watermark', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const snapshot = deferred();
  const page = deferred();
  const order = [];
  const afterCursors = [];
  let snapshots = 0, pages = 0, publishedCycle = 'cycle-old';
  const state = controller(context, {
    snapshot: async () => {
      snapshots++;
      if (snapshots === 1) return { ...empty, watermark: '202', tasks: [task], next_task_cursor: 'task-a' };
      order.push('snapshot-start');
      const result = await snapshot.promise;
      // The new cycle is committed and visible when the snapshot response completes.
      publishedCycle = 'cycle-new'; order.push('snapshot-finish');
      return result;
    },
    tasks: async (_scope, after) => {
      assert.equal(after, 'task-a'); pages++;
      const read = { tasks: [{ ...task, id: 'task-z', cycle_id: publishedCycle }], next_cursor: null };
      if (pages === 1) return read;
      order.push(`page-start:${publishedCycle}`);
      await page.promise;
      return read;
    },
    events: async (_scope, after) => {
      afterCursors.push(after);
      return { scope, audience: 'engagement_members', watermark: '203', events: after === '202'
        ? [{ cursor: '203', task_id: 'task-z', cycle_id: 'cycle-new', command_id: 'continue', kind: 'received' }] : [],
      next_cursor: '203', has_more: false, resync_required: false };
    },
  });
  state.client.setAccess(true); await flush(); await state.client.loadTaskPage();
  assert.equal(state.client.getSnapshot().tasks[0].cycle_id, 'cycle-old');
  context.mock.timers.tick(2000); await flush();
  assert.deepEqual(order, ['snapshot-start']);
  assert.equal(pages, 1, 'the later SQL page must not start while its snapshot is pending');
  snapshot.resolve({ ...empty, watermark: '203', tasks: [task], next_task_cursor: 'task-a' }); await flush();
  assert.deepEqual(order, ['snapshot-start', 'snapshot-finish', 'page-start:cycle-new']);
  assert.equal(state.client.getSnapshot().tasks[0].cycle_id, 'cycle-old', 'do not partially publish the new snapshot before its dependent page resolves');
  page.resolve(); await flush();
  assert.equal(state.client.getSnapshot().tasks[0].cycle_id, 'cycle-new');
  context.mock.timers.tick(2000); await flush();
  assert.deepEqual(afterCursors, ['202', '203']);
  assert.equal(state.client.getSnapshot().tasks[0].cycle_id, 'cycle-new', 'an empty next feed retains a page at least as recent as its watermark');
  assert.equal(snapshots, 2);
});

test('R1 a persisted handoff survives access revalidation without sending under its obsolete generation', async context => {
  const reservation = deferred(); const keys = []; let posts = 0;
  const state = controller(context, { post: async () => { posts++; return receipt; } });
  state.store.reserveOriginal = state.store.reserve.bind(state.store);
  state.store.reserve = async request => { await reservation.promise; return state.store.reserveOriginal(request); };
  state.client.setAccess(true); await flush();
  const submitting = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content }, key => keys.push(key));
  await flush();
  state.client.setAccess(false, true); state.client.setAccess(true, true); await flush();
  assert.equal(state.client.getSnapshot().pending.length, 0);
  reservation.resolve();
  assert.equal(await submitting, true, 'the original unchanged draft can clear after durable storage handoff');
  assert.deepEqual(keys, [command.key]); assert.equal(posts, 0);
  assert.equal((await state.store.read()).length, 1);
  assert.equal(state.client.getSnapshot().pending[0].key, command.key, 'same binding immediately sees the newly saved operation');
});

test('R1 late persistence after withdrawal remains saved without exposing or transmitting it', async context => {
  const reservation = deferred(); let posts = 0;
  const state = controller(context, { post: async () => { posts++; return receipt; } });
  state.store.reserveOriginal = state.store.reserve.bind(state.store);
  state.store.reserve = async request => { await reservation.promise; return state.store.reserveOriginal(request); };
  state.client.setAccess(true); await flush();
  const submitting = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  state.client.setAccess(false); reservation.resolve();
  assert.equal(await submitting, true); assert.equal(posts, 0);
  assert.equal((await state.store.read()).length, 1); assert.deepEqual(state.client.getSnapshot().pending, []);
});

test('R2 a replaced or aborted inspection cannot withdraw a newer verified conversation on failure', async context => {
  for (const mode of ['new-selection', 'closed', 'resynchronised']) {
    const old = deferred(); const lifetime = new AbortController();
    const state = controller(context, {
      snapshot: async () => ({ ...empty, watermark: '1', tasks: [task], messages: [message] }),
      task: async (_scope, id) => id === 'task-old' ? old.promise : { ...task, id },
    });
    state.client.setAccess(true); await flush();
    const reading = state.client.openTask('task-old', lifetime.signal);
    if (mode === 'new-selection') assert.equal((await state.client.openTask('task-new')).id, 'task-new');
    if (mode === 'closed') lifetime.abort();
    if (mode === 'resynchronised') { state.client.resync(); await flush(); }
    old.reject(new AccessError(403));
    assert.equal(await reading, null);
    assert.equal(state.failures, 0); assert.equal(state.client.getSnapshot().connection, 'connected');
    assert.equal(state.client.getSnapshot().tasks[0].id, task.id);
    state.client.setAccess(false);
  }
});

test('R2 a newer accepted projection fences old inspection success and failure', async context => {
  for (const failure of [false, true]) {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const reading = deferred(); let snapshots = 0;
    const state = controller(context, {
      snapshot: async () => ({ ...empty, watermark: String(++snapshots), tasks: [task] }),
      events: async () => ({ scope, audience: 'engagement_members', watermark: '2', next_cursor: '2', has_more: false, resync_required: false,
        events: [{ cursor: '2', task_id: task.id, cycle_id: task.cycle_id, command_id: 'command', kind: 'applied' }] }),
      task: () => reading.promise,
    });
    state.client.setAccess(true); await flush();
    const inspecting = state.client.openTask('task-a');
    context.mock.timers.tick(2000); await flush();
    if (failure) reading.reject(new Error('obsolete exact read failed')); else reading.resolve({ ...task, working_brief: 'old' });
    assert.equal(await inspecting, null); assert.equal(state.client.getSnapshot().connection, 'connected');
    assert.equal(state.client.getSnapshot().tasks[0].working_brief, 'Objective');
    state.client.setAccess(false); context.mock.timers.reset();
  }
});

test('R3 exact durable echo wins over a later lost reply without inventing unsaved uncertainty', async context => {
  const acknowledgement = deferred(); let accepted = false;
  const state = controller(context, {
    snapshot: async () => accepted ? { ...empty, watermark: '1', messages: [message], tasks: [task] } : empty,
    post: () => acknowledgement.promise,
  });
  state.client.setAccess(true); await flush();
  const submitting = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  await flush(); accepted = true; state.client.resync(); await flush();
  assert.equal((await state.store.read()).length, 0); assert.equal(state.client.getSnapshot().pending.length, 0);
  acknowledgement.reject(new Error('committed reply lost')); assert.equal(await submitting, true);
  assert.equal(state.client.getSnapshot().error, null); assert.equal(state.client.getSnapshot().messages[0].command_id, 'command-a');
});

test('R3 fresh authority refusal still withdraws after an exact durable echo', async context => {
  const acknowledgement = deferred(); let accepted = false;
  const state = controller(context, {
    snapshot: async () => accepted ? { ...empty, watermark: '1', messages: [message], tasks: [task] } : empty,
    post: () => acknowledgement.promise,
  });
  state.client.setAccess(true); await flush();
  const submitting = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  await flush(); accepted = true; state.client.resync(); await flush();
  acknowledgement.reject(new AccessError(403)); await submitting;
  assert.equal(state.failures, 1); assert.deepEqual(state.client.getSnapshot().tasks, []); assert.deepEqual(state.client.getSnapshot().messages, []);
});

test('R4 dismissing a refusal clears only that operation notice and it stays cleared after later reads', async context => {
  const state = controller(context, { post: async () => { throw new AccessError(409); } });
  const second = { ...command, key: 'second-key', content: 'Second exact request' };
  await state.store.reserve(command); await state.store.reserve(second); state.client.setAccess(true); await flush();
  await state.client.retry(command.key); await state.client.retry(second.key);
  await state.client.acknowledgeRefusal(second.key);
  assert.match(state.client.getSnapshot().error, /Request refused/);
  assert.equal((await state.store.read())[0].key, command.key);
  await state.client.acknowledgeRefusal(command.key);
  assert.equal(state.client.getSnapshot().error, null);
  state.client.resync(); await flush(); assert.equal(state.client.getSnapshot().error, null);
});

test('R4 dismissing a refusal cannot erase an unrelated storage failure notice', async context => {
  const storage = memory();
  const state = controller(context, { post: async () => { throw new AccessError(409); } }, storage);
  await state.store.reserve(command); state.client.setAccess(true); await flush(); await state.client.retry(command.key);
  storage.setItem = () => { throw new Error('Storage quota'); };
  assert.equal(await state.client.submit({ kind: 'create', content: 'Another draft' }), false);
  const storageNotice = state.client.getSnapshot().error; assert.match(storageNotice, /recovery storage/);
  await state.client.acknowledgeRefusal(command.key); assert.equal(state.client.getSnapshot().error, storageNotice);
  state.client.resync(); await flush(); assert.equal(state.client.getSnapshot().error, storageNotice);
});

test('R5 other-tab creation and dismissal refresh only the matching bounded outbox without replay', async context => {
  const storage = memory(); let posts = 0;
  const state = controller(context, { post: async () => { posts++; return receipt; } }, storage);
  const secondTab = new OutboxStore('actor-a', scope, () => storage);
  state.client.setAccess(true); await flush();
  await persistConflict(secondTab, command);
  await flush();
  assert.equal(state.client.getSnapshot().pending[0].key, command.key); assert.equal(posts, 0);
  await secondTab.remove(command.key); await flush();
  assert.deepEqual(state.client.getSnapshot().pending, []); assert.equal(posts, 0);
});

test('R5 irrelevant bindings never inspect payloads and relevant bursts coalesce behind an access fence', async context => {
  const storage = memory();
  const state = controller(context, {}, storage); state.client.setAccess(true); await flush();
  await new OutboxStore('actor-b', scope, () => storage).reserve(command);
  await new OutboxStore('actor-a', { ...scope, client_id: 'other' }, () => storage).reserve(command);
  storage.getItem = () => { throw new Error('Must not inspect other payloads'); };
  await flush(); assert.equal(state.client.getSnapshot().error, null);
  let reads = 0; const reconcile = state.store.reconcile.bind(state.store);
  state.store.reconcile = messages => { reads++; return reconcile(messages); };
  for (let index = 0; index < 100; index++) state.client.observeOutbox();
  await flush(); assert.equal(reads, 1, 'one coalesced bounded reconciliation reads only the current binding');
  state.client.observeOutbox(); state.client.setAccess(false); await flush();
  assert.equal(reads, 1); assert.deepEqual(state.client.getSnapshot().pending, []);
});

test('R3 a different author or different meaning is never receipt evidence for an in-flight request', async context => {
  for (const changed of [{ author_id: 'actor-b' }, { content: 'Different direction' }]) {
    const acknowledgement = deferred(); let accepted = false;
    const state = controller(context, {
      snapshot: async () => accepted ? { ...empty, watermark: '1', messages: [{ ...message, ...changed }], tasks: [task] } : empty,
      post: () => acknowledgement.promise,
    });
    state.client.setAccess(true); await flush();
    const submitting = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
    await flush(); accepted = true; state.client.resync(); await flush();
    acknowledgement.reject(new Error('lost reply')); await submitting;
    assert.equal((await state.store.read()).length, 1); assert.match(state.client.getSnapshot().error, /Receipt unconfirmed/);
    state.client.setAccess(false);
  }
});

test('R8 current activity advances independently while the displayed history page stays fixed', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const older = { ...message, command_id: 'older-command', key: 'older-key', received_cursor: '1' };
  let latest = { cursor: '10', task_id: 'task-current' };
  const state = controller(context, {
    snapshot: async () => ({ ...empty, watermark: latest.cursor, latest_activity: latest, messages: [message], before_cursor: '1', tasks: [task] }),
    history: async () => ({ scope, audience: 'engagement_members', watermark: '10', messages: [older], before_cursor: null }),
    events: async () => ({ scope, audience: 'engagement_members', watermark: '11', next_cursor: '11', has_more: false, resync_required: false,
      events: [{ cursor: '11', task_id: 'task-old', cycle_id: 'cycle-old', command_id: 'older-command', kind: 'applied' }] }),
  });
  state.client.setAccess(true); await flush(); await state.client.loadEarlier();
  assert.equal(state.client.getSnapshot().messages[0].command_id, 'older-command');
  latest = { cursor: '11', task_id: 'task-old' };
  context.mock.timers.tick(2000); await flush();
  assert.equal(state.client.getSnapshot().messages[0].command_id, 'older-command');
  assert.deepEqual(state.client.getSnapshot().latestActivity, latest);
  state.client.setAccess(false); assert.equal(state.client.getSnapshot().latestActivity, null);
});

test('R4 a successful retry storage read clears its own prior failure including a verified absent key', async context => {
  const state = controller(context);
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  const read = state.store.read.bind(state.store);
  state.store.read = () => { throw new Error('Storage unavailable'); };
  assert.equal(await state.client.retry(command.key), false);
  assert.match(state.client.getSnapshot().error, /saved recovery request/);
  state.store.read = read;
  assert.equal(await state.client.retry(command.key), true); assert.equal(state.client.getSnapshot().error, null);
  state.store.read = () => { throw new Error('Storage unavailable'); };
  assert.equal(await state.client.retry('already-absent'), false);
  state.store.read = read;
  assert.equal(await state.client.retry('already-absent'), false); assert.equal(state.client.getSnapshot().error, null);
});

test('R4 successful refusal dismissal clears only its own storage warning including verified absence', async context => {
  const state = controller(context);
  await persistConflict(state.store, command); state.client.setAccess(true); await flush();
  const remove = state.store.remove.bind(state.store);
  state.store.remove = () => { throw new Error('Storage unavailable'); };
  await state.client.acknowledgeRefusal(command.key);
  assert.match(state.client.getSnapshot().error, /could not be dismissed/);
  state.store.remove = remove; await state.client.acknowledgeRefusal(command.key);
  assert.equal(state.client.getSnapshot().error, null);
  const read = state.store.read.bind(state.store);
  state.store.read = () => { throw new Error('Storage unavailable'); };
  await state.client.retry('different-operation'); await state.client.acknowledgeRefusal('already-absent');
  state.store.read = read; await state.client.acknowledgeRefusal('already-absent');
  assert.match(state.client.getSnapshot().error, /saved recovery request/, 'another operation retains its own storage warning');
  state.client.resync(); await flush(); assert.match(state.client.getSnapshot().error, /saved recovery request/);
});

test('async outbox retry reads cannot transmit after access changes while persistence is loading', async context => {
  let posts = 0; const reading = deferred();
  const state = controller(context, { post: async () => { posts++; return receipt; } });
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  const saved = await state.store.read(); const read = state.store.read.bind(state.store);
  state.store.read = () => reading.promise;
  const retry = state.client.retry(command.key);
  state.client.setAccess(false); state.store.read = read;
  reading.resolve(saved);
  assert.equal(await retry, false); assert.equal(posts, 0); assert.deepEqual(state.client.getSnapshot().pending, []);
});

test('async status persistence is fenced immediately before any command POST', async context => {
  const writing = deferred(); let posts = 0;
  const state = controller(context, { initialSession: session, post: async () => { posts++; return receipt; } });
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  const save = state.store.save.bind(state.store);
  state.store.save = async (...args) => { await writing.promise; return save(...args); };
  const retry = state.client.retry(command.key); await flush();
  state.client.setAccess(false); writing.resolve();
  assert.equal(await retry, false); assert.equal(posts, 0); assert.equal((await state.store.read()).length, 1);
});

test('out-of-order async reconciliation cannot restore an outbox row removed by a newer transaction', async context => {
  const state = controller(context);
  state.store.subscribe = () => () => {};
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  const oldRows = await state.store.read(); const oldRead = deferred();
  const reconcile = state.store.reconcile.bind(state.store); let calls = 0;
  state.store.reconcile = messages => ++calls === 1 ? oldRead.promise : reconcile(messages);
  state.client.observeOutbox(); await flush();
  await state.store.remove(command.key); state.client.observeOutbox(); await flush();
  assert.deepEqual(state.client.getSnapshot().pending, []);
  oldRead.resolve(oldRows); await flush();
  assert.deepEqual(state.client.getSnapshot().pending, []); assert.equal(state.client.getSnapshot().error, null);
});

test('late async reconciliation failures cannot overwrite a newer access generation', async context => {
  const state = controller(context); const obsolete = deferred();
  const reconcile = state.store.reconcile.bind(state.store); let reads = 0;
  state.store.reconcile = messages => ++reads === 1 ? obsolete.promise : reconcile(messages);
  state.client.setAccess(true); await flush();
  state.client.setAccess(false); state.client.setAccess(true); await flush();
  obsolete.reject(new Error('obsolete IndexedDB request failed')); await flush();
  assert.equal(state.client.getSnapshot().error, null); assert.equal(state.client.getSnapshot().connection, 'connected');
});

test('an asynchronous status-write failure prevents transmission and retains the exact reserved request', async context => {
  let posts = 0;
  const state = controller(context, { initialSession: session, post: async () => { posts++; return receipt; } });
  await state.store.reserve(command); state.client.setAccess(true); await flush();
  state.store.save = async () => { throw new Error('IndexedDB status transaction aborted'); };
  assert.equal(await state.client.retry(command.key), false);
  assert.equal(posts, 0); assert.deepEqual((await state.store.read())[0].command, command);
});

test('a late asynchronous refusal-removal failure cannot restore notices after withdrawal', async context => {
  const removing = deferred();
  const state = controller(context);
  await persistConflict(state.store, command); state.client.setAccess(true); await flush();
  state.store.remove = () => removing.promise;
  const dismissal = state.client.acknowledgeRefusal(command.key); await flush();
  state.client.setAccess(false); removing.reject(new Error('IndexedDB transaction aborted')); await dismissal;
  assert.equal(state.client.getSnapshot().error, null); assert.deepEqual(state.client.getSnapshot().pending, []);
  assert.equal((await state.store.read())[0].status, 'conflict');
});

test('status-only storage updates cannot resurrect an already removed operation', async () => {
  const storage = memory(), store = new OutboxStore('actor-a', scope, () => storage);
  await store.reserve(command); await store.remove(command.key);
  await assert.rejects(store.save(command, 'conflict'), /no longer exists/);
  assert.deepEqual(await store.read(), []);
});

test('own legacy preview recovery blocks reads and new sends with an explicit fixed notice', async context => {
  let posts = 0;
  const state = controller(context, { post: async () => { posts++; return receipt; } });
  state.store.reconcile = async () => { throw new LegacyRecoveryError(); };
  state.store.reserve = async () => { throw new LegacyRecoveryError(); };
  state.client.setAccess(true); await flush();
  assert.equal(state.client.getSnapshot().error, new LegacyRecoveryError().message);
  assert.equal(await state.client.submit({ kind: 'create', content: 'Preserved draft' }), false);
  assert.equal(state.client.getSnapshot().error, new LegacyRecoveryError().message);
  assert.equal(posts, 0); assert.deepEqual(state.client.getSnapshot().pending, []);
});

test('unknown persistence errors never expose untrusted storage text', async context => {
  const state = controller(context);
  state.store.reconcile = async () => { throw new Error('Secret or untrusted storage bytes'); };
  state.store.reserve = async () => { throw new Error('Secret or untrusted storage bytes'); };
  state.client.setAccess(true); await flush();
  assert.doesNotMatch(state.client.getSnapshot().error, /Secret|untrusted/);
  assert.equal(await state.client.submit({ kind: 'create', content: 'Preserved draft' }), false);
  assert.doesNotMatch(state.client.getSnapshot().error, /Secret|untrusted/);
});

test('a known receipt survives asynchronous removal failure and recovery retries cleanup without admission', async context => {
  let posts = 0;
  const state = controller(context, { initialSession: session, post: async () => { posts++; return receipt; } });
  state.client.setAccess(true); await flush();
  const remove = state.store.remove.bind(state.store);
  state.store.remove = async () => { throw new Error('Committed receipt but cleanup transaction aborted'); };
  assert.equal(await state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content }), true);
  await flush();
  assert.equal(posts, 1); assert.equal(state.client.getSnapshot().pending[0].status, 'received');
  assert.deepEqual((await state.store.read())[0].command, command);
  assert.match(state.client.getSnapshot().error, /Request received/);
  assert.equal(await state.client.retry(command.key), false);
  assert.equal(posts, 1); assert.equal(state.client.getSnapshot().pending[0].status, 'received');
  state.client.setAccess(false, true); state.client.setAccess(true, true); await flush();
  assert.equal(state.client.getSnapshot().pending[0].status, 'received', 'same-scope access revalidation retains exact receipt evidence');
  state.store.remove = remove;
  assert.equal(await state.client.retry(command.key), true); await flush();
  assert.equal(posts, 1); assert.deepEqual(await state.store.read(), []);
  assert.deepEqual(state.client.getSnapshot().pending, []); assert.equal(state.client.getSnapshot().error, null);
});

test('an exact durable echo survives failed reconciliation and a late POST failure without retransmission', async context => {
  const acknowledgement = deferred(); let visible = false, posts = 0;
  const state = controller(context, {
    initialSession: session,
    snapshot: async () => visible ? { ...empty, watermark: '1', messages: [message], tasks: [task] } : empty,
    post: () => { posts++; return acknowledgement.promise; },
  });
  state.client.setAccess(true); await flush();
  const reconcile = state.store.reconcile.bind(state.store);
  state.store.reconcile = async messages => {
    if (messages.length) throw new Error('Receipt cleanup transaction aborted');
    return reconcile(messages);
  };
  const submission = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  await flush(); visible = true; state.client.resync(); await flush();
  assert.equal(state.client.getSnapshot().pending[0].status, 'received');
  acknowledgement.reject(new Error('Reply lost after durable echo')); await submission; await flush();
  assert.equal(state.client.getSnapshot().pending[0].status, 'received');
  assert.doesNotMatch(state.client.getSnapshot().error ?? '', /Receipt unconfirmed/);
  assert.equal(await state.client.retry(command.key), true); await flush();
  assert.equal(posts, 1); assert.deepEqual(await state.store.read(), []);
});

test('controller disposal closes recovery storage while temporary access checks leave it open', async context => {
  const committing = deferred(); let closes = 0, posts = 0;
  const state = controller(context, { initialSession: session, post: async () => { posts++; return receipt; } });
  state.store.close = () => { closes++; };
  state.client.setAccess(true); await flush();
  state.client.setAccess(false, true); state.client.setAccess(true, true); await flush();
  assert.equal(closes, 0);
  const reserve = state.store.reserve.bind(state.store);
  state.store.reserve = async request => { await committing.promise; return reserve(request); };
  const submitting = state.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  state.client.dispose(); committing.resolve();
  assert.equal(await submitting, true, 'disposal does not undo an exact committed persistence handoff');
  assert.equal(closes, 1); assert.equal(posts, 0);
  assert.deepEqual(state.client.getSnapshot().pending, []);
  assert.deepEqual((await state.store.read())[0].command, command);
  state.client.setAccess(true); await flush();
  assert.equal(state.client.getSnapshot().pending.length, 1, 'Strict Mode can restart a disposed controller using reopenable storage');
  assert.equal(posts, 0, 'reopening never automatically replays retained requests');
});

test('replacement disposes the old controller without allowing its late acknowledgement to erase recovery', async context => {
  const acknowledgement = deferred(); const storage = memory(); let posts = 0, closes = 0;
  const previous = controller(context, { initialSession: session, post: () => { posts++; return acknowledgement.promise; } }, storage);
  previous.store.close = () => { closes++; };
  previous.client.setAccess(true); await flush();
  const submitting = previous.client.submit({ kind: command.kind, task_id: command.task_id, cycle_id: command.cycle_id, content: command.content });
  await flush(); assert.equal(posts, 1);
  previous.client.dispose();
  const replacement = controller(context, { initialSession: session, post: async () => { posts++; return receipt; } }, storage);
  replacement.client.setAccess(true); await flush();
  acknowledgement.resolve(receipt); assert.equal(await submitting, true); await flush();
  assert.equal(closes, 1); assert.equal(posts, 1);
  assert.deepEqual(previous.client.getSnapshot().pending, []);
  assert.deepEqual(replacement.client.getSnapshot().pending[0].command, command);
  assert.deepEqual((await replacement.store.read())[0].command, command);
});
