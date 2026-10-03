import { retroTheme } from './retro';

/** Registry extension point. The MVP intentionally exposes just one theme. */
export const themes = { retro: retroTheme } as const;
export type ThemeId = keyof typeof themes;
export const DEFAULT_THEME: ThemeId = 'retro';
