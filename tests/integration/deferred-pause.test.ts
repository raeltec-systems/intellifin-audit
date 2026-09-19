import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptDeferredPause, acquireRunControlLease, pauseRun, type AuditUnitOfWork } from '@intellifin/application';
import { classifyPlanTargets, type DeferredPauseAnchor } from '@intellifin/domain';
import {
  createDb, createSqlClient, createAuditEventWriter, CryptoUuidV7Generator, DrizzleRoleRepository,
  PostgresDeferredPauseRepository, PostgresProceduresUnitOfWork, PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork, PostgresWaitRepository, SystemClock, type Database, type Sql, type Transaction,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { auditRun } from '../../packages/infrastructure/src/db/schema.js';
import { ConversationContentCipher } from '../../packages/infrastructure/src/runs/conversation-content.js';
import { PostgresRunConversationRepository } from '../../packages/infrastructure/src/runs/run-conversation-repository.js';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('deferred pause durable latch and admission guards', () => {
  let client: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const actor = ids.next(), procedureId = ids.next(), versionId = ids.next();
  const session = { userId: actor, sessionId: `${actor}-deferred` };
  const version = activeRunVersion(procedureId, versionId, actor);
  const target = classifyPlanTargets(version.compiledPlan!).agents[0]!;
  const runs: string[] = [];
  const clock = new SystemClock();

  beforeAll(async () => {
    const targetUrl = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(targetUrl.hostname) ||
        !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(targetUrl.pathname.slice(1)))
      throw new Error('Deferred pause tests require an isolated local or CI database');
    client = createSqlClient(url!, { max: 6 }); db = createDb(client);
    await client`INSERT INTO auth_user(id,name,email) VALUES (${actor},'Deferred pause auditor',${actor+'@test.invalid'})`;
    await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor')`;
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
    });
  });

  afterAll(async () => {
    if (!client) return;
    try {
      for (const runId of runs) await client.begin(async tx => {
        await tx`DELETE FROM run_agent_work WHERE run_id=${runId}`;
        await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      });
      await client`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM user_role WHERE user_id=${actor}`;
      await client`DELETE FROM auth_user WHERE id=${actor}`;
    } finally { await client.end({ timeout: 5 }); }
  });

  function coreDeps(commandId: string, transaction?: Transaction) {
    const connection = transaction ?? db;
    const unitOfWork: AuditUnitOfWork = transaction
      ? { execute: work => work({ auditEvents: createAuditEventWriter(transaction, clock, ids) }) }
      : new PostgresRunsUnitOfWork(db);
    return { roles: new DrizzleRoleRepository(connection), unitOfWork,
      repository: new PostgresDeferredPauseRepository(connection), ids, clock, commandId };
  }

  async function fixture(): Promise<{ runId: string; commandId: string; anchor: DeferredPauseAnchor }> {
    const runId = ids.next(), itemId = ids.next();
    runs.push(runId);
    const year = 2040 + runs.length;
    await db.insert(auditRun).values({ runId, requestToken: ids.next(), correlationId: ids.next(), procedureId,
      versionId, versionNumber: 1, procedureName: 'Deferred pause fixture', periodFrom: `${year}-01-01`,
      periodTo: `${year}-01-31`, state: 'RUNNING', kind: 'STANDARD', initiatorId: actor,
      sessionId: session.sessionId, authorizationRole: 'auditor', initiatedAt: new Date() });
    await client`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,attempts,cycles,observations)
      VALUES(${itemId},${runId},${target.stepId},1,NULL,${target.target.registrationId},'Configuration page','IN_PROGRESS',1,0,0)`;
    const attempt = ids.next();
    await client`INSERT INTO run_agent_work(run_id,revision,status,run_started_at,lease_until,attempt_id,work_item_id,next_turn,tokens,reserved_tokens)
      VALUES(${runId},1,'EXECUTING',clock_timestamp(),clock_timestamp()+interval '1 minute',${attempt},${itemId},1,0,0)`;
    const lease = await acquireRunControlLease({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresRunControlLeaseRepository(db), ids, allowEnrollment: true },
      { session, request: { runId, expectedEpoch: 0 } });
    expect(lease).toMatchObject({ ok: true, lease: { epoch: 1 } });
    const conversation = new PostgresRunConversationRepository(db, new ConversationContentCipher('34'.repeat(32)), () => clock.now());
    const inspection = await conversation.readCurrentInspection({ runId, actorId: actor });
    if (inspection.status !== 'ready') throw new Error(`Inspection fixture unavailable: ${inspection.reason}`);
    const proposal = await conversation.append({ actorId: actor, sessionId: session.sessionId, request: {
      runId, idempotencyKey: ids.next(), text: 'pause after this inspection', selectedSourceOrdinal: null,
      replyToWaitId: null, currentInspection: inspection.anchor,
    } });
    expect(proposal).toMatchObject({ ok: true });
    if (!proposal.ok) throw new Error(proposal.reason);
    const [command] = await client<{ command_id: string }[]>`SELECT command_id::text FROM run_interaction_command WHERE message_id=${proposal.messageId}`;
    if (!command) throw new Error('Deferred proposal missing');
    return { runId, commandId: command.command_id, anchor: inspection.anchor };
  }

  it('commits marker and queued receipt together and rolls both back with its outer transaction', async () => {
    const fixtureRow = await fixture();
    const input = { session, request: { runId: fixtureRow.runId, anchor: fixtureRow.anchor, expectedControlEpoch: 1 } };
    await expect(db.transaction(async tx => {
      expect(await acceptDeferredPause(coreDeps(fixtureRow.commandId, tx), input)).toMatchObject({ ok: true });
      const rows = await tx.query.runInteractionTransition.findMany({
        where: (table, { eq }) => eq(table.commandId, fixtureRow.commandId),
        orderBy: (table, { asc }) => [asc(table.sequence)],
      });
      expect(rows.map(row => row.state)).toEqual(['received','interpreted','queued']);
      throw new Error('Injected outer transaction rollback');
    })).rejects.toThrow('Injected outer transaction rollback');
    expect(await client`SELECT command_id FROM run_deferred_pause WHERE run_id=${fixtureRow.runId}`).toHaveLength(0);
    expect((await client`SELECT state FROM run_interaction_transition WHERE command_id=${fixtureRow.commandId} ORDER BY sequence`).map(row => row.state))
      .toEqual(['received','interpreted']);
    expect(await acceptDeferredPause(coreDeps(fixtureRow.commandId), input)).toMatchObject({ ok: true });
    expect(await acceptDeferredPause(coreDeps(fixtureRow.commandId), input)).toMatchObject({ ok: true });
    expect(await client`SELECT event_id FROM audit_events WHERE aggregate_id=${fixtureRow.runId} AND event_type='lifecycle.run-deferred-pause-requested'`).toHaveLength(1);
    await expect(client`UPDATE run_deferred_pause SET work_item_id=${ids.next()} WHERE command_id=${fixtureRow.commandId}`).rejects.toMatchObject({ code: '23514' });
    await expect(client`DELETE FROM run_deferred_pause WHERE command_id=${fixtureRow.commandId}`).rejects.toMatchObject({ code: '23514' });
    await expect(client`UPDATE run_deferred_pause SET state='SUPERSEDED',superseded_at=clock_timestamp(),superseded_reason=NULL WHERE command_id=${fixtureRow.commandId}`)
      .rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an applied receipt whose null page target was omitted from its event', async () => {
    const row = await fixture();
    expect(row.anchor.subjectKey).toBeNull();
    expect(await acceptDeferredPause(coreDeps(row.commandId), { session,
      request: { runId: row.runId, anchor: row.anchor, expectedControlEpoch: 1 } })).toMatchObject({ ok: true });
    const forged = await db.transaction(tx => createAuditEventWriter(tx, clock, ids).append({
      actor: { type: 'human', id: actor }, eventType: 'lifecycle.run-paused', source: 'worker', outcome: 'success',
      aggregateId: row.runId, correlationId: ids.next(), sessionId: session.sessionId,
      payload: { commandId: row.commandId, pauseMode: 'after-inspection', workItemId: row.anchor.workItemId,
        registrationId: row.anchor.registrationId },
    }));
    await expect(client`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at,source_event_id)
      SELECT ${row.commandId}::uuid,4,'applied','forged-applied',occurred_at,event_id FROM audit_events WHERE event_id=${forged.eventId}`)
      .rejects.toMatchObject({ code: '23514' });
    expect(await client`SELECT state FROM run_deferred_pause WHERE command_id=${row.commandId}`).toMatchObject([{ state: 'PENDING' }]);
  });

  it('refuses a checkpoint no longer matching the frozen step without retargeting its proposal', async () => {
    const row = await fixture();
    await client`UPDATE run_work_item SET step_id='unapproved-inspection' WHERE work_item_id=${row.anchor.workItemId}`;
    expect(await acceptDeferredPause(coreDeps(row.commandId), { session,
      request: { runId: row.runId, anchor: row.anchor, expectedControlEpoch: 1 } })).toMatchObject({ ok: false, code: 'not-current' });
    expect(await client`SELECT command_id FROM run_deferred_pause WHERE run_id=${row.runId}`).toHaveLength(0);
  });

  it('retires a confirmed latch atomically when the existing immediate pause command is accepted', async () => {
    const row = await fixture();
    expect(await acceptDeferredPause(coreDeps(row.commandId), { session,
      request: { runId: row.runId, anchor: row.anchor, expectedControlEpoch: 1 } })).toMatchObject({ ok: true });
    expect(await pauseRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresWaitRepository(db), ids, clock }, { session, request: { runId: row.runId } })).toMatchObject({ ok: true, pending: true });
    expect(await client`SELECT state,superseded_reason FROM run_deferred_pause WHERE command_id=${row.commandId}`)
      .toMatchObject([{ state: 'SUPERSEDED', superseded_reason: 'immediate-pause' }]);
    expect((await client`SELECT state FROM run_interaction_transition WHERE command_id=${row.commandId} ORDER BY sequence`).map(item => item.state))
      .toEqual(['received','interpreted','queued','superseded']);
    const [run] = await client`SELECT state,pause_requested_by FROM audit_run WHERE run_id=${row.runId}`;
    expect(run).toMatchObject({ state: 'RUNNING', pause_requested_by: actor });
    expect(await client`SELECT wait_id FROM run_wait WHERE run_id=${row.runId}`).toHaveLength(0);
  });
});
