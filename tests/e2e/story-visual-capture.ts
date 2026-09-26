import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Opt-in evidence from the real synthetic browser journeys; never a visual pass by itself. */
export async function captureStoryState(page: Page, name: string, section?: Locator): Promise<void> {
  if (process.env['STORY_VISUAL_CAPTURE'] !== '1') return;
  const viewport = page.viewportSize();
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const widths = /\/(timeline|replay)(?:[?#]|$)/.test(page.url()) ? [1280, 1024] : [1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    const prefix = `visual-${name}-${width}x800`;
    await page.screenshot({ path: test.info().outputPath(`${prefix}-top.png`), animations: 'disabled' });
    if (section) {
      await section.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: test.info().outputPath(`${prefix}-section.png`), animations: 'disabled' });
    }
    const facts = await page.evaluate(() => ({
      title: document.title, url: location.href, width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => ({ level: h.tagName, text: h.textContent })),
      focus: document.activeElement?.outerHTML.slice(0, 1000),
      times: Array.from(document.querySelectorAll('time')).map(t => ({ text: t.textContent, datetime: t.dateTime, title: t.title })),
    }));
    await writeFile(test.info().outputPath(`${prefix}.json`), JSON.stringify(facts, null, 2));
  }
  if (viewport) await page.setViewportSize(viewport);
  await page.evaluate(position => window.scrollTo(position.x, position.y), scroll);
}
