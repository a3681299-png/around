/** Splits a selector list at its top-level commas; commas inside `:not(...)` or `[...]` stay. */
export function splitSelectorList(list: string): string[] {
  const entries: string[] = [];
  let depth = 0,
    start = 0;
  for (let index = 0; index < list.length; index++) {
    const char = list[index];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      entries.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(list.slice(start).trim());
  return entries.filter(Boolean);
}

export interface SubjectKey {
  readonly kind: 'tag' | 'id' | 'class';
  readonly value: string;
}

const IDENTIFIER = /^-?[a-zA-Z_][a-zA-Z0-9_-]*/;

/**
 * What the element a selector selects must have, as far as it can be read from the rightmost
 * compound: an id, else a class, else a tag (lower-cased). Undefined when the compound is led only
 * by attributes, pseudo-classes or `*`, or uses escapes. Everything inside `(...)` or `[...]` is
 * ignored, so a `:not(.a)` never becomes a requirement.
 */
export function subjectKey(selector: string): SubjectKey | undefined {
  const text = selector.trim();
  let depth = 0,
    start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) start = index + 1;
  }
  const compound = text.slice(start);
  if (compound.includes('\\')) return undefined;
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(compound)?.[0];
  let found: SubjectKey | undefined;
  depth = 0;
  for (let index = tag?.length ?? 0; index < compound.length; index++) {
    const char = compound[index];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && (char === '#' || char === '.')) {
      const name = IDENTIFIER.exec(compound.slice(index + 1))?.[0];
      if (!name) return undefined;
      if (char === '#') return { kind: 'id', value: name };
      found ??= { kind: 'class', value: name };
    }
  }
  return found ?? (tag ? { kind: 'tag', value: tag.toLowerCase() } : undefined);
}

export interface IndexedSelector<T> {
  /** The table row this selector belongs to. */
  readonly source: T;
  /** One or more entries of the row's selector list that share an indexable subject (or none). */
  readonly selector: string;
}

interface Item<T> extends IndexedSelector<T> {
  readonly order: number;
  readonly tags: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly classes: ReadonlySet<string>;
  /** No indexable subject: tested for every element. */
  readonly wild: boolean;
}

/**
 * Index of selector-list rows by what their subject needs (tag, id or class). An element is
 * tested only against the entries that can match its tag, id or classes, plus the few entries
 * with no indexable subject, in the original row order, so the outcome equals testing every row
 * (`element.matches(row.selector)`). Ids and classes are compared as written in the selectors.
 */
export function createSelectorIndex<T extends { readonly selector: string }>(rows: readonly T[]) {
  const items: Item<T>[] = [];
  for (const source of rows) {
    const keyed: string[] = [],
      wild: string[] = [],
      tags = new Set<string>(),
      ids = new Set<string>(),
      classes = new Set<string>();
    for (const entry of splitSelectorList(source.selector)) {
      const key = subjectKey(entry);
      if (!key) wild.push(entry);
      else {
        keyed.push(entry);
        (key.kind === 'tag' ? tags : key.kind === 'id' ? ids : classes).add(key.value);
      }
    }
    if (keyed.length)
      items.push({ source, selector: keyed.join(', '), order: items.length, tags, ids, classes, wild: false });
    if (wild.length)
      items.push({
        source,
        selector: wild.join(', '),
        order: items.length,
        tags: new Set(),
        ids: new Set(),
        classes: new Set(),
        wild: true,
      });
  }
  const wildItems = items.filter((item) => item.wild);
  const byId = new Map<string, Item<T>[]>(),
    byClass = new Map<string, Item<T>[]>();
  for (const item of items) {
    for (const id of item.ids) byId.set(id, [...(byId.get(id) ?? []), item]);
    for (const name of item.classes) byClass.set(name, [...(byClass.get(name) ?? []), item]);
  }
  const classNames = [...byClass.keys()];
  const byTag = new Map<string, readonly Item<T>[]>();
  const tagList = (tag: string) => {
    let list = byTag.get(tag);
    if (!list) {
      list = items.filter((item) => item.wild || item.tags.has(tag));
      byTag.set(tag, list);
    }
    return list;
  };
  return {
    /** Every entry, in row order: what an unindexed scan would test. */
    all: items as readonly IndexedSelector<T>[],
    candidates(element: Element): readonly IndexedSelector<T>[] {
      const base = tagList(element.localName);
      let extra: Item<T>[] | undefined;
      // Attributes, not the `id`/`className` properties: custom elements may shadow those.
      const id = element.getAttribute('id');
      if (id) extra = byId.get(id);
      const attribute = element.getAttribute('class');
      if (attribute)
        for (const name of classNames)
          // A substring test never misses a class; matches() makes the final decision.
          if (attribute.includes(name)) extra = [...(extra ?? []), ...byClass.get(name)!];
      if (!extra) return base;
      const merged = new Set<Item<T>>(base);
      for (const item of extra) merged.add(item);
      return [...merged].sort((a, b) => a.order - b.order);
    },
    /** Entries with no indexable subject. */
    wildCount: wildItems.length,
  };
}
