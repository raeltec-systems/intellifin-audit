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
  // Confirmations are counted only so the double-activation guard is observable: a
  // dialog that calls `onConfirm` twice looks identical to one that calls it once
  // unless something on the page counts. Nothing is stored and nothing is sent.
  const [confirmations, setConfirmations] = useState(0);
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
      {/* Under the surrounding <h3>, so the panel heading is an <h4>. */}
      <UnavailableActions actions={UNAVAILABLE} headingLevel={4} />

      <p className="ls-caption">
        Confirmations recorded on this page:{' '}
        <span data-testid="confirmations">{confirmations}</span>. Nothing is stored.
      </p>

      {current ? (
        <ConfirmDialog
          open
          weight={current.weight}
          title={current.title}
          consequence={current.consequence}
          confirmLabel={current.confirmLabel}
          onConfirm={() => {
            setConfirmations((count) => count + 1);
            setOpen(null);
          }}
          onCancel={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
