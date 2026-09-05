import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import NotificationsPage from './page';
const delivered=vi.hoisted(()=>vi.fn());
vi.mock('@intellifin/infrastructure',()=>({DrizzleNotificationRepository:class {deliveredFor=delivered;}}));
vi.mock('../../src/bootstrap',()=>({getRuntime:async()=>({db:{}})}));
vi.mock('../../src/server-session',()=>({currentIdentity:async()=>({kind:'identified',session:{userId:'signed-in',sessionId:'session'}})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it('identifies distinct notices with version/time, refresh and an older-items link',async()=>{
  delivered.mockResolvedValue({items:[{sendKey:'a',procedureId:'p1',versionId:'v1',procedureName:'Access review',versionNumber:1,kind:'submitted',createdAt:'2026-09-01T00:00:00Z',deliveredAt:'2026-09-01T00:00:01.123456Z'},{sendKey:'b',procedureId:'p2',versionId:'v2',procedureName:'Payment review',versionNumber:2,kind:'approved',createdAt:'2026-09-02T00:00:00Z',deliveredAt:'2026-09-02T00:00:01.123456Z'}],nextCursor:{sendKey:'b',deliveredAt:'2026-09-02T00:00:01.123456Z'}});
  const html=renderToStaticMarkup(await NotificationsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('Access review · v1'); expect(html).toContain('Payment review · v2');
  expect(html).toContain('/procedures/p1/versions/v1');expect(html).toContain('/procedures/p2/versions/v2');
  expect(html).toContain('2026-09-01T00:00:01.123456Z');expect(html).toContain('2026-09-02T00:00:01.123456Z');
  expect(html).toContain('Older notifications'); expect(html).toContain('Refresh notifications');
  expect(delivered).toHaveBeenCalledWith({userId:'signed-in',sessionId:'session'},undefined);
});
