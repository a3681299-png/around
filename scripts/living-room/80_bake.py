# Bakes the room's light and writes the web files. Needs every part built.
#   static_lm  : big surfaces, light in a texture (their only UV); written to <out>/lightmap.png
#   static_vc  : everything else, light in vertex colours (COLOR_0)
#   dyn_*      : light sources and screens, exported with their own colours, never baked
# Web colour = baked colour x LIGHT_SCALE (see room.json). The source objects keep their
# modifiers; the baked copies live in the `bake` collection and are rebuilt every run.
import numpy as np, json, os, time

OUT = globals().get('WW_OUT') or (WWD + '../../art/living-room/web/')
LM_SIZE = globals().get('WW_LM_SIZE', 4096)
SAMPLES = globals().get('WW_SAMPLES', 128)
VC_SAMPLES = globals().get('WW_VC_SAMPLES', 128)
LIGHT_SCALE = 4.0
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
BK = wipe('bake')
BK.hide_render = False  # the last run left the baked copies hidden from renders
SRC = ['shell', 'desk', 'bed', 'left', 'decor', 'right']
for n in SRC:
    coll(n).hide_render = False
dg = bpy.context.evaluated_depsgraph_get()
groups = {'lm': [], 'vc': [], 'dyn': [], 'pbr': []}
for n in SRC:
    for o in coll(n).objects:
        if o.type not in ('MESH', 'CURVE'):
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        if o.matrix_world.determinant() < 0:
            me.flip_normals()
        c = bpy.data.objects.new('b_' + o.name, me)
        # Background views through glass must keep transmitting the authored window light.
        # new_from_object copies geometry only, so it otherwise restores opaque bake shadows.
        c.visible_shadow = o.visible_shadow
        BK.objects.link(c)
        key = 'pbr' if o.name.startswith('pbr_') else 'dyn' if o.name.startswith('dyn_') else 'lm' if o.get('lm') else 'vc'
        c['src'] = o.name
        groups[key].append(c)


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name
    j.data.name = name
    return j


keep = ('dyn_monitor_screen', 'dyn_monitor2_screen', 'dyn_window_sky')
dyn_keep = [o for o in groups['dyn'] if o['src'] in keep]
# the baked copy takes the engine's name; the source keeps it under a `src_` prefix until the end
renamed = []
for o in dyn_keep:
    src = bpy.data.objects[o['src']]
    src.name = 'src_' + o['src']
    o.name = o['src']
    renamed.append((src, o['src'], o))
dyn_rest = [o for o in groups['dyn'] if o['src'] not in keep]
for o in groups['dyn']:
    # the sky's gradient is its vertex colour: make it the one the exporter writes
    if o.data.color_attributes:
        o.data.color_attributes.active_color = o.data.color_attributes[0]
        o.data.color_attributes.render_color_index = 0
lm = join(groups['lm'], 'static_lm')
vc = join(groups['vc'], 'static_vc')
em = join(dyn_rest, 'dyn_emissive')
reflective = join(groups['pbr'], 'pbr_reflective') if groups['pbr'] else None
print('tris lm/vc/em', *[sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (lm, vc, em)])

# hide the sources while baking so nothing is doubled
for n in SRC:
    coll(n).hide_render = True

# metals have no diffuse light to bake: bake them as plain surfaces, then put the values back
metal = {}
for m in bpy.data.materials:
    if m.use_nodes:
        p = m.node_tree.nodes.get('Principled BSDF')
        if p and p.inputs['Metallic'].default_value > 0:
            metal[m.name] = p.inputs['Metallic'].default_value
            p.inputs['Metallic'].default_value = 0

sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.use_denoising = True
# Baking is not denoised, and the tiny emitters (bulbs, LEDs, neon tubes) are what make it
# sparkle. Each of them has a lamp standing in for it (60_lights.py), so their meshes do not light
# the bake; the screens and the sky are large enough to stay. Fireflies are clamped as well.
em.visible_diffuse = False
em.visible_glossy = False
clamps = (sc.cycles.sample_clamp_direct, sc.cycles.sample_clamp_indirect)
sc.cycles.sample_clamp_direct = 12
sc.cycles.sample_clamp_indirect = 4
bs = sc.render.bake
sc.cycles.bake_type = 'DIFFUSE'
bs.use_pass_direct = True
bs.use_pass_indirect = True
bs.use_pass_color = False
bs.use_selected_to_active = False
bs.use_clear = True


