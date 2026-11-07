# Retargets a library's animations onto one VRM 1.0 and writes a .vrma (and a .json of what was
# measured) per clip. Blender 5.2 + VRM Add-on for Blender 4.10 (not --factory-startup).
#
#   blender -b -P scripts/characters/retarget_vrma.py -- <target.vrm> <source.glb|fbx> <rig.json> <clips.json> <out-dir> [--only A,B]
#
# How a pose carries over: for each humanoid bone, how far the source bone turned in the world from
# its reference pose, applied to the target bone's rest (T) pose. Bone rolls and bone counts do not
# matter; a target spine bone the source has more of takes the world turn of the highest one.
#
# The corrections come from the two bodies, not from numbers tuned to one character
# (docs/product-design-snapshot.md, "動きの3段階"), so another model gets its own:
# - hips height and stride: the hips' motion is scaled by target / source rest hips height (a
#   short-legged body takes shorter steps; a walk's speed in .json is the speed its feet keep)
# - feet on the floor: each frame, the target's lower ankle is put where the source's lower ankle
#   is, scaled the same way, by moving the hips up or down. A jump keeps its height; a body whose
#   legs bend differently does not float or sink
# - arm spread: each frame, the arms open about the shoulders by the least angle (2.5° steps, up to
#   --arm-avoid, default 45°) that keeps the forearms and hands out of the torso's surface (the
#   model's own mesh), smoothed over neighbouring frames
# Clips with "inPlace" lose their straight travel (the engine moves the character at the speed).
import bpy, sys, os, math, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshcheck
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1 :]
vrm_path, source_path, rig_path, clips_path, out_dir = args[:5]
opt = lambda name, default: args[args.index(name) + 1] if name in args else default
only = set(filter(None, opt("--only", "").split(",")))
arm_avoid_max = float(opt("--arm-avoid", "45"))
rig = json.load(open(rig_path, encoding="utf8"))
clip_list = json.load(open(clips_path, encoding="utf8"))["clips"]
AVOID_STEP = 2.5
SMOOTH = 6
FINGERS = ("Thumb", "Index", "Middle", "Ring", "Little")
SWING = ("UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Thumb", "Index", "Middle", "Ring", "Little")
CHAIN = ["hips", "spine", "chest", "upperChest", "neck", "head"]
DIRECTION_CHILD = {"spine": "chest", "neck": "head"}
for side in ("left", "right"):
    DIRECTION_CHILD.update(
        {
            f"{side}Shoulder": f"{side}UpperArm",
            f"{side}UpperArm": f"{side}LowerArm",
            f"{side}LowerArm": f"{side}Hand",
            f"{side}Hand": f"{side}MiddleProximal",
            f"{side}UpperLeg": f"{side}LowerLeg",
            f"{side}LowerLeg": f"{side}Foot",
            f"{side}Foot": f"{side}Toes",
            f"{side}ThumbMetacarpal": f"{side}ThumbProximal",
            f"{side}ThumbProximal": f"{side}ThumbDistal",
        }
    )
    for f in ("Index", "Middle", "Ring", "Little"):
        DIRECTION_CHILD[f"{side}{f}Proximal"] = f"{side}{f}Intermediate"
        DIRECTION_CHILD[f"{side}{f}Intermediate"] = f"{side}{f}Distal"


def rot(m):
    return m.to_3x3().normalized().to_quaternion()


scn = bpy.context.scene
bpy.ops.wm.read_homefile(use_empty=True)
scn = bpy.context.scene
# The importer turns seconds into frames at the scene's rate.
scn.render.fps, scn.render.fps_base = rig.get("fps", 30), 1.0
bpy.ops.import_scene.vrm(filepath=vrm_path)
tgt = next(o for o in bpy.data.objects if o.type == "ARMATURE")
tgt_hb = tgt.data.vrm_addon_extension.vrm1.humanoid.human_bones
known = set(bpy.data.objects)
if source_path.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=source_path)
else:
    bpy.ops.import_scene.fbx(filepath=source_path)
src_objs = [o for o in bpy.data.objects if o not in known]
src = next(o for o in src_objs if o.type == "ARMATURE")
src_bones = {b.name for b in src.data.bones}

