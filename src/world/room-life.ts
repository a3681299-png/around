/**
 * A character living in the room behind the UI (docs/living-room.md). Pure and deterministic: the
 * Host passes time, the room's layout (numbers read from the room asset's markers, or the
 * artwork's own), how much of the room the viewer can see, and whether the room looks flat; the
 * same inputs give the same life. Nothing here reads the page or knows the site.
 *
 * The character walks the floor between places, sits on seats, crouches at hiding places (the
 * room's furniture hides it by depth when drawn), and goes to the front of the UI when the room
 * is mostly hidden, coming back when it opens again. Near places are walked or hopped to, far
 * ones are left by fading out and appearing there (never sliding while seated, never walking on air).
 */

/** A place in the room, in metres (the room's own axes: y up). `heading` is the way the character
 * faces there, radians about y (0 = +z, toward camera_main in the asset contract's rooms). */
export interface RoomSpot {
  id: string;
  kind: 'sit' | 'hide' | 'stand';
  x: number;
  y: number;
  z: number;
  heading: number;
}
/** The walkable floor: triangles on the floor plane, [x0, z0, x1, z1, x2, z2] each. */
export interface RoomLayout {
  floorY: number;
  floor: readonly (readonly number[])[];
  spots: readonly RoomSpot[];
}

export type ResidentActivity =
  'idle' | 'walk' | 'sitDown' | 'sit' | 'standUp' | 'hide' | 'touch' | 'leave' | 'front' | 'arrive';
export interface ResidentState {
  /** Seconds since the life started. */
  t: number;
  /** Draws of the deterministic generator so far. */
  draws: number;
  x: number;
  z: number;
  /** Radians about y; 0 faces +z. */
  heading: number;
  activity: ResidentActivity;
  /** When the activity started (t). */
  since: number;
  /** How long it lasts (seconds), chosen when it starts. */
  dwell: number;
  /** The place it is at or heading to. */
  spot?: string;
  /** Floor points still to walk through (x, z pairs). */
  path: readonly (readonly [number, number])[];
  /** The last time the character was moved while the room looked flat. */
  swappedAt: number;
  /** Since when the room has been mostly hidden (or open), for the front visits. */
  hiddenSince: number | undefined;
  openSince: number | undefined;
  /** How the current move between the room and the front goes. */
  via?: 'hop' | 'fade';
}

export interface ResidentInput {
  dt: number;
  layout: RoomLayout;
  /** 0–1 per spot id: how much of that place the viewer sees now (the Host projects it). */
  seen: (spot: RoomSpot) => number;
  /** 0–1: how much of the room shows at all (beside the UI's opaque parts). */
  roomSeen: number;
  /** The room looks flat (the camera's far, telephoto shot): the character may move unseen. */
  flat: boolean;
  /** The artwork's readiness to come to the front (0 never, 1 whenever the room is hidden). */
  front: number;
  /** The character's place in the room is near its place in front (screen distance, the Host). */
  nearFront: boolean;
  reducedMotion: boolean;
  /** The glass is right in front of the character (the Host: a plate's edge near its hand on
   * screen): arriving at a standing place, it touches the glass from behind. Absent: never. */
  glassNear?: boolean;
}

export const WALK_SPEED = 0.85; // metres a second
/** How long a touch of the glass lasts; the mark is left `TOUCH_MARK_S` into it. */
export const TOUCH_S = 2.4;
export const TOUCH_MARK_S = 0.7;
export const SIT_DOWN_S = 0.7;
export const STAND_UP_S = 0.6;
export const LEAVE_S = 0.45;
export const ARRIVE_S = 0.45;
/** The room must stay mostly hidden (or open) this long before the character crosses over. */
const CROSS_AFTER_S = 2.5;
const ROOM_HIDDEN = 0.2;
const ROOM_OPEN = 0.35;
/** At most one unseen move per this many seconds while the room looks flat. */
const SWAP_EVERY_S = 18;

// --- deterministic numbers -------------------------------------------------------------------

