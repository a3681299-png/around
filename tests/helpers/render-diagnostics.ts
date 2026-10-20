import type { BrowserContext } from '@playwright/test';

/** Record actual font fallback and viewport: the Xvfb screen size is not the page viewport. */
export async function renderDiagnostics(context: BrowserContext) {
  return Promise.all(context.pages().filter((page) => !page.isClosed()).map(async (page) => {
    try {
      const layout = await page.evaluate(() => {
        const root = document.querySelector('#web-world-themes-creator')?.shadowRoot;
        const selectors = ['.layers-pane', '.layers-section', '.layers', '.layer', '.selection-tip', '.selection-actions'];
        const gl = document.createElement('canvas').getContext('webgl'), debug = gl?.getExtension('WEBGL_debug_renderer_info');
        const renderer = debug && gl ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return { viewport: { width: innerWidth, height: innerHeight }, renderer, elements: selectors.map((selector) => {
          const node = root?.querySelector(selector); if (!node) return { selector };
          const { x, y, width, height } = node.getBoundingClientRect(), style = getComputedStyle(node);
          return { selector, x, y, width, height, font: style.font };
        }) };
      });
      const session = await context.newCDPSession(page);
      try {
        await session.send('DOM.enable'); await session.send('CSS.enable'); await session.send('DOM.getDocument', { depth: -1, pierce: true });
        const fonts: Record<string, unknown> = {};
        for (const selector of ['.layer-title', '.selection-tip']) {
          const { result } = await session.send('Runtime.evaluate', { expression: `document.querySelector('#web-world-themes-creator')?.shadowRoot?.querySelector(${JSON.stringify(selector)})` });
          if (result.objectId) fonts[selector] = await session.send('CSS.getPlatformFontsForNode', await session.send('DOM.requestNode', { objectId: result.objectId }));
        }
        return { url: page.url(), ...layout, fonts };
      } finally { await session.detach(); }
    } catch (error) { return { url: page.url(), error: String(error) }; }
  }));
}
