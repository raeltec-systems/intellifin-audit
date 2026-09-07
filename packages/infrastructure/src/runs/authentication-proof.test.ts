import { describe, expect, it } from 'vitest';
import type { Page, Response } from 'playwright-core';
import { hasAuthenticatedAccount } from './authentication-proof.js';

function fixture(options: { status?: number; password?: boolean; count?: number; visible?: boolean; text?: string } = {}) {
  const page = {
    locator: () => ({ count: async () => options.password ? 1 : 0 }),
    getByRole: (role: string, query: { name: string; exact: boolean }) => {
      expect(role).toBe('status');
      expect(query).toEqual({ name: 'Current signed-in account', exact: true });
      return { count: async () => options.count ?? 1, isVisible: async () => options.visible ?? true, innerText: async () => options.text ?? 'Signed in as audit.readonly' };
    },
  } as unknown as Page;
  const response = { status: () => options.status ?? 200 } as Response;
  return hasAuthenticatedAccount(page, response);
}

describe('positive authenticated UI proof', () => {
  it('accepts the declared visible authenticated account', async () => { expect(await fixture()).toBe(true); });
  it.each([199, 300, 401, 403, 500])('refuses status %s', async status => { expect(await fixture({ status })).toBe(false); });
  it('refuses a password form even beside a claimed account', async () => { expect(await fixture({ password: true })).toBe(false); });
  it.each([0, 2])('refuses %s account markers', async count => { expect(await fixture({ count })).toBe(false); });
  it('refuses hidden state', async () => { expect(await fixture({ visible: false })).toBe(false); });
  it('requires an identity', async () => { expect(await fixture({ text: 'Signed in as   ' })).toBe(false); });
  it.each([
    'Signed in as another.account',
    'Signed in as audit.readonly (administrator)',
    'Signed in as audit.readonly.evil',
  ])('refuses an unapproved identity marker %s', async text => { expect(await fixture({ text })).toBe(false); });
  it('accepts Northstar\'s bounded explanatory marker', async () => {
    expect(await fixture({ text: 'Signed in as the read-only audit account audit.readonly. This account cannot change anything; the system refuses every write.' })).toBe(true);
  });
  it('refuses an overlong marker even when it starts with the approved phrase', async () => {
    expect(await fixture({ text: `Signed in as audit.readonly${'x'.repeat(257)}` })).toBe(false);
  });
  it('does not inspect a cookie jar to decide authentication', async () => { expect(await fixture({ text: 'Not signed in.' })).toBe(false); });
});
