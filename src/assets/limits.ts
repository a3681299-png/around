import { IMAGE_LIMITS } from '../design/types';
import { MODEL_LIMITS } from '../models/types';
import { ANIMATION_LIMITS } from './motion-types';

export const ASSET_LIMITS = Object.freeze({ fileBytes: 32 * 1024 * 1024, modelBytes: 64 * 1024 * 1024, chunkBytes: 4 * 1024 * 1024, batchBytes: 64 * 1024 * 1024, batchCount: 8, totalBytes: 256 * 1024 * 1024, count: 128, edge: 4096, pixels: 16 * 1024 * 1024, legacyAnimationCount: 8 });
export const MODEL_RESOURCE_LIMITS = Object.freeze({ morphBytes: 64 * 1024 * 1024, vrmMorphBytes: 128 * 1024 * 1024, animationBytes: 64 * 1024 * 1024, gpuBytes: 96 * 1024 * 1024, vrmGpuBytes: 192 * 1024 * 1024, pageGpuBytes: 256 * 1024 * 1024 });
const mib = (bytes: number) => `${bytes / (1024 * 1024)}MiB`;
const fileSizes = `通常素材は${mib(ASSET_LIMITS.fileBytes)}、GLB・VRMは${mib(ASSET_LIMITS.modelBytes)}までです。`;
const batchSizes = `通常${mib(ASSET_LIMITS.fileBytes)}、大容量3Dを含む場合は${mib(ASSET_LIMITS.batchBytes)}までです。`;

/** Asset limits and their UI/error wording share the same numeric sources. */
export const ASSET_MESSAGES = Object.freeze({
  fileSize: `素材は1ファイル${mib(ASSET_LIMITS.fileBytes)}までです。`,
  fileSizes,
  batchCount: `一度に追加できる素材は${ASSET_LIMITS.batchCount}個までです。`,
  batchSize: `一度の追加は${batchSizes}`,
  batch: `一度の追加は${ASSET_LIMITS.batchCount}個・${batchSizes}`,
  transferSize: (large: boolean) => `素材の転送容量は合計${mib(large ? ASSET_LIMITS.batchBytes : ASSET_LIMITS.fileBytes)}までです。`,
  storage: `素材の保存上限（${mib(ASSET_LIMITS.totalBytes)}・${ASSET_LIMITS.count}素材）またはブラウザーの空き容量を確認してください。不要な素材を削除して保存すると空きを確保できます。`,
  imageDimensions: `画像の大きさは${ASSET_LIMITS.edge}×${ASSET_LIMITS.edge}px以内にしてください。`,
  lottieSize: `Lottie JSONは${mib(ANIMATION_LIMITS.lottieBytes)}までです。`,
  modelCount: `3D素材は${MODEL_LIMITS.count}レイヤーまでです。`,
  layerCount: `素材は合計${IMAGE_LIMITS.count}レイヤーまでです。`,
  legacyAnimationCount: `旧形式のアニメーションは${ASSET_LIMITS.legacyAnimationCount}枚までです。`,
  formats: `PNG・APNG・WebP・GIF・WebM・Lottie JSON・GLB・VRM。通常${mib(ASSET_LIMITS.fileBytes)}／3D ${mib(ASSET_LIMITS.modelBytes)}／JSON ${mib(ANIMATION_LIMITS.lottieBytes)}、全${IMAGE_LIMITS.count}レイヤーまで。`,
  morphSize: (vrm: boolean) => `モーフの展開予算${mib(vrm ? MODEL_RESOURCE_LIMITS.vrmMorphBytes : MODEL_RESOURCE_LIMITS.morphBytes)}を超えています。`,
  modelAnimationSize: `アニメーションの展開予算${mib(MODEL_RESOURCE_LIMITS.animationBytes)}を超えています。`,
  textureSize: `テクスチャの展開量は合計${mib(MODEL_LIMITS.textureBytes)}までです。`,
  modelGpuSize: (vrm: boolean) => `3Dの推定描画資源が${mib(vrm ? MODEL_RESOURCE_LIMITS.vrmGpuBytes : MODEL_RESOURCE_LIMITS.gpuBytes)}を超えています。`,
  pageGpuSize: `3D描画資源の予算${mib(MODEL_RESOURCE_LIMITS.pageGpuBytes)}を超えました。ほかのモデルを削除してください。`,
});
