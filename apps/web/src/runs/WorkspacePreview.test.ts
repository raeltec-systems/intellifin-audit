import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PreviewSampleTimes, WorkspacePreview, matchingPreview } from './WorkspacePreview';
import {
  SAVED_SCREEN_HEADING,
  WORKSPACE_PREVIEW_ALT,
  WORKSPACE_PREVIEW_LABEL,
  WORKSPACE_PREVIEW_STATUS,
  noSavedScreenSentence,
  savedScreenSentence,
} from './workspace-words';
const sample = { runId: 'run', runtimeId: 'runtime', workspaceRevision: 1, privacyEpoch: 2, mode: 'public' as const, sequence: 3, capturedAt: 1000, captureCompletedAt: 1100, expiresAt: 5000 };
describe('preview freshness after image decode', () => {
  it('accepts only the same fresh runtime, epoch and sample', () => {
    expect(matchingPreview(sample, sample, 2000)).toBe(true);
    for (const changed of [{ runId: 'foreign' }, { runtimeId: 'replacement' }, { workspaceRevision: 2 }, { privacyEpoch: 3 }, { mode: 'private' as const }, { sequence: 4 }, { capturedAt: 999 }, { expiresAt: 1900 }]) {
      expect(matchingPreview(sample, { ...sample, ...changed }, 2000)).toBe(false);
    }
    expect(matchingPreview(sample, sample, 4000)).toBe(false);
    expect(matchingPreview(sample, sample, 999)).toBe(false);
    expect(matchingPreview({ ...sample, captureCompletedAt: 999 }, sample, 2000)).toBe(false);
  });
  it('allows capture progress during decode without extending the decoded sample age', () => {
    const newer = { ...sample, sequence: 4, capturedAt: 1500, captureCompletedAt: 1600 };
    expect(matchingPreview(sample, newer, 2000)).toBe(true);
    expect(matchingPreview(sample, newer, 4000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, sequence: 2 }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, privacyEpoch: 3 }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, runtimeId: 'replacement' }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, mode: 'private' }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, capturedAt: 2100 }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, captureCompletedAt: 1400 }, 2000)).toBe(false);
  });
  it('starts with an accessible unavailable state and no prior pixels', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreview, { runId: 'run', enabled: true }));
    expect(html).toContain(`aria-label="${WORKSPACE_PREVIEW_LABEL}"`);
    expect(html).toContain(`<p role="status" aria-live="polite">${WORKSPACE_PREVIEW_STATUS.unavailable}</p>`);
    expect(html).not.toContain('<img');
  });
});

/**
 * UI cleanup 2026-09-23, UX-24: the preview used to say "Near-live preview · synthetic
 * workspace · not registered evidence." and print two raw ISO instants. It says what the
 * reader is looking at instead, and its privacy states are still said.
 */
const IMPLEMENTATION_WORDS = /near-live|synthetic|registered|action-linked|ephemeral|commit|sample started/i;
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const visibleText = (html: string) => html.replace(/<[^>]+>/g, '');

describe('the live preview says what the reader is looking at (UX-24)', () => {
  it('names no mechanism in any state, label or text alternative', () => {
    for (const words of [...Object.values(WORKSPACE_PREVIEW_STATUS), WORKSPACE_PREVIEW_LABEL, WORKSPACE_PREVIEW_ALT]) {
      expect(words, words).not.toMatch(IMPLEMENTATION_WORDS);
      expect(words, words).not.toMatch(ISO_INSTANT);
    }
  });

  it('says a shown picture is a few seconds behind and is not evidence', () => {
    expect(WORKSPACE_PREVIEW_STATUS.showing).toContain('a few seconds behind');
    expect(WORKSPACE_PREVIEW_STATUS.showing).toContain('Not saved as evidence');
  });

  it('still says the private-step and hidden-tab states', () => {
    expect(WORKSPACE_PREVIEW_STATUS.private).toMatch(/^Private step\./);
    expect(WORKSPACE_PREVIEW_STATUS.private).toContain('hidden');
    expect(WORKSPACE_PREVIEW_STATUS.hidden).toContain('paused while this tab is hidden');
  });

  it('sets its status only from the shared table, never from an inline sentence', () => {
    const source = readFileSync(fileURLToPath(new URL('./WorkspacePreview.tsx', import.meta.url)), 'utf8');
    const calls = [...source.matchAll(/setStatus\(([^;]*?)\);/g)].map((match) => match[1]!);
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const argument of calls) {
      // A literal compared against (`mode === 'private'`) chooses a status; it is not one.
      const statuses = argument.replace(/[=!]==\s*(['"`])[^'"`]*\1/g, '');
      expect(statuses, argument).not.toMatch(/['"`]/);
      expect(statuses, argument).toContain('WORKSPACE_PREVIEW_STATUS.');
    }
    expect(source).toContain('useState<WorkspacePreviewStatus>(WORKSPACE_PREVIEW_STATUS.unavailable)');
    expect(source).not.toMatch(IMPLEMENTATION_WORDS);
    expect(source).not.toContain('toISOString');
  });

  it('writes when the picture was taken and checked in words, exact only in the attributes', () => {
    const capturedAt = Date.parse('2026-09-21T12:24:45.656Z');
    const html = renderToStaticMarkup(createElement(PreviewSampleTimes, { capturedAt, checkedAt: capturedAt + 1_200 }));
    expect(visibleText(html)).toBe('Screen taken 21 Sep 2026, 12:24:45 UTC. Connection checked 21 Sep 2026, 12:24:46 UTC.');
    expect(visibleText(html)).not.toMatch(ISO_INSTANT);
    // The browser proof reads the capture instant from here, so it must stay exact.
    expect(html).toContain('<span data-preview-captured-at="true"><time dateTime="2026-09-21T12:24:45.656Z"');
  });
});

describe('the saved screen says it is evidence, and why none is shown (UX-24, UX-49)', () => {
  it('says the saved screen is evidence and which system it came from', () => {
    expect(SAVED_SCREEN_HEADING).toBe('Latest saved screen');
    expect(savedScreenSentence('LoanCore')).toBe('Saved as evidence from LoanCore.');
    expect(savedScreenSentence(null)).toBe('Saved as evidence.');
  });

  it('says "yet" only of an active Run, and names no mechanism', () => {
    const none = noSavedScreenSentence({ browserOpened: false, active: true });
    const active = noSavedScreenSentence({ browserOpened: true, active: true });
    const ended = noSavedScreenSentence({ browserOpened: true, active: false });
    expect(none).toBe('No browser has been opened for this Run.');
    expect(active).toBe('No screen has been saved yet.');
    expect(ended).toBe('No screen was saved during this Run.');
    for (const words of [none, active, ended, savedScreenSentence('LoanCore')]) expect(words).not.toMatch(IMPLEMENTATION_WORDS);
  });
});
