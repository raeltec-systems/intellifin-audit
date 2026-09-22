/**
 * The words this application shows an auditor, for the things it calls something else
 * inside.
 *
 * An auditor opening the Builder is not reading a schema. They are answering seven
 * questions about a control they already understand: what period, which records, which
 * systems, what counts as a finding, what proof, how often. The domain calls those a
 * Population Source binding, an inclusion rule with predicates, a Target System
 * selection, Compliance Rule conditions with applicability expressions, Evidence
 * Requirements and a Schedule — every one of which is the right name for the thing it
 * freezes, and none of which is the question in the auditor's head.
 *
 * So the domain keeps its names and the surface translates. It is collected here for
 * the reason `copy.ts` is collected: a word retyped in six components is six chances to
 * teach one reader two names for one thing. `plain-words.test.ts` requires every section
 * the domain declares to have a title and a question here, so a heading added to
 * `DRAFT_SECTION_HEADINGS` cannot reach a person untranslated.
 *
 * This is a PRESENTATION mapping and nothing else. `DRAFT_SECTION_HEADINGS` is the
 * stored `jsonb` payload's own key set and is validated on read, so the headings
 * themselves can never move; what the reader sees above one can.
 */
import {
  DRAFT_SECTION_HEADINGS,
  type DeclaredCountMechanism,
  type DraftSectionHeading,
  type DecimalOperator,
  type InclusionPredicate,
  type PopulationSourceKind,
  type TargetSystemKind,
} from '@intellifin/domain';
// The Escalation kinds are the APPLICATION's closed vocabulary, not the domain's:
// `escalation-kind.ts` is the dependency-free leaf the wait commands and the
// notification ports share.
import type { EscalationKind } from '@intellifin/application';

/**
 * Each Builder section as a title and the question it answers.
 *
 * The title is what the reader scans; the question is what tells them whether this is
 * the section they are looking for. "Objective", "Period and scope" and "Schedule" are
 * already the auditor's own words and are left exactly as the domain spells them —
 * translating a word that needs no translation is how a vocabulary starts drifting.
 */
export const SECTION_WORDS: Readonly<
  Record<DraftSectionHeading, { readonly title: string; readonly question: string }>
> = {
  Risk: { title: 'Risk', question: 'What could go wrong?' },
  'Criterion reference': { title: 'Criterion reference', question: 'Which approved policy, standard or requirement is the test based on?' },
  Control: {
    title: 'The control being tested',
    question: 'What is this procedure checking, and why?',
  },
  Objective: {
    title: 'Objective',
    question: 'What does a passing result mean?',
  },
  'Period and scope': {
    title: 'Period and scope',
    question: 'Which dates does this cover, and what is in and out?',
  },
  'Population Source binding': {
    title: 'Records to test',
    question: 'Where does the list of records come from, and which of them are tested?',
  },
  'Target System selection': {
    title: 'Systems to check',
    question: 'Which systems does the agent look in?',
  },
  'Audit Instructions': {
    title: 'Instructions for the agent',
    question: 'In your own words, what should the agent do in each system?',
  },
  'Compliance Rule conditions': {
    title: 'What counts as a finding',
    question: 'What makes one record a problem?',
  },
  'Evidence Requirements': {
    title: 'Evidence to capture',
    question: 'What proof do you need kept for every record?',
  },
  // "How often it runs" and "run on its own" both stated a fact that is not true: no
  // Run starts by itself in this release, and the Schedule step has no control that
  // would make one. The saved frequency is the INTENT, which is what the words say now;
  // `run-start-words.ts` says the rest, in the editor and on three other surfaces.
  //
  // `[REWORDED 2026-09-22, UX-14]` "Planned frequency": the title itself says it is a plan.
  Schedule: {
    title: 'Planned frequency',
    question: 'How often is this test meant to happen, and which dates would each one cover?',
  },
};

/** The sections in the Builder's order, already translated. */
export const SECTION_ORDER: readonly DraftSectionHeading[] = DRAFT_SECTION_HEADINGS;

