// The browser boundary (docs/product-design-snapshot.md, "ほかのサイト・ほかのブラウザに耐える3本の線"):
// Chrome's APIs are called only in src/browser/ and in the extension's own entry points, so the
// page runtime also runs where there is no extension (the Playground, docs/playground-plan.md).
import { transform } from 'esbuild';

/** Files that are the extension itself: its worker, pages, content entry and dev diagnostics. */
export const CHROME_ALLOWED = Object.freeze([
  /^src\/browser\//,
  /^src\/background\//,
  /^src\/popup\//,
  /^src\/backup\/page\.ts$/,
  /^src\/content\/index\.ts$/,
  /^src\/assets\/read-frame\.ts$/,
  // Profiling and benchmark builds only (ASSET_PROFILE); never in a normal or Playground bundle's paths.
  /^src\/diagnostics\//,
]);

/** A message when `label` (a path like src/x.ts) calls chrome.* outside the boundary. */
export async function chromeBoundaryProblem(label, source) {
  if (!/^src\/.*\.ts$/.test(label) || CHROME_ALLOWED.some((pattern) => pattern.test(label))) return undefined;
  // Compile first: comments, strings in types and type-only references (chrome.runtime.MessageSender)
  // do not count, a call does.
  const { code } = await transform(source, { loader: 'ts', logLevel: 'silent', legalComments: 'none' });
  const call = /\bchrome\s*(?:\?\.|\.)\s*[A-Za-z_]/.exec(code);
  return call ? `${label}: call Chrome APIs (chrome.*) only from src/browser/` : undefined;
}
