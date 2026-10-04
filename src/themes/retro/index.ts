import tokens from './tokens.css';
import surfaces from './surfaces.css';
import chrome from './chrome.css';
import editor from './editor.css';
import personalization from './personalization.css';
import comments from './comments.css';
import type { ThemeDefinition } from '../types';

export const retroTheme = {
  id: 'retro',
  name: 'Retro / Classic desktop',
  stylesheets: [tokens, surfaces, chrome, personalization, comments],
  editorStylesheets: [tokens, chrome, editor],
} as const satisfies ThemeDefinition;
