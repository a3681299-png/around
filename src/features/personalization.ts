import type { FeatureDefinition } from './types';

const option = (id: string, label: string, description: string, defaultEnabled: boolean): FeatureDefinition => ({
  id,
  label,
  description,
  defaultEnabled,
});

export const personalizationFeatures: readonly FeatureDefinition[] = [
  option('palette', 'UIの配色', '色相・彩度・明るさでUIの色を調整（映像は変更しません）', true),
  option('glossy-titlebars', 'タイトルバーの光沢', 'タイトルバー上半分に控えめな反射を表示', true),
  option(
    'focus-titlebars',
    '操作中の小窓の色',
    '実際に操作した小窓を青く表示。別タブや別ウィンドウへ移ると解除',
    false,
  ),
  option('daily-details', '日替わりの小さな飾り', '余白に日替わりの小さな顔文字とASCIIを表示', true),
  option('surface-noise', '表面のかすかな粒子', '背景と装飾部分だけにごく薄いディザを追加', false),
  option(
    'bbs-comments',
    '掲示板風のコメント',
    '表示中のコメントを順番付きの掲示板風に。正確な日時がある場合のみ併記',
    true,
  ),
  option('transparent-background', '透明な背景', 'ページの地色を透明に。カードや本文の読みやすさは維持', false),
  option('lcd-durations', '液晶風の再生時間', '動画の長さを小さな液晶風表示に統一', true),
  option('readable-votes', '読みやすい高評価数', 'コメントの高評価数を濃い文字で表示', true),
];
