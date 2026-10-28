import { test, expect } from '@playwright/test';
import { createSelectorIndex, splitSelectorList, subjectKey } from '../src/sites/surface-index';
import { YOUTUBE_SURFACE_TARGETS } from '../src/sites/youtube-surfaces';
import { YOUTUBE_SKIN_MARKS } from '../src/sites/youtube-targets';

const fake = (localName: string, id = '', className = '') =>
  ({
    localName,
    // As on real YouTube, a custom element may shadow the id property; only attributes are trusted.
    id: undefined,
    className: undefined,
    getAttribute: (name: string) => (name === 'id' ? id : name === 'class' ? className : null) || null,
  }) as unknown as Element;

test('selector lists split only at top-level commas', () => {
  expect(splitSelectorList('a b, c > d')).toEqual(['a b', 'c > d']);
  expect(splitSelectorList('x:not(.a, .b) y, z[data-k="1,2"]')).toEqual(['x:not(.a, .b) y', 'z[data-k="1,2"]']);
  expect(splitSelectorList('  ')).toEqual([]);
});

test('the subject key is the id, class or tag of the rightmost compound, never one inside a function', () => {
  expect(subjectKey('ytd-app button:not(.html5-video-player button)')).toEqual({ kind: 'tag', value: 'button' });
  expect(subjectKey('ytd-masthead yt-button-shape a')).toEqual({ kind: 'tag', value: 'a' });
  expect(subjectKey('ytd-watch-metadata #top-level-buttons-computed > :not(a, b) button')).toEqual({
    kind: 'tag',
    value: 'button',
  });
  expect(subjectKey('YT-Chip-Cloud-Chip-Renderer:not(:has(button))')).toEqual({
    kind: 'tag',
    value: 'yt-chip-cloud-chip-renderer',
  });
  // An id beats a class beats a tag.
  expect(subjectKey('ytd-searchbox #search-icon-legacy')).toEqual({ kind: 'id', value: 'search-icon-legacy' });
  expect(subjectKey('div.a.b#c')).toEqual({ kind: 'id', value: 'c' });
  expect(subjectKey('ytd-watch-flexy[elevated-watch-ambient] .box')).toEqual({ kind: 'class', value: 'box' });
  expect(subjectKey('yt-chip-cloud-chip-renderer .ytChipShapeChip')).toEqual({
    kind: 'class',
    value: 'ytChipShapeChip',
  });
  expect(subjectKey('ytd-comments #title')).toEqual({ kind: 'id', value: 'title' });
  // Not indexable: attribute-led, universal, pseudo-led, escaped.
  expect(subjectKey('ytd-masthead [id^="youtube-paths"]')).toBeUndefined();
  expect(subjectKey('a > *')).toBeUndefined();
  expect(subjectKey('ytd-thumbnail + :is(div, span)')).toBeUndefined();
  expect(subjectKey('.a\\:b')).toBeUndefined();
  expect(subjectKey('#')).toBeUndefined();
  expect(subjectKey('body')).toEqual({ kind: 'tag', value: 'body' });
  // A requirement hidden in a function or attribute value is not a requirement.
  expect(subjectKey('p:not(.skip)')).toEqual({ kind: 'tag', value: 'p' });
  expect(subjectKey('[data-x=".y"]')).toBeUndefined();
});

test('candidates keep row order, bring in id and class matches, and split mixed rows', () => {
  const rows = [
    { selector: 'b, i' },
    { selector: 'x .k, p q, #z, [data-w]' },
    { selector: 'i' },
    { selector: 'section.only-class' },
    { selector: '*' },
  ];
  const index = createSelectorIndex(rows);
  const view = (element: Element) =>
    index.candidates(element).map((item) => `${rows.indexOf(item.source)}:${item.selector}`);
  // Entries with an unindexable subject (`[data-w]`, `*`) are tested for every element.
  expect(view(fake('b'))).toEqual(['0:b, i', '1:[data-w]', '4:*']);
  expect(view(fake('q'))).toEqual(['1:x .k, p q, #z', '1:[data-w]', '4:*']);
  expect(view(fake('i'))).toEqual(['0:b, i', '1:[data-w]', '2:i', '4:*']);
  expect(view(fake('div'))).toEqual(['1:[data-w]', '4:*']);
  // An id and a class bring their rows in at the right position.
  expect(view(fake('div', 'z'))).toEqual(['1:x .k, p q, #z', '1:[data-w]', '4:*']);
  expect(view(fake('div', '', 'one k two'))).toEqual(['1:x .k, p q, #z', '1:[data-w]', '4:*']);
  expect(view(fake('div', '', 'only-class'))).toEqual(['1:[data-w]', '3:section.only-class', '4:*']);
  // A class name that merely contains a key is a superset candidate; matches() decides.
  expect(view(fake('div', '', 'blank')).some((item) => item.startsWith('1:'))).toBe(true);
  // SVG elements (className is not a string) are read through the same attribute.
  const svg = { localName: 'g', getAttribute: (name: string) => (name === 'class' ? 'k' : null) } as unknown as Element;
  expect(view(svg)).toEqual(['1:x .k, p q, #z', '1:[data-w]', '4:*']);
  // Plain tag lists are reused.
  expect(index.candidates(fake('div'))).toBe(index.candidates(fake('div')));
  expect(index.wildCount).toBe(2);
});

test('the bundled tables: every entry is kept exactly once, and most elements meet few candidates', () => {
  const rows = [...YOUTUBE_SURFACE_TARGETS, ...YOUTUBE_SKIN_MARKS];
  const index = createSelectorIndex(rows);
  for (const row of rows) {
    const entries = index.all.filter((item) => item.source === row).flatMap((item) => splitSelectorList(item.selector));
    expect(entries.sort()).toEqual(splitSelectorList(row.selector).sort());
  }
  // Only entries led by an attribute, pseudo-class or `*` meet every element.
  expect(index.wildCount).toBeLessThanOrEqual(2);
  const entries = index.all.length;
  for (const tag of ['div', 'span', 'yt-formatted-string', 'ytd-rich-grid-media', 'button', 'a'])
    expect(index.candidates(fake(tag)).length, tag).toBeLessThan(entries / 3);
});