/** The n-th number of a fixed sequence (a 32-bit hash), 0 ≤ r < 1. Same n, same number. */
export function draw(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- the floor ---------------------------------------------------------------------------------

const inTriangle = (x: number, z: number, t: readonly number[]) => {
  const [ax, az, bx, bz, cx, cz] = t as [number, number, number, number, number, number];
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
  const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0,
    pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};
export const onFloor = (layout: RoomLayout, x: number, z: number) => layout.floor.some((t) => inTriangle(x, z, t));
/** The body's half width: the middle of the body keeps this far from the floor's edge (furniture). */
export const BODY_M = 0.14;
/** Room for the whole body: the floor around the point, not only under it. */
export const walkable = (layout: RoomLayout, x: number, z: number) =>
  onFloor(layout, x, z) &&
  onFloor(layout, x + BODY_M, z) &&
  onFloor(layout, x - BODY_M, z) &&
  onFloor(layout, x, z + BODY_M) &&
  onFloor(layout, x, z - BODY_M);

/** The nearest walkable point to (x, z) on a 5 cm search (a seat's marker is over the chair, off the floor). */
export function nearestFloor(layout: RoomLayout, x: number, z: number): [number, number] {
  if (walkable(layout, x, z)) return [x, z];
  for (let r = 0.05; r <= 1.5; r += 0.05)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2,
        px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (walkable(layout, px, pz)) return [px, pz];
    }
  return [x, z];
}

const CELL = 0.1;
const MAX_VISITS = 4096;
const MAX_FLOOR_CHECKS = 750000;
/**
 * A walk over the floor from a to b: straight when nothing is in the way, otherwise the shortest
 * way over a 10 cm grid of the floor, pulled tight (each corner kept only where a straight line
 * would leave the floor). Empty when b cannot be reached.
 */
export function floorPath(
  layout: RoomLayout,
  a: readonly [number, number],
  b: readonly [number, number],
): [number, number][] {
  // Navigation runs on the page's main thread. Charge each position conservatively for
  // all its triangle checks, including the straight-line and path-shortening passes.
  let remaining = Math.floor(MAX_FLOOR_CHECKS / (5 * Math.max(1, layout.floor.length)));
  const supported = (x: number, z: number) => remaining-- > 0 && walkable(layout, x, z);
  const clear = (from: readonly [number, number], to: readonly [number, number]) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.02));
    if (!(steps < remaining)) return false;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!supported(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t)) return false;
    }
    return true;
  };
  if (!supported(...a) || !supported(...b)) return [];
  if (clear(a, b)) return [[b[0], b[1]]];
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const t of layout.floor)
    for (let i = 0; i < 6; i += 2) {
      minX = Math.min(minX, t[i]!);
      maxX = Math.max(maxX, t[i]!);
      minZ = Math.min(minZ, t[i + 1]!);
      maxZ = Math.max(maxZ, t[i + 1]!);
    }
  const w = Math.ceil((maxX - minX) / CELL) + 1,
    h = Math.ceil((maxZ - minZ) / CELL) + 1;
  if (!(w > 0 && h > 0) || w * h > 250000) return [];
  const cx = (i: number) => minX + (i % w) * CELL,
    cz = (i: number) => minZ + Math.floor(i / w) * CELL;
  const cellOf = (x: number, z: number) =>
    Math.min(h - 1, Math.max(0, Math.round((z - minZ) / CELL))) * w +
    Math.min(w - 1, Math.max(0, Math.round((x - minX) / CELL)));
  const start = cellOf(a[0], a[1]),
    goal = cellOf(b[0], b[1]);
  const cost = new Float64Array(w * h).fill(Infinity),
    from = new Int32Array(w * h).fill(-1),
    done = new Uint8Array(w * h);
  cost[start] = 0;
  // Stop before scanning a large disconnected floor can block the host. A partial path
  // would leave the resident walking somewhere the solver didn't prove reachable.
  const open = new Set<number>([start]);
  let arrived = false;
  for (let visit = 0; open.size && visit < MAX_VISITS && remaining > 0; visit++) {
    let best = -1,
      bestCost = Infinity;
    for (const i of open) {
      const f = cost[i]! + Math.hypot(cx(i) - cx(goal), cz(i) - cz(goal));
      if (f < bestCost) {
        bestCost = f;
        best = i;
      }
    }
    open.delete(best);
    if (best === goal) {
      arrived = true;
      break;
    }
    done[best] = 1;
    const bx = best % w,
      bz = Math.floor(best / w);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = bx + dx,
          nz = bz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const n = nz * w + nx;
        if (done[n] || (n !== goal && !supported(cx(n), cz(n)))) continue;
        // A diagonal step only where both sides are open (it would cut a furniture corner).
        if (dx && dz && (!supported(cx(bz * w + nx), cz(bz * w + nx)) || !supported(cx(nz * w + bx), cz(nz * w + bx))))
          continue;
        const c = cost[best]! + (dx && dz ? Math.SQRT2 : 1) * CELL;
        if (c < cost[n]!) {
          cost[n] = c;
          from[n] = best;
          open.add(n);
        }
      }
  }
  if (!arrived || start === goal) return [];
  const cells: [number, number][] = [];
  for (let i = goal; i !== -1 && i !== start; i = from[i]!) cells.unshift([cx(i), cz(i)]);
  cells[cells.length - 1] = [b[0], b[1]];
  // Pull tight.
  const out: [number, number][] = [];
  let at: readonly [number, number] = a;
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1];
    if (next && clear(at, next)) continue;
    out.push(cells[i]!);
    at = cells[i]!;
  }
  return out;
}

