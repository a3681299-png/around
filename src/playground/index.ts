import { mountPlayer } from './player';

mountPlayer(document);
performance.mark('playground:player-ready');

const apply = document.querySelector<HTMLButtonElement>('#apply')!;
let queued = false;
let toggle = () => {
  queued = !queued;
  apply.textContent = queued ? '準備中…' : 'WWT を適用';
  if (queued) apply.setAttribute('aria-busy', 'true');
  else apply.removeAttribute('aria-busy');
};
apply.addEventListener('click', () => toggle());

// The native page can paint and take input before the heavier theme module is parsed.
requestAnimationFrame(() => {
  setTimeout(() => {
    void import('./theme')
      .then(({ mountTheme }) =>
        mountTheme((action) => {
          toggle = action;
          if (queued) action();
        }),
      )
      .catch((error: unknown) => {
        document.querySelector<HTMLElement>('#status')!.textContent = 'WWT の作品を読み込めませんでした。';
        apply.textContent = 'WWT を適用';
        apply.removeAttribute('aria-busy');
        apply.disabled = true;
        console.error('[WWT Playground]', error);
      });
  }, 0);
});
