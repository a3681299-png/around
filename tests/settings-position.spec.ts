import { test, expect } from '@playwright/test';
import { initialSettingsPosition } from '../src/settings/position';

test('default settings position fits a side gutter or the free space below the player', () => {
  for (const [width, height, obstacle] of [
    [1920, 1080, { left: 100, top: 160, width: 1100, height: 620 }],
    [1100, 760, { left: 200, top: 160, width: 570, height: 320 }],
    [760, 760, { left: 12, top: 100, width: 736, height: 414 }],
  ] as const) {
    const result = initialSettingsPosition(width, height, 340, obstacle);
    expect(result.hasRoom).toBe(true);
    expect(result.x + 340).toBeLessThanOrEqual(width);
    expect(result.y + result.maxHeight).toBeLessThanOrEqual(height);
    const intersects =
      result.x < obstacle.left + obstacle.width &&
      result.x + 340 > obstacle.left &&
      result.y < obstacle.top + obstacle.height &&
      result.y + result.maxHeight > obstacle.top;
    expect(intersects).toBe(false);
  }
});
test('a viewport occupied by video requests free page space, without inventing a non-overlapping position', () => {
  expect(initialSettingsPosition(760, 500, 340, { left: 0, top: 0, width: 760, height: 500 }).hasRoom).toBe(false);
});