/**
 * The room's places plus free standing places on its open floor (a 0.9 m grid, at most 16, facing
 * the camera's side): with only the furniture's places, a character whose furniture is out of
 * sight would never be seen; with these, the life drifts toward the floor the viewer can see.
 */
export function withFloorPlaces(layout: RoomLayout): RoomLayout {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const t of layout.floor)
    for (let i = 0; i < 6; i += 2) {
      minX = Math.min(minX, t[i]!);
      maxX = Math.max(maxX, t[i]!);
      minZ = Math.min(minZ, t[i + 1]!);
      maxZ = Math.max(maxZ, t[i + 1]!);
    }
  const free: RoomSpot[] = [];
  // A sparse floor should still have a fixed sampling budget. Integer indices also advance
  // when a very large coordinate cannot represent the addition of a small step.
  const spacing = Math.max(0.9, (maxX - minX) / 16, (maxZ - minZ) / 16);
  for (let row = 0; row < 16 && free.length < 16; row++) {
    const z = minZ + (row + 0.5) * spacing;
    if (!(z < maxZ)) break;
    for (let col = 0; col < 16 && free.length < 16; col++) {
      const x = minX + (col + 0.5) * spacing;
      if (!(x < maxX)) break;
      if (walkable(layout, x, z) && !layout.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 0.6))
        free.push({ id: `floor_${free.length}`, kind: 'stand', x, y: layout.floorY, z, heading: 0 });
    }
  }
  return { ...layout, spots: [...layout.spots, ...free] };
}

// --- the life ----------------------------------------------------------------------------------

/** Where the character stands to use a spot: the spot itself, or beside a seat on the floor. */
export function standPoint(layout: RoomLayout, spot: RoomSpot): [number, number] {
  if (spot.kind !== 'sit') return nearestFloor(layout, spot.x, spot.z);
  // In front of the seat (the way it faces), where the feet go before sitting down.
  return nearestFloor(layout, spot.x + Math.sin(spot.heading) * 0.35, spot.z + Math.cos(spot.heading) * 0.35);
}

export function startResident(layout: RoomLayout, seed: number): ResidentState {
  // The first place: the most comfortable one (a seat), seated already, as if it had been there.
  const seat = layout.spots.find((s) => s.kind === 'sit') ?? layout.spots[0];
  const [x, z] = seat ? standPoint(layout, seat) : nearestFloor(layout, 0, 0);
  return {
    t: 0,
    draws: seed >>> 0,
    x,
    z,
    heading: seat?.heading ?? 0,
    activity: seat?.kind === 'sit' ? 'sit' : 'idle',
    since: 0,
    dwell: 12,
    ...(seat ? { spot: seat.id } : {}),
    path: [],
    swappedAt: -Infinity,
    hiddenSince: undefined,
    openSince: undefined,
  };
}

const settle = (spot: RoomSpot | undefined): ResidentActivity =>
  spot?.kind === 'sit' ? 'sitDown' : spot?.kind === 'hide' ? 'hide' : 'idle';

/** The next place: weighted by how much the viewer sees it (life is to be glimpsed), never the same one. */
function choose(current: string | undefined, input: ResidentInput, rand: () => number): RoomSpot | undefined {
  const others = input.layout.spots.filter((spot) => spot.id !== current);
  if (!others.length) return undefined;
  // The room's own places keep a little weight unseen (life goes on behind the list); free floor
  // places almost none (there would be no reason to stand there out of sight).
  const weights = others.map(
    (spot) =>
      ((spot.id.startsWith('floor_') ? 0.02 : 0.15) + Math.max(0, Math.min(1, input.seen(spot)))) *
      (spot.kind === 'sit' ? 1.4 : 1),
  );
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < others.length; i++) if ((r -= weights[i]!) <= 0) return others[i];
  return others[others.length - 1];
}

const turnToward = (from: number, to: number, max: number) => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-max, Math.min(max, d));
};

