import type { Page } from '@playwright/test';

/**
 * Opt-in stress fixture derived from a public YouTube watch-page DOM inspected on
 * 2026-10-04. Keep the shared legacy fixture intact: these hashed colors and
 * scoped/percentage/flex constraints are deliberately independent of --yt-spec-*.
 * The visible cinematic box is synthetic; the inspected live box was hidden.
 */
export async function installNativeYouTube(page: Page, dark: boolean, options: { errorOverlay?: boolean } = {}) {
  await page.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await page.evaluate(
    ({ dark, errorOverlay }) => {
      document.documentElement.toggleAttribute('dark', dark);
      const style = document.createElement('style');
      style.id = 'fixture-native-youtube-css';
      style.textContent = `
      :root {
        --t3e41d7b17b187f69: #fff;
        --tffc2fd3a644f6275: #0f0f0f;
        --t518e925f61bdcb91: #f2f2f2;
        --fixture-native-secondary: #606060;
      }
      :root[dark] {
        --t3e41d7b17b187f69: #0f0f0f;
        --tffc2fd3a644f6275: #f1f1f1;
        --t518e925f61bdcb91: #212121;
        --fixture-native-secondary: #aaa;
      }
      ytd-app {
        position: absolute; inset: 0; min-height: 100%; height: max-content;
        background: var(--t3e41d7b17b187f69); color: var(--tffc2fd3a644f6275);
      }
      ytd-watch-flexy { position: relative; isolation: isolate; }
      #columns.ytd-watch-flexy, #primary.ytd-watch-flexy,
      #primary-inner.ytd-watch-flexy, #below.ytd-watch-flexy,
      #secondary.ytd-watch-flexy, ytd-watch-metadata, ytd-comments { background: transparent; }
      #primary-inner.ytd-watch-flexy { position: relative; }
      #below.ytd-watch-flexy { padding-top: 1px; }
      #cinematics.ytd-watch-flexy { position: absolute; inset: 0; pointer-events: none; z-index: -1; }
      #cinematics .box { position: absolute; inset: 0; background: var(--t518e925f61bdcb91); }
      #fixture-scroll-tail { height: 500px; }
      #player.ytd-watch-flexy { position: relative; }
      #player-container-outer.ytd-watch-flexy { display: block; width: 100%; }
      #player-container-inner.ytd-watch-flexy { position: relative; height: 0; padding-top: 56.25%; }
      #player-container.ytd-watch-flexy { position: absolute; inset: 0; }
      ytd-player, #movie_player { display: block; width: 100%; height: 100%; }
      ytd-player { position: static; overflow: hidden; }
      ytd-player > #container { height: 100%; }
      #movie_player .html5-main-video { width: 100%; height: 100%; }
      #error-screen.ytd-watch-flexy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: black; color: white; }
      ytd-topbar-logo-renderer { display: flex; width: 93px; flex: 0 0 93px; }
      ytd-topbar-logo-renderer svg { display: block; width: 93px; height: 24px; fill: var(--tffc2fd3a644f6275); }
      yt-icon { display: inline-flex; width: 24px; height: 24px; color: var(--icon-color, currentcolor); fill: var(--iron-icon-fill-color, currentcolor); }
      yt-icon svg { display: block; width: 24px; height: 24px; }
      #guide-icon.ytd-masthead { color: var(--tffc2fd3a644f6275); }
      ytd-watch-metadata h1, ytd-watch-metadata #owner, ytd-watch-metadata #owner *,
      ytd-comments-header-renderer, ytd-comments-header-renderer *,
      ytd-comments #author-text, ytd-comments #published-time-text,
      ytd-comments #contenteditable-root { color: var(--tffc2fd3a644f6275); }
      ytd-comments-header-renderer { display: flex; align-items: center; gap: 20px; }
      ytd-playlist-panel-renderer {
        display: flex; flex-direction: column; height: 402px; max-height: 402px;
        background: var(--t518e925f61bdcb91);
      }
      ytd-playlist-panel-renderer > #container {
        display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; box-sizing: border-box;
      }
      ytd-playlist-panel-renderer .header { flex: 0 0 auto; }
      ytd-playlist-panel-renderer #items { height: 100%; overflow-y: auto; }
      ytd-playlist-panel-video-renderer { display: flex; }
      ytd-playlist-panel-video-renderer > a { display: block; width: 100%; padding: 0; }
      ytd-playlist-panel-video-renderer > a > #container {
        display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 8px 4px 0;
        background: transparent;
      }
      ytd-playlist-panel-video-renderer #index-container { flex: 0 0 13px; }
      ytd-playlist-panel-video-renderer #thumbnail-container { flex: 0 0 82px; }
      ytd-playlist-panel-video-renderer #meta { flex: 1; min-width: 0; }
      ytd-playlist-panel-video-renderer #video-title yt-formatted-string { color: var(--tffc2fd3a644f6275); }
      ytd-playlist-panel-video-renderer #byline, ytd-playlist-panel-video-renderer #index {
        color: var(--fixture-native-secondary);
      }
      ytd-playlist-panel-renderer[collapsible][collapsed],
      ytd-playlist-panel-renderer[collapsible][collapsed] > #container { height: auto; }
      ytd-playlist-panel-renderer[collapsed] #items { display: none; }
    `;
      document.head.append(style);
      const masthead = document.querySelector('ytd-masthead')!;
      const guide = masthead.querySelector('.header-icon')!;
      guide.innerHTML =
        '<yt-icon id="guide-icon" class="ytd-masthead"><svg viewBox="0 0 24 24"><path d="M3 5h18v2H3zM3 11h18v2H3zM3 17h18v2H3z"/></svg></yt-icon>';
      const brand = masthead.querySelector('.brand')!;
      // Schematic paths reproduce the live inheritance boundaries, not official logo artwork.
      brand.innerHTML = `<ytd-topbar-logo-renderer><svg id="yt-ringo2-svg_yt5" viewBox="0 0 93 24">
      <g><path id="fixture-play-red" fill="#FF0033" d="M0 2h30v20H0z"/><path id="fixture-play-white" fill="white" d="M12 7v10l9-5z"/></g>
      <g id="youtube-paths_yt5"><path d="M34 5h3l2 5 2-5h3l-4 9v5h-3v-5z"/><path d="M44 9h6v10h-6z"/><path d="M51 9h3v8h2V9h3v10h-8z"/><path d="M60 5h10v3h-3v11h-3V8h-4z"/><path d="M70 9h3v8h2V9h3v10h-8z"/><path d="M79 5h3v4h4v10h-7z"/><path d="M87 9h6v6h-3v2h3v2h-6z"/></g>
    </svg></ytd-topbar-logo-renderer>`;

      const flexy = document.querySelector('ytd-watch-flexy')!;
      flexy.setAttribute('elevated-watch-ambient', '');
      const columns = flexy.querySelector<HTMLElement>('.watch-grid')!;
      columns.id = 'columns';
      columns.classList.add('ytd-watch-flexy');
      const primary = columns.querySelector<HTMLElement>('.watch-main')!;
      primary.id = 'primary';
      primary.classList.add('ytd-watch-flexy');
      columns.querySelector('aside')!.id = 'secondary';
      const primaryInner = document.createElement('div');
      primaryInner.id = 'primary-inner';
      primaryInner.className = 'ytd-watch-flexy';
      primaryInner.append(...primary.childNodes);
      primary.append(primaryInner);
      const below = document.createElement('div');
      below.id = 'below';
      below.className = 'ytd-watch-flexy';
      below.append(primaryInner.querySelector('ytd-watch-metadata')!, primaryInner.querySelector('ytd-comments')!);
      primaryInner.append(below);
      const ambient = document.createElement('div');
      ambient.id = 'cinematics';
      ambient.className = 'ytd-watch-flexy';
      ambient.innerHTML = '<div class="box"></div>';
      flexy.prepend(ambient);
      const tail = document.createElement('div');
      tail.id = 'fixture-scroll-tail';
      below.append(tail);

      const mount = document.querySelector<HTMLElement>('#player-mount')!;
      mount.id = 'player';
      mount.className = 'ytd-watch-flexy';
      const player = mount.querySelector('#movie_player')!;
      const outer = document.createElement('div');
      outer.id = 'player-container-outer';
      outer.className = 'ytd-watch-flexy';
      const inner = document.createElement('div');
      inner.id = 'player-container-inner';
      inner.className = 'ytd-watch-flexy';
      const container = document.createElement('div');
      container.id = 'player-container';
      container.className = 'ytd-watch-flexy';
      const nativePlayer = document.createElement('ytd-player');
      nativePlayer.id = 'ytd-player';
      const nativePlayerContainer = document.createElement('div');
      nativePlayerContainer.id = 'container';
      nativePlayerContainer.className = 'style-scope ytd-player';
      outer.append(inner);
      inner.append(container);
      container.append(nativePlayer);
      nativePlayer.append(nativePlayerContainer);
      nativePlayerContainer.append(player);
      mount.append(outer);
      if (errorOverlay) {
        // Observed native playback-error branch: this absolute sibling covers all of
        // #player, including a titlebar wrongly mounted inside that boundary.
        const error = document.createElement('yt-playability-error-supported-renderers');
        error.id = 'error-screen';
        error.className = 'style-scope ytd-watch-flexy';
        error.innerHTML =
          '<div><p>Sign in to confirm you’re not a bot</p><button aria-label="Retry fixture playback">Try again</button></div>';
        error.querySelector('button')!.addEventListener('click', () => {
          error.dataset.retryCount = String(Number(error.dataset.retryCount ?? 0) + 1);
        });
        mount.append(error);
      }

      const owner = document.querySelector('.watch-actions')!;
      owner.id = 'owner';
      owner.querySelector('.channel-info')!.id = 'channel-name';
      const heading = document.querySelector('.comment-heading')!;
      const nativeHeading = document.createElement('ytd-comments-header-renderer');
      nativeHeading.className = heading.className;
      nativeHeading.append(...heading.childNodes);
      heading.replaceWith(nativeHeading);
      nativeHeading.querySelector('h2')!.id = 'title';
      document.querySelector('ytd-comment-thread-renderer b')!.id = 'author-text';
      const playlist = document.querySelector('ytd-playlist-panel-renderer')!;
      playlist.setAttribute('collapsible', '');
      const playlistContainer = document.createElement('div');
      playlistContainer.id = 'container';
      playlistContainer.append(...playlist.childNodes);
      playlist.append(playlistContainer);
      // Live rows also have #container. It must remain a genuine painted box so a
      // broad panel selector reproduces white selected text over an inner silver fill.
      playlist.querySelectorAll('ytd-playlist-panel-video-renderer').forEach((row) => {
        const link = row.querySelector('a')!;
        link.id = 'wc-endpoint';
        const rowContainer = document.createElement('div');
        rowContainer.id = 'container';
        rowContainer.className = 'style-scope ytd-playlist-panel-video-renderer';
        const index = link.querySelector('#index')!;
        const indexContainer = document.createElement('div');
        indexContainer.id = 'index-container';
        index.before(indexContainer);
        indexContainer.append(index);
        link.querySelector('.thumbnail-box')!.id = 'thumbnail-container';
        link.lastElementChild!.id = 'meta';
        rowContainer.append(...link.childNodes);
        link.append(rowContainer);
      });
      document.dispatchEvent(new Event('yt-page-data-updated'));
    },
    { dark, errorOverlay: options.errorOverlay ?? false },
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Decode only through the browser's own canvas; no new image dependency or network. */
export async function pixels(page: Page, png: Buffer, points: Array<{ x: number; y: number }>) {
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3));
    },
    { data: png.toString('base64'), points },
  );
}

