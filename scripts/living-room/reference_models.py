# Places the user's cleaned Tripo models (art/living-room/models, made by prepare_models.py).
# Each model keeps its own colour texture: it is named `tex_*`, so the bake gives it vertex
# light only and the web multiplies that light by the texture (80_bake.py, src/living-room).
# Screens on the workstation are split off as `dyn_*` so they glow and are never baked.
MODEL_DIR = os.path.normpath(WWD + '../../art/living-room/models') + os.sep
# key: (collection, location, rotation about Z in degrees). Every model's front is -Y, origin
# on the floor under its centre, real size.
PLACES = {
    'workstation': ('desk', (-.30, 1.77, 0), 0),
    # The separate executive chair replaces the small task chair Tripo fused to the desk.
    'chair': ('desk', (-.45, .72, 0), 180),
    'dark_shelf': ('left', (-1.92, 2.47, 0), 0),
    'storage': ('left', (-2.80, -.30, 0), 90),
    'floorset': ('decor', (-.10, -.95, 0), 0),
    'rack': ('right', (2.31, -2.42, 0), 0),
    'backpack': ('right', (-2.40, -1.05, 0), 62),
}
SCREEN_GLOW = 2.4


def place_model(key, collection, loc, yaw):
    c = coll(collection)
    for name in ('tex_' + key, 'dyn_' + key + '_screen'):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
        if name in bpy.data.meshes and bpy.data.meshes[name].users == 0:
            bpy.data.meshes.remove(bpy.data.meshes[name])
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=MODEL_DIR + key + '.glb')
    new = [o for o in bpy.data.objects if o not in before]
    o = next(x for x in new if x.type == 'MESH')
    o.data.transform(o.matrix_world)
    o.parent = None
    for x in new:
        if x is not o:
            bpy.data.objects.remove(x, do_unlink=True)
    for x in list(o.users_collection):
        x.objects.unlink(o)
    c.objects.link(o)
    o.name = o.data.name = 'tex_' + key
    o.matrix_world = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')
    # a rebuild in a live session imports again: the material may come back as `<key>_screen.001`
    screen = next((i for i, m in enumerate(o.data.materials) if m.name.split('.')[0].endswith('_screen')), None)
    if screen is None:
        return o, None
    # split the glowing faces into their own object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    glow = bmesh.new()
    glow.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == screen], context='FACES')
    bmesh.ops.delete(glow, geom=[f for f in glow.faces if f.material_index != screen], context='FACES')
    me = bpy.data.meshes.new('dyn_' + key + '_screen')
    glow.to_mesh(me)
    bm.to_mesh(o.data)
    bm.free()
    glow.free()
    m = o.data.materials.pop(index=screen)
    for p in me.polygons:
        p.material_index = 0
    me.materials.append(m)
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    nt.links.new(t.outputs['Color'], p.inputs['Emission Color'])
    p.inputs['Emission Strength'].default_value = SCREEN_GLOW
    s = bpy.data.objects.new(me.name, me)
    c.objects.link(s)
    s.matrix_world = o.matrix_world.copy()
    return o, s


MODEL_OBJECTS = {}
SCREEN_OBJECTS = {}
for _key, (_c, _loc, _yaw) in PLACES.items():
    MODEL_OBJECTS[_key], _screen = place_model(_key, _c, _loc, _yaw)
    if _screen:
        SCREEN_OBJECTS[_key] = _screen


def screen_panels(o):
    """The connected display patches, for the monitor lights (reference_lighting.py):
    (centre, width, height, facing, area) in world space, largest first."""
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(mw)
    # the glTF import split the vertices along UV seams again
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        patch, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            patch.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        area = sum(f.calc_area() for f in patch)
        n = sum((f.normal * f.calc_area() for f in patch), Vector()).normalized()
        pts = [v.co for f in patch for v in f.verts]
        centre = sum(pts, Vector()) / len(pts)
        # extent along the panel's own horizontal and up axes
        side = n.cross(Vector((0, 0, 1))).normalized()
        up = side.cross(n).normalized()
        w = max(p.dot(side) for p in pts) - min(p.dot(side) for p in pts)
        h = max(p.dot(up) for p in pts) - min(p.dot(up) for p in pts)
        out.append((centre, w, h, n, area))
    bm.free()
    return sorted(out, key=lambda r: -r[4])


PANELS = screen_panels(SCREEN_OBJECTS['workstation'])
for _p in PANELS:
    print('screen panel', tuple(round(v, 3) for v in _p[0]), 'w', round(_p[1], 3), 'h', round(_p[2], 3), 'n', tuple(round(v, 2) for v in _p[3]), 'area', round(_p[4], 4))
print('reference models ready', len(MODEL_OBJECTS))
