# Cleans the user's Tripo models into art/living-room/models/<id>.glb, which the room imports
# (reference_models.py). Run once whenever a source model changes, headless only (it resets the
# Blender file between models, so never run it inside a live MCP session holding the room):
#   blender -b --factory-startup --python scripts/living-room/prepare_models.py
# Environment: WW_TRIPO_SRC = folder of the raw Tripo GLBs (default C:/wwt-private/room/source)
#              WW_ONLY=id,id  limits the run to those models
# The raw GLBs stay outside the repository; only the cleaned results are committed (LFS).
import bpy, bmesh, os, numpy as np
from mathutils import Vector, Matrix

_HERE = os.path.dirname(os.path.abspath(globals().get('__file__') or (WWD + 'prepare_models.py')))
SRC = (os.environ.get('WW_TRIPO_SRC') or 'C:/wwt-private/room/source').rstrip('/\\') + '/'
OUT = os.path.normpath(_HERE + '/../../art/living-room/models') + os.sep
os.makedirs(OUT, exist_ok=True)

# drop: boxes (min, max) in the raw model's own 1 m frame; a welded part whose faces all lie
#   inside one box is removed.
# height: metres of the real thing. tex: texture size in the room (from 4096).
# snap: straighten wavy outer panels – vertices within `eps` of a bound move onto it.
# inpaint: (box, luminance) – bright print inside the box is painted with the cloth around it.
MODELS = {
    'workstation': dict(file='design workstation 3d model.glb', height=.89 * 2.1, tex=2048,
                        # the bundled task chair (seat, arms, base) and a stray 6-face sliver;
                        # the room uses the separate chair model at this desk
                        drop=[((-.48, -.37, 0), (-.17, -.03, .31)), ((.09, -.23, .22), (.14, -.21, .26))],
                        screens=True),
    'chair': dict(file='chair.glb', height=1.18, tex=1024),
    'floorset': dict(file='desk setup 3d model.glb', height=.377 * 3.6, tex=2048),
    'storage': dict(file='storage bookshelf 3d model.glb', height=.958 * 2.3, tex=2048,
                    # three loose stickers float in front of the wall
                    drop=[((-.43, .03, .88), (-.37, .05, .91)), ((-.31, .03, .72), (-.24, .05, .75)),
                          ((.38, -.02, .67), (.40, .04, .70))]),
    'dark_shelf': dict(file='dark bookshelf 3d model.glb', height=2.3, tex=2048),
    # lift: Tripo printed its own dim studio shading into the colours; the white rack and its
    # clothes read as black in the dark front corner of the room without it.
    'rack': dict(file='clothing rack 3d model.glb', height=1.5, tex=2048, lift=1.45,
                 # brand marks on the top bags (outdoor duffel, tennis bag): paint them out
                 inpaint=[((-.40, -.20, .86), (-.05, .20, 1.0), .38), ((.05, -.20, .78), (.45, .20, 1.0), .38)]),
    'backpack': dict(file='khaki backpack 3d model.glb', height=.52, tex=1024),
}


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type == 'MESH')
    mesh.data.transform(mesh.matrix_world)
    mesh.parent = None
    mesh.matrix_world = Matrix()
    for o in new:
        if o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    return mesh


def weld_and_drop(o, boxes):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # glTF splits vertices along UV seams; weld them so parts follow the real surface
    # (UVs live on the corners and are kept).
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    part = [-1] * len(bm.faces)
    parts = []
    for f in bm.faces:
        if part[f.index] >= 0:
            continue
        stack, members = [f], []
        part[f.index] = len(parts)
        while stack:
            x = stack.pop()
            members.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if part[g.index] < 0:
                        part[g.index] = len(parts)
                        stack.append(g)
        parts.append(members)
    gone = []
    for members in parts:
        centres = [f.calc_center_median() for f in members]
        for lo, hi in boxes:
            if all(lo[i] <= c[i] <= hi[i] for c in centres for i in range(3)):
                gone += members
                break
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    return len(gone)


def snap(o, axis, eps):
    i = 'xyz'.index(axis)
    co = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    lo, hi = co[:, i].min(), co[:, i].max()
    moved = 0
    for edge, near in ((lo, co[:, i] < lo + eps), (hi, co[:, i] > hi - eps)):
        co[near, i] = edge
        moved += int(near.sum())
    o.data.vertices.foreach_set('co', co.ravel())
    o.data.update()
    return moved