/** One step of the life. */
export function stepResident(state: ResidentState, input: ResidentInput, seed: number): ResidentState {
  const dt = Math.min(0.25, Math.max(0, Number.isFinite(input.dt) ? input.dt : 0));
  let s: ResidentState = { ...state, t: state.t + dt };
  const rand = () => draw(seed, s.draws++);
  const spots = new Map(input.layout.spots.map((spot) => [spot.id, spot]));
  const elapsed = s.t - s.since;
  const begin = (activity: ResidentActivity, dwell: number, extra: Partial<ResidentState> = {}) => {
    s = { ...s, activity, since: s.t, dwell, ...extra };
  };

  // How long the room has been hidden or open: the front visits follow the viewer's own scrolling
  // and theater switches, not a timer of their own.
  s.hiddenSince = input.roomSeen < ROOM_HIDDEN ? (s.hiddenSince ?? s.t) : undefined;
  s.openSince = input.roomSeen > ROOM_OPEN ? (s.openSince ?? s.t) : undefined;
  const inRoom = s.activity !== 'front' && s.activity !== 'leave';
  // Mid-movement into or out of a seat (or arriving), the crossing waits: the standUp step below
  // goes on to leave by itself once standing.
  const busy = s.activity === 'sitDown' || s.activity === 'standUp' || s.activity === 'arrive';
  if (
    inRoom &&
    !busy &&
    input.front > 0 &&
    s.hiddenSince !== undefined &&
    s.t - s.hiddenSince >= CROSS_AFTER_S / Math.max(0.1, input.front)
  ) {
    // Seated, it stands up first (never sliding off the seat).
    if (s.activity === 'sit') begin('standUp', STAND_UP_S);
    else begin('leave', LEAVE_S, { via: input.nearFront && !input.reducedMotion ? 'hop' : 'fade', path: [] });
    return s;
  }
  if (s.activity === 'front') {
    if (s.openSince !== undefined && s.t - s.openSince >= CROSS_AFTER_S * 0.4) {
      // Back where the viewer now sees the room best: appear there (a fade), or hop in when near.
      const spot = choose(undefined, input, rand);
      const [x, z] = spot ? standPoint(input.layout, spot) : [s.x, s.z];
      begin('arrive', ARRIVE_S, {
        x,
        z,
        heading: spot?.heading ?? s.heading,
        ...(spot ? { spot: spot.id } : {}),
        via: input.nearFront && !input.reducedMotion ? 'hop' : 'fade',
        path: [],
      });
    }
    return s;
  }

  // Unseen moves: while the room looks flat (far away), the character may simply be somewhere
  // else the next time it opens ("いつの間にかソファにいる").
  if (
    input.flat &&
    (s.activity === 'idle' || s.activity === 'sit' || s.activity === 'hide') &&
    s.t - s.swappedAt >= SWAP_EVERY_S &&
    elapsed >= 6
  ) {
    const spot = choose(s.spot, input, rand);
    if (spot) {
      const [x, z] = standPoint(input.layout, spot);
      begin(spot.kind === 'sit' ? 'sit' : spot.kind === 'hide' ? 'hide' : 'idle', 10 + rand() * 14, {
        x,
        z,
        heading: spot.heading,
        spot: spot.id,
        path: [],
        swappedAt: s.t,
      });
      return s;
    }
  }

  switch (s.activity) {
    case 'leave':
      if (elapsed >= s.dwell) begin('front', Infinity);
      break;
    case 'arrive': {
      if (elapsed >= s.dwell) {
        const spot = s.spot ? spots.get(s.spot) : undefined;
        begin(settle(spot), spot?.kind === 'sit' ? SIT_DOWN_S : 4 + rand() * 4);
      }
      break;
    }
    case 'sitDown':
      if (elapsed >= s.dwell) begin('sit', 9 + rand() * 14);
      break;
    case 'standUp':
      if (elapsed >= s.dwell) {
        if (
          s.hiddenSince !== undefined &&
          input.front > 0 &&
          s.t - s.hiddenSince >= CROSS_AFTER_S / Math.max(0.1, input.front)
        )
          begin('leave', LEAVE_S, { via: input.nearFront && !input.reducedMotion ? 'hop' : 'fade' });
        else begin('idle', 0.6 + rand() * 1.2);
      }
      break;
    case 'sit':
      if (elapsed >= s.dwell) begin('standUp', STAND_UP_S);
      break;
    case 'idle':
    case 'hide':
      if (elapsed >= s.dwell) {
        const spot = choose(s.spot, input, rand);
        if (!spot) {
          begin(s.activity, 5);
          break;
        }
        const target = standPoint(input.layout, spot);
        const path = floorPath(input.layout, [s.x, s.z], target);
        if (!path.length) {
          // Not reachable on foot: a fade there would be a jump cut in full view, so stay.
          begin(s.activity, 3 + rand() * 3);
          break;
        }
        begin('walk', Infinity, { spot: spot.id, path });
      }
      break;
    case 'walk': {
      let budget = WALK_SPEED * dt;
      let { x, z, heading } = s;
      const path = [...s.path];
      while (budget > 0 && path.length) {
        const [px, pz] = path[0]!;
        const d = Math.hypot(px - x, pz - z);
        if (d > 1e-6) heading = turnToward(heading, Math.atan2(px - x, pz - z), dt * 6);
        if (d <= budget) {
          x = px;
          z = pz;
          budget -= d;
          path.shift();
        } else {
          x += ((px - x) / d) * budget;
          z += ((pz - z) / d) * budget;
          budget = 0;
        }
      }
      s = { ...s, x, z, heading, path };
      if (!path.length) {
        const spot = s.spot ? spots.get(s.spot) : undefined;
        // At a standing place right behind the glass, it touches the glass first.
        if (spot?.kind === 'stand' && input.glassNear && !input.reducedMotion) begin('touch', TOUCH_S);
        else begin(settle(spot), spot?.kind === 'sit' ? SIT_DOWN_S : 4 + rand() * 5);
      }
      break;
    }
    case 'touch':
      if (elapsed >= s.dwell) begin('idle', 3 + rand() * 4);
      break;
  }
  // Settling into a place turns the character to the place's way (seats and corners face out).
  if (s.activity !== 'walk' && s.activity !== 'front') {
    const spot = s.spot ? spots.get(s.spot) : undefined;
    if (spot) s = { ...s, heading: turnToward(s.heading, spot.heading, dt * 5) };
  }
  return s;
}

