// A small bubble over the resident's head that says how it feels (docs/living-mind.md): the room
// is seen from across it, where a face is a few pixels, so a feeling has to be readable from
// there. The marks are drawn here on a canvas (shapes and plain glyphs, no image files): sleep,
// a start, a question, a tune, crossness, fondness, a pause.
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, type Vector3 } from 'three';
import type { Emote } from './director';

const KINDS: readonly Emote[] = ['zzz', 'bang', 'what', 'note', 'anger', 'heart', 'dots'];
const CELL = 128;

function atlas() {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * KINDS.length;
  canvas.height = CELL;
  const g = canvas.getContext('2d')!;
  g.lineJoin = g.lineCap = 'round';
  KINDS.forEach((kind, i) => {
    const cx = i * CELL + CELL / 2,
      cy = CELL / 2;
    // The bubble: pale, with a dark rim so it reads on the night room and on bright glass alike.
    g.fillStyle = 'rgba(250,251,255,0.96)';
    g.strokeStyle = 'rgba(20,24,56,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy - 4, 50, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 12, cy + 42);
    g.lineTo(cx, cy + 60);
    g.lineTo(cx + 12, cy + 42);
    g.fill();
    const ink = {
      zzz: '#4a63c8',
      bang: '#e0483c',
      what: '#7a4fd0',
      note: '#1f9e8a',
      anger: '#e0483c',
      heart: '#ec5a8c',
      dots: '#59607a',
    }[kind];
    g.fillStyle = g.strokeStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (kind === 'zzz') {
      g.font = '800 30px system-ui, sans-serif';
      g.fillText('z', cx - 22, cy + 14);
      g.font = '800 40px system-ui, sans-serif';
      g.fillText('z', cx, cy - 2);
      g.font = '800 50px system-ui, sans-serif';
      g.fillText('Z', cx + 24, cy - 22);
    } else if (kind === 'bang' || kind === 'what') {
      g.font = '900 78px system-ui, sans-serif';
      g.fillText(kind === 'bang' ? '!' : '?', cx, cy - 2);
    } else if (kind === 'note') {
      g.font = '800 70px system-ui, sans-serif';
      g.fillText('♪', cx, cy - 4);
    } else if (kind === 'dots') {
      for (const dx of [-24, 0, 24]) {
        g.beginPath();
        g.arc(cx + dx, cy - 2, 8, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === 'anger') {
      // The cross-vein mark: four short curves round a middle.
      g.lineWidth = 9;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.beginPath();
        g.arc(
          cx + Math.cos(a + Math.PI / 4) * 30,
          cy - 4 + Math.sin(a + Math.PI / 4) * 30,
          19,
          a + Math.PI * 0.75,
          a + Math.PI * 1.75,
        );
        g.stroke();
      }
    } else {
      g.beginPath();
      g.moveTo(cx, cy + 24);
      g.bezierCurveTo(cx - 48, cy - 8, cx - 22, cy - 46, cx, cy - 20);
      g.bezierCurveTo(cx + 22, cy - 46, cx + 48, cy - 8, cx, cy + 24);
      g.fill();
    }
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.repeat.set(1 / KINDS.length, 1);
  return texture;
}

export interface EmoteBubble {
  readonly object: Sprite;
  /** One frame: what to show (undefined: nothing), over this point, for a body this tall. */
  update(kind: Emote | undefined, over: Vector3, height: number, dt: number): void;
}

export function emoteBubble(): EmoteBubble {
  const texture = atlas();
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false });
  const object = new Sprite(material);
  object.name = 'resident_emote';
  object.renderOrder = 10;
  object.visible = false;
  let shown: Emote | undefined,
    size = 0,
    speed = 0,
    time = 0;
  return {
    object,
    update(kind, over, height, dt) {
      time += dt;
      // A new mark pops up from nothing; the old one shrinks away first.
      if (kind !== shown && size < 0.05) {
        shown = kind;
        if (kind) texture.offset.x = KINDS.indexOf(kind) / KINDS.length;
      }
      const goal = kind && kind === shown ? 1 : 0;
      for (let left = Math.min(0.1, dt); left > 1e-6; left -= 1 / 240) {
        const h = Math.min(1 / 240, left);
        speed += (-16 * 16 * (size - goal) - 2 * 0.42 * 16 * speed) * h;
        size += speed * h;
      }
      if (goal === 0 && size < 0.02) size = speed = 0;
      object.visible = size > 0.02;
      if (!object.visible) return;
      const s = height * 0.3 * size;
      object.scale.set(s, s, 1);
      // Beside and above the head, bobbing a little (a sleeper's rises slowly).
      const bob = Math.sin(time * Math.PI * 2 * (shown === 'zzz' ? 0.3 : 0.9)) * height * 0.012;
      object.position.set(over.x + height * 0.13, over.y + height * 0.24 + bob, over.z);
    },
  };
}
