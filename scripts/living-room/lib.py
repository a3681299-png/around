# Shared helpers for the living room (scripts/living-room). Run inside Blender:
#   exec(open(".../lib.py").read())  then  exec(open(".../10_shell.py").read())  …
# Every part script wipes and rebuilds its own collection, so a part can be re-run on its own.
# Units are metres, Z up, the open side of the room is -Y (glTF +Z, toward camera_main).
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler

ROOT = 'Room'
HALF = 3.0
BACK = 2.7
FRONT = -2.7
WALL_H = 2.9
# The bay belongs to the walkable room, including its angled cheeks.
FLOOR_PLAN = [(-3, -2.7), (3, -2.7), (3, 2.7), (0.1, 2.7),
              (-0.2, 3.5), (-2.1, 3.5), (-2.4, 2.7), (-3, 2.7)]


def srgb(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (a,)


def coll(name):
    root = bpy.data.collections.get(ROOT)
    if not root:
        root = bpy.data.collections.new(ROOT)
        bpy.context.scene.collection.children.link(root)
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        root.children.link(c)
    return c


def wipe(name):
    c = coll(name)
    for o in list(c.objects):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data and data.users == 0:
            kind = type(data).__name__
            store = {'Mesh': bpy.data.meshes, 'Curve': bpy.data.curves, 'PointLight': bpy.data.lights,
                     'AreaLight': bpy.data.lights, 'SpotLight': bpy.data.lights}.get(kind)
            if store:
                store.remove(data)
    return c


def mat(name, color, rough=0.65, metal=0.0, emit=None, strength=0.0, alpha=1.0, vcol=False):
    """A Principled material. `emit` makes it a light source (exported as emissive, not baked)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    rgba = srgb(color) if isinstance(color, str) else tuple(color)
    p.inputs['Base Color'].default_value = rgba
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Alpha'].default_value = alpha
    if emit:
        e = srgb(emit) if isinstance(emit, str) else tuple(emit)
        p.inputs['Emission Color'].default_value = e
        p.inputs['Emission Strength'].default_value = strength
        if vcol:
            a = nt.nodes.new('ShaderNodeVertexColor')
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            mix.inputs['A'].default_value = e
            nt.links.new(a.outputs['Color'], mix.inputs['B'])
            nt.links.new(mix.outputs['Result'], p.inputs['Emission Color'])
        m['ww_emit'] = True
    m.diffuse_color = rgba
    return m


def finish(o, c, bevel=0.0, segs=2, smooth=True, angle=35):
    c.objects.link(o)
    if smooth and o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = True
    if bevel > 0:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = segs
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(angle)
        b.miter_outer = 'MITER_ARC'
        b.harden_normals = False
    if smooth and o.type == 'MESH':
        w = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
        w.keep_sharp = False
        w.weight = 60
    return o


def bm_object(name, bm, mats, c, bevel=0.0, segs=2, smooth=True, loc=(0, 0, 0), rot=(0, 0, 0), angle=35):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    o.location = loc
    o.rotation_euler = rot
    return finish(o, c, bevel, segs, smooth, angle)


def bm_box(bm, size, loc=(0, 0, 0), rot=(0, 0, 0), mi=0):
    """Adds a box to bm; returns its verts."""
    m = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    faces = set()
    for v in r['verts']:
        for f in v.link_faces:
            faces.add(f)
    for f in faces:
        f.material_index = mi
    return r['verts']


def box(name, size, loc, c, m, rot=(0, 0, 0), bevel=0.008, segs=2):
    bm = bmesh.new()
    bm_box(bm, size)
    return bm_object(name, bm, m, c, bevel, segs, loc=loc, rot=rot)


def cyl(name, r, h, loc, c, m, rot=(0, 0, 0), bevel=0.004, segs=2, verts=32, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=h)
    return bm_object(name, bm, m, c, bevel, segs, loc=loc, rot=rot, angle=40)


def lathe(name, profile, loc, c, m, steps=36, rot=(0, 0, 0), subsurf=0, cap=True, bevel=0.0):
    """Spins (r, z) points about Z. Points with r == 0 close the shape on the axis."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / steps), r * math.sin(2 * math.pi * i / steps), z))
                          for i in range(steps)])
    for a, b in zip(rings, rings[1:]):
        for i in range(steps):
            j = (i + 1) % steps
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = bm_object(name, bm, m, c, bevel, loc=loc, rot=rot)
    if subsurf:
        s = o.modifiers.new('sub', 'SUBSURF')
        s.levels = s.render_levels = subsurf
        o.modifiers.move(len(o.modifiers) - 1, 0)
    return o


