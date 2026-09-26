import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * How `useLiveTimeline` is wired (Story 10.8 review, P3 and P4).
 *
 * The rules the hook applies live outside it and are tested there: the hand-off in
 * `live-status.test.ts`, the subscription and its beginning and end in
 * `live-stream.test.ts`, the one-second render clock in `nextLiveTick`. What is left is the
 * WIRING, and this suite runs under `renderToStaticMarkup` in a `node` environment where no
 * effect runs and there is no DOM to mount a hook into — so the wiring is read off the
 * source, the way `startup.test.ts` reads the worker's composition root. Each assertion
 * names the failure it prevents.
 */
const source = readFileSync(fileURLToPath(new URL('./useLiveTimeline.ts', import.meta.url)), 'utf8');

/** The source of every `useLayoutEffect(` / `useEffect(` call, from its name to its closing parenthesis. */
function effects(): { readonly kind: 'useLayoutEffect' | 'useEffect'; readonly body: string }[] {
  const found: { kind: 'useLayoutEffect' | 'useEffect'; body: string }[] = [];
  for (const match of source.matchAll(/\b(useLayoutEffect|useEffect)\(/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let at = start;
    for (; at < source.length && depth > 0; at += 1) {
      if (source[at] === '(') depth += 1;
      else if (source[at] === ')') depth -= 1;
    }
    found.push({ kind: match[1] as 'useLayoutEffect' | 'useEffect', body: source.slice(start, at - 1) });
  }
  return found;
}

describe('the live hook wiring', () => {
  it('takes and leaves the clock in a LAYOUT effect', () => {
    // A passive effect runs after the browser paints, so a remount would paint one frame of
    // a fresh `connecting` clock — with the live controls OPEN on a stream that was lost —
    // before the effect took the clock the last page left. A layout effect runs before the
    // paint, so the first thing the new page shows is what the stream last said.
    const handOff = effects().filter((effect) => effect.body.includes('beginLiveSubscription('));
    expect(handOff).toHaveLength(1);
    expect(handOff[0]!.kind).toBe('useLayoutEffect');
    expect(handOff[0]!.body).toContain('endLiveSubscription(');
  });

  it('closes the connection in that layout cleanup, before the clock is left', () => {
    // The subscription effect is passive, so its own cleanup runs after the next page has
    // already taken the clock. The layout cleanup therefore closes the connection itself:
    // `endLiveSubscription` stops first and leaves second.
    const [handOff] = effects().filter((effect) => effect.body.includes('beginLiveSubscription('));
    expect(handOff!.body).toMatch(/endLiveSubscription\(state, RUN_STREAM_CLOCKS, handOffKey, stopConnection, /);
    const subscription = effects().filter((effect) => effect.body.includes('followLiveStream('));
    expect(subscription).toHaveLength(1);
    expect(subscription[0]!.kind).toBe('useEffect');
    expect(subscription[0]!.body).toMatch(/connection\.current = followLiveStream\(/);
    expect(subscription[0]!.body).toContain('stopConnection()');
  });

  it('repaints only through a clock that always moves forward', () => {
    // React skips a setter handed the value it already holds; `setNow(Date.now())` twice in
    // one millisecond is exactly that, and the inherited clock would not be painted.
    expect(source.match(/\bsetNow\(/g)).toHaveLength(1);
    expect(source).toContain('setNow((previous) => nextLiveTick(previous, Date.now()))');
    expect(source).toMatch(/onChange: repaint,/);
    expect(source).toMatch(/setInterval\(repaint, 1_000\)/);
    const [handOff] = effects().filter((effect) => effect.body.includes('beginLiveSubscription('));
    expect(handOff!.body).toContain('repaint();');
  });

  it('opens the stream from the page cursor on a new stream, and from the last sequence seen on a new cursor', () => {
    // `beginLiveSubscription` resets the sequence for the stream it begins; the subscription
    // effect re-runs on a new cursor WITHOUT beginning again, so a server re-read keeps the
    // last sequence the page saw (AD-17: no gap, no duplicate).
    const [handOff] = effects().filter((effect) => effect.body.includes('beginLiveSubscription('));
    expect(handOff!.body).toMatch(/beginLiveSubscription\(state, RUN_STREAM_CLOCKS, handOffKey, cursor, /);
    expect(handOff!.body).toMatch(/\}, \[handOffKey, state\]\)?$/);
    const [subscription] = effects().filter((effect) => effect.body.includes('followLiveStream('));
    expect(subscription!.body).not.toContain('beginLiveSubscription(');
    expect(subscription!.body).toMatch(/\}, \[url, cursor, state\]\)?$/);
  });
});
