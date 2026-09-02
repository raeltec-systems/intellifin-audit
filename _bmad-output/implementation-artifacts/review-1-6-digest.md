---
title: Story 1.6 review — cryptography and the digest contract
lens: correctness of the cryptography and the AD-2 digest contract
date: 2026-09-02
---

# Story 1.6 review — cryptography and the digest contract

Baseline `2c692c3`; the Story 1.6 work was staged when the review started and was
committed to `1e89234` while it ran. Every claim below was executed, not reasoned about,
except where the text says otherwise.

## Scope

| File | Verdict |
| --- | --- |
| `packages/domain/src/canonical-json.ts` | 1 SHOULD |
| `packages/domain/src/sha256.ts` | clean as a hash; 1 BLOCKER against its own docstring |
| `packages/domain/src/registrations/target-system.ts` | 1 BLOCKER, 1 BLOCKER (shared) |
| `packages/domain/src/registrations/target-system.test.ts` | 1 CONSIDER |
| `packages/domain/src/audit-event.ts` (extraction only) | clean |
| `tests/fixtures/registration-digest-golden.json` | 1 SHOULD |
| `scripts/make-registration-digest-golden.py` | reproduces byte-identically |
| `tests/unit/registration-digest.test.ts`, `tests/unit/sha256.test.ts` | 1 CONSIDER |

## What was verified clean

These are the questions the lens asked, answered by execution.

**1. The canonicalizer extraction did not change the audit chain.** The moved body is
character-for-character the old one:

```
$ git show 2c692c3:packages/domain/src/audit-event.ts | awk '/^function canonicalize\(/,/^}/' \
    | sed 's/canonicalize/CANON/g' > old.txt
$ sed -n '/^export function canonicalJson/,/^}/p' packages/domain/src/canonical-json.ts \
    | sed 's/^export //; s/canonicalJson/CANON/g' > new.txt
$ diff -u old.txt new.txt        # no output
```

The only other change to `audit-event.ts` inside `canonicalizeAuditEvent` is the call
name (`canonicalize` → `canonicalJson`, line 299); the eleven-key projection and the
`assertJsonValue` guard on line 298 are untouched. `tests/fixtures/audit-chain-golden.json`
is not in the Story 1.6 diff at all (`git diff --cached --stat` over that path is empty),
and `tests/unit/audit-event.test.ts` — which pins both `canonicalizeAuditEvent` text and
`computeAuditEventHash` against it — passes:

```
✓ packages/domain/src/registrations/target-system.test.ts (10 tests)
✓ tests/unit/sha256.test.ts (21 tests)
✓ tests/unit/registration-digest.test.ts (7 tests)
✓ tests/unit/audit-event.test.ts (18 tests)
Test Files  4 passed (4)   Tests  56 passed (56)
```

**2. The hand-written SHA-256 is correct.** Run against `node:crypto`:

- 19 ASCII lengths — `0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 255, 256, 1000, 10000, 100000` — all match, so the padding and the multi-block loop are right at every block boundary and well past the first two blocks.
- 500 random byte strings of length 0..599 through `sha256HexOfBytes` — all match.
- Astral and multi-byte input (`U+1F50E`, `U+1D11E`, `U+10FFFF`, mixed, `U+2028`, `U+0000`) — all match, so `utf8Bytes` agrees with `Buffer.from(…, 'utf8')` on every well-formed input.
- Lone surrogates (`\uD800`, `a\uDC00b`, `\uD83D`, `\uD83D\uD83D`) all throw `Utf8EncodingError` rather than substituting U+FFFD.

Zero mismatches. The `>>> 0` discipline is complete: every `rotateRight`, every `w[i]`
recurrence, every `temp1`/`temp2`, and every state update is masked, and the largest
un-masked intermediate is five 32-bit addends (`temp1`, `sha256.ts:129`) ≈ 2^34.3, exact
in a double.

The 64-bit big-endian length split (`sha256.ts:101-102`) is right above 2^32 bits. A
600 MB buffer is impractical here, so this was checked arithmetically instead:

| bytes | bits | `hi` | `lo` | `hi·2³² + lo == bits` | tail gap |
| --- | --- | --- | --- | --- | --- |
| 536 870 911 | 4 294 967 288 | 0 | 4 294 967 288 | yes | 65 |
| 536 870 912 | 4 294 967 296 | 1 | 0 | yes | 64 |
| 600 000 000 | 4 800 000 000 | 1 | 505 032 704 | yes | 64 |
| 4 000 000 000 | 32 000 000 000 | 7 | 1 935 228 928 | yes | 64 |