def blur(a, r):
    """Three box passes, a close Gaussian, separable in both axes (no SciPy in Blender)."""
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if k == axis else (0, 0) for k in range(a.ndim)], mode='edge'), axis=axis)
            a = (np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def face_mask(o, box, size):
    """Texels covered by the faces inside `box` (raw frame), for print removal."""
    me = o.data
    uv = me.uv_layers.active.data
    mask = np.zeros((size, size), dtype=bool)
    for p in me.polygons:
        c = p.center
        if not all(box[0][i] <= c[i] <= box[1][i] for i in range(3)):
            continue
        pts = np.array([uv[k].uv for k in p.loop_indices]) * size
        x0, y0 = np.floor(pts.min(0)).astype(int)
        x1, y1 = np.ceil(pts.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1] + .5
        a, b, d = pts[0], pts[1], pts[2]
        # barycentric inside test for the first triangle (Tripo exports triangles)
        v0, v1 = b - a, d - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        s = ((xx - a[0]) * v1[1] - v1[0] * (yy - a[1])) / den
        t = (v0[0] * (yy - a[1]) - (xx - a[0]) * v0[1]) / den
        inside = (s >= -.02) & (t >= -.02) & (s + t <= 1.02)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def clean_texture(o, key, cfg):
    m = o.data.materials[0]
    node = next(n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE')
    img = node.image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    for lo_hi_lum in cfg.get('inpaint', []):
        lo, hi, lum = lo_hi_lum
        mask = face_mask(o, (lo, hi), w)
        bright = mask & (px.max(axis=2) > lum)
        # grow the print by a few texels so anti-aliased edges go too
        bright = blur(bright.astype(np.float32), 3) > .02
        bright &= mask
        dark = mask & ~bright
        weight = blur(dark.astype(np.float32), 24)[:, :, None]
        fill = blur(px * dark[:, :, None], 24) / np.maximum(weight, 1e-4)
        px[bright] = fill[bright]
        print(key, 'painted out', int(bright.sum()), 'texels')
    # Down to the room's size by averaging (it also takes out Tripo's speckle), then restore
    # the edges of prints, stitching and spines with a light unsharp mask.
    f = w // cfg['tex']
    small = px.reshape(cfg['tex'], f, cfg['tex'], f, 3).mean(axis=(1, 3))
    small = np.clip(small + .55 * (small - blur(small, 2)), 0, 1)
    if cfg.get('lift'):
        # a gamma lift keeps blacks black and whites white while opening up the mid tones
        small = small ** (1 / cfg['lift'])
    out = bpy.data.images.new(key + '_basecolor', cfg['tex'], cfg['tex'], alpha=False)
    rgba = np.ones((cfg['tex'], cfg['tex'], 4), dtype=np.float32)
    rgba[:, :, :3] = small
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = OUT + key + '_basecolor.jpg'
    out.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    out.save()
    out.source = 'FILE'
    out.reload()
    node.image = out
    bpy.data.images.remove(img)
    m.name = key


def mark_screens(o, key):
    """Bright, display-facing faces become a second material `<key>_screen` (same texture);
    the room makes those glow and puts its monitor lights on them."""
    me = o.data
    m = me.materials[0]
    img = next(n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE').image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    uv = me.uv_layers.active.data
    sm = m.copy()
    sm.name = key + '_screen'
    me.materials.append(sm)
    seeds = []
    for p in me.polygons:
        # displays face the room (-Y) or tilt up toward it; never the underside of a tablet
        if p.center.z < .335 or p.normal.y > -.25 or p.normal.z < -.3:
            continue
        lum = np.mean([px[min(h - 1, int(uv[k].uv[1] * h)), min(w - 1, int(uv[k].uv[0] * w))].mean() for k in p.loop_indices])
        if lum > .42:
            seeds.append(p.index)
    # A bright texel test alone leaves the dark parts of each picture behind. Displays are flat:
    # grow every seed across the faces of its own plane (a dark bezel in that plane only glows
    # as dark as its texture).
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    glow = set()
    for s in seeds:
        if s in glow:
            continue
        f0 = bm.faces[s]
        n0, d0 = f0.normal.copy(), f0.normal.dot(f0.calc_center_median())
        stack = [f0]
        glow.add(s)
        while stack:
            f = stack.pop()
            for e in f.edges:
                for g in e.link_faces:
                    if g.index in glow or g.normal.dot(n0) < .97 or abs(g.normal.dot(g.calc_center_median()) - d0) > .006:
                        continue
                    glow.add(g.index)
                    stack.append(g)
    # Only real displays: drop connected patches smaller than 0.004 (raw frame, about
    # 13 x 13 cm in the room) – white speakers, the webcam and paper notes are bright too.
    kept, seen = set(), set()
    for i in glow:
        if i in seen:
            continue
        patch, stack = [], [bm.faces[i]]
        seen.add(i)
        while stack:
            f = stack.pop()
            patch.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index in glow and g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        if sum(f.calc_area() for f in patch) >= .004:
            kept.update(f.index for f in patch)
    bm.free()
    for i in kept:
        me.polygons[i].material_index = 1
    print(key, 'screen faces', len(kept), 'of', len(glow), 'from seeds', len(seeds))


only = set(filter(None, os.environ.get('WW_ONLY', '').split(',')))
for key, cfg in MODELS.items():
    if only and key not in only:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    o = load(SRC + cfg['file'])
    o.name = o.data.name = key
    if cfg.get('drop'):
        print(key, 'dropped faces', weld_and_drop(o, cfg['drop']))
    else:
        weld_and_drop(o, [])
    clean_texture(o, key, cfg)
    if cfg.get('screens'):
        mark_screens(o, key)
    if cfg.get('snap'):
        print(key, 'straightened vertices', snap(o, *cfg['snap']))
    # Origin at the floor under the centre, real size.
    co = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    s = cfg['height'] / (hi[2] - lo[2])
    o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
    for p in o.data.polygons:
        p.use_smooth = True
    print(key, 'size', tuple(round(v, 3) for v in o.dimensions), 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))
    bpy.ops.export_scene.gltf(filepath=OUT + key + '.glb', export_format='GLB', export_image_format='JPEG',
                              export_jpeg_quality=88, export_normals=True, export_texcoords=True,
                              export_materials='EXPORT', export_animations=False, export_yup=True)
    os.remove(OUT + key + '_basecolor.jpg')
print('models prepared', OUT)
