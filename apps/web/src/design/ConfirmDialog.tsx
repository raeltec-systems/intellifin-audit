'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

/**
 * The three weights, named exactly as EXPERIENCE.md names them.
 *
 * *Routine* restates the consequence. *Routine with rationale* adds a rationale field
 * validated non-empty. *Finalization* alone uses the destructive primary button and
 * names the irreversibility in its title.
 */
export type ConfirmWeight = 'routine' | 'routine-with-rationale' | 'finalization';

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly weight: ConfirmWeight;
  /** Names the consequence, and for a finalization names that it cannot be undone. */
  readonly title: string;
  /** One sentence restating what confirming does. */
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly onConfirm: (rationale: string | null) => void;
  readonly onCancel: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * The confirmation dialog.
 *
 * `role="dialog"` with `aria-modal`, titled with the consequence, focus trapped inside
 * while open, focus restored to the invoking control on close, and Escape cancels.
 * It never auto-confirms: the confirm button is never the element that receives initial
 * focus, which is the rationale field when there is one and Cancel otherwise.
 *
 * A `<dialog>` element would give the trap for free and take the rest away — its
 * top-layer rendering ignores the scrim token, and `showModal()` cannot be driven from
 * a render. The trap is 20 lines; the tokens are the product.
 */
export function ConfirmDialog({
  open,
  weight,
  title,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element | null {
  const titleId = useId();
  const consequenceId = useId();
  const rationaleId = useId();
  const errorId = useId();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const invokerRef = useRef<Element | null>(null);

  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsRationale = weight === 'routine-with-rationale';

  useEffect(() => {
    if (!open) return undefined;
    invokerRef.current = document.activeElement;
    initialFocusRef.current?.focus();
    setRationale('');
    setError(null);
    return () => {
      // Restore focus to whatever opened the dialog. Without this the person lands at
      // the top of the document and has to find their place again.
      const invoker = invokerRef.current;
      if (invoker instanceof HTMLElement) invoker.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const container = dialogRef.current;
    if (!container) return;
    const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleConfirm(): void {
    if (needsRationale && rationale.trim() === '') {
      setError('A rationale is required.');
      document.getElementById(rationaleId)?.focus();
      return;
    }
    onConfirm(needsRationale ? rationale.trim() : null);
  }

  return (
    // The scrim closes nothing: a click outside is not a decision, and this dialog
    // exists to make a decision explicit. The key handler is on the wrapper so it sees
    // Escape and Tab wherever focus sits inside.
    <div className="ls-scrim" onKeyDown={handleKeyDown}>
      <div
        className="ls-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={consequenceId}
        ref={dialogRef}
      >
        <h2 className="ls-dialog__title" id={titleId}>
          {title}
        </h2>
        <p id={consequenceId}>{consequence}</p>

        {needsRationale ? (
          <div className="ls-dialog__field">
            <label htmlFor={rationaleId}>Rationale</label>
            <textarea
              className="ls-textarea"
              id={rationaleId}
              value={rationale}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setRationale(event.target.value);
                if (error) setError(null);
              }}
              ref={(element) => {
                initialFocusRef.current = element;
              }}
            />
            {error ? (
              <p className="ls-field-error" id={errorId} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="ls-dialog__actions">
          <button
            type="button"
            className="ls-button ls-button--secondary ls-button--sm"
            onClick={onCancel}
            ref={(element) => {
              if (!needsRationale) initialFocusRef.current = element;
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`ls-button ls-button--sm ls-button--${
              weight === 'finalization' ? 'destructive' : 'primary'
            }`}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
