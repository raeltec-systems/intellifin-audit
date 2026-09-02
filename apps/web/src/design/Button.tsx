'use client';

import { useId, type MouseEvent, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

interface ButtonProps {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  /** `{spacing.control-sm}` in a record header, `{spacing.control-md}` in a form. */
  readonly size?: 'sm' | 'md';
  readonly type?: 'button' | 'submit';
  readonly icon?: IconName;
  readonly onClick?: () => void;
  /**
   * Why this action is unavailable. Passing it disables the action AND states the
   * reason; there is no way to disable a button silently.
   */
  readonly disabledReason?: string;
  /**
   * The id of the visible sentence in the "Unavailable actions" panel. When the panel
   * is on the surface, the button points its accessible description at that text, so
   * the person hears exactly what everybody else reads. Without it the button carries
   * its own description instead — never a tooltip either way.
   */
  readonly disabledReasonId?: string;
  readonly busy?: boolean;
}

/**
 * The one button.
 *
 * A disabled action keeps its position, its size, and its place in the tab order. It is
 * `aria-disabled`, not `disabled`: a `disabled` element is unfocusable, so its
 * accessible description is unreachable by keyboard — which turns the reason into the
 * hover-only explanation DESIGN.md forbids. Activation is refused in the handler
 * instead, which is what `disabled` was doing that mattered.
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'sm',
  type = 'button',
  icon,
  onClick,
  disabledReason,
  disabledReasonId,
  busy = false,
}: ButtonProps): React.JSX.Element {
  const ownDescriptionId = useId();
  const unavailable = disabledReason !== undefined;
  const describedBy = unavailable ? (disabledReasonId ?? ownDescriptionId) : undefined;

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (unavailable || busy) {
      event.preventDefault();
      return;
    }
    onClick?.();
  }

  return (
    <>
      <button
        type={type}
        className={`ls-button ls-button--${variant} ls-button--${size}`}
        aria-disabled={unavailable || busy ? true : undefined}
        aria-describedby={describedBy}
        onClick={handleClick}
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {children}
      </button>
      {unavailable && disabledReasonId === undefined ? (
        <span id={ownDescriptionId} className="ls-visually-hidden">
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
