import Link from 'next/link';

import { PROCEDURE_FILTER_STATES, type ProcedureOwner } from '@intellifin/infrastructure';

import {
  APPLY_FILTERS,
  CLEAR_FILTERS,
  FILTERS_LABEL,
  FILTER_KEYS,
  OWNER_ANY,
  OWNER_LABEL,
  SEARCH_HINT,
  SEARCH_LABEL,
  STATE_ANY,
  STATE_FILTER_WORDS,
  STATE_LABEL,
} from './procedures-list-words';

/**
 * The Procedures list's search and filters (UI cleanup 2026-09-22, UX-03).
 *
 * A `<form method="get">`, which is the ONE exception to this product's "every form is a
 * POST" rule and the reason it exists: a filter MUTATES NOTHING. It therefore works with
 * no JavaScript at all, it is bookmarkable, the browser's back button restores it, and
 * `form-method.test.ts` accepts `get` for exactly this shape.
 *
 * Every control is a native element with a real `<label>`: a `<select>` rather than a
 * listbox, a `<input type="search">` rather than a combobox, and a submit button rather
 * than a change handler — so the page a reader lands on after filtering is a page the
 * server rendered, and nothing here depends on hydration.
 *
 * Clear is a LINK to the unfiltered page, not a reset button: a reset restores the form's
 * initial values, which on a filtered page are the filter, so the control would look like
 * it cleared the list and would not.
 */
export function ProcedureFilters({
  search,
  states,
  ownerId,
  owners,
  names,
}: {
  readonly search: string;
  /** The states the reader chose. Empty filters nothing. */
  readonly states: readonly string[];
  readonly ownerId: string;
  /** Everybody accountable for at least one Procedure, with how many each holds. */
  readonly owners: readonly ProcedureOwner[];
  /** User id to person's name (`ActorNameReader`); an id with no name shows as the id. */
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const filtered = search !== '' || states.length > 0 || ownerId !== '';
  return (
    /* `data-readonly-filter` is the declared exception to the POST rule: this form
       mutates nothing, and `form-method.test.ts` admits a GET form only when it says so
       on the tag itself. */
    <form
      className="ls-filters"
      method="get"
      action="/procedures"
      aria-label={FILTERS_LABEL}
      data-readonly-filter="true"
    >
      <div className="ls-filters__field">
        <label htmlFor="procedures-search">{SEARCH_LABEL}</label>
        <input
          id="procedures-search"
          name={FILTER_KEYS.search}
          type="search"
          defaultValue={search}
          maxLength={200}
          aria-describedby="procedures-search-hint"
        />
        <p className="ls-caption" id="procedures-search-hint">
          {SEARCH_HINT}
        </p>
      </div>

      <div className="ls-filters__field">
        <label htmlFor="procedures-state">{STATE_LABEL}</label>
        {/* One value, not a multi-select: a multi-select is unusable with a keyboard on
            most platforms and the read already accepts a list, so a later story can add
            checkboxes without changing the query string's shape. */}
        <select id="procedures-state" name={FILTER_KEYS.state} defaultValue={states[0] ?? ''}>
          <option value="">{STATE_ANY}</option>
          {PROCEDURE_FILTER_STATES.map((state) => (
            <option key={state} value={state}>
              {STATE_FILTER_WORDS[state]}
            </option>
          ))}
        </select>
      </div>

      <div className="ls-filters__field">
        <label htmlFor="procedures-owner">{OWNER_LABEL}</label>
        <select id="procedures-owner" name={FILTER_KEYS.owner} defaultValue={ownerId}>
          <option value="">{OWNER_ANY}</option>
          {owners.map((owner) => (
            <option key={owner.userId} value={owner.userId}>
              {names.get(owner.userId) ?? owner.userId}
            </option>
          ))}
        </select>
      </div>

      <div className="ls-filters__actions ls-actions">
        <button className="ls-button ls-button--secondary ls-button--md" type="submit">
          {APPLY_FILTERS}
        </button>
        {filtered ? <Link href="/procedures">{CLEAR_FILTERS}</Link> : null}
      </div>
    </form>
  );
}
