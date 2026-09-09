import { Icon, type IconName } from '../design/Icon';
import { corroborationWord, evidenceKindWord } from './labels';

/**
 * The two badge kinds that are outside DESIGN.md's nine families.
 *
 * The Evidence item kind (Structural Snapshot · Screenshot · Source excerpt · Recording
 * segment · Adapter extract) and the grounding corroboration badge (matched ·
 * contradictory · model-read) are both named by DESIGN.md — in the Evidence item card and
 * the Grounding inspector — and neither appears in the nine-row status table.
 *
 * They must NOT be added to `status.ts`: that module is pinned against DESIGN.md's table
 * by a test that reads it off disk, so adding a row the table does not have would break
 * the one claim the module makes, which is that it IS the table.
 *
 * They still carry a word and an icon each, because "never colour alone" is a floor for
 * every badge and not only for the nine. They deliberately use the generic neutral
 * treatment rather than borrowing a family's colour: a kind is not a status, and an
 * Adapter extract wearing the success green would read as a passed check.
 */

const KIND_ICONS: Readonly<Record<string, IconName>> = {
  population: 'file-text',
  'reference-source': 'file-text',
  'adapter-extraction': 'braces',
  'structural-snapshot': 'braces',
  screenshot: 'layout-dashboard',
  'recording-segment': 'play',
};

export function EvidenceKindBadge({ kind }: { readonly kind: string }): React.JSX.Element {
  const icon = Object.hasOwn(KIND_ICONS, kind) ? KIND_ICONS[kind]! : 'file-text';
  return (
    <span className="ls-kind-badge">
      <Icon name={icon} size={12} />
      {evidenceKindWord(kind)}
    </span>
  );
}

/**
 * The corroboration verdict for one grounded attribute.
 *
 * `contradictory` is the only one that carries a warning treatment, because it is the
 * only one that is a finding: DESIGN.md reserves the `user` glyph for "your turn" states,
 * so a human-matched record uses `user-check` and this uses neither.
 */
const CORROBORATION_ICONS: Readonly<Record<string, IconName>> = {
  matched: 'check',
  contradictory: 'alert-triangle',
  'model-read': 'cpu',
};

export function CorroborationBadge({
  value,
}: {
  readonly value: string | null;
}): React.JSX.Element {
  const icon = value !== null && Object.hasOwn(CORROBORATION_ICONS, value) ? CORROBORATION_ICONS[value]! : 'help-circle';
  const tone = value === 'contradictory' ? 'ls-corroboration-badge--contradictory' : 'ls-corroboration-badge--neutral';
  return (
    <span className={`ls-corroboration-badge ${tone}`}>
      <Icon name={icon} size={12} />
      {corroborationWord(value)}
    </span>
  );
}
