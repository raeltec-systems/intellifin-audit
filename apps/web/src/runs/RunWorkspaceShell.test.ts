import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  clampWorkspaceConversationPercent,
  nextWorkspaceConversationPercent,
  RunWorkspaceShell,
} from './RunWorkspaceShell';

describe('RunWorkspaceShell', () => {
  it('keeps the pane ratio inside the usable desktop range and supports keyboard resizing', () => {
    expect(clampWorkspaceConversationPercent(Number.NaN)).toBe(40);
    expect(clampWorkspaceConversationPercent(5)).toBe(28);
    expect(clampWorkspaceConversationPercent(99)).toBe(65);
    expect(nextWorkspaceConversationPercent(40, 'ArrowRight')).toBe(45);
    expect(nextWorkspaceConversationPercent(40, 'ArrowLeft')).toBe(35);
    expect(nextWorkspaceConversationPercent(40, 'Home')).toBe(28);
    expect(nextWorkspaceConversationPercent(40, 'End')).toBe(65);
  });

  it('renders every route slot, a named navigation toggle and an accessible separator', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunWorkspaceShell, {
        header: React.createElement('h1', null, 'Run header'),
        progress: React.createElement('p', null, 'Run progress'),
        controls: React.createElement('button', { type: 'button' }, 'Pause'),
        currentDecision: React.createElement('p', null, 'Current decision'),
        conversation: React.createElement('p', null, 'Conversation history'),
        composer: React.createElement('p', null, 'Composer'),
        workspace: React.createElement('p', null, 'Actual workspace'),
      }),
    );

    expect(html).toContain('Run header');
    expect(html).toContain('Run progress');
    expect(html).toContain('Pause');
    expect(html).toContain('Current decision');
    expect(html).toContain('Conversation history');
    expect(html).toContain('Composer');
    expect(html).toContain('Actual workspace');
    expect(html).toContain('>Navigation</button>');
    expect(html).toContain('>Focus workspace</button>');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize conversation and workspace panes"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('--run-conversation-percent:40%');
    expect(html).not.toContain('autofocus');
  });

  it('pins the decision above conversation content and leaves the actual workspace in its own pane', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunWorkspaceShell, {
        header: null,
        progress: null,
        controls: null,
        currentDecision: React.createElement('p', null, 'DECISION_SLOT'),
        conversation: React.createElement('p', null, 'CONVERSATION_SLOT'),
        composer: React.createElement('p', null, 'COMPOSER_SLOT'),
        workspace: React.createElement('p', null, 'WORKSPACE_SLOT'),
      }),
    );
    expect(html.indexOf('DECISION_SLOT')).toBeLessThan(html.indexOf('CONVERSATION_SLOT'));
    expect(html.indexOf('CONVERSATION_SLOT')).toBeLessThan(html.indexOf('COMPOSER_SLOT'));
    expect(html.indexOf('WORKSPACE_SLOT')).toBeGreaterThan(html.indexOf('COMPOSER_SLOT'));
  });
});

/**
 * One scroll model (UI cleanup 2026-09-23, UX-23): the page does not scroll, the
 * conversation and workspace panes do, and nothing inside the workspace pane adds a
 * scrollbar of its own except a capture a person chose to see at its native size.
 */
function ruleBody(file: string, selector: string): string {
  const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1];
  if (body === undefined) throw new Error(`No rule for ${selector} in ${file}`);
  return body;
}

describe('the workspace pane adds no scroll container of its own', () => {
  it('fits a capture without a viewport scrollbar, and pans only at native size', () => {
    const fit = ruleBody('./WorkspaceCaptureView.css', '.workspace-capture-view__viewport');
    expect(fit).toMatch(/overflow:\s*visible;/);
    expect(fit).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
    const native = ruleBody('./WorkspaceCaptureView.css', '.workspace-capture-view__viewport--native');
    expect(native).toMatch(/overflow:\s*auto;/);
    expect(native).toMatch(/max-height:\s*50dvh;/);
  });

  it('shows native size at the original pixels, not under the session viewer\'s height bound', () => {
    expect(ruleBody('./WorkspaceCaptureView.css', '.workspace-capture-view__viewport--native .ls-session__frame'))
      .toMatch(/max-height:\s*none;/);
  });

  it('spaces the pane content without making it scroll', () => {
    expect(ruleBody('./RunWorkspaceShell.css', '.run-workspace-stage')).not.toMatch(/overflow/);
    expect(ruleBody('./RunWorkspaceShell.css', '.workspace-preview')).not.toMatch(/overflow/);
  });

  it('keeps the shared page header compact above the panes', () => {
    const header = ruleBody('./RunWorkspaceShell.css', '.run-workspace-shell__header .ls-page-header');
    expect(header).toMatch(/margin-bottom:\s*0;/);
    expect(ruleBody('./RunWorkspaceShell.css', '.run-workspace-shell__header .ls-page-header__meta'))
      .toMatch(/font-size:\s*var\(--type-caption-font-size\);/);
  });
});