/**
 * The two sections a Template writes and the Builder never edits.
 *
 * They are read once, at the top, as one panel rather than as two cards each repeating
 * the read-only sentence. Everything after them is a step somebody has to do.
 */
export const TEMPLATE_ONLY_SECTIONS = ['Control', 'Objective', 'Risk', 'Criterion reference'] as const;

/** Whether a section is one of the two the Template writes. */
export function isTemplateOnly(heading: string): boolean {
  return (TEMPLATE_ONLY_SECTIONS as readonly string[]).includes(heading);
}

/**
 * How a Population Source delivers its records, said as the person who set it up would
 * say it.
 *
 * `PopulationSourceKind` is the frozen vocabulary and is what the digest covers; these
 * are the same three things in words. A kind added to the domain without a word here
 * fails `plain-words.test.ts` rather than rendering its own identifier at a reader.
 */
export const SOURCE_KIND_WORDS: Readonly<
  Record<PopulationSourceKind, { readonly label: string; readonly detail: string }>
> = {
  'manual-upload': {
    label: 'Uploaded by hand each time',
    detail: 'Somebody attaches the file when the procedure runs.',
  },
  'versioned-file': {
    label: 'A published file',
    detail: 'The platform downloads the same file every time, from an address you give it.',
  },
  'read-only-api': {
    label: 'A read-only service',
    detail: 'The platform reads the records from a system, without changing anything.',
  },
};

/**
 * How the expected number of records is confirmed by somebody other than this platform.
 *
 * The domain calls it the declared-count mechanism. What it decides is whether a Run can
 * tell "we read every record" from "we read the records we happened to be given", which
 * is the whole reason FR-6 makes its absence visible while a person can still fix it.
 */
export const COUNT_MECHANISM_WORDS: Readonly<
  Record<DeclaredCountMechanism, { readonly label: string; readonly detail: string }>
> = {
  'cover-sheet': {
    label: 'A signed cover sheet',
    detail: 'The file comes with its own record count, signed by the system that produced it.',
  },
  'count-endpoint': {
    label: 'The system reports its own total',
    detail: 'The system says how many records it holds, and the platform checks what it read against that.',
  },
  none: {
    label: 'Nothing confirms it',
    detail: 'Nobody states how many records to expect, so a short file cannot be told from a complete one.',
  },
};

/**
 * What an Escalation is ASKING, in words (FR-27).
 *
 * The stored value is a closed domain vocabulary, and printing one at an auditor is the
 * defect the plain-words pass removed from the authoring screens: `choose-candidate` is a
 * key, not a question. Story 5.6's panel already had this map privately; Story 5.8's
 * Replay jump list printed the raw identifier in a MONOSPACE span, which presents it as an
 * identifier on purpose. One home, typed against the domain union so a kind added there
 * fails to COMPILE rather than reaching a reader as its own name.
 */
export const ESCALATION_KIND_WORDS: Readonly<Record<EscalationKind, string>> = {
  'choose-candidate': 'Choose candidate',
  'unnamed-value': 'Unnamed value',
  'retry-or-skip': 'Retry or skip',
};

/** What a stored kind this build does not recognise is called, rather than its own value. */
export const ESCALATION_KIND_UNKNOWN = 'Unrecognised kind';

/**
 * The plain word for a kind read back from the database, which is typed `string`.
 *
 * `Object.hasOwn`, because a plain-object index keyed by stored input inherits from
 * `Object.prototype` — `'constructor'` returns a function, and this codebase has now been
 * bitten by that six times. An unrecognised kind is NAMED rather than printed: a row
 * already says "Escalation", so repeating an identifier it does not understand would be
 * the defect this map exists to remove, said less clearly.
 */
export function escalationKindWord(kind: string): string {
  return Object.hasOwn(ESCALATION_KIND_WORDS, kind)
    ? ESCALATION_KIND_WORDS[kind as EscalationKind]
    : ESCALATION_KIND_UNKNOWN;
}

