'use client';

import { useId, useState } from 'react';
import type { InclusionPredicate, TemplateId } from '@intellifin/domain';

import { Button } from '../design/Button';
import { countNoun } from '../design/words';
import { FILTERS_DO_NOT_FIT, missingFieldsSentence, rankSources, type ChoosableSource, type SourceChoice } from './source-choice';

/**
 * The primary way to choose where a procedure's records come from (UX-11).
 *
 * A searchable list of rows, each naming the source, how its records arrive, the fields
 * it provides in words, and what it lacks for this procedure, with a Choose button. The
 * sources that can serve this procedure come first; the rest are under "Other sources".
 * The chat can still select a source by name, and both paths go through the one save
 * the Builder already has, so the Draft's record filters are kept exactly as before.
 *
 * The search is a filter over the page, not a query: every registered source is already
 * here, so what it hides it hides from view only, and the counts say how many matched.
 */
export function SourceChooser({
  sources,
  templateId,
  predicates,
  selectedBindingId,
  busy,
  disabledReason,
  onChoose,
}: {
  readonly sources: readonly ChoosableSource[];
  readonly templateId: TemplateId;
  readonly predicates: readonly InclusionPredicate[];
  /** The source the Draft has saved, marked in its row instead of offering Choose again. */
  readonly selectedBindingId: string | null;
  readonly busy: boolean;
  readonly disabledReason?: string;
  readonly onChoose: (bindingId: string) => Promise<{ readonly ok: boolean; readonly message: string }>;
}): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<{ readonly ok: boolean; readonly message: string } | null>(null);
  const ranked = rankSources(sources, templateId, predicates, query);
  const shown = ranked.suggested.length + ranked.other.length;

  function row(choice: SourceChoice): React.JSX.Element {
    const selected = choice.bindingId === selectedBindingId;
    const missing = missingFieldsSentence(choice.missing);
    const reason = disabledReason ?? (choice.filtersFit ? undefined : FILTERS_DO_NOT_FIT);
    return (
      <li key={choice.bindingId} className="ls-source-choice" data-source-choice={choice.bindingId}>
        <div className="ls-source-choice__copy">
          <p className="ls-source-choice__name">{choice.displayName}</p>
          <p className="ls-caption">{choice.arrives}</p>
          <p className="ls-caption">Provides: {choice.fields.join(', ')}</p>
          {missing === null ? null : <p className="ls-caption ls-source-choice__missing">{missing}</p>}
        </div>
        <div className="ls-source-choice__action">
          {selected ? (
            <p className="ls-caption" data-source-chosen>Chosen</p>
          ) : (
            <Button
              type="button"
              size="sm"
              busy={busy}
              disabledReason={reason}
              onClick={() => {
                setOutcome(null);
                void onChoose(choice.bindingId).then(setOutcome);
              }}
            >
              Choose<span className="ls-visually-hidden"> {choice.displayName}</span>
            </Button>
          )}
        </div>
      </li>
    );
  }

  return (
    <section className="ls-source-chooser ls-stack" aria-labelledby={`${id}-heading`} data-source-chooser>
      <h4 className="ls-source-chooser__title" id={`${id}-heading`}>Sources you can choose</h4>
      <div className="ls-dialog__field">
        <label htmlFor={`${id}-search`}>Search sources</label>
        <input
          className="ls-input"
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby={`${id}-count`}
        />
        <p className="ls-caption" id={`${id}-count`}>
          {query.trim() === ''
            ? `${countNoun(sources.length, 'source')} set up for this institution.`
            : `${countNoun(shown, 'source')} of ${sources.length} match “${query.trim()}”.`}
        </p>
      </div>
      {/* The live region exists before it has text, so the outcome is announced. */}
      <p role="status" className="ls-caption" data-source-choice-outcome={outcome === null ? undefined : outcome.ok ? 'saved' : 'refused'}>{outcome?.message ?? ''}</p>
      {sources.length === 0 ? (
        <p>No sources are available yet. Ask a PoC Administrator to add one under Administration.</p>
      ) : shown === 0 ? (
        <p>No source matches that search. Clear the search to see every source.</p>
      ) : (
        <>
          {ranked.suggested.length === 0 ? null : (
            <div className="ls-stack" data-source-group="suggested">
              <h5 className="ls-source-chooser__group">Suited to this procedure</h5>
              <ul className="ls-source-chooser__list">{ranked.suggested.map(row)}</ul>
            </div>
          )}
          {ranked.other.length === 0 ? null : (
            <div className="ls-stack" data-source-group="other">
              <h5 className="ls-source-chooser__group">Other sources</h5>
              <ul className="ls-source-chooser__list">{ranked.other.map(row)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
