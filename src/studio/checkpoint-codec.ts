import type { EditorCheckpoint } from '../editor-core/types';

type Atom = string | number | boolean | null | { ref: number };
type Node = { array: Atom[] } | { object: [string, Atom][] };
export interface PackedCheckpoint {
  version: 2;
  root: Atom;
  nodes: Node[];
}

/** Preserve the shared graph on disk; DesignDocument itself still has exactly the v12 shape. */
export function packCheckpoint(checkpoint: EditorCheckpoint): PackedCheckpoint {
  const nodes: Node[] = [],
    refs = new WeakMap<object, number>(),
    visiting = new WeakSet<object>();
  function encode(value: unknown): Atom {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || visiting.has(value)) throw new Error('復旧データが不正です。');
    const existing = refs.get(value);
    if (existing !== undefined) return { ref: existing };
    const ref = nodes.length;
    refs.set(value, ref);
    nodes.push({ array: [] });
    visiting.add(value);
    nodes[ref] = Array.isArray(value)
      ? { array: value.map(encode) }
      : {
          object: Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, encode(item)]),
        };
    visiting.delete(value);
    return { ref };
  }
  const root = encode(checkpoint);
  return { version: 2, root, nodes };
}

/** v1 remains readable; Core validates every recovered document before adopting anything. */
export function unpackCheckpoint(value: unknown): EditorCheckpoint | undefined {
  if (!value || typeof value !== 'object' || !('version' in value)) return;
  if (value.version === 1) return value as EditorCheckpoint;
  if (value.version !== 2) return;
  const packed = value as PackedCheckpoint;
  if (!Array.isArray(packed.nodes) || packed.nodes.length > 100_000) throw new Error('復旧データが大きすぎます。');
  const decoded = new Map<number, object>(),
    visiting = new Set<number>();
  function decode(atom: Atom, depth = 0): unknown {
    if (
      atom === null ||
      typeof atom === 'string' ||
      typeof atom === 'boolean' ||
      (typeof atom === 'number' && Number.isFinite(atom))
    )
      return atom;
    if (
      !atom ||
      typeof atom !== 'object' ||
      !Number.isInteger(atom.ref) ||
      atom.ref < 0 ||
      atom.ref >= packed.nodes.length ||
      depth > 64 ||
      visiting.has(atom.ref)
    )
      throw new Error('復旧データの参照が不正です。');
    if (decoded.has(atom.ref)) return decoded.get(atom.ref);
    visiting.add(atom.ref);
    const node = packed.nodes[atom.ref]!;
    let result: object;
    if ('array' in node && Array.isArray(node.array)) result = node.array.map((item) => decode(item, depth + 1));
    else if ('object' in node && Array.isArray(node.object))
      result = Object.fromEntries(node.object.map(([key, item]) => [key, decode(item, depth + 1)]));
    else throw new Error('復旧データの形式が不正です。');
    visiting.delete(atom.ref);
    decoded.set(atom.ref, result);
    return result;
  }
  const checkpoint = decode(packed.root);
  if (!checkpoint || typeof checkpoint !== 'object' || !('version' in checkpoint) || checkpoint.version !== 1)
    throw new Error('復旧データの形式が不正です。');
  return checkpoint as EditorCheckpoint;
}
