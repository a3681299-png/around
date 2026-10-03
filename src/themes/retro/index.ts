import tokens from './tokens.css';
import surfaces from './surfaces.css';
import type { ThemeDefinition } from '../types';

export const retroTheme = {
  id: 'retro',
  name: 'Retro (prototype)',
  stylesheets: [tokens, surfaces],
} as const satisfies ThemeDefinition;
