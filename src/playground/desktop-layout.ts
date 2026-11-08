type Point = [number, number, number];

export interface DesktopLayout {
  monitor: { position: Point; rotationDeg: Point; size: [number, number] };
  floorY: number;
  viewer: [number, number];
  via: [number, number][];
  camera: { truckX: number; lensY: number };
  room?: { asset: string; position: Point; rotationDeg: Point; scale: number };
}

/** The Playground scene has its own layout. Only bounded transforms and a verified asset ID cross this boundary. */
export function parseDesktopLayout(input: unknown): DesktopLayout {
  const record = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    throw new Error('デスクトップの配置を読み込めません。');
  };
  const number = (value: unknown, min: number, max: number) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) return value;
    throw new Error('デスクトップの配置の数値が範囲外です。');
  };
  const tuple = <T extends [number, number] | Point>(value: unknown, count: T['length'], min: number, max: number) => {
    if (!Array.isArray(value) || value.length !== count) throw new Error('デスクトップの配置の軸数が違います。');
    return value.map((entry) => number(entry, min, max)) as T;
  };
  const transform = (value: Record<string, unknown>) => ({
    position: tuple<Point>(value.position, 3, -4000, 4000),
    rotationDeg: tuple<Point>(value.rotationDeg, 3, -180, 180),
  });
  const data = record(input);
  const screen = record(data.monitor);
  const via = data.via ?? [];
  if (!Array.isArray(via) || via.length > 3) throw new Error('デスクトップの経路が長すぎます。');
  const camera = record(data.camera ?? {});
  const layout: DesktopLayout = {
    monitor: { ...transform(screen), size: tuple<[number, number]>(screen.size, 2, 32, 1500) },
    floorY: number(data.floorY, -2400, 1000),
    viewer: tuple<[number, number]>(data.viewer, 2, -2400, 2400),
    via: via.map((point) => tuple<[number, number]>(point, 2, -2400, 2400)),
    camera: { truckX: number(camera.truckX ?? 0, -900, 900), lensY: number(camera.lensY ?? -0.18, -0.4, 0.2) },
  };
  if (data.room !== undefined) {
    const room = record(data.room);
    if (typeof room.asset !== 'string' || !/^asset-[a-f0-9]{64}$/.test(room.asset))
      throw new Error('部屋の素材 ID が不正です。');
    layout.room = { asset: room.asset, ...transform(room), scale: number(room.scale, 0.001, 2000) };
  }
  return layout;
}
