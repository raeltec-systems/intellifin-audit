import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import { DrizzleUserDirectory } from './role-repository.js';

describe('managed user directory grant projection', () => {
  it.each(['audit-manager', 'auditor', null])('reports persisted grant independently of role %s', async role => {
    const row = { userId:'subject', name:'Subject', email:'subject@test.invalid', role,
      createdAt:new Date('2026-09-20T12:00:00Z'), transferGranted:true, transferRevision:3 };
    const query = { from:() => query, leftJoin:() => query, orderBy:() => query,
      where:() => query, limit:async () => [row] };
    const directory = new DrizzleUserDirectory({ select:() => query } as unknown as Database);
    expect((await directory.listUsers())[0]).toMatchObject({role,runControlTransferGrant:{granted:true,revision:3}});
    expect(await directory.findUser('subject')).toMatchObject({role,runControlTransferGrant:{granted:true,revision:3}});
  });
  it.each([{transferGranted:false,transferRevision:4},{transferGranted:null,transferRevision:null}])('retains revocation revision or the absent default: %j',async grant => {
    const row = { userId:'subject', name:'Subject', email:'subject@test.invalid', role:'audit-manager',
      createdAt:new Date('2026-09-20T12:00:00Z'), ...grant };
    const query = { from:() => query, leftJoin:() => query, orderBy:() => query, limit:async () => [row] };
    const directory = new DrizzleUserDirectory({ select:() => query } as unknown as Database);
    expect((await directory.listUsers())[0]?.runControlTransferGrant).toEqual({granted:false,revision:grant.transferRevision ?? 0});
  });
});
