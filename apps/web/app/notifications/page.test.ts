import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import NotificationsPage from './page';
const delivered=vi.hoisted(()=>vi.fn());
const open=vi.hoisted(()=>vi.fn());
const names=vi.hoisted(()=>vi.fn());
// The bell's own count, which the page now reads beside the bounded list. Zero by default:
// no existing case is about the bound, and zero never exceeds a list's length.
const count=vi.hoisted(()=>vi.fn().mockResolvedValue(0));
vi.mock('@intellifin/infrastructure',()=>({
  DrizzleNotificationRepository:class {deliveredFor=delivered; openFor=open; countOpenFor=count;},
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
  // `[REWRITTEN 2026-09-22, UX-02/UX-32]` This asserted the raw ISO instant as VISIBLE
  // text. The revised Formats row makes that a defect on an ordinary screen, so the page
  // renders `1 Sep 2026, 00:00 UTC` and keeps the exact value in the `datetime` attribute
  // — nothing is lost, and a machine can still read it.
  expect(html).toContain('1 Sep 2026, 00:00 UTC');
  expect(html).toContain('dateTime="2026-09-01T00:00:01.123Z"');
  expect(html).toContain('2 Sep 2026, 00:00 UTC');
  expect(html).not.toContain('>2026-09-01T00:00:01.123456Z<');
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
  // The words are the shell's own (`BELL_KIND_WORDS`), so the bell's panel, the inbox
  // and the Overview's attention list describe one wait one way.
  expect(html).toContain('Access review · v1 · Waiting for your answer');
  expect(html).toContain('/runs/019823ab-0000-7000-8000-000000000001');
  expect(html).toContain('Time remaining:');
  // The Run is named by a short reference in the ORDINARY reading — the raw UUID appears
  // only inside the Technical details disclosure, never loose as visible text beside it.
  const ordinaryReading = html.split('<details')[0]!;
  expect(ordinaryReading).not.toContain('>019823ab-0000-7000-8000-000000000001<');
  expect(html).toContain('Run <span class="ls-mono">00000001</span>');
  expect(html).toContain(
    '<dt>Run identifier</dt><dd class="ls-mono">019823ab-0000-7000-8000-000000000001</dd>',
  );
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
  expect(html).toContain('Access review · v1 · Waiting for your answer');
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
  expect(html).toContain('Access review · v1 · Flagged for an Audit Manager');
  expect(html).toContain('Flagged by Dana Mwansa');
  expect(html).toContain('7 Sep 2026, 09:00 UTC');
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
  expect(html).toContain('Flagged by <span class="ls-mono">user-77</span>');
});

// `openFor` bounds its merged list with Escalations first, so enough open Escalations push every
// flag off the end, while `countOpenFor` counts both unbounded. Two numbers that disagree with
// nothing explaining the gap is the silent-truncation defect; the page says so now.
it('says how many it could not show when the bell counts more than the list', async()=>{
  names.mockResolvedValue(new Map());
  open.mockResolvedValue([{
    recipientId:'signed-in', procedureId:'p1', versionId:'v1', procedureName:'Access review', versionNumber:1,
    kind:'escalation', runId:'019823ab-0000-7000-8000-000000000001',
    waitId:'019823ab-0000-7000-8000-000000000002', escalationKind:'choose-candidate',
    deadline:'2026-09-07T14:00:00.000Z',
  }]);
  delivered.mockResolvedValue({items:[],nextCursor:null});
  count.mockResolvedValueOnce(137);
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Showing the first 1 of 137.');
  expect(count).toHaveBeenCalledWith({userId:'signed-in',sessionId:'session'});
});

it('says nothing about a bound when the list holds everything the bell counts', async()=>{
  names.mockResolvedValue(new Map());
  open.mockResolvedValue([{
    recipientId:'signed-in', procedureId:'p1', versionId:'v1', procedureName:'Access review', versionNumber:1,
    kind:'escalation', runId:'019823ab-0000-7000-8000-000000000001',
    waitId:'019823ab-0000-7000-8000-000000000002', escalationKind:'choose-candidate',
    deadline:'2026-09-07T14:00:00.000Z',
  }]);
  delivered.mockResolvedValue({items:[],nextCursor:null});
  count.mockResolvedValueOnce(1);
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).not.toContain('Showing the first');
});
