import { test, expect, chromium } from '@playwright/test';
import { installOutsetAudit, outsetAudit, outsetPaintDiff } from './helpers/skin-outset-audit';

for (const front of [false, true])
  test(`outset audit detects actual native occlusion and preserves opaque native protection above it (${front})`, async () => {
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
      await page.setContent(`<style>
        body { margin:0; background:white; }
        [data-ww-surface] { position:absolute; left:20px; top:20px; width:100px; height:80px;
          z-index:1; border-image-slice:10 fill; border-image-width:4px; border-image-outset:4px; }
        #shield { position:absolute; left:116px; top:34px; width:28px; height:28px; background:white; z-index:${front ? 2 : 0}; }
        #neighbor { position:absolute; left:4px; top:4px; width:20px; height:20px; padding:0; border:0; background:white; }
        #own { position:absolute; right:0; bottom:0; width:20px; height:20px; border:0; }
      </style><div data-ww-surface="video-card"><button id="own">O</button></div>
      <div id="shield"><button id="neighbor">N</button></div>`);
      await installOutsetAudit(page);
      const before = await page.screenshot();
      await page.locator('[data-ww-surface]').evaluate((node: HTMLElement) => {
        node.style.borderImageSource = 'linear-gradient(red,red)';
      });
      const audit = await outsetAudit(page);
      const after = await page.screenshot();
      const paint = await outsetPaintDiff(page, before, after, audit);
      expect(audit.parts[0]!.g1.some((row: any) => row.samePart)).toBe(true);
      expect(paint.checked).toBeGreaterThan(0);
      if (front) expect(paint.differences).toEqual([]);
      else expect(paint.differences.length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });
