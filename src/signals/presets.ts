import type { SignalSource } from './keyframes';
import { SIGNAL_REGISTRY } from './registry';
export const SIGNAL_PRESETS: readonly { id: string; label: string; source: SignalSource; unit: string }[] =
  SIGNAL_REGISTRY.presets;

export const signalPreset = (source: SignalSource) =>
  SIGNAL_PRESETS.find((preset) => preset.source.signal === source.signal && preset.source.space === source.space) ??
  SIGNAL_PRESETS[0]!;
