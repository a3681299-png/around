import type { FeatureDefinition } from './types';

/** Small independent lifetimes: site capabilities own DOM, CSS options own one flag. */
function option(id: string, label: string, description: string, defaultEnabled: boolean, siteOwned = false): FeatureDefinition {
  return {
    id, label, description, defaultEnabled,
    mount: ({ document: doc, site }) => {
      const capability = site.features?.[id];
      if (siteOwned && !capability) return undefined;
      const attribute = `data-ww-feature-${id}`;
      doc.documentElement.setAttribute(attribute, '');
      const instance = capability?.mount();
      return {
        refresh() {
          if (!doc.documentElement.hasAttribute(attribute)) doc.documentElement.setAttribute(attribute, '');
          instance?.refresh?.();
        },
        destroy() {
          instance?.destroy();
          doc.documentElement.removeAttribute(attribute);
        },
      };
    },
  };
}

export const personalizationFeatures: readonly FeatureDefinition[] = [
  option('palette', 'Palette colors', '色相・彩度・明るさでUIの色を調整（映像は変更しません）', true),
  option('glossy-titlebars', 'Glossy titlebars', 'タイトルバー上半分に控えめな反射を表示', true),
  option('focus-titlebars', 'Active window color', '実際に操作した小窓を青く表示。別タブや別ウィンドウへ移ると解除', false, true),
  option('daily-details', 'Daily tiny details', '余白に日替わりの小さな顔文字とASCIIを表示', true, true),
  option('surface-noise', 'Faint surface grain', '背景と装飾部分だけにごく薄いディザを追加', false),
  option('bbs-comments', 'BBS comments', '表示中のコメントを順番付きの掲示板風に。正確な日時がある場合のみ併記', true, true),
  option('transparent-background', 'Transparent background', 'ページの地色を透明に。カードや本文の読みやすさは維持', false),
  option('lcd-durations', 'LCD duration badges', '動画の長さを小さな液晶風表示に統一', true),
  option('readable-votes', 'Readable comment votes', 'コメントの高評価数を濃い文字で表示', true),
];
