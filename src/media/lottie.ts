import type { LottieAnimation } from '../vendor/lottie-light.js';

/** The pinned light build has no expressions/effects or automatic page discovery. */
export function createLottieSource(container: HTMLElement, data: object) {
  let player: LottieAnimation | undefined;
  let rejectReady: ((reason: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const ready = (async () => {
    // Lazy initialization also keeps ordinary image/card sessions free of Lottie work.
    const { default: lottie } = await import('../vendor/lottie-light.js');
    if (closed) throw new Error('表示を終了しました。');
    lottie.useWebWorker(false);
    player = lottie.loadAnimation({
      container,
      renderer: 'svg',
      autoplay: false,
      loop: false,
      animationData: structuredClone(data),
      rendererSettings: { progressiveLoad: false, preserveAspectRatio: 'xMidYMid meet', hideOnTransparent: false },
    });
    await new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      const loaded = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        resolve();
      };
      const failed = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        reject(new Error('Lottieを描画できませんでした。書き出し設定を確認してください。'));
      };
      player!.addEventListener('DOMLoaded', loaded);
      player!.addEventListener('data_failed', failed);
      player!.addEventListener('error', failed);
      if (player!.isLoaded) loaded();
      else timer = setTimeout(failed, 5000);
    });
  })();
  return {
    ready,
    paint(index: number) {
      if (!closed) player?.goToAndStop(index, true);
    },
    destroy() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      rejectReady?.(new Error('表示を終了しました。'));
      player?.destroy();
    },
  };
}