def only(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# --- the lightmap ---
only(lm)
for uv in list(lm.data.uv_layers):
    lm.data.uv_layers.remove(uv)
lm.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')
img = bpy.data.images.get('ww_lightmap')
if img:
    bpy.data.images.remove(img)
img = bpy.data.images.new('ww_lightmap', LM_SIZE, LM_SIZE, alpha=False, float_buffer=True)
img.colorspace_settings.name = 'Non-Color'
tmp_nodes = []
for m in lm.data.materials:
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = img
    m.node_tree.nodes.active = n
    tmp_nodes.append((m, n))
sc.cycles.samples = SAMPLES
bs.target = 'IMAGE_TEXTURES'
bs.margin = 8
t = time.time()
bpy.ops.object.bake(type='DIFFUSE')
print('lightmap baked s', round(time.time() - t, 1))
for m, n in tmp_nodes:
    m.node_tree.nodes.remove(n)
px = np.array(img.pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
rgb = px[:, :, :3].copy()

# Bake the material separately: denoising irradiance must not erase the wood grain and weave.
tmp_nodes = []
for m in lm.data.materials:
    node = m.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    m.node_tree.nodes.active = node
    tmp_nodes.append((m, node))
bs.use_pass_direct = bs.use_pass_indirect = False
bs.use_pass_color = True
sc.cycles.samples = 1
bpy.ops.object.bake(type='DIFFUSE')
albedo = np.array(img.pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
for m, node in tmp_nodes:
    m.node_tree.nodes.remove(node)
wwrun('denoise.py')
guide = np.repeat((albedo[:, :, :3].max(axis=2) > 0)[:, :, None], 3, axis=2).astype(np.float32)
rgb = denoise_atlas(rgb, guide, OUT) * albedo[:, :, :3]
light = np.clip(rgb / LIGHT_SCALE, 0, 1)
print('lightmap max', float(rgb.max()), 'p99.9', float(np.percentile(rgb, 99.9)))
enc = np.where(light <= 0.0031308, light * 12.92, 1.055 * np.power(light, 1 / 2.4) - 0.055)
out = bpy.data.images.new('ww_lightmap_png', LM_SIZE, LM_SIZE, alpha=False)
rgba = np.ones((LM_SIZE, LM_SIZE, 4), dtype=np.float32)
rgba[:, :, :3] = enc
out.pixels.foreach_set(rgba.ravel())
out.filepath_raw = OUT + 'lightmap.png'
out.file_format = 'PNG'
out.save()
bpy.data.images.remove(out)

# --- vertex light ---
only(vc)
for a in list(vc.data.color_attributes):
    vc.data.color_attributes.remove(a)
# per vertex, not per corner: corners would split every vertex in the file (40 MB instead of ~10)
ca = vc.data.color_attributes.new('Light', 'FLOAT_COLOR', 'POINT')
vc.data.color_attributes.active_color = ca
vc.data.color_attributes.render_color_index = 0
sc.cycles.samples = VC_SAMPLES
bs.use_pass_direct = bs.use_pass_indirect = bs.use_pass_color = True
bs.target = 'VERTEX_COLORS'
t = time.time()
bpy.ops.object.bake(type='DIFFUSE')
print('vertex light baked s', round(time.time() - t, 1))
ca = vc.data.color_attributes['Light']
arr = np.zeros(len(ca.data) * 4, dtype=np.float32)
ca.data.foreach_get('color', arr)
arr = arr.reshape(-1, 4)
print('vertex light max', float(arr[:, :3].max()), 'mean', float(arr[:, :3].mean()))
# smooth the grain along the mesh: each vertex moves halfway to the mean of its neighbours, four times
ne = len(vc.data.edges)
ev = np.zeros(ne * 2, dtype=np.int32)
vc.data.edges.foreach_get('vertices', ev)
ev = ev.reshape(-1, 2)
for _ in range(4):
    acc = np.zeros((len(arr), 3), dtype=np.float64)
    cnt = np.zeros(len(arr), dtype=np.float64)
    np.add.at(acc, ev[:, 0], arr[ev[:, 1], :3])
    np.add.at(acc, ev[:, 1], arr[ev[:, 0], :3])
    np.add.at(cnt, ev[:, 0], 1)
    np.add.at(cnt, ev[:, 1], 1)
    has = cnt > 0
    arr[has, :3] = (arr[has, :3] + acc[has] / cnt[has, None]) / 2
arr[:, :3] = np.clip(arr[:, :3] / LIGHT_SCALE, 0, 1)
arr[:, 3] = 1
ca.data.foreach_set('color', arr.ravel())
vc.data.update()

sc.cycles.sample_clamp_direct, sc.cycles.sample_clamp_indirect = clamps
for name, v in metal.items():
    bpy.data.materials[name].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = v

# --- export ---
for o in bpy.context.selected_objects:
    o.select_set(False)
exp = [lm, vc, em] + ([reflective] if reflective else []) + dyn_keep + [o for o in coll('meta_marks').objects] + [bpy.data.objects['camera_main']]
nav = bpy.data.objects['navmesh_floor']
for o in exp:
    o.hide_set(False)
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT + 'room.glb', export_format='GLB', use_selection=True, export_apply=False,
    export_yup=True, export_cameras=True, export_extras=False, export_lights=False,
    export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='NONE',
    export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
    export_animations=False, export_skins=False, export_morph=False)
for src, name, copy in renamed:
    copy.name = 'b_' + name
    src.name = name
for n in SRC:
    coll(n).hide_render = False
BK.hide_render = True
cam = bpy.data.objects['camera_main']
manifest = {'version': 1, 'bakedColor': True, 'lightScale': LIGHT_SCALE, 'lightmap': 'lightmap.png', 'lightmapMesh': 'static_lm',
            'vertexLightMesh': 'static_vc', 'camera': 'camera_main',
            'sensorWidth': cam.data.sensor_width, 'lens': cam.data.lens, 'aspect': sc.render.resolution_x / sc.render.resolution_y}
# Keep generated JSON stable across Python, Prettier and Windows line endings.
manifest = {key: int(value) if isinstance(value, float) and value.is_integer() else value for key, value in manifest.items()}
with open(OUT + 'room.json', 'w', encoding='utf-8', newline='\n') as manifest_file:
    json.dump(manifest, manifest_file, indent=2)
    manifest_file.write('\n')
print('exported', os.path.getsize(OUT + 'room.glb'), os.path.getsize(OUT + 'lightmap.png'))
