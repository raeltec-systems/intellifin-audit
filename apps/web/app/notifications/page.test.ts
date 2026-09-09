import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import NotificationsPage from './page';
const delivered=vi.hoisted(()=>vi.fn());
const open=vi.hoisted(()=>vi.fn());
vi.mock('@intellifin/infrastructure',()=>({DrizzleNotificationRepository:class {deliveredFor=delivered; openFor=open;}}));
vi.mock('../../src/bootstrap',()=>({getRuntime:async()=>({db:{}})}));
vi.mock('../../src/server-session',()=>({currentIdentity:async()=>({kind:'identified',session:{userId:'signed-in',sessionId:'session'}})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it('identifies distinct notices with version/time, refresh and an older-items link',async()=>{
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
  expect(html).toContain('Run 019823ab-0000-7000-8000-000000000001 · Escalation choose-candidate');
  expect(html).toContain('/runs/019823ab-0000-7000-8000-000000000001');
  expect(html).toContain('Time remaining:');
  expect(html).not.toContain('Question');
  expect(html).not.toContain('Evidence');
});

it('shows authorized open Escalations with a Run link and safe metadata only', async()=>{
  open.mockResolvedValue([{
    recipientId:'signed-in', procedureId:'p1', versionId:'v1', procedureName:'Access review', versionNumber:1,
    kind:'escalation', runId:'019823ab-0000-7000-8000-000000000003', waitId:'019823ab-0000-7000-8000-000000000004',
    escalationKind:'choose-candidate', deadline:'2026-09-07T14:00:00.000Z',
  }]);
  delivered.mockResolvedValue({items:[],nextCursor:null});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Runs waiting for your answer');
  expect(html).toContain('Run 019823ab-0000-7000-8000-000000000003 · Escalation choose-candidate');
  expect(html).toContain('/runs/019823ab-0000-7000-8000-000000000003');
  expect(html).toContain('Procedure Access review · v1 · Time remaining:');
  expect(html).not.toContain('Question');
  expect(html).not.toContain('Evidence');
  expect(html).not.toContain('019823ab-0000-7000-8000-000000000004');
});
