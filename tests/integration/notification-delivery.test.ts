import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EscalationNotification } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  InAppNotificationSender,
  PostgresProceduresUnitOfWork,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const url = process.env['DATABASE_URL'];

/**
 * The notification worker's two channel outcomes are one transaction and one idempotent
 * replay. This test is intentionally database-backed: the audit hash chain and the two
 * conditional updates cannot be meaningfully replaced by an in-memory fake.
 */
describe.skipIf(!url)('durable escalation notification delivery', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runId = ids.next();
  const correlationId = ids.next();
  const waitId = ids.next();
  const sessionId = `${author}-session`;
  const notification: EscalationNotification = {
    sendKey: `escalation:${waitId}:${author}`,
    recipientId: author,
    procedureId,
    versionId,
    procedureName: 'Terminated users',
    versionNumber: 1,
    kind: 'escalation',
    runId,
    waitId,
    escalationKind: 'choose-candidate',
    deadline: '2026-09-07T14:00:00.000Z',
  };

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) throw new Error('Notification tests require an isolated local or CI test database');
    sql = createSqlClient(url!, { max: 4 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Notification test',${author + '@test.invalid'})`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
    await sql`
      INSERT INTO audit_run(
        request_token, run_id, correlation_id, procedure_id, version_id, version_number,
        procedure_name, period_from, period_to, state, kind, initiator_id, session_id,
        authorization_role, initiated_at
      ) VALUES (
        ${ids.next()}, ${runId}, ${correlationId}, ${procedureId}, ${versionId}, 1,
        'Terminated users', DATE '2026-09-01', DATE '2026-09-01', 'AWAITING_AUDITOR',
        'STANDARD', ${author}, ${sessionId}, 'auditor', now()
      )
    `;
    await sql`
      INSERT INTO run_wait(
        wait_id, run_id, kind, options, deadline, closed_at, closure_kind, answer_option_id, actor
      ) VALUES (
        ${waitId}, ${runId}, 'choose-candidate', ${JSON.stringify([{ id: 'mark-ambiguous', label: 'Mark ambiguous' }])}::jsonb,
        ${notification.deadline}::timestamptz, NULL, NULL, NULL, NULL
      )
    `;
    await sql`
      INSERT INTO notification(
        send_key, recipient_id, procedure_id, version_id, procedure_name, version_number,
        kind, run_id, wait_id, escalation_kind, deadline, email_outcome, email_outcome_at
      ) VALUES (
        ${notification.sendKey}, ${author}, ${procedureId}, ${versionId}, ${notification.procedureName}, 1,
        'escalation', ${runId}, ${waitId}, ${notification.escalationKind}, ${notification.deadline}::timestamptz,
        NULL, NULL
      )
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      await sql`DELETE FROM notification WHERE send_key = ${notification.sendKey}`;
      await sql`DELETE FROM run_wait WHERE wait_id = ${waitId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id = ${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id = ${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id = ${runId}`;
      await sql`DELETE FROM procedure_version WHERE version_id = ${versionId}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id = ${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('delivers in-app, records email unconfigured, and does not duplicate outcomes on replay', async () => {
    const sender = new InAppNotificationSender(db);
    await sender.send(notification);
    await sender.send(notification);

    const row = (await sql`
      SELECT delivered_at, email_outcome, email_outcome_at
      FROM notification
      WHERE send_key = ${notification.sendKey}
    `)[0];
    expect(row?.delivered_at).toBeTruthy();
    expect(row?.email_outcome).toBe('unconfigured');
    expect(row?.email_outcome_at).toBeTruthy();
    const events = await sql`
      SELECT event_type, outcome, payload
      FROM audit_events
      WHERE aggregate_id = ${runId} AND event_type LIKE 'notification.%'
      ORDER BY sequence
    `;
    expect(events).toHaveLength(2);
    expect(events.map(event => event.event_type)).toEqual([
      'notification.in-app-delivery',
      'notification.email-delivery',
    ]);
    expect(events.map(event => event.payload.deliveryOutcome)).toEqual(['delivered', 'unconfigured']);
    expect(events[1]?.outcome).toBe('failure');
  });

  it('rejects notification context and partial email outcomes without changing the row', async () => {
    const before = (await sql`
      SELECT run_id::text AS run_id, wait_id::text AS wait_id, escalation_kind,
             deadline, email_outcome, email_outcome_at
      FROM notification
      WHERE send_key = ${notification.sendKey}
    `)[0];
    expect(before).toBeTruthy();

    // The trigger binds an escalation notification to the immutable wait's kind and
    // deadline. These updates use valid enum values and timestamps so the trigger, rather
    // than a TypeScript writer, is the boundary under test.
    await expect(sql`
      UPDATE notification
      SET escalation_kind = 'unnamed-value'
      WHERE send_key = ${notification.sendKey}
    `).rejects.toMatchObject({ code: '23514' });
    await expect(sql`
      UPDATE notification
      SET deadline = ${'2030-01-01T00:00:00.000Z'}::timestamptz
      WHERE send_key = ${notification.sendKey}
    `).rejects.toMatchObject({ code: '23514' });
    await expect(sql`
      UPDATE notification
      SET escalation_kind = NULL
      WHERE send_key = ${notification.sendKey}
    `).rejects.toMatchObject({ code: '23514' });

    // An email outcome is meaningful only with the instant at which that outcome was
    // recorded. This exercises the paired-column check independently of the binding guard.
    await expect(sql`
      UPDATE notification
      SET email_outcome = 'unconfigured', email_outcome_at = NULL
      WHERE send_key = ${notification.sendKey}
    `).rejects.toMatchObject({ code: '23514' });

    const after = (await sql`
      SELECT run_id::text AS run_id, wait_id::text AS wait_id, escalation_kind,
             deadline, email_outcome, email_outcome_at
      FROM notification
      WHERE send_key = ${notification.sendKey}
    `)[0];
    expect(after).toEqual(before);
  });
});
