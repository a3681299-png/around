import type { PlacementFrame } from '../world/geometry';

export interface StudioInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface StudioHostLayout {
  mode: 'reserved' | 'fullscreen' | 'unavailable';
  canvas: PlacementFrame;
}
export interface StudioLayoutAdapter {
  update(insets: StudioInsets): void;
  state(): StudioHostLayout;
  destroy(): void;
}