/** What the renderer draws: the body's pose kind, the clip time and where the hips go. */
export interface ResidentPose {
  visible: boolean;
  /** 0–1: the room character's opacity (fades out leaving, in arriving). */
  opacity: number;
  clip: 'idle' | 'walk' | 'sitDown' | 'sit' | 'standUp' | 'hide' | 'hop' | 'touch';
  /** Seconds into the clip. */
  time: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** 0 standing on the floor, 1 seated at the spot's height (the seat's marker is at the hips). */
  seat: number;
  seatY: number;
  /** The floor's height (the shadow stays on it during a hop). */
  floorY: number;
}

export function residentPose(s: ResidentState, layout: RoomLayout): ResidentPose {
  const spot = s.spot ? layout.spots.find((p) => p.id === s.spot) : undefined;
  const elapsed = s.t - s.since;
  const base = {
    visible: true,
    opacity: 1,
    time: elapsed,
    x: s.x,
    y: layout.floorY,
    z: s.z,
    heading: s.heading,
    seat: 0,
    seatY: spot?.y ?? layout.floorY,
    floorY: layout.floorY,
  };
  const k = (v: number) => Math.min(1, Math.max(0, v));
  const ease = (v: number) => v * v * (3 - 2 * v);
  switch (s.activity) {
    case 'front':
      return { ...base, visible: false, opacity: 0, clip: 'idle' };
    case 'leave':
    case 'arrive': {
      const p = k(elapsed / s.dwell),
        shown = s.activity === 'leave' ? 1 - p : p;
      if (s.via === 'hop')
        // A small hop out of (or into) the room toward the viewer, fading at the far end.
        return {
          ...base,
          clip: 'hop',
          y: layout.floorY + Math.sin(Math.PI * p) * 0.25,
          z: s.z + (1 - shown) * 0.6,
          opacity: ease(shown),
        };
      return { ...base, clip: 'idle', opacity: ease(shown) };
    }
    case 'sitDown': {
      const p = ease(k(elapsed / s.dwell));
      // The feet stay planted while the body lowers: the place moves from the stand point to the
      // seat in the same proportion as the hips go down.
      return {
        ...base,
        clip: 'sitDown',
        seat: p,
        ...(spot ? { x: s.x + (spot.x - s.x) * p, z: s.z + (spot.z - s.z) * p } : {}),
      };
    }
    case 'standUp': {
      const p = ease(k(elapsed / s.dwell));
      return {
        ...base,
        clip: 'standUp',
        seat: 1 - p,
        ...(spot ? { x: spot.x + (s.x - spot.x) * p, z: spot.z + (s.z - spot.z) * p } : {}),
      };
    }
    case 'sit':
      return { ...base, clip: 'sit', seat: 1, ...(spot ? { x: spot.x, z: spot.z } : {}) };
    case 'hide':
      return { ...base, clip: 'hide' };
    case 'touch':
      // Facing the glass (the viewer's side) with a hand on it.
      return { ...base, clip: 'touch', heading: 0 };
    case 'walk':
      return { ...base, clip: 'walk' };
    case 'idle':
      return { ...base, clip: 'idle' };
  }
}