`paddedLength` always leaves at least 9 bytes after the message, and `((len + 72) / 64) | 0`
cannot overflow 32 bits for any allocatable `Uint8Array`.

**3. RFC 8785 conformance, checked against Python `rfc8785` 0.1.4 rather than against the
RFC prose.** Byte-identical output on every case the two implementations both accept:

| input | `canonicalJson` | `rfc8785.dumps` |
| --- | --- | --- |
| `{a: -0}` | `{"a":0}` | `{"a":0}` |
| `{a: 1e21}` | `{"a":1e+21}` | `{"a":1e+21}` |
| `{a: 1e-7}` | `{"a":1e-7}` | `{"a":1e-7}` |
| `{a: 0.1}` | `{"a":0.1}` | `{"a":0.1}` |
| `{a: "\b\f\n\r\t"}` | `{"a":"\b\f\n\r\t"}` | identical |
| `{a: "  "}` | emitted raw (`e2 80 a8 e2 80 a9`) | identical |
| `{a: "🔎"}` | emitted raw (`f0 9f 94 8e`) | identical |
| `{"🔎":1, "�":2, "a":3}` | `{"a":3,"🔎":1,"�":2}` | identical |

That last row is the one that matters: `U+1F50E` sorts **before** `U+FFFD` because its
leading UTF-16 code unit is `0xD83D`, which is what RFC 8785 §3.2.3 requires and what
`Array.prototype.sort`'s default comparator does. Code-point order would have put
`U+FFFD` first. Key sorting is correct.

**4. The golden fixture was not produced by the code under test.** `uv run
scripts/make-registration-digest-golden.py` regenerates
`tests/fixtures/registration-digest-golden.json` byte-identically (same md5,
`8d982ca23e4ae41fb71ae941e6078a08`, empty `git diff`). The generator imports `rfc8785`
and `hashlib` only, hand-writes each envelope, and refuses to write a fixture whose
vectors share a digest. `registration-digest.test.ts:46` pins `producer` to `/^Python /`.
This one is genuinely independent evidence.

**5. No two different registrations collide on one digest through the locator slot.** For
`kind === 'desktop'` the envelope reads `applicationIdentity` and ignores `allowedOrigins`;
for every other kind it reads `allowedOrigins` and ignores `applicationIdentity`
(`target-system.ts:138-141`) — and `toRecord` in the command forces the ignored one to
`[]` / `''` before storing (`register-target-system.ts:260-261`), so the row never carries
a value the digest cannot see. `kind` is itself inside the envelope, so a desktop system
whose application identity is `X` cannot collide with a web system whose sole origin is
`X`. Two registrations with the same six normalised fields do share a digest, but that is
the design: the digest names a capability, not a row (see CONSIDER 4).

---

## Findings

### BLOCKER 1 — a duplicate origin makes the chain record a digest change that did not happen

`packages/domain/src/registrations/target-system.ts:122-124` (root cause),
`packages/application/src/registrations/register-target-system.ts:197-199, 303-320`
(where it surfaces).

`normalizedSet` trims, **deduplicates** and sorts. It is private to the domain module, so
the command re-implements a weaker normalisation: `cleaned()` trims and drops blanks but
does not deduplicate, and `changedDigestFields`'s `same()` compares lengths first. The two
disagree, and the disagreement is reachable — nothing between the textarea and the row
deduplicates (`actions.ts:69-75` bounds lengths only).

Concrete failing input, executed:

```
before: allowedOrigins = ["https://a.example", "https://a.example"]
after : allowedOrigins = ["https://a.example"]

digest before                     04429baa4e663291f4f664563039683bcba0ece25fa929dcafda5a8624a1a81e
digest after                      04429baa4e663291f4f664563039683bcba0ece25fa929dcafda5a8624a1a81e
digests equal                     true
changedDigestFields sees a change true
```

So `changeTargetSystem` takes the `changed.length !== 0` branch and appends
`configuration.registration-changed` (`register-target-system.ts:544-563`) with
`priorDigest === newDigest` and `changedFields: ['allowedOrigins']`. That event is in an
immutable chain, it says a registration changed when nothing the agent may touch changed,
and it is exactly what Epic 2 reads to mint a platform-authored draft for every Procedure
Version that froze the old digest — the harm `register-target-system.ts:49-53` and the
CLAUDE.md decision both say must not occur.

