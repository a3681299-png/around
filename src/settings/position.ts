export const SETTINGS_POSITION_KEY = 'around.settings.position.v1';
export interface SettingsRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function initialSettingsPosition(width: number, height: number, panelWidth: number, obstacle?: SettingsRect) {
  const gap = 12,
    x = gap,
    y = gap,
    maxHeight = Math.max(80, height - gap * 2);
  if (!obstacle) return { x, y, maxHeight, hasRoom: true };
  const right = obstacle.left + obstacle.width,
    bottom = obstacle.top + obstacle.height;
  const areas = [
    { x: Math.max(gap, right + gap), y: gap, width: width - right - gap * 2, height: maxHeight },
    { x: gap, y: gap, width: obstacle.left - gap * 2, height: maxHeight },
    { x: gap, y: Math.max(gap, bottom + gap), width: width - gap * 2, height: height - bottom - gap * 2 },
    { x: gap, y: gap, width: width - gap * 2, height: obstacle.top - gap * 2 },
  ];
  const area = areas.find((area) => area.width >= panelWidth && area.height >= Math.min(180, maxHeight));
  return area ? { x: area.x, y: area.y, maxHeight: area.height, hasRoom: true } : { x, y, maxHeight, hasRoom: false };
}
