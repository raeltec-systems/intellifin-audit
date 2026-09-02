import { describe, expect, it, vi } from 'vitest';

import type { AuditEventDraft, AuditEventRecord, Role } from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommand } from './authorize.js';

/**
 * `authorizeCommand` is the only place a command is authorized, so it is also the
 * only place a caller could subvert one. These tests are about that seam: the session
 * decides who is asking, and a refusal is never returned without its event.
 */

const SESSION = { userId: 'user_manager', sessionId: 'sess_1' };

/** Records what the command appended, without a database or a transaction. */
function recordingUnitOfWork(appended: AuditEventDraft[]): AuditUnitOfWork {
  return {
    execute: (work) =>
      work({
        auditEvents: {
          append: (draft) => {
            appended.push(draft);
            return Promise.resolve(draft as unknown as AuditEventRecord);
          },
        },
      }),
  };
}

function dependencies(role: Role | null) {
  const appended: AuditEventDraft[] = [];
  const findRole = vi.fn().mockResolvedValue(role);
  return {
    appended,
    findRole,
    deps: { roles: { findRole }, unitOfWork: recordingUnitOfWork(appended) },
  };
}

describe('authorizeCommand and the caller-supplied context', () => {
  it('ignores a context actorId and uses the session identity instead', async () => {
    const { deps, appended } = dependencies('audit-manager');

    // A handler claiming to be somebody else must not escape the author rule: the
    // version's author IS this session, so approval has to be refused regardless.
    const outcome = await authorizeCommand(deps, {
      session: SESSION,
      action: 'procedure.version.approve',
      correlationId: 'corr_1',
      context: { authorId: SESSION.userId, actorId: 'somebody-else-entirely' },
    });

    expect(outcome).toEqual({
      allowed: false,
      reason: 'You cannot approve a version you authored.',
      role: 'audit-manager',
    });
    expect(appended).toHaveLength(1);
  });

  it('still allows approving a version somebody else authored', async () => {
    const { deps } = dependencies('audit-manager');

    await expect(
      authorizeCommand(deps, {
        session: SESSION,
        action: 'procedure.version.approve',
        correlationId: 'corr_1',
        context: { authorId: 'user_auditor' },
      }),
    ).resolves.toEqual({ allowed: true, role: 'audit-manager', userId: SESSION.userId });
  });

  it('denies approval when the caller supplies no author at all', async () => {
    const { deps } = dependencies('audit-manager');

    await expect(
      authorizeCommand(deps, {
        session: SESSION,
        action: 'procedure.version.approve',
        correlationId: 'corr_1',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'You cannot approve a version you authored.',
    });
  });
});

describe('authorizeCommand and the audit event', () => {
  it('reads the role fresh on every call', async () => {
    const { deps, findRole } = dependencies('auditor');

    await authorizeCommand(deps, { session: SESSION, action: 'run.initiate', correlationId: 'c' });
    await authorizeCommand(deps, { session: SESSION, action: 'run.initiate', correlationId: 'c' });

    expect(findRole).toHaveBeenCalledTimes(2);
    expect(findRole).toHaveBeenCalledWith(SESSION.userId);
  });

  it('appends security.denied for a refusal, attributed to the session', async () => {
    const { deps, appended } = dependencies('poc-administrator');

    const outcome = await authorizeCommand(deps, {
      session: SESSION,
      action: 'procedure.author',
      correlationId: 'corr_9',
    });

    expect(outcome).toMatchObject({
      allowed: false,
      reason: 'PoC Administrator cannot author Procedures or start Runs.',
    });
    expect(appended[0]).toEqual({
      actor: { type: 'human', id: SESSION.userId },
      eventType: 'security.denied',
      source: 'web',
      outcome: 'denied',
      sessionId: SESSION.sessionId,
      correlationId: 'corr_9',
      payload: {
        action: 'procedure.author',
        role: 'poc-administrator',
        reason: 'PoC Administrator cannot author Procedures or start Runs.',
      },
    });
  });

  it('records role null for a signed-in person who holds none', async () => {
    const { deps, appended } = dependencies(null);

    await expect(
      authorizeCommand(deps, { session: SESSION, action: 'run.initiate', correlationId: 'c' }),
    ).resolves.toMatchObject({ allowed: false, role: null });
    expect(appended[0]?.payload).toMatchObject({ role: null });
  });

  it('appends nothing when the action is allowed', async () => {
    const { deps, appended } = dependencies('auditor');

    await authorizeCommand(deps, { session: SESSION, action: 'run.pause', correlationId: 'c' });

    expect(appended).toEqual([]);
  });

  it('propagates an append failure rather than returning an unaudited denial', async () => {
    const findRole = vi.fn().mockResolvedValue('poc-administrator');
    const deps = {
      roles: { findRole },
      unitOfWork: {
        execute: () => Promise.reject(new Error('database unavailable')),
      } as AuditUnitOfWork,
    };

    await expect(
      authorizeCommand(deps, {
        session: SESSION,
        action: 'procedure.author',
        correlationId: 'c',
      }),
    ).rejects.toThrow(/database unavailable/);
  });
});
