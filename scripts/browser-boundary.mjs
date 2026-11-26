// The browser boundary (docs/product-design-snapshot.md, "ほかのサイト・ほかのブラウザに耐える3本の線"):
// Chrome's APIs are used only in src/browser/ and in the extension's own entry points, so the page
// runtime also runs where there is no extension (the Playground, docs/playground-plan.md).
//
// Enforced by ESLint's scope analysis, not by searching text: any value reference to the global
// `chrome` outside these files is an error, however it is written (chrome.x, chrome["x"],
// chrome?.x, const c = chrome), and so is reaching it through globalThis / window / self. Type-only
// references (chrome.runtime.MessageSender in a type) are not values and stay allowed.
import tseslint from 'typescript-eslint';

/** Files that are the extension itself: its worker, pages, content entry and dev diagnostics. */
export const CHROME_ALLOWED = Object.freeze([
  'src/browser/**',
  'src/background/**',
  'src/popup/**',
  'src/backup/page.ts',
  'src/content/index.ts',
  'src/assets/read-frame.ts',
  // Profiling and benchmark builds only; never in a normal or Playground bundle's paths.
  'src/diagnostics/**',
]);
const message = 'Use Chrome APIs (chrome.*) only from src/browser/ and the extension entry points.';

/** ESLint flat-config entries for the boundary. No type information needed. */
export const browserBoundaryConfig = Object.freeze([
  {
    files: ['src/**/*.ts'],
    ignores: [...CHROME_ALLOWED],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-globals': ['error', { name: 'chrome', message }],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'chrome', message },
        { object: 'window', property: 'chrome', message },
        { object: 'self', property: 'chrome', message },
      ],
    },
  },
]);