/** How a Target System is reached, in words. */
export const TARGET_KIND_WORDS: Readonly<Record<TargetSystemKind, string>> = {
  web: 'Website the agent signs into',
  desktop: 'Desktop application',
  api: 'Read-only service',
  'versioned-file': 'Published file',
};

/**
 * What a digest is, for somebody who has to decide whether to trust one.
 *
 * The surface still shows the value — an auditor compares it — but it stops calling it a
 * digest without saying what it does. "Fingerprint" is the shortest true word: it changes
 * when the thing it covers changes, and not otherwise.
 */
export const FINGERPRINT_WORD = 'Fingerprint';
export const FINGERPRINT_EXPLANATION =
  'A fingerprint of the settings below. It changes if any of them change, which is how a Procedure can prove it ran against the setup you approved.';

/**
 * The comparisons an inclusion filter can make, as one list.
 *
 * The domain splits this across a predicate `kind` and, for decimals, an `operator`, so
 * the Builder used to ask for both — a "Comparison type" and then a "Decimal operator",
 * two controls for one thought. These are the reachable combinations, spelled the way a
 * person says them, and the editor turns one choice back into the two fields the domain
 * wants.
 */
export type FilterComparison =
  | { readonly id: 'text:eq'; readonly label: string; readonly kind: 'text' }
  | { readonly id: `decimal:${DecimalOperator}`; readonly label: string; readonly kind: 'decimal'; readonly operator: DecimalOperator }
  | { readonly id: 'within-period'; readonly label: string; readonly kind: 'within-period' };

export const FILTER_COMPARISONS: readonly FilterComparison[] = [
  { id: 'text:eq', label: 'is exactly', kind: 'text' },
  { id: 'decimal:eq', label: 'equals (number)', kind: 'decimal', operator: 'eq' },
  { id: 'decimal:neq', label: 'does not equal (number)', kind: 'decimal', operator: 'neq' },
  { id: 'decimal:gt', label: 'is more than', kind: 'decimal', operator: 'gt' },
  { id: 'decimal:gte', label: 'is at least', kind: 'decimal', operator: 'gte' },
  { id: 'decimal:lt', label: 'is less than', kind: 'decimal', operator: 'lt' },
  { id: 'decimal:lte', label: 'is at most', kind: 'decimal', operator: 'lte' },
  { id: 'within-period', label: 'falls inside the period above', kind: 'within-period' },
];

export type FilterComparisonId = FilterComparison['id'];

/** The one list entry a stored predicate corresponds to. */
export function filterComparisonId(predicate: InclusionPredicate): FilterComparisonId {
  if (predicate.kind === 'within-period') return 'within-period';
  if (predicate.kind === 'text') return 'text:eq';
  return `decimal:${predicate.operator}`;
}

/**
 * The frozen contract's own field names, in the words the rest of the surface uses.
 *
 * The approval diff, the plan preview and the Target System card each print keys that
 * come straight out of a frozen envelope — `permitted_actions`, `credential_ref`,
 * `zeroRecordPass`. The keys cannot move: they are what the digest covers. What they are
 * CALLED in front of a person can, and has to be the same word in all three places, or
 * an auditor comparing a version diff against the Builder that produced it is reading
 * two vocabularies for one setting.
 *
 * A key with no entry falls back to its own name, spaced out. That is deliberate: a
 * contract key added later renders as itself rather than borrowing another key's words.
 */
