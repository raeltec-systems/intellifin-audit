'use client';

import { useState } from 'react';

import { Button } from '../../src/design/Button';
import { ConfirmDialog, type ConfirmWeight } from '../../src/design/ConfirmDialog';
import { UnavailableActions } from '../../src/design/UnavailableActions';

/**
 * The three confirmation weights and the disabled-action rule, rendered so they can be
 * operated — by a person checking the pattern and by the accessibility gate, which
 * cannot test a focus trap that nothing opens.
 *
 * The consequences below are illustrative. Nothing here mutates anything: `onConfirm`
 * closes the dialog and no more.
 */

const WEIGHTS: readonly {
  weight: ConfirmWeight;
  label: string;
  title: string;
  consequence: string;
  confirmLabel: string;
}[] = [
  {
    weight: 'routine',
    label: 'Routine',
    title: 'Pause this Run?',
    consequence:
      'The Audit Agent stops after the current Step. The Run resumes where it stopped, and nothing already captured changes.',
    confirmLabel: 'Pause Run',
  },
  {
    weight: 'routine-with-rationale',
    label: 'Routine with rationale',
    title: 'Reject this evaluation?',
    consequence:
      'Your replacement value is recorded as Human-classified. The rejected evaluation stays visible beneath it as history.',
    confirmLabel: 'Reject evaluation',
  },
  {
    weight: 'finalization',
    label: 'Finalization',
    title: 'Finalize this Result? This cannot be undone.',
    consequence:
      'Every later mutation on this Result is denied and logged. The sealed outcome and its Evidence stay visible.',
    confirmLabel: 'Finalize Result',
  },
];

const UNAVAILABLE = [
  {
    id: 'unavailable-approve-version',
    label: 'Approve version',
    reason: 'Only an Audit Manager can approve a Procedure Version.',
  },
  {
    id: 'unavailable-finalize-result',
    label: 'Finalize Result',
    reason: 'Only an Audit Manager can approve a submitted Result.',
  },
];

export function ConfirmDialogDemo(): React.JSX.Element {
  const [open, setOpen] = useState<ConfirmWeight | null>(null);
  const current = WEIGHTS.find((entry) => entry.weight === open);

  return (
    <div className="ls-stack">
      <div className="ls-badge-gallery">
        {WEIGHTS.map((entry) => (
          <Button
            key={entry.weight}
            variant={entry.weight === 'finalization' ? 'destructive' : 'secondary'}
            onClick={() => setOpen(entry.weight)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <div className="ls-badge-gallery">
        {UNAVAILABLE.map((action) => (
          <Button key={action.id} disabledReason={action.reason} disabledReasonId={action.id}>
            {action.label}
          </Button>
        ))}
      </div>
      <UnavailableActions actions={UNAVAILABLE} />

      {current ? (
        <ConfirmDialog
          open
          weight={current.weight}
          title={current.title}
          consequence={current.consequence}
          confirmLabel={current.confirmLabel}
          onConfirm={() => setOpen(null)}
          onCancel={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
