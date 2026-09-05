'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The three weights, named exactly as EXPERIENCE.md names them.
 *
 * *Routine* restates the consequence. *Routine with rationale* adds a rationale field
 * validated non-empty. *Finalization* alone uses the destructive primary button and
 * names the irreversibility in its title.
 */
export type ConfirmWeight = 'routine' | 'routine-with-rationale' | 'finalization';

interface ConfirmDialogProps {
  readonly initialRationale?: string;
  readonly refusal?: string | null;
  readonly busy?: boolean;
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

/** The element the shell wraps every page in. Made inert while a dialog is open. */
const APP_ROOT_ID = 'ls-app';

/**
 * The confirmation dialog.
 *
 * `role="dialog"` with `aria-modal`, focus trapped inside while open, focus restored to
 * the invoking control on close, and Escape cancels. It never auto-confirms: the confirm
 * button is never the element that receives initial focus, which is the rationale field
 * when there is one and Cancel otherwise.
 *
 * Three things it does that `aria-modal` alone does not:
 *
 *   1. The key handler is on `document`, not on the scrim element. The scrim is not
 *      focusable, so a click on it puts focus on `<body>` and a handler bound there
 *      never fires again — Escape would silently stop working and the dialog could not
 *      be dismissed from the keyboard at all.
 *   2. The rest of the page is marked `inert` and body scroll is locked. `aria-modal`
 *      is a hint to a screen reader and nothing more: without `inert`, a mouse and a
 *      screen reader both still reach every control behind the scrim.
 *   3. Confirming twice before the parent unmounts calls `onConfirm` once. A double
 *      Enter on a mutating action is a real double submit.
 *
 * A `<dialog>` element would give the trap and the inertness for free and take the rest
 * away — its top-layer rendering ignores the scrim token, and `showModal()` cannot be
 * driven from a render.
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
  initialRationale = '', refusal = null, busy = false,
}: ConfirmDialogProps): React.JSX.Element | null {
  const titleId = useId();
  const consequenceId = useId();
  const rationaleId = useId();
  const errorId = useId();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const invokerRef = useRef<Element | null>(null);
  const confirmedRef = useRef(false);

  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsRationale = weight === 'routine-with-rationale';

  // The document listener is installed once per opening, so it must not close over a
  // stale `onCancel`. This ref always holds the current one.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  // Portalled to `<body>` so the shell can be made inert without the dialog, which
  // would otherwise be inside it, going inert too.
  useEffect(() => {
    setContainer(document.body);
  }, []);

  useEffect(() => {
    if (!open || !container) return undefined;

    invokerRef.current = document.activeElement;
    initialFocusRef.current?.focus();
    setRationale(initialRationale);
    setError(null);
    confirmedRef.current = false;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (!(active instanceof Node) || !dialog.contains(active)) {
        // Focus fell out of the dialog — a backdrop click puts it on <body>. Bring it back.
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    const appRoot = document.getElementById(APP_ROOT_ID);
    appRoot?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      appRoot?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      // Restore focus to whatever opened the dialog. Without this the person lands at
      // the top of the document and has to find their place again.
      const invoker = invokerRef.current;
      if (invoker instanceof HTMLElement) invoker.focus();
    };
  }, [open, container]);

  useEffect(() => { if (refusal) confirmedRef.current = false; }, [refusal]);

  if (!open || !container) return null;

  function handleConfirm(): void {
    if (confirmedRef.current || busy) return;
    if (needsRationale && rationale.trim() === '') {
      setError('A rationale is required.');
      document.getElementById(rationaleId)?.focus();
      return;
    }
    confirmedRef.current = true;
    onConfirm(needsRationale ? rationale.trim() : null);
  }

  return createPortal(
    // The scrim closes nothing: a click outside is not a decision, and this dialog
    // exists to make a decision explicit.
    <div className="ls-scrim">
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
        {refusal ? <p role="alert" className="ls-field-error">{refusal}</p> : null}

        {needsRationale ? (
          <div className="ls-dialog__field">
            <label htmlFor={rationaleId}>Rationale</label>
            <textarea
              className="ls-textarea"
              id={rationaleId}
              value={rationale}
              maxLength={4000}
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
            disabled={busy}
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
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    container,
  );
}