export const FROZEN_FIELD_WORDS: Readonly<Record<string, string>> = {
  sourceSnapshot: 'Where the records come from',
  credential_ref: 'Sign-in credential',
  allowed_origins: 'Web addresses the agent may open, or the application identity',
  permitted_actions: 'What the agent may do here',
  attribute_label_patterns: 'Field labels to look for',
  secondary_key: 'Second way to identify a record',
  declared_schema: 'Fields this source provides',
  declared_count_mechanism: 'How the record count is confirmed',
  sensitive_fields: 'Fields shown masked',
  location: 'Where it is fetched from',
  digest: FINGERPRINT_WORD,
  applicabilityAst: 'Compiled "applies to"',
  applicability: 'Applies to',
  rule: 'Compiled rule',
  status: 'How the rule is decided',
  policy: 'Which roles count as privileged',
  rolesField: 'Field holding the roles',
  privileged: 'Privileged roles',
  nonPrivileged: 'Known non-privileged roles',
  groundedBy: 'Proof kept for this value',
  modelRead: 'Agent reading accepted without matching proof',
  platformCaptured: 'Captured automatically',
  screenshot: 'Screenshot of the page',
  recordingSegment: 'Clip of the session recording',
  attributeName: 'What to record',
  zeroRecordPass: 'Passes when no records match',
  allowVersionedDuplicates: 'Same record may appear more than once',
  confidenceThreshold: 'How certain the agent must be',
  agentJudgedThreshold: 'How certain the agent must be',
  from: 'Start date',
  to: 'End date',
  // The frozen review's "Model and tool configuration" section. `model` read as plain
  // "Model" on the version review, which an auditor who had just used the writing
  // assistant read as that assistant — two different models, and only this one is
  // frozen with the version.
  model: 'Plan-check model',
  tools: 'How the agent reads the plan',
  identityMatching: 'How a record is matched',
};

/** The words for one frozen field, or its own name spaced out when it has none. */
export function frozenFieldWord(key: string): string {
  return Object.hasOwn(FROZEN_FIELD_WORDS, key)
    ? FROZEN_FIELD_WORDS[key]!
    : key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replaceAll('_', ' ')
        .replace(/^./, (character) => character.toUpperCase());
}

/**
 * A frozen field whose ABSENCE means something, rather than "nobody filled this in".
 *
 * The version review renders a null frozen value as "Not set", which is right for a
 * field somebody could have filled and wrong for `model`: no plan-check model is
 * configured until a platform configuration revision publishes one, and until then
 * derivation is deterministic — a fact about how the plan was produced, not a gap in
 * the Draft. The owner read "Model: Not set" beside a writing assistant that had just
 * worked and reasonably concluded the two were the same thing.
 *
 * A key with no entry here keeps the generic absence word, which is the safe default:
 * only a field whose absence has a KNOWN meaning gets a sentence.
 */
export const FROZEN_FIELD_ABSENT_WORDS: Readonly<Record<string, string>> = {
  model:
    'No plan-check model is configured, so this plan was worked out from your saved sections alone, with no model involved. The assistant that helps you write is a separate model and is not part of what this version freezes.',
};

/** The sentence for an absent frozen field, or `null` when its absence says nothing. */
export function frozenFieldAbsentWord(key: string): string | null {
  // `Object.hasOwn`: the key comes from a stored frozen review, so a plain index would
  // answer `'constructor'` with a function. The standing rule, met again.
  return Object.hasOwn(FROZEN_FIELD_ABSENT_WORDS, key) ? FROZEN_FIELD_ABSENT_WORDS[key]! : null;
}

/**
 * How identity keys are compared, said once and without the word that reads both ways.
 *
 * The frozen canonical plan text says both "exact normalized employee_id" and "never
 * trim, normalize or parse them as numbers" — a real contradiction to a reader, and one
 * this surface cannot repair: those bytes are the compiler's own and are what the
 * version froze (`makePlan`, compiler 1). So the presentation states the rule plainly
 * beside them and says what the plan's own word means, rather than leaving an auditor to
 * pick whichever half they read first. Compiler 1's rule is opaque exact strings: case,
 * whitespace, leading zeros and Unicode composition are all preserved and compared.
 */
export const IDENTITY_KEYS_EXACT_SENTENCE =
  'Identity keys are compared exactly, character for character: upper and lower case, spaces, leading zeros and accents all count, and nothing is trimmed, re-spelled or read as a number. Where a step below says "exact normalized", it means that exact comparison and no other change.';