pairs = {}
for h, s in rig["bones"].items():
    t = getattr(tgt_hb, meshcheck.snake(h)).node.bone_name
    if t and s in src_bones:
        pairs[h] = (t, s)
for i, h in enumerate(CHAIN):
    if h in pairs:
        j = i + 1
        while j < len(CHAIN) and CHAIN[j] not in pairs and rig["bones"].get(CHAIN[j]) in src_bones:
            pairs[h] = (pairs[h][0], rig["bones"][CHAIN[j]])
            j += 1
tgt_to_src = {t: s for t, s in pairs.values()}
print("RETARGET pairs", len(pairs))

# Reference poses in the rest pose (no action evaluated).
if src.animation_data:
    src.animation_data.action = None
for pb in src.pose.bones:
    pb.matrix_basis = Matrix()
src_rest = {b.name: src.matrix_world @ b.matrix_local for b in src.data.bones}
tgt_rest = {b.name: tgt.matrix_world @ b.matrix_local for b in tgt.data.bones}
swing = {}
for h, (t, s) in pairs.items():
    c = DIRECTION_CHILD.get(h)
    if any(k in h for k in SWING) and c in pairs:
        dt = tgt_rest[pairs[c][0]].translation - tgt_rest[t].translation
        ds = src_rest[pairs[c][1]].translation - src_rest[s].translation
        swing[t] = ds.rotation_difference(dt)
for h, (t, s) in pairs.items():
    if t not in swing:
        p = tgt.data.bones[t].parent
        swing[t] = swing[p.name] if any(k in h for k in SWING) and p and p.name in swing else Quaternion()
src_ref = {s: swing[t] @ rot(src_rest[s]) for t, s in pairs.values()}
hips_t, hips_s = pairs["hips"]
k = tgt_rest[hips_t].translation.z / src_rest[hips_s].translation.z


def leg_length(rest, chain):
    pts = [rest[b].translation for b in chain]
    return sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))


# A step is as long as the leg, not as the hips are high: the hips' travel along the floor is
# scaled by the legs' length (a short-legged body's hips may sit relatively high), up and down by
# the hips' height. Otherwise the planted feet slide by the difference.
legs = [h for h in ("leftUpperLeg", "leftLowerLeg", "leftFoot") if h in pairs]
k_step = (
    leg_length(tgt_rest, [pairs[h][0] for h in legs]) / leg_length(src_rest, [pairs[h][1] for h in legs])
    if len(legs) == 3
    else k
)
feet = [pairs[h] for h in ("leftFoot", "rightFoot") if h in pairs]
print("RETARGET hips scale", round(k, 4))


def under(arm, bone):
    names, stack = {bone}, list(arm.data.bones[bone].children)
    while stack:
        b = stack.pop()
        names.add(b.name)
        stack.extend(b.children)
    return names


def sole_vertices(arm, foot_bones):
    """Per mesh, the vertices a foot (or a toe under it) moves most: the sole is the lowest of
    them in the deformed mesh. A sole follows the foot's pitch (a heel strike, a toe-off), which an
    ankle does not, and skinning bends it, which a rigid point does not."""
    owners = set().union(*(under(arm, b) for b in foot_bones))
    out = []
    for mesh in [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == arm]:
        gname = {g.index: g.name for g in mesh.vertex_groups}
        idx = [
            v.index for v in mesh.data.vertices if v.groups and gname.get(max(v.groups, key=lambda x: x.weight).group) in owners
        ]
        if idx:
            out.append((mesh, idx))
    return out


def sole_height(parts_list):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    lowest = math.inf
    for mesh, idx in parts_list:
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        lowest = min(lowest, min((mw @ me.vertices[i].co).z for i in idx))
        ev.to_mesh_clear()
    return lowest


def sole_points(parts_list):
    """Every sole vertex in the deformed mesh (world), in a fixed order."""
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    out = []
    for mesh, idx in parts_list:
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        out.extend((mw @ me.vertices[i].co).copy() for i in idx)
        ev.to_mesh_clear()
    return out


