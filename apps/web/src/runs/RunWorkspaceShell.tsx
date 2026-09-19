'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import './RunWorkspaceShell.css';

export const RUN_WORKSPACE_DEFAULT_CONVERSATION_PERCENT = 40;
export const RUN_WORKSPACE_MIN_CONVERSATION_PERCENT = 28;
export const RUN_WORKSPACE_MAX_CONVERSATION_PERCENT = 65;
export const RUN_WORKSPACE_DEFAULT_STORAGE_KEY = 'intellifin.run-workspace.preferences';

export type WorkspacePaneResizeKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End';

/** Keep the conversation wide enough to read while leaving the stage useful at desktop sizes. */
export function clampWorkspaceConversationPercent(value: number): number {
  if (!Number.isFinite(value)) return RUN_WORKSPACE_DEFAULT_CONVERSATION_PERCENT;
  return Math.min(
    RUN_WORKSPACE_MAX_CONVERSATION_PERCENT,
    Math.max(RUN_WORKSPACE_MIN_CONVERSATION_PERCENT, Math.round(value)),
  );
}

/** The keyboard step is deliberately large enough to be useful with a single key press. */
export function nextWorkspaceConversationPercent(
  current: number,
  key: WorkspacePaneResizeKey,
): number {
  const value = clampWorkspaceConversationPercent(current);
  switch (key) {
    case 'Home':
      return RUN_WORKSPACE_MIN_CONVERSATION_PERCENT;
    case 'End':
      return RUN_WORKSPACE_MAX_CONVERSATION_PERCENT;
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampWorkspaceConversationPercent(value - 5);
    case 'ArrowRight':
    case 'ArrowUp':
      return clampWorkspaceConversationPercent(value + 5);
  }
}

interface StoredWorkspacePreferences {
  readonly conversationPercent?: unknown;
  readonly focusWorkspace?: unknown;
}

export interface RunWorkspaceShellProps {
  /** The Run identity and state row. It stays above both working panes. */
  readonly header: ReactNode;
  /** Progress and as-of information supplied by the route. */
  readonly progress: ReactNode;
  /** Route controls, filters or action buttons. */
  readonly controls: ReactNode;
  /** A decision or review card pinned above the left conversation history. */
  readonly currentDecision: ReactNode;
  /** The conversation renderer. Its own thread can be independently bounded. */
  readonly conversation: ReactNode;
  /** A composer pinned below the conversation. */
  readonly composer: ReactNode;
  /** The actual action-linked workspace stage supplied by the route. */
  readonly workspace: ReactNode;
  /** Only pane preferences are stored under this key. */
  readonly storageKey?: string;
  readonly initialConversationPercent?: number;
  readonly initialFocusWorkspace?: boolean;
  readonly onFocusWorkspaceChange?: (focused: boolean) => void;
}

function readStoredPreferences(storageKey: string): {
  conversationPercent: number | null;
  focusWorkspace: boolean | null;
} {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return { conversationPercent: null, focusWorkspace: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { conversationPercent: null, focusWorkspace: null };
    }
    const stored = parsed as StoredWorkspacePreferences;
    return {
      conversationPercent:
        typeof stored.conversationPercent === 'number'
          ? clampWorkspaceConversationPercent(stored.conversationPercent)
          : null,
      focusWorkspace: typeof stored.focusWorkspace === 'boolean' ? stored.focusWorkspace : null,
    };
  } catch {
    return { conversationPercent: null, focusWorkspace: null };
  }
}

function writeStoredPreferences(
  storageKey: string,
  conversationPercent: number,
  focusWorkspace: boolean,
): void {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ conversationPercent, focusWorkspace }),
    );
  } catch {
    // Private browsing and blocked storage are valid browser states. Pane behavior still works.
  }
}

/**
 * The reusable Run work surface. The left pane is a conversation and the right pane is the
 * real workspace supplied by the route. Scroll containers sit above the pinned decision and
 * composer so a long history or a tall capture never pushes the action surface away.
 */
