import { SKIN_STATES, type DesignTarget, type SkinFrame, type SkinState, type SurfaceSkin } from '../design/types';
import type { SkinAssetStatus } from '../design/renderer';
import type { InkDecision } from '../design/contrast';

/** What the Host found on the page for one part; never part of the document. */
export interface SkinPageInfo {
  id: string;
  count: number;
  width?: number;
  height?: number;
  /** Load state of the part's normal art in the page renderer. */
  asset?: SkinAssetStatus;
  /** Smallest visible part of the kind, and the first one's room between edges and text. */
  minWidth?: number;
  minHeight?: number;
  textInset?: { top: number; right: number; bottom: number; left: number };
  /** The engine's legibility decision per state in the current mode. */
  ink?: Readonly<Record<string, InkDecision>>;
}

const STATE_NAMES: Record<SkinState, string> = {
  normal: '通常',
  hover: 'ホバー',
  focus: 'フォーカス',
  selected: '選択中',
  pressed: '押下',
  disabled: '無効',
};
export const SKIN_STATE_HELP: Readonly<Record<SkinState, string>> = {
  normal: 'いつもの見た目です。ほかの状態に絵がないときもこの絵を使います。',
  hover: 'マウスを乗せている間の見た目です。',
  focus: 'キーボードで選んだときの見た目です。',
  selected: 'オンになっている間の見た目です。',
  pressed: '押している間の見た目です。',
  disabled: '押せないときの見た目です。',
};

/** The states a part supports: normal plus every state its adapter can express in CSS. */
export function skinStates(target: DesignTarget | undefined): SkinState[] {
  return SKIN_STATES.filter((state) => state === 'normal' || target?.skin?.states[state] !== undefined);
}
export function skinStateName(target: DesignTarget | undefined, state: SkinState): string {
  return target?.skin?.labels?.[state] ?? STATE_NAMES[state];
}

/** Part status for the list and the "not applied" reason, in the spirit of the guard's 制限中 display. */
export function skinReason(
  target: DesignTarget,
  skin: SurfaceSkin | undefined,
  info: SkinPageInfo | undefined,
): { status: 'applied' | 'empty' | 'missing' | 'loading' | 'error'; text: string } {
  if (info && info.count === 0)
    return {
      status: 'missing',
      text: `このページに見つかりません${target.skin?.where ? `（${target.skin.where}にあります）` : ''}`,
    };
  if (!skin) return { status: 'empty', text: info ? `未設定・ページ上に${info.count}個` : '未設定' };
  if (info?.asset?.state === 'error') return { status: 'error', text: `絵を読み込めません：${info.asset.message}` };
  if (info?.asset?.state === 'loading') return { status: 'loading', text: '絵を読み込み中…' };
  if (info && info.width === 0) return { status: 'missing', text: 'ページ上で非表示です' };
  return { status: 'applied', text: info ? `${info.count}個に反映中` : '設定済み' };
}

/** Where the image has paint (alpha above a faint threshold), in source pixels. */
export interface PaintedArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface SkinReport {
  facts: string[];
  warnings: string[];
}
const round = (value: number) => Math.round(value * 10) / 10;

/** What the author sees after importing: the image, where it is painted, the frame it will draw,
 * and the smallest part it lands on, with the problems that make a frame unreadable or vanish. */
export function skinReport(
  target: DesignTarget,
  frame: SkinFrame,
  image: { width: number; height: number } | undefined,
  painted: PaintedArea | undefined,
  info: SkinPageInfo | undefined,
): SkinReport {
  const facts: string[] = [],
    warnings: string[] = [];
  const scale = frame.scalePct / 100,
    { top, right, bottom, left } = frame.slices;
  const drawn = { top: top * scale, right: right * scale, bottom: bottom * scale, left: left * scale };
  // Parts that draw outward keep up to the adapter's measured gap outside the box.
  const outset = target.skin?.outset ?? 0;
  const inside = {
    top: Math.max(0, drawn.top - outset),
    right: Math.max(0, drawn.right - outset),
    bottom: Math.max(0, drawn.bottom - outset),
    left: Math.max(0, drawn.left - outset),
  };
  if (image) facts.push(`画像 ${image.width}×${image.height}px`);
  if (painted) facts.push(`絵がある範囲 横${painted.left}〜${painted.right}px・縦${painted.top}〜${painted.bottom}px`);
  else if (image) warnings.push('画像に絵がありません（すべて透明です）。');
  facts.push(
    `描く枠 上下 ${round(drawn.top)}＋${round(drawn.bottom)}＝${round(drawn.top + drawn.bottom)}px・左右 ${round(drawn.left)}＋${round(drawn.right)}＝${round(drawn.left + drawn.right)}px${outset ? `（外側へ最大${outset}px）` : ''}`,
  );
  const width = info?.minWidth ?? target.skin?.sample?.width,
    height = info?.minHeight ?? target.skin?.sample?.height;
  if (width !== undefined && height !== undefined) {
    facts.push(
      `${info?.minWidth !== undefined ? 'ページ上で一番小さい部品' : '部品の典型的な大きさ'} ${round(width)}×${round(height)}px`,
    );
    if (inside.top + inside.bottom > height)
      warnings.push(
        `枠の上下の合計（${round(inside.top + inside.bottom)}px）が部品の高さ（${round(height)}px）を超えるため、枠が縮んで描かれ、中央が消えます。「枠の太さ」を下げてください。`,
      );
    if (inside.left + inside.right > width)
      warnings.push(
        `枠の左右の合計（${round(inside.left + inside.right)}px）が部品の幅（${round(width)}px）を超えるため、中央が消えます。`,
      );
  }
  // Art that sits inside one slice is stretched as a single edge, not drawn as a frame.
  if (painted && image) {
    const alone =
      painted.right <= left
        ? '左'
        : painted.left >= image.width - right
          ? '右'
          : painted.bottom <= top
            ? '上'
            : painted.top >= image.height - bottom
              ? '下'
              : undefined;
    if (alone)
      warnings.push(
        `絵が${alone}の切り位置の中にしかありません。四隅・四辺・中央に分けて描いた9スライス用の絵か確かめてください。`,
      );
  }
  const text = info?.textInset;
  if (text)
    for (const [side, name] of [
      ['top', '上'],
      ['right', '右'],
      ['bottom', '下'],
      ['left', '左'],
    ] as const)
      if (inside[side] > Math.max(0, text[side]) + 0.5) {
        warnings.push(
          `${name}の枠（部品の内側に${round(inside[side])}px）が文字までの余白（${round(Math.max(0, text[side]))}px）より太く、文字に重なります。`,
        );
        break;
      }
  return { facts, warnings };
}

/** The legibility line for one state: the engine's colour switch, or the advisory warning. */
export function inkMessage(decision: InkDecision | undefined): { text: string; warn: boolean } | undefined {
  if (!decision) return;
  if (decision.warn)
    return {
      text: `読みにくいかもしれません。白でも黒でも 4.5:1 に届きません（最大 ${round(decision.best)}:1）。`,
      warn: true,
    };
  if (decision.ink)
    return {
      text: `文字が読めるように、文字の色を${decision.ink === '#ffffff' ? '白' : '黒'}にしています（${round(decision.contrast)}:1）。`,
      warn: false,
    };
}
