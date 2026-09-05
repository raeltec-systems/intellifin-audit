'use client';

import { createContext, createElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

function createSubmissionRegistry() {
  const readers = new Map<string, () => string | null>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach(listener => listener());
  return {
    reason: () => [...readers.values()].map(read => read()).find(reason => reason !== null) ?? null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    register(id: string, read: () => string | null) { readers.set(id, read); changed(); return () => { readers.delete(id); changed(); }; },
    changed,
  };
}
const SubmissionContext = createContext<ReturnType<typeof createSubmissionRegistry> | null>(null);
export function BuilderSubmissionProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createSubmissionRegistry);
  return createElement(SubmissionContext.Provider, { value: registry }, children);
}
export function useSubmissionGuard() {
  const registry = useContext(SubmissionContext);
  const reason = useSyncExternalStore(registry?.subscribe ?? (() => () => {}), registry?.reason ?? (() => null), () => null);
  return { reason, check: registry?.reason ?? (() => null) };
}
export function useSectionSubmissionStatus(name: string, section: { status(): { dirty: boolean; conflict: boolean; pending: boolean } }, busy: boolean, unknown: boolean) {
  const registry = useContext(SubmissionContext), id = useId();
  const read = useRef((): string | null => null);
  read.current = () => {
    const status = section.status();
    if (unknown) return `Reload to inspect the unknown save outcome in ${name} before submitting.`;
    if (busy || status.pending) return `Wait for the ${name} save to be acknowledged before submitting.`;
    if (status.conflict) return `Resolve the saved-value conflict in ${name} before submitting.`;
    return status.dirty ? `Save or reset unsaved changes in ${name} before submitting.` : null;
  };
  useLayoutEffect(() => registry?.register(id, () => read.current()), [registry, id]);
  useLayoutEffect(() => { registry?.changed(); });
}

export interface SectionState<T> { value: T; baseline: T; token: string; conflict: boolean }
// PostgreSQL jsonb can reorder object keys; ordered authored arrays still retain meaning.
// Unlike the durable JSON validator this also accepts incomplete text while it is edited.
const sectionKey = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, (item as Record<string, unknown>)[key]])) : item) ?? 'undefined';
const equal = (left: unknown, right: unknown): boolean => sectionKey(left) === sectionKey(right);

/** A whole-row token may move safely only when this section's authoring baseline agrees. */
export function reconcileSection<T>(state: SectionState<T>, server: T, token: string): SectionState<T> {
  if (state.conflict) return state;
  if (equal(state.value, state.baseline) || equal(state.value, server)) {
    return { value: server, baseline: server, token, conflict: false };
  }
  if (equal(state.baseline, server)) return { ...state, token };
  return { ...state, conflict: true };
}

/** Action acknowledgements and refreshed props arrive independently. Tokens are opaque:
 * retain an acknowledged token until its snapshot arrives, and never revive a retired token. */
export function createSectionMachine<T>(server: T, token: string) {
  let state: SectionState<T> = { value: server, baseline: server, token, conflict: false };
  let observed = { value: server, token };
  let revision = 0;
  let pending: { normalized: T; baseline: T; token: string; revision: number; acknowledged: boolean } | null = null;
  let awaiting: { value: T } | null = null;
  const retired = new Set<string>();
  const adopt = (next: SectionState<T>) => {
    if (next.token !== state.token) retired.add(state.token);
    state = next;
  };
  return {
    get state() { return state; },
    status() { return { dirty: !equal(state.value, state.baseline), conflict: state.conflict, pending: pending !== null }; },
    observe(nextServer: T, nextToken: string, normalize?: (value: T) => T) {
      // A parent may publish the action token before refreshing its section data.
      // Neither that pair nor another old-snapshot refresh supersedes the acknowledgement.
      if (awaiting !== null && equal(nextServer, observed.value) && !equal(nextServer, awaiting.value)) return;
      if (retired.has(nextToken)) return;
      observed = { value: nextServer, token: nextToken };
      if (state.conflict) return;
      if (awaiting !== null) {
        if (equal(nextServer, awaiting.value)) {
          awaiting = null;
          adopt({ ...state, token: nextToken });
        } else {
          state = { ...state, conflict: true };
        }
        return;
      }
      if (pending !== null && equal(nextServer, pending.normalized)) {
        pending.acknowledged ||= nextToken !== pending.token;
        adopt({ ...state, baseline: nextServer, token: nextToken });
      } else if (pending !== null && (pending.acknowledged || (!equal(nextServer, pending.baseline) && !(normalize !== undefined && equal(nextServer, normalize(pending.baseline)))))) {
        state = { ...state, conflict: true };
      } else if (normalize !== undefined && equal(nextServer, normalize(state.baseline))) {
        const pristine = equal(state.value, state.baseline);
        adopt({ ...state, value: pristine ? nextServer : state.value, baseline: nextServer, token: nextToken });
      } else adopt(reconcileSection(state, nextServer, nextToken));
    },
    edit(value: T) { revision += 1; state = { ...state, value }; },
    begin(normalized: T) { pending = { normalized, baseline: state.baseline, token: state.token, revision, acknowledged: false }; },
    finish(nextToken?: string) {
      const sent = pending;
      pending = null;
      if (nextToken === undefined || sent === null || state.conflict) return false;
      const unchanged = revision === sent.revision;
      // A refreshed acknowledgement can already include a later unrelated-section save.
      // Do not replace that observed token with the earlier action response token.
      const acknowledged = sent.acknowledged && equal(observed.value, sent.normalized);
      adopt({ value: unchanged ? sent.normalized : state.value, baseline: sent.normalized,
        token: acknowledged ? state.token : nextToken, conflict: false });
      if (!acknowledged) awaiting = { value: sent.normalized };
      return unchanged;
    },
    reset() {
      revision += 1;
      pending = null;
      awaiting = null;
      adopt({ value: observed.value, baseline: observed.value, token: observed.token, conflict: false });
    },
  };
}

export function useSection<T>(server: T, rowVersion: string, normalizeBaseline?: (value: T) => T) {
  const machine = useRef<ReturnType<typeof createSectionMachine<T>> | null>(null);
  machine.current ??= createSectionMachine(server, rowVersion);
  const section = machine.current;
  const [state, render] = useState(section.state);
  const current = useRef(state);
  const publish = () => { current.current = section.state; render(section.state); };
  const serverKey = sectionKey(server);
  useEffect(() => {
    section.observe(server, rowVersion, normalizeBaseline);
    publish();
  }, [serverKey, rowVersion]);
  return {
    ...state,
    status: section.status,
    current,
    edit(value: T) { section.edit(value); publish(); },
    begin(normalized: T) { section.begin(normalized); },
    finish(token?: string) { const unchanged = section.finish(token); publish(); return unchanged; },
    reset() { section.reset(); publish(); },
  };
}
