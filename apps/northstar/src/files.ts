import { readGeneratedBytes } from './fixtures.js';
import { bytes, escapeHtml, html, json, type NorthstarResponse } from './http.js';
import { layout } from './page.js';

/**
 * The versioned file sources and their signed cover sheets (addendum A.1).
 *
 * The bytes served are the bytes `fixtures/northstar/generate.py` wrote, read off disk and
 * streamed unchanged. That is what makes the cover sheet's digest a digest of what a Run
 * actually fetched rather than of something that was re-serialized on the way out.
 *
 * **The served set is a `Map`, not a path join.** `/files/../../etc/passwd` is a URL
 * anybody can type; an allowlist keyed by name cannot be talked into leaving the folder,
 * and a `Map` cannot be talked into answering `constructor` with something truthy either —
 * which is the class of bug this repository has now hit five times.
 */

export interface Artifact {
  readonly file: string;
  readonly contentType: string;
  readonly description: string;
}

const CSV = 'text/csv; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

export const ARTIFACTS: ReadonlyMap<string, Artifact> = new Map([
  [
    'leavers-export.csv',
    { file: 'leavers-export.csv', contentType: CSV, description: 'The current leavers export.' },
  ],
  [
    'leavers-export.cover-sheet.json',
    {
      file: 'leavers-export.cover-sheet.json',
      contentType: JSON_TYPE,
      description: 'Row count and digest of the current leavers export.',
    },
  ],
  [
    'leavers-export-truncated.csv',
    {
      file: 'leavers-export-truncated.csv',
      contentType: CSV,
      description: 'Seeded incomplete population: fewer rows than its cover sheet declares.',
    },
  ],
  [
    'leavers-export-truncated.cover-sheet.json',
    {
      file: 'leavers-export-truncated.cover-sheet.json',
      contentType: JSON_TYPE,
      description: 'Declares the FULL export. Reconciling it against the truncated file must fail.',
    },
  ],
  [
    'leavers-export-2026-07.csv',
    {
      file: 'leavers-export-2026-07.csv',
      contentType: CSV,
      description: 'Seeded stale population: the previous generation, effective through July.',
    },
  ],
  [
    'leavers-export-2026-07.cover-sheet.json',
    {
      file: 'leavers-export-2026-07.cover-sheet.json',
      contentType: JSON_TYPE,
      description: 'Cover sheet of the previous generation.',
    },
  ],
  [
    'role-matrix.csv',
    {
      file: 'role-matrix.csv',
      contentType: CSV,
      description: 'RoleMatrix: the versioned reference source that expands a role to permissions.',
    },
  ],
  [
    'role-matrix.cover-sheet.json',
    {
      file: 'role-matrix.cover-sheet.json',
      contentType: JSON_TYPE,
      description: 'Row count and digest of RoleMatrix.',
    },
  ],
  [
    'config-registry.csv',
    {
      file: 'config-registry.csv',
      contentType: CSV,
      description: 'ConfigRegistry: the approved configuration baseline.',
    },
  ],
  [
    'config-registry.cover-sheet.json',
    {
      file: 'config-registry.cover-sheet.json',
      contentType: JSON_TYPE,
      description: 'Row count and digest of ConfigRegistry.',
    },
  ],
]);

export function index(): NorthstarResponse {
  const items = [...ARTIFACTS.values()]
    .map(
      (artifact) =>
        `<li><a href="/files/${encodeURIComponent(artifact.file)}">${escapeHtml(artifact.file)}</a> — ${escapeHtml(artifact.description)}</li>`,
    )
    .join('\n');
  return html(
    200,
    layout({
      system: 'Northstar published files',
      title: 'Published files',
      body: `<h2>Published files</h2>\n<ul>\n${items}\n</ul>`,
    }),
  );
}

export function artifact(name: string): NorthstarResponse {
  // `Map.get`, and the name is never joined onto a path. There is nothing to traverse.
  const found = ARTIFACTS.get(name);
  if (found === undefined) {
    return json(404, {
      error: 'not_found',
      message: `No published file is named "${name}".`,
      published: [...ARTIFACTS.keys()],
    });
  }
  return bytes(200, found.contentType, readGeneratedBytes(found.file));
}
