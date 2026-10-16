export interface LottieAnimation {
  isLoaded: boolean;
  goToAndStop(frame: number, isFrame: boolean): void;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
  destroy(): void;
}
declare const lottie: {
  useWebWorker(value: boolean): void;
  loadAnimation(options: { container: HTMLElement; renderer: 'svg'; autoplay: false; loop: false; animationData: object; rendererSettings: { progressiveLoad: false; preserveAspectRatio: string; hideOnTransparent: false } }): LottieAnimation;
};
export default lottie;
