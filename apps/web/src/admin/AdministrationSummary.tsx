import Link from 'next/link';

import { countNoun } from '../design/words';
import {
  ACCOUNTS_WITHOUT_ROLE,
  ADMINISTRATION_AREAS,
  ADMINISTRATION_NOT_AVAILABLE,
  ADMINISTRATION_TABS,
  ADMINISTRATOR_COVER,
  CONFIGURATION_HEALTH_TITLE,
  SOURCES_WITHOUT_A_CONFIRMED_COUNT,
  SYSTEMS_NEVER_CHECKED,
  healthSentence,
} from './administration-words';

/**
 * What a PoC Administrator is responsible for, with the numbers (UX-37).
 *
 * The walkthrough's landing was a heading and one sentence of prose with two links in
 * it: the operator could not see how much there was, or whether any of it needed
 * attention, without opening all three areas. This is the three areas with their EXACT
 * totals and four health lines.
 *
 * Every number here is a `count(*)` over the row set it names, never `rows.length` of a
 * bounded page — a summary that reported the list limit as the total would be wrong in
 * the one place somebody comes to find out how much there is.
 *
 * Every health line renders whether or not it found anything: a section that disappears
 * when all is well is indistinguishable from one that never ran, which is the empty-state
 * rule one altitude up.
 */

export interface AdministrationTotals {
  readonly users: number;
  readonly usersWithoutRole: number;
  readonly administrators: number;
  readonly sources: number;
  readonly sourcesWithoutConfirmedCount: number;
  readonly systems: number;
  readonly systemsNeverChecked: number;
}

/** `attention` decides the treatment; the sentence is the same either way. */
interface Health {
  readonly sentence: string;
  readonly attention: boolean;
}

function health(totals: AdministrationTotals): readonly Health[] {
  return [
    {
      sentence: healthSentence(ACCOUNTS_WITHOUT_ROLE, totals.usersWithoutRole),
      attention: totals.usersWithoutRole > 0,
    },
    {
      // Not a count of a fault: the "clear" state is MORE than one administrator, so the
      // line is inverted deliberately rather than being given a count of zero to render.
      sentence:
        totals.administrators > 1
          ? ADMINISTRATOR_COVER.clear
          : ADMINISTRATOR_COVER.problem(totals.administrators),
      attention: totals.administrators <= 1,
    },
    {
      sentence: healthSentence(
        SOURCES_WITHOUT_A_CONFIRMED_COUNT,
        totals.sourcesWithoutConfirmedCount,
      ),
      attention: totals.sourcesWithoutConfirmedCount > 0,
    },
    {
      sentence: healthSentence(SYSTEMS_NEVER_CHECKED, totals.systemsNeverChecked),
      attention: totals.systemsNeverChecked > 0,
    },
  ];
}

function areaCount(href: (typeof ADMINISTRATION_TABS)[number]['href'], totals: AdministrationTotals): number {
  if (href === '/administration/users') return totals.users;
  if (href === '/administration/sources') return totals.sources;
  return totals.systems;
}

export function AdministrationSummary({
  totals,
}: {
  readonly totals: AdministrationTotals;
}): React.JSX.Element {
  return (
    <div className="ls-stack">
      <ul className="ls-admin-areas">
        {ADMINISTRATION_TABS.map((tab) => {
          const area = ADMINISTRATION_AREAS[tab.href];
          return (
            <li className="ls-admin-area" key={tab.href}>
              <p className="ls-admin-area__count">
                {countNoun(areaCount(tab.href, totals), area.singular, area.plural)}
              </p>
              <h2 className="ls-admin-area__title">
                <Link href={tab.href}>{area.title}</Link>
              </h2>
              <p className="ls-caption">{area.purpose}</p>
            </li>
          );
        })}
      </ul>

      <section className="ls-stack">
        <h2>{CONFIGURATION_HEALTH_TITLE}</h2>
        <ul className="ls-admin-health">
          {health(totals).map((line) => (
            <li
              className={
                line.attention ? 'ls-admin-health__line ls-admin-health__line--attention' : 'ls-admin-health__line'
              }
              key={line.sentence}
            >
              {line.sentence}
            </li>
          ))}
        </ul>
        <p className="ls-caption">{ADMINISTRATION_NOT_AVAILABLE}</p>
      </section>
    </div>
  );
}