The module asserts only the opposite direction (`register-target-system.ts:509`: digest
moved with no field changed). This direction is unguarded. The same hole exists for
`attributeLabelPatterns`, and for a blank entry: `["https://a.example", "   "]` → `["https://a.example"]`
is likewise invisible to the digest and visible to `same()`.

Proposed patch — export the one normalisation and use it for storage as well, so the row,
the comparison and the digest agree by construction:

```ts
// packages/domain/src/registrations/target-system.ts
-function normalizedSet(values: readonly string[]): readonly string[] {
+/** The one set normalisation. Exported so a caller cannot store a set the digest cannot see. */
+export function normalizedRegistrationSet(values: readonly string[]): readonly string[] {
   return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))].sort();
 }
```

```ts
// packages/application/src/registrations/register-target-system.ts
-function cleaned(values: readonly string[]): readonly string[] {
-  return values.map((value) => value.trim()).filter((value) => value !== '');
-}
+const cleaned = normalizedRegistrationSet;
```

and, because the digest is by construction a function of the six, make the assertion
two-directional rather than one:

```ts
   const changed = changedDigestFields(before, next);
+  // The digest is a function of the six. If they disagree, one of them is wrong.
+  if ((changed.length > 0) !== (before.digest !== next.digest)) {
+    throw new Error('the change detector and the digest disagree about the six fields');
+  }
```

A regression test belongs in `tests/unit/` or the integration suite: save with a duplicated
origin, save again with the duplicate removed, assert `published === false` and that no
`configuration.registration-changed` row was appended.

### BLOCKER 2 — a lone surrogate produces a digest over bytes the database cannot store, and the documented refusal never fires

`packages/domain/src/canonical-json.ts:33-34`, `packages/domain/src/sha256.ts:47-84`,
`packages/domain/src/registrations/target-system.ts:151-153`.

`sha256.ts:50-54` and the CLAUDE.md decision both state that `utf8Bytes` refuses a lone
surrogate rather than substituting U+FFFD, "because that substitution would make two
different inputs hash the same". On the registration path that guard is **unreachable**:
`canonicalJson` serialises strings with `JSON.stringify`, which escapes a lone surrogate
to the six ASCII characters `\ud800` (ES2019 well-formed `JSON.stringify`). By the time
`sha256Hex` sees the text there is no surrogate left to refuse. Nothing on the registration
path guards it either — `grep -rn "urrogate"` over `packages/application/src`,
`packages/infrastructure/src`, `apps/web/src`, `apps/web/app` and
`packages/domain/src/registrations` returns nothing, and `actions.ts` checks lengths only.

Concrete failing input, executed with `allowedOrigins: ['https://a\uD800.example']`:

```
canonical text     {"allowed_origins":["https://a\ud800.example"], …
digest as stored   669c4ab793e42a14ef990144cde39b4033e7317f382ae0d6bba1d8681e4277e3
digest recomputed
  from the row     0e3bbc5f3fdc91ae8f16cb5c198e168c917a8912822dd1b04c27381b8b52e01a
row disagrees
  with its digest  true
```

The row disagrees because the driver encodes the string for the wire with UTF-8
substitution — `Buffer.from('https://a\uD800.example','utf8')` yields
`…61 ef bf bd 2e…`, i.e. U+FFFD — so PostgreSQL stores a value that is not the value the
digest was taken over. The digest column then permanently names bytes that exist nowhere,
and `target-system.ts:159-160` says nothing recomputes it on read, so it is silent. (The
encoding substitution is executed and shown above; the end-to-end write was not run — no
PostgreSQL 18 in this environment.)

It also breaks the fixture's premise. Python `rfc8785` **refuses** the same input —
`CanonicalizationError: input contains non-UTF-8 codepoints` — so this case can never be
pinned by the independent generator, and TypeScript and the reference implementation
diverge on it (one hashes, the other errors).

`canonicalizeAuditEvent` is not affected: `assertJsonValue` → `assertNoLoneSurrogates`
(`audit-event.ts:149-162`) runs over the whole envelope before `canonicalJson` sees it.
The registration path has no equivalent.

Reachable by any PoC Administrator through a hand-made POST to the Server Action; the
browser form will not normally produce a lone surrogate, and it is not blocked from doing
so. The created-event payload carries `displayName`, `kind` and the digests but not the
origins, so the audit append does not throw and the write commits.

Proposed patch — refuse in the canonicalizer, where every caller is covered and the
refusal matches Python:

