/**
 * Is this string shaped like a `uuid` column value?
 *
 * PostgreSQL raises `22P02 invalid input syntax for type uuid` when a query compares a
 * `uuid` column against text that is not one, and that exception travels out of the
 * repository as a framework 500. The id in question comes straight from a URL segment
 * (`/administration/sources/<anything a person types>`) or from a Server Action's
 * argument, so a 500 is the answer to a perfectly ordinary mistyped link — and it is a
 * 500 on a path whose honest answer is "there is no such row".
 *
 * So every lookup by id checks the shape first and reports absence. It lives at the
 * repository, not in each page, because a guard each caller has to remember is a guard
 * the next caller forgets.
 *
 * The pattern accepts the RFC 9562 versions 1 to 8. It is deliberately not restricted to
 * version 7 even though `CryptoUuidV7Generator` mints those: this asks whether the value
 * can be COMPARED, not whether we would have issued it.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidText(value: string): boolean {
  return UUID_PATTERN.test(value);
}