src_soles = sole_vertices(src, [s for _, s in feet])
tgt_soles = sole_vertices(tgt, [t for t, _ in feet])
tgt_soles_side = {
    side: sole_vertices(tgt, [pairs[f"{side}Foot"][0]]) for side in ("left", "right") if f"{side}Foot" in pairs
}
src_sole_rest = sole_height(src_soles)
tgt_sole_rest = sole_height(tgt_soles)
print("RETARGET sole vertices", sum(len(i) for _, i in src_soles), sum(len(i) for _, i in tgt_soles))

arm_side = {}
for side, sign in (("left", -1), ("right", 1)):
    up = pairs.get(f"{side}UpperArm")
    if not up:
        continue
    stack = [tgt.data.bones[up[0]]]
    while stack:
        b = stack.pop()
        arm_side[b.name] = (side, sign)
        stack.extend(b.children)
tgt_world_inv = tgt.matrix_world.inverted()
order = []


def walk(b):
    order.append(b)
    [walk(c) for c in b.children]


for b in tgt.data.bones:
    if b.parent is None:
        walk(b)
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == tgt]
parts = meshcheck.classify(meshes, tgt, list(rig["bones"].keys()))
height = max(o.dimensions.z for o in meshes)


def world(bone, matrix):
    return (src.matrix_world @ src.pose.bones[bone].matrix).translation if matrix is None else matrix


