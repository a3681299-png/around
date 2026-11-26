export const ROOM_LAYERS: readonly string[];
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer;
export function encodeLayer(
  width: number,
  height: number,
  rgba: ArrayLike<number>,
  flipRows?: boolean,
): { png: Buffer; scale: number };
export function packRoom(glbBytes: Buffer, layers: readonly { name: string; png: Buffer; scale: number }[]): Buffer;
