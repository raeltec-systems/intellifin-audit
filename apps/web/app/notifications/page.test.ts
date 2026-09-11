import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import NotificationsPage from './page';
const delivered=vi.hoisted(()=>vi.fn());
const open=vi.hoisted(()=>vi.fn());
const names=vi.hoisted(()=>vi.fn());
vi.mock('@intellifin/infrastructure',()=>({
  DrizzleNotificationRepository:class {deliveredFor=delivered; openFor=open;},
  DrizzleActorNameReader:class {namesFor=names;},
}));
vi.mock('../../src/bootstrap',()=>({getRuntime:async()=>({db:{}})}));
vi.mock('../../src/server-session',()=>({currentIdentity:async()=>({kind:'identified',session:{userId:'signed-in',sessionId:'session'}})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it('identifies distinct notices with version/time, refresh and an older-items link',async()=>{
  names.mockResolvedValue(new Map());
  open.mockResolvedValue([]);
  delivered.mockResolvedValue({items:[{sendKey:'a',procedureId:'p1',versionId:'v1',procedureName:'Access review',versionNumber:1,kind:'submitted',createdAt:'2026-09-01T00:00:00Z',deliveredAt:'2026-09-01T00:00:01.123456Z'},{sendKey:'b',procedureId:'p2',versionId:'v2',procedureName:'Payment review',versionNumber:2,kind:'approved',createdAt:'2026-09-02T00:00:00Z',deliveredAt:'2026-09-02T00:00:01.123456Z'}],nextCursor:{sendKey:'b',deliveredAt:'2026-09-02T00:00:01.123456Z'}});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Access review · v1'); expect(html).toContain('Payment review · v2');
  expect(html).toContain('/procedures/p1/versions/v1');expect(html).toContain('/procedures/p2/versions/v2');
  expect(html).toContain('2026-09-01T00:00:01.123456Z');expect(html).toContain('2026-09-02T00:00:01.123456Z');
  expect(html).toContain('Older notifications'); expect(html).toContain('Refresh notifications');
  expect(delivered).toHaveBeenCalledWith({userId:'signed-in',sessionId:'session'},undefined);
  expect(open).toHaveBeenCalledWith({userId:'signed-in',sessionId:'session'});
});

it('links a delivered Escalation to its Run with safe metadata only', async()=>{
  names.mockResolvedValue(new Map());
  open.mockResolvedValue([]);
  delivered.mockResolvedValue({items:[{
    sendKey:'escalation-notice', recipientId:'signed-in', procedureId:'p1', versionId:'v1',
    procedureName:'Access review', versionNumber:1, kind:'escalation',
    runId:'019823ab-0000-7000-8000-000000000001',
    waitId:'019823ab-0000-7000-8000-000000000002', escalationKind:'choose-candidate',
    deadline:'2026-09-07T14:00:00.000Z', createdAt:'2026-09-07T09:00:00Z',
    deliveredAt:'2026-09-07T09:00:01.123456Z',
  }],nextCursor:null});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Access review · waiting for your answer');
  expect(html).toContain('/runs/019823ab-0000-7000-8000-000000000001');
  expect(html).toContain('Time remaining:');
  expect(html).not.toContain('Question');
  expect(html).not.toContain('Evidence');
});

it('shows authorized open Escalations with a Run link and safe metadata only', async()=>{
  names.mockResolvedValue(new Map());
  open.mockResolvedValue([{
    recipientId:'signed-in', procedureId:'p1', versionId:'v1', procedureName:'Access review', versionNumber:1,
    kind:'escalation', runId:'019823ab-0000-7000-8000-000000000003', waitId:'019823ab-0000-7000-8000-000000000004',
    escalationKind:'choose-candidate', deadline:'2026-09-07T14:00:00.000Z',
  }]);
  delivered.mockResolvedValue({items:[],nextCursor:null});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Runs that need you');
  expect(html).toContain('Access review · waiting for your answer');
  expect(html).toContain('/runs/019823ab-0000-7000-8000-000000000003');
  expect(html).toContain('Time remaining:');
  expect(html).not.toContain('Question');
  expect(html).not.toContain('Evidence');
  expect(html).not.toContain('019823ab-0000-7000-8000-000000000004');
});

// Story 5.5. A flag shares the inbox with an Escalation and must be told apart from one:
// no countdown, because it has no deadline, and the actor rendered as a NAME.
it('shows an open flag with the actor as a name and no countdown', async()=>{
  names.mockResolvedValue(new Map([['user-77','Dana Mwansa']]));
  open.mockResolvedValue([{
    recipientId:'signed-in', procedureId:'p1', versionId:'v1', procedureName:'Access review', versionNumber:1,
    kind:'flag', runId:'019823ab-0000-7000-8000-000000000005',
    flagId:'019823ab-0000-7000-8000-000000000006', flaggedBy:'user-77', flaggedAt:'2026-09-07T09:00:00.000Z',
  }]);
  delivered.mockResolvedValue({items:[],nextCursor:null});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Access review · flagged for an Audit Manager');
  expect(html).toContain('Flagged by Dana Mwansa at');
  expect(html).toContain('/runs/019823ab-0000-7000-8000-000000000005/live');
  // A countdown on something with no deadline would be a fact nobody measured.
  expect(html).not.toContain('Time remaining');
  // The id is never shown in place of the name it resolved to.
  expect(html).not.toContain('user-77');
  expect(names).toHaveBeenCalledWith(['user-77']);
});

// An id with no `auth_user` row is shown as the id, which is honest about what is known.
it('falls back to the actor id when no name resolves', async()=>{
  names.mockResolvedValue(new Map());
  open.mockResolvedValue([{
    recipientId:'signed-in', procedureId:'p1', versionId:'v1', procedureName:'Access review', versionNumber:1,
    kind:'flag', runId:'019823ab-0000-7000-8000-000000000005',
    flagId:'019823ab-0000-7000-8000-000000000006', flaggedBy:'user-77', flaggedAt:'2026-09-07T09:00:00.000Z',
  }]);
  delivered.mockResolvedValue({items:[],nextCursor:null});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Flagged by user-77 at');
});
