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

