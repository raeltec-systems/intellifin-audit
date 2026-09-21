import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TransferPermissionControl } from './TransferPermissionControl';
function render(role: string, granted = false) {
  return renderToStaticMarkup(React.createElement(TransferPermissionControl, { userId: 'manager', userName: 'Dana', role,
    grant: { granted, revision: 3 }, onSubmit: vi.fn(), onStart: vi.fn(), onResult: vi.fn() }));
}
describe('explicit transfer permission presentation', () => {
  it('presents an ungranted manager with a separate grant action', () => {
    expect(render('audit-manager')).toContain('Not granted'); expect(render('audit-manager')).toContain('Grant transfer permission');
    expect(render('audit-manager', true)).toContain('Revoke transfer permission');
  });
  it.each(['auditor', 'poc-administrator'])('never presents implicit permission for %s', role => {
    expect(render(role)).toContain('Unavailable for this role'); expect(render(role)).not.toContain('<button');
  });
  it('allows an administrator to revoke a legacy grant on an ineligible role', () => {
    expect(render('auditor', true)).toContain('Revoke transfer permission');
    expect(render('auditor', true)).not.toContain('Grant transfer permission');
  });
});