export function RunWorkspaceShell({
  header,
  progress,
  controls,
  currentDecision,
  conversation,
  composer,
  workspace,
  storageKey = RUN_WORKSPACE_DEFAULT_STORAGE_KEY,
  initialConversationPercent = RUN_WORKSPACE_DEFAULT_CONVERSATION_PERCENT,
  initialFocusWorkspace = false,
  onFocusWorkspaceChange,
}: RunWorkspaceShellProps): React.JSX.Element {
  const [conversationPercent, setConversationPercent] = useState(() =>
    clampWorkspaceConversationPercent(initialConversationPercent),
  );
  const [focusWorkspace, setFocusWorkspace] = useState(initialFocusWorkspace);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startPercent: number } | null>(null);

  /**
   * The shell follows the space left after the route chrome. That chrome is intentionally
   * server-rendered and its height changes with banners, open decisions and compact route
   * controls, so a viewport-only `76dvh` leaves the composer below the fold on short pages.
   * Keep the measured value on the shell itself so the layout still has a deterministic CSS
   * fallback before hydration.
   */
  const measureAvailableHeight = useCallback(() => {
    const shell = shellRef.current;
    if (shell === null || typeof window === 'undefined') return;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const rect = shell.getBoundingClientRect();
    // Derive the shell's document origin before subtracting the viewport bottom. Using
    // `rect.top` alone would make the shell grow every time the page scrolled upward.
    const documentTop = rect.top + window.scrollY;
    const available = Math.max(240, Math.floor(viewportHeight - documentTop - 12));
    shell.style.setProperty('--run-workspace-available-height', `${available}px`);
  }, []);

  useEffect(() => {
    measureAvailableHeight();
    window.addEventListener('resize', measureAvailableHeight);
    const parent = shellRef.current?.parentElement;
    const observer = typeof ResizeObserver === 'undefined' || parent == null
      ? null
      : new ResizeObserver(measureAvailableHeight);
    if (observer !== null && parent != null) observer.observe(parent);
    return () => {
      window.removeEventListener('resize', measureAvailableHeight);
      observer?.disconnect();
    };
  }, [measureAvailableHeight]);

  useEffect(() => {
    const stored = readStoredPreferences(storageKey);
    if (stored.conversationPercent !== null) setConversationPercent(stored.conversationPercent);
    if (stored.focusWorkspace !== null) setFocusWorkspace(stored.focusWorkspace);
    setStorageHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!storageHydrated) return;
    writeStoredPreferences(storageKey, conversationPercent, focusWorkspace);
  }, [conversationPercent, focusWorkspace, storageHydrated, storageKey]);

  const setFocusMode = useCallback(
    (focused: boolean) => {
      setFocusWorkspace(focused);
      onFocusWorkspaceChange?.(focused);
    },
    [onFocusWorkspaceChange],
  );

  const onSeparatorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const key = event.key as WorkspacePaneResizeKey;
      if (
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight' &&
        key !== 'ArrowUp' &&
        key !== 'ArrowDown' &&
        key !== 'Home' &&
        key !== 'End'
      ) {
        return;
      }
      event.preventDefault();
      setConversationPercent((current) => nextWorkspaceConversationPercent(current, key));
    },
    [],
  );

  const onSeparatorPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || splitRef.current === null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startPercent: conversationPercent };
    },
    [conversationPercent],
  );

  const onSeparatorPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const split = splitRef.current;
    if (drag === null || split === null) return;
    const width = split.getBoundingClientRect().width;
    if (width <= 0) return;
    const delta = ((event.clientX - drag.startX) / width) * 100;
    setConversationPercent(clampWorkspaceConversationPercent(drag.startPercent + delta));
  }, []);

  const endSeparatorDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const splitStyle = {
    '--run-conversation-percent': `${conversationPercent}%`,
  } as CSSProperties;

  return (
    <section
      ref={shellRef}
      className={`run-workspace-shell${focusWorkspace ? ' run-workspace-shell--focus-workspace' : ''}${navigationOpen ? ' run-workspace-shell--navigation-open' : ''}`}
      data-testid="run-workspace-shell"
    >
      <div className="run-workspace-shell__header">{header}</div>
      <div className="run-workspace-shell__meta">
        <div className="run-workspace-shell__progress">{progress}</div>
        <div className="run-workspace-shell__controls">
          <div className="run-workspace-shell__controls-content">{controls}</div>
          <button
            type="button"
            className="run-workspace-shell__navigation-button"
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((open) => !open)}
          >
            {navigationOpen ? 'Hide navigation' : 'Navigation'}
          </button>
          <button
            type="button"
            className="run-workspace-shell__focus-button"
            aria-pressed={focusWorkspace}
            onClick={() => setFocusMode(!focusWorkspace)}
          >
            {focusWorkspace ? 'Show conversation' : 'Focus workspace'}
          </button>
        </div>
      </div>

      <div
        ref={splitRef}
        className="run-workspace-shell__split"
        style={splitStyle}
        data-conversation-percent={conversationPercent}
      >
        <section
          className="run-workspace-shell__pane run-workspace-shell__conversation-pane"
          aria-label="Conversation pane"
          hidden={focusWorkspace}
        >
          <div className="run-workspace-shell__pinned run-workspace-shell__decision">
            {currentDecision}
          </div>
          <div className="run-workspace-shell__scroll run-workspace-shell__conversation-scroll">
            {conversation}
          </div>
          <div className="run-workspace-shell__pinned run-workspace-shell__composer">
            {composer}
          </div>
        </section>

        <button
          type="button"
          className="run-workspace-shell__separator"
          role="separator"
          aria-label="Resize conversation and workspace panes"
          aria-orientation="vertical"
          aria-valuemin={RUN_WORKSPACE_MIN_CONVERSATION_PERCENT}
          aria-valuemax={RUN_WORKSPACE_MAX_CONVERSATION_PERCENT}
          aria-valuenow={conversationPercent}
          tabIndex={0}
          onKeyDown={onSeparatorKeyDown}
          onPointerDown={onSeparatorPointerDown}
          onPointerMove={onSeparatorPointerMove}
          onPointerUp={endSeparatorDrag}
          onPointerCancel={endSeparatorDrag}
        >
          <span aria-hidden="true" />
        </button>

        <section
          className="run-workspace-shell__pane run-workspace-shell__workspace-pane"
          aria-label="Run workspace"
        >
          <div className="run-workspace-shell__scroll run-workspace-shell__workspace-scroll" role="region" aria-label="Workspace capture viewport" tabIndex={0}>
            {workspace}
          </div>
        </section>
      </div>
    </section>
  );
}