```ts
// packages/domain/src/canonical-json.ts
+/** A lone surrogate has no UTF-8 encoding. RFC 8785 input containing one is not canonicalizable. */
+function assertWellFormed(text: string): void {
+  for (let i = 0; i < text.length; i += 1) {
+    const code = text.charCodeAt(i);
+    if (code >= 0xd800 && code <= 0xdbff) {
+      const low = text.charCodeAt(i + 1);
+      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError('unpaired Unicode surrogate');
+      i += 1;
+    } else if (code >= 0xdc00 && code <= 0xdfff) {
+      throw new TypeError('unpaired Unicode surrogate');
+    }
+  }
+}
+
 export function canonicalJson(value: JsonValue): string {
-  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
+  if (typeof value === 'string') {
+    assertWellFormed(value);
+    return JSON.stringify(value);
+  }
+  if (value === null || typeof value === 'boolean') {
     return JSON.stringify(value);
   }
   …
-    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] as JsonValue)}`)
+    .map((key) => {
+      assertWellFormed(key);
+      return `${JSON.stringify(key)}:${canonicalJson(object[key] as JsonValue)}`;
+    })
```

`validateRegistrationFields` should then turn that throw into a refusal string rather than
a 500. A test belongs next to the existing lone-surrogate case in `sha256.test.ts:92-98`,
asserting that `registrationDigest` with a lone surrogate in an origin throws.

### SHOULD 1 — `canonicalJson` turns NaN and Infinity into `null` and hashes it

`packages/domain/src/canonical-json.ts:36`.

```
canonicalJson({ a: NaN })      => {"a":null}
canonicalJson({ a: Infinity }) => {"a":null}
```

Python `rfc8785` raises `FloatDomainError: nan is not representable in JCS`. Today no
caller is exposed — the six-key envelope has no numbers, and `canonicalizeAuditEvent`
guards with `Number.isFinite` (`audit-event.ts:180`). But `canonicalJson` is now a public
export of `@intellifin/domain` (`index.ts`), its own docstring pushes the obligation onto
callers ("Callers are responsible for handing over … finite numbers"), and the next caller
that forgets gets a digest over `null` instead of an error. A serializer that silently
substitutes a value is the same class of defect as an encoder that substitutes U+FFFD.

```ts
-  if (typeof value === 'number') return JSON.stringify(value);
+  if (typeof value === 'number') {
+    if (!Number.isFinite(value)) throw new TypeError('a non-finite number is not canonical JSON');
+    return JSON.stringify(value);
+  }
```

### SHOULD 2 — the fixture vector that claims to pin UTF-16 code-unit ordering does not distinguish it from code-point ordering

`tests/fixtures/registration-digest-golden.json:133-137`,
`scripts/make-registration-digest-golden.py:111-113, 120, 127`.

The `versioned-file-unicode` note says the vector shows "why the astral-plane emoji sorts
AFTER the CJK character". It does — but so does code-point order:
`N` U+004E < `金` U+91D1 < `🔎` U+1F50E under code points, and `0x004E < 0x91D1 < 0xD83D`
under UTF-16 code units. Both orderings give the same list, so the vector pins nothing
about which rule is in force. If `normalizedSet` were changed to
`sort((a, b) => [...a] < [...b] ? -1 : 1)` or any code-point comparator, this fixture would
still pass. (The behaviour is correct — I checked it against Python directly, see "verified
clean" item 3 — it is the *pinning* that is absent.)

One value fixes it. `U+FFFD` sorts after `🔎` by UTF-16 code unit (`0xD83D < 0xFFFD`) and
before it by code point (`0xFFFD < 0x1F50E`):

```python
# scripts/make-registration-digest-golden.py
-        "attributeLabelPatterns": ["N° de pièce", "金額", "🔎 locator"],
+        "attributeLabelPatterns": ["N° de pièce", "金額", "� sentinel", "🔎 locator"],
…
-        "attribute_label_patterns": ["N° de pièce", "金額", "🔎 locator"],
+        # UTF-16 code-unit order: the emoji's leading surrogate 0xD83D precedes 0xFFFD,
+        # which code-point order would reverse. This is the assertion.
+        "attribute_label_patterns": ["N° de pièce", "金額", "🔎 locator", "� sentinel"],
```

then `uv run scripts/make-registration-digest-golden.py`.

### CONSIDER 1 — `canonicalJson` on a non-JSON object fails obscurely or silently

`packages/domain/src/canonical-json.ts:32-43`. `canonicalJson({ a: undefined })` throws
`TypeError: Cannot convert undefined or null to object` from `Object.keys`, which names
neither the field nor the problem; a `Date`, `Map` or class instance serialises as `{}`
with no complaint. `assertJsonValue` covers the audit path; nothing covers the registration
path or a future caller. Low priority while the six-key envelope is built key by key from
`string`-typed fields, but a `typeof value !== 'object'` guard with a real message costs
two lines.

### CONSIDER 2 — no independent vector contains a non-ASCII object key

Both golden fixtures were scanned: neither `audit-chain-golden.json` nor
`registration-digest-golden.json` has a single non-ASCII key anywhere. The registration
envelope's six keys are fixed ASCII, but an **audit payload's** keys are caller-supplied
and go through the same `.sort()`. The key-sort rule is therefore pinned by no fixture at
all. I verified it agrees with Python by hand (item 3 above); a vector in
`audit-chain-golden.json` with a payload key such as `"🔎"` alongside `"�"` would make
that permanent.

### CONSIDER 3 — the digest is never asserted to move when a desktop application identity changes

`packages/domain/src/registrations/target-system.test.ts:103-117`. "moves when any one of
the six changes" lists six variants of a `web` registration, so `applicationIdentity` — the
field that occupies the locator slot for a `desktop` system — is never varied. Only the
fixture's single desktop vector pins it. Add:

```ts
     const variants: readonly RegistrationDigestInput[] = [
       { ...BASE, kind: 'api' },
+      // The locator slot for a desktop system. Not covered by the `web` variants above.
+      { ...BASE, kind: 'desktop', applicationIdentity: 'com.a.one' },
+      { ...BASE, kind: 'desktop', applicationIdentity: 'com.a.two' },
```

### CONSIDER 4 — the digest names a capability, not a registration, and nothing says so at the storage layer

`packages/infrastructure/drizzle/0005_clumsy_freak.sql:39-46`. Two registrations with the
same six normalised fields have the same digest, and `digest` carries a format CHECK but no
unique index. That is the right design — a Procedure Version freezes what the agent may
touch, not which row it came from — but Epic 2 is about to treat these digests as keys.
Worth one line in the migration comment or in `target-system.ts` saying the digest is not a
registration identity, before a later story adds `WHERE digest = $1` and gets two rows.

### CONSIDER 5 — `same()` re-sorts its right operand once per element

`packages/application/src/registrations/register-target-system.ts:307-308`:
`[...b].sort()[index]` inside `.every()` is O(n² log n) for a list bounded at 50. Correct,
just wasteful — and it disappears entirely with the BLOCKER 1 patch, since both sides
arrive already sorted and deduplicated.

---

## State of the tree at the end of this review

The working tree moved while this review ran — another agent is editing
`packages/application/src/registrations/register-target-system.ts` concurrently. Two things
follow.

**BLOCKER 1 is already fixed in the working tree, with the same diagnosis.** `toRecord`
now stores `setOf(...)` — trimmed, blank-free, deduplicated, sorted — for both
`allowedOrigins` and `attributeLabelPatterns` (`register-target-system.ts:204-212, 271-285`),
so the row, the change detector and the digest agree by construction. The finding above is
kept for the record and because two residual points stand:

- `setOf` is a **second** implementation of `normalizedSet` (`target-system.ts:122-124`).
  That is the exact "two copies that agree on every value anybody thought to try" risk
  `canonical-json.ts:1-15` was written to remove, one level down. Export the domain's and
  delete the copy.
- The one-directional assertion at `register-target-system.ts:509` is unchanged. Making it
  two-directional (patch above) is what stops the next divergence being silent.

**An unused import to watch.** `register-target-system.ts:2-7` now imports `canonicalJson`,
`sha256Hex` and `JsonValue` from `@intellifin/domain` and uses none of them — a
work-in-progress edit that would fail `noUnusedLocals`. If it is heading toward a hash
computed in the application layer, AD-2 and `target-system.ts:8-12` say the digest is
computed in the domain module and nowhere else; a second SHA-256 call site in the command
needs to be something other than a registration digest, and needs to say so.

## Not found

Nothing was found wrong with the SHA-256 itself: padding, the 64-bit big-endian length,
the above-2^32-bits path, the `>>> 0` discipline and the UTF-8 encoder are all correct, and
the encoder's refusal of lone surrogates is right — it is only unreachable from the digest
path (BLOCKER 2). Number serialisation, string escaping and key ordering in
`canonical-json.ts` match Python `rfc8785` byte for byte on every input both accept. The
canonicalizer extraction did not change one byte of the audit chain. The golden fixture is
real independent evidence and regenerates identically.