def sphere(name, r, loc, c, m, scale=(1, 1, 1), rot=(0, 0, 0), seg=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    o = bm_object(name, bm, m, c, loc=loc, rot=rot)
    o.scale = scale
    return o


def soft_box(name, size, loc, c, m, rot=(0, 0, 0), cuts=6, puff=0.25, pinch=0.0, noise=0.0, seed=0, levels=2, flat_bottom=0.0):
    """A cushion: a subdivided box rounded toward a superellipsoid, optionally pinched at the
    corners (pillows) and wrinkled a little, then subdivided."""
    bm = bmesh.new()
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    rnd = random.Random(seed)
    sx, sy, sz = size
    for v in bm.verts:
        x, y, z = v.co * 2  # -1..1
        # bulge the faces outward: more in the middle of each face
        k = puff
        bx = x * (1 + k * (1 - y * y) * (1 - z * z) * 0.5)
        by = y * (1 + k * (1 - x * x) * (1 - z * z) * 0.5)
        bz = z * (1 + k * (1 - x * x) * (1 - y * y))
        if pinch:
            # thin toward the rim like a stuffed pillow
            edge = max(abs(x), abs(y))
            bz *= 1 - pinch * edge ** 3
        if flat_bottom and bz < 0:
            bz *= (1 - flat_bottom)
        n = noise * (rnd.random() - 0.5)
        v.co = Vector((bx * sx / 2, by * sy / 2, bz * sz / 2 + n * sz))
    o = bm_object(name, bm, m, c, loc=loc, rot=rot)
    s = o.modifiers.new('sub', 'SUBSURF')
    s.levels = s.render_levels = levels
    o.modifiers.move(len(o.modifiers) - 1, 0)
    return o


def tube(name, pts, radius, c, m, cyclic=False, res=12, bevel_res=4, kind='BEZIER', fill_caps=True):
    """A wire, cable or rod through points (smooth)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_res
    cu.resolution_u = res
    cu.use_fill_caps = fill_caps
    sp = cu.splines.new('NURBS' if kind == 'NURBS' else 'POLY' if kind == 'POLY' else 'BEZIER')
    if kind == 'BEZIER':
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
    else:
        sp.points.add(len(pts) - 1)
        for sp_p, p in zip(sp.points, pts):
            sp_p.co = (*p, 1)
        if kind == 'NURBS':
            sp.use_endpoint_u = True
            sp.order_u = min(4, len(pts))
    sp.use_cyclic_u = cyclic
    cu.materials.append(m)
    o = bpy.data.objects.new(name, cu)
    c.objects.link(o)
    return o


def outline(name, pts2d, thickness, loc, c, m, rot=(0, 0, 0), bevel=0.004, segs=2):
    """A flat shape (x, y points, counter-clockwise) given thickness along +Z."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for x, y in pts2d]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=(0, 0, thickness), verts=[e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_object(name, bm, m, c, bevel, segs, loc=loc, rot=rot)


def rounded_rect(w, h, r, n=8):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def light(name, kind, loc, c, color, power, size=0.1, rot=(0, 0, 0), size_y=None, spot=None, soft=None):
    d = bpy.data.lights.new(name, kind)
    d.color = srgb(color)[:3] if isinstance(color, str) else color
    d.energy = power
    if kind == 'AREA':
        d.size = size
        if size_y:
            d.shape = 'RECTANGLE'
            d.size_y = size_y
    elif kind in ('POINT', 'SPOT'):
        d.shadow_soft_size = size
        if spot:
            d.spot_size = math.radians(spot)
            d.spot_blend = 0.5
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = rot
    # the lamps shape the light; what the camera sees glowing are the emissive meshes
    o.visible_camera = False
    c.objects.link(o)
    return o


def empty(name, loc, c, yaw=0.0, size=0.2):
    """A marker. Its +Z after glTF export is Blender's -Y at yaw 0 (facing the open side)."""
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = 'SINGLE_ARROW'
    o.empty_display_size = size
    o.location = loc
    # The arrow (local +Z) points along the facing; exported glTF keeps the empty's rotation.
    o.rotation_euler = (math.radians(90), 0, yaw)
    c.objects.link(o)
    return o


print('living-room lib ready')