def solve(spread, travel, f0, f1, ground, lift=0.0, step=None):
    """The target's matrix_basis per bone for the current source frame.
    spread = {"left": deg, "right": deg}; lift moves the hips up (m)."""
    spread_q = {}
    for side, sign in (("left", -1), ("right", 1)):
        a = math.radians(spread.get(side, 0.0))
        axis = Vector((0, sign, 0))
        if a and f"{side}Hand" in pairs:
            wp = lambda h: (src.matrix_world @ src.pose.bones[pairs[h][1]].matrix).translation
            arm_dir = wp(f"{side}Hand") - wp(f"{side}UpperArm")
            out = wp(f"{side}Hand") - wp("hips")
            out.z = 0
            c = arm_dir.cross(out)
            if c.length > 1e-4:
                axis = c.normalized()
        spread_q[side] = Quaternion(axis, a)
    pose_arm, out = {}, {}
    for b in order:
        rest_rel = (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local
        base = (pose_arm[b.parent.name] @ rest_rel) if b.parent else rest_rel
        basis = Matrix()
        s = tgt_to_src.get(b.name)
        if s:
            spb = src.pose.bones[s]
            delta = rot(src.matrix_world @ spb.matrix) @ src_ref[s].inverted()
            if b.name in arm_side:
                delta = spread_q[arm_side[b.name][0]] @ delta
            want = rot(tgt_world_inv) @ delta @ rot(tgt_rest[b.name])
            basis = (rot(base).inverted() @ want).to_matrix().to_4x4()
            if b.name == hips_t:
                moved = (src.matrix_world @ spb.matrix).translation - src_rest[s].translation - ground
                if travel is not None:
                    moved = moved - travel * ((scn.frame_current - f0) / max(1, f1 - f0))
                s = k_step if step is None else step
                scaled = Vector((moved.x * s, moved.y * s, moved.z * k + lift))
                want_loc = tgt_world_inv @ (tgt_rest[b.name].translation + scaled)
                basis.translation = base.inverted() @ want_loc
            out[b.name] = basis
        pose_arm[b.name] = base @ basis
    return out


def pose_target(pose):
    for bone, basis in pose.items():
        tgt.pose.bones[bone].matrix_basis = basis


# Planted feet (walks and runs): a source's stance foot drifts a little on its own (UAL's walks by
# 16-19% of their pace), and no single hips speed can cancel a drift that changes within a step.
# While a foot touches the floor, its leg is bent (two-bone IK on this body's own thigh and shin) so
# that the touching sole vertices stay where they were; once it lifts off, the correction eases back
# to none over the swing, so the swing stays the source's. "Touching" is a sole vertex within
# CONTACT of the body's rest sole height, in two neighbouring frames (the same test check-motions
# uses for a planted foot), both measured on this body. The foot keeps its own turn (a heel strike,
# a toe-off), only its place changes.
CONTACT = 0.015
LEG = ("UpperLeg", "LowerLeg", "Foot")


def ik_leg(side, offset):
    """Moves the foot by `offset` (world) with the thigh and shin, keeping the knee's bend plane and
    the foot's turn. Returns the three bones' new matrix_basis."""
    up, lo, ft = (tgt.pose.bones[pairs[side + b][0]] for b in LEG)
    vl = bpy.context.view_layer
    vl.update()
    off = tgt_world_inv.to_3x3() @ offset
    H, K, A = (pb.matrix.translation.copy() for pb in (up, lo, ft))
    foot_rot = ft.matrix.to_quaternion()
    L1, L2 = (K - H).length, (A - K).length
    u = A + off - H
    # A straight leg cannot reach farther; a fully folded one not nearer.
    d = min(max(u.length, abs(L1 - L2) + 1e-4), (L1 + L2) * 0.9995)
    u.normalize()
    n = (K - H).cross(A - H)
    if n.length < 1e-6:
        n = up.matrix.to_3x3().col[0]
    w = n.normalized().cross(u)
    if w.dot((K - H) - u * (K - H).dot(u)) < 0:
        w = -w
    a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
    knee = H + u * a + w * math.sqrt(max(0.0, L1 * L1 - a * a))
    target = H + u * d
    about = lambda p, q: Matrix.Translation(p) @ q.to_matrix().to_4x4() @ Matrix.Translation(-p)
    up.matrix = about(H, (K - H).rotation_difference(knee - H)) @ up.matrix
    vl.update()
    K2, A2 = lo.matrix.translation.copy(), ft.matrix.translation.copy()
    lo.matrix = about(K2, (A2 - K2).rotation_difference(target - K2)) @ lo.matrix
    vl.update()
    ft.matrix = Matrix.LocRotScale(ft.matrix.translation, foot_rot, None)
    vl.update()
    return {pb.name: pb.matrix_basis.copy() for pb in (up, lo, ft)}


def pin_feet(pose_at, f0, f1, looping):
    """Per frame and foot, the world offset that keeps a touching foot's sole still (see above)."""
    n = f1 - f0 + 1
    P = n - 1 if looping else n
    sides = [s for s in ("left", "right") if s in tgt_soles_side and all(s + b in pairs for b in LEG)]
    pins = {s: [Vector((0, 0, 0)) for _ in range(n)] for s in sides}
    floor = tgt_sole_rest + CONTACT * height
    # Twice: the second pass cancels what the first left (skinning bends the sole a little).
    for _ in range(2):
        soles = {s: [] for s in sides}
        for f in range(f0, f1 + 1):
            scn.frame_set(f)
            pose_target(pose_at(f))
            for s in sides:
                if pins[s][f - f0].length > 0:
                    ik_leg(s, pins[s][f - f0])
            for s in sides:
                soles[s].append(sole_points(tgt_soles_side[s]))
        for s in sides:
            # drift[t]: the touching sole's median move from frame t-1 to t (None: not touching).
            drift = [None] * n
            for t in range(1, n):
                a, b = soles[s][t - 1], soles[s][t]
                moves = [b[i] - a[i] for i, p in enumerate(a) if p.z < floor and b[i].z < floor]
                if moves:
                    moves.sort(key=lambda v: v.x * v.x + v.y * v.y)
                    m = moves[len(moves) // 2]
                    drift[t] = Vector((m.x, m.y, 0))
            # A loop runs twice from its start so the first step's state is the steady one; the
            # transitions are into frames 1..P (frame P of a loop is its frame 0 one cycle on).
            span = 2 * P if looping else n
            into = lambda m: ((m - 1) % P) + 1 if looping else m
            acc, out = [Vector((0, 0, 0))] * span, Vector((0, 0, 0))
            m = 1
            while m < span:
                d = drift[into(m)]
                if d is not None:
                    out = out - d
                    acc[m] = out.copy()
                    m += 1
                    continue
                # A swing: from the correction it lifted off with back to none, by its next contact.
                end = m
                while end < span and drift[into(end)] is None:
                    end += 1
                for j in range(m, end):
                    acc[j] = out * (1 - (j - m + 1) / (end - m + 1))
                out = Vector((0, 0, 0)) if end < span else acc[end - 1].copy()
                m = end
            for i in range(n):
                j = (i % P) + P if looping else i
                pins[s][i] = pins[s][i] + acc[j if j < span else span - 1]
            if looping:
                pins[s][n - 1] = pins[s][0].copy()
    return pins


def run(clip):
    name = clip["source"]
    act = bpy.data.actions.get(name)
    if not act:
        print("RETARGET missing", name)
        return None
    src.animation_data_create()
    src.animation_data.action = act
    if getattr(act, "slots", None) and len(act.slots):
        src.animation_data.action_slot = act.slots[0]
    f0, f1 = (int(round(v)) for v in act.frame_range)
    scn.frame_start, scn.frame_end = f0, f1
    hips_at = lambda f: (scn.frame_set(f), (src.matrix_world @ src.pose.bones[hips_s].matrix).translation.copy())[1]
    travel = hips_at(f1) - hips_at(f0)
    travel.z = 0
    sec = (f1 - f0) / scn.render.fps
    in_place = bool(clip.get("inPlace"))
    mapped = [src.pose.bones[s] for h, (t, s) in pairs.items() if not any(x in h for x in FINGERS)]
    scn.frame_set(f0)
    p0 = {b.name: b.matrix.to_quaternion() for b in mapped}
    scn.frame_set(f1)
    looping = all(math.degrees(p0[b.name].rotation_difference(b.matrix.to_quaternion()).angle) < 1.0 for b in mapped)
    # The source's start: its feet define the floor (a clip that starts in the air keeps its height
    # relative to it only if the library says so; UAL clips start on the floor).
    scn.frame_set(f0)
    ground = Vector((0, 0, 0))
    travel_raw = hips_at(f1) - hips_at(f0)
    n = f1 - f0 + 1
    tr = travel if in_place else None

    # Feet: per frame, the hips' lift that puts the target's lower sole as far above its floor as
    # the source's lower sole is above its own (scaled).
    lifts = []
    # A motion that travels: the speed this body's planted feet keep, measured on the motion done
    # in place (a touching sole vertex goes back at it). The hips then travel at that speed, so the
    # feet hold still; the legs' length ratio is only the first guess.
    travels = not in_place and travel.length > 0.05 * src_rest[hips_s].translation.z
    soles_in_place = []
    for f in range(f0, f1 + 1):
        scn.frame_set(f)
        want = tgt_sole_rest + (sole_height(src_soles) - ground.z - src_sole_rest) * k
        pose_target(solve({}, tr, f0, f1, ground))
        lifts.append(want - sole_height(tgt_soles))
        if travels:
            pose_target(solve({}, travel, f0, f1, ground))
            soles_in_place.append(sole_points(tgt_soles))
    for pb in tgt.pose.bones:
        pb.matrix_basis = Matrix()
    step = k_step
    travel_all = travel_raw * k_step
    if travels and len(soles_in_place) > 2:
        forward = travel.normalized()
        speeds = []
        for a, b in zip(soles_in_place, soles_in_place[1:]):
            floor = min(p.z for p in a)
            touch = [i for i, p in enumerate(a) if p.z < floor + 0.01 * height and b[i].z < floor + 0.01 * height]
            if touch:
                v = sorted(-(b[i] - a[i]).dot(forward) * scn.render.fps for i in touch)
                speeds.append(v[len(v) // 2])
        speeds.sort()
        feet_speed = speeds[len(speeds) // 2] if speeds else 0
        if feet_speed > 0:
            step = feet_speed * sec / travel.length
            travel_all = Vector((travel_raw.x * step, travel_raw.y * step, travel_raw.z * k))
    # Smoothed a little: the hips must not jitter by a frame's rounding.
    period = n - 1 if looping else n
    win = lambda arr, i: (
        [arr[(i + d) % period] for d in range(-2, 3)] if looping else arr[max(0, i - 2) : i + 3]
    )
    lifts = [sum(win(lifts, i)) / len(win(lifts, i)) for i in range(n)]

    need = {"left": [0.0] * n, "right": [0.0] * n}
    if arm_avoid_max > 0:
        dg = bpy.context.evaluated_depsgraph_get()
        steps = [i * AVOID_STEP for i in range(int(arm_avoid_max / AVOID_STEP) + 1)]
        for f in range(f0, f1 + 1):
            scn.frame_set(f)
            found = {}
            for a in steps:
                pose_target(solve({"left": a, "right": a}, tr, f0, f1, ground, lifts[f - f0], step))
                dg.update()
                hits = meshcheck.inside(parts, dg, height)
                for side in ("left", "right"):
                    if side not in found and not hits[side]:
                        found[side] = a
                if len(found) == 2:
                    break
            for side in ("left", "right"):
                a = found.get(side, arm_avoid_max)
                need[side][f - f0] = min(arm_avoid_max, a + AVOID_STEP) if a > 0 else 0.0
        for side in ("left", "right"):
            a = need[side]
            if looping:
                a[0] = a[-1] = max(a[0], a[-1])
            w = lambda arr, i: (
                [arr[(i + d) % period] for d in range(-SMOOTH, SMOOTH + 1)]
                if looping
                else arr[max(0, i - SMOOTH) : i + SMOOTH + 1]
            )
            mx = [max(w(a, i)) for i in range(n)]
            need[side] = [sum(w(mx, i)) / len(w(mx, i)) for i in range(n)]
        for pb in tgt.pose.bones:
            pb.matrix_basis = Matrix()

    pose_at = lambda f: solve(
        {"left": need["left"][f - f0], "right": need["right"][f - f0]}, tr, f0, f1, ground, lifts[f - f0], step
    )
    # Walks and runs (a motion whose hips travel): planted feet held still.
    pins = pin_feet(pose_at, f0, f1, looping) if travels else {}
    for pb in tgt.pose.bones:
        pb.matrix_basis = Matrix()

    tgt.animation_data_create()
    action = bpy.data.actions.new(name + "_vrma")
    tgt.animation_data.action = action
    prev = {}
    for f in range(f0, f1 + 1):
        scn.frame_set(f)
        pose = pose_at(f)
        if pins:
            pose_target(pose)
            for side, offsets in pins.items():
                if offsets[f - f0].length > 0:
                    pose.update(ik_leg(side, offsets[f - f0]))
        for bone, basis in pose.items():
            q = basis.to_quaternion()
            if bone in prev and prev[bone].dot(q) < 0:
                q.negate()
            prev[bone] = q
            pb = tgt.pose.bones[bone]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if bone == hips_t:
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=f)
    scn.frame_set(f0)
    path = os.path.join(out_dir, name + ".vrma")
    res = bpy.ops.export_scene.vrma(filepath=path, armature_object_name=tgt.name)
    info = {
        "source": name,
        "frames": n,
        "fps": scn.render.fps,
        "seconds": round(sec, 3),
        "loop": looping,
        "inPlace": in_place,
        "hipsScale": round(k, 4),
        "stepScale": round(step, 4),
        "speedMps": round(travel.length * k_step / sec, 3) if in_place and sec else 0.0,
        # VRM space (Y up, +Z forward): the hips' travel left in the clip.
        "rootTravelM": [round(v, 3) for v in ((0, 0, 0) if in_place else (travel_all.x, travel_all.z, -travel_all.y))],
        "feetLiftM": {"min": round(min(lifts), 4), "max": round(max(lifts), 4)},
        "armSpreadDeg": {s: round(max(need[s]), 1) for s in need},
        # The farthest a planted foot was held from where the motion put it (cm).
        "feetPinCm": {s: round(max(v.length for v in pins[s]) * 100, 2) for s in pins},
        "export": list(res),
    }
    with open(os.path.join(out_dir, name + ".json"), "w", encoding="utf-8") as fp:
        json.dump(info, fp, ensure_ascii=False, indent=1)
    tgt.animation_data.action = None
    bpy.data.actions.remove(action)
    for pb in tgt.pose.bones:
        pb.matrix_basis = Matrix()
    print("RETARGET clip " + json.dumps(info))
    return info


os.makedirs(out_dir, exist_ok=True)
done = []
for clip in clip_list:
    if only and clip["source"] not in only:
        continue
    info = run(clip)
    if info:
        done.append(info)
print("RETARGET done", len(done))
