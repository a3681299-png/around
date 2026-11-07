# Whether forearm and hand vertices are inside the torso's surface (hips, spine, chest, thighs).
# Shared by retarget_vrma.py (the arm spread it bakes) and any check that poses the model in Blender.
import re
from mathutils.bvhtree import BVHTree

ARM_KEYS = ("LowerArm", "Hand", "Thumb", "Index", "Middle", "Ring", "Little")
TORSO_PARTS = {"hips", "spine", "chest", "upperChest", "leftUpperLeg", "rightUpperLeg"}


def snake(n):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", n).lower()


def classify(meshes, arm, human_names):
    """Per mesh: indices of left-arm, right-arm and torso vertices, by each vertex's heaviest humanoid bone."""
    hb = arm.data.vrm_addon_extension.vrm1.humanoid.human_bones
    bone_to_h = {}
    for h in human_names:
        b = getattr(hb, snake(h)).node.bone_name
        if b:
            bone_to_h[b] = h
    out = []
    for mesh in meshes:
        gname = {g.index: g.name for g in mesh.vertex_groups}
        left, right, torso = [], [], set()
        for v in mesh.data.vertices:
            if not v.groups:
                continue
            h = bone_to_h.get(gname.get(max(v.groups, key=lambda x: x.weight).group))
            if not h:
                continue
            if h in TORSO_PARTS:
                torso.add(v.index)
            elif any(k in h for k in ARM_KEYS):
                (left if h.startswith("left") else right).append(v.index)
        out.append((mesh, left, right, torso))
    return out


def inside(parts, dg, height):
    """The arm vertices inside the torso in the current pose, as {"left": n, "right": n} counts.
    Torso faces of every mesh form one surface (a coat on one mesh, the body on another)."""
    co_all, polys, arms = [], [], []
    for mesh, left, right, torso in parts:
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        base = len(co_all)
        co = [ev.matrix_world @ v.co for v in me.vertices]
        co_all.extend(co)
        polys.extend([base + i for i in p.vertices] for p in me.polygons if all(i in torso for i in p.vertices))
        arms.append((base, left, right))
        ev.to_mesh_clear()
    hits = {"left": 0, "right": 0}
    if not polys:
        return hits
    bvh = BVHTree.FromPolygons(co_all, polys)
    for base, left, right in arms:
        for side, verts in (("left", left), ("right", right)):
            for i in verts:
                p = co_all[base + i]
                loc, nrm, _, dist = bvh.find_nearest(p)
                if loc is not None and (p - loc).dot(nrm) < -0.002 and dist < 0.05 * height:
                    hits[side] += 1
    return hits