export function luminance(rgb: number[]) {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

/**
 * Sample the actual painted backdrop at the text/glyph, not body.backgroundColor.
 * Hiding only glyph paint preserves gradients, ancestor opacity, ambient siblings,
 * and native backgrounds. The hit-test makes occlusion an explicit test failure.
 */
export async function contrastAt(page: Page, selector: string, svg = false) {
  const target = page.locator(selector).first();
  await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const probe = await target.evaluate((element, svg) => {
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect =
      (svg
        ? element.getBoundingClientRect()
        : [...range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0)) ??
      element.getBoundingClientRect();
    const x = Math.floor(rect.left + rect.width / 2),
      y = Math.floor(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = svg ? style.fill : style.color;
    context.fillRect(0, 0, 1, 1);
    const ink = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    const ancestors = [];
    let opacity = 1;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const computed = getComputedStyle(current);
      opacity *= Number(computed.opacity);
      ancestors.push({
        tag: current.tagName,
        id: current.id,
        background: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        opacity: computed.opacity,
      });
    }
    // Pointer hit testing excludes SVGs with no painted fill after the mask, so
    // capture it now while original native/extension paint is still present.
    const unobscured = Boolean(hit && (element.contains(hit) || hit.contains(element)));
    const mask = document.createElement('style');
    mask.id = 'fixture-contrast-mask';
    element.setAttribute('data-fixture-contrast-target', '');
    // Outrank theme !important SVG fill rules without removing any background.
    mask.textContent =
      ':root:root:root:root:root [data-fixture-contrast-target], :root:root:root:root:root [data-fixture-contrast-target] * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; fill: transparent !important; stroke: transparent !important; }';
    document.head.append(mask);
    return { x, y, ink, opacity, unobscured, hit: hit ? `${hit.tagName}#${hit.id}` : null, ancestors };
  }, svg);
  let background: number[];
  try {
    const png = await page.screenshot({ fullPage: false, scale: 'css', animations: 'disabled' });
    background = (await pixels(page, png, [{ x: probe.x, y: probe.y }]))[0]!;
  } finally {
    await target.evaluate((element) => {
      element.removeAttribute('data-fixture-contrast-target');
      document.querySelector('#fixture-contrast-mask')?.remove();
    });
  }
  const paintedInk = probe.ink.map(
    (channel, index) => channel * probe.opacity + background[index]! * (1 - probe.opacity),
  );
  const light = luminance(paintedInk),
    dark = luminance(background);
  return {
    ...probe,
    background,
    ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
    backgroundLuminance: dark,
  };
}
