import { SKIN_STATES, type DesignTarget, type SkinState, type SurfaceSkin } from '../design/types';
import type { SkinAssetStatus } from '../design/renderer';

/** What the Host found on the page for one part; never part of the document. */
export interface SkinPageInfo {
  id: string;
  count: number;
  width?: number;
  height?: number;
  /** Load state of the part's normal art in the page renderer. */
  asset?: SkinAssetStatus;
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
