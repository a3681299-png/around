# Cleans the user's Tripo models into art/living-room/models/<id>.glb, which the room imports
# (reference_models.py). Run once whenever a source model changes, headless only (it resets the
# Blender file between models, so never run it inside a live MCP session holding the room):
#   blender -b --factory-startup --python scripts/living-room/prepare_models.py
# Environment: WW_TRIPO_SRC = folder of the first raw Tripo GLBs (default C:/wwt-private/room/source)
#              WW_TRIPO_NEW = folder of the second set (default C:/wwt_room_work/src)
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
# The second set of models (2026-11-13) is in NEW. Tripo names those files
# "A faithful … #<n>.glb", so they are found by their number (`new`).
NEW = (os.environ.get('WW_TRIPO_NEW') or 'C:/wwt_room_work/src').rstrip('/\\') + '/'
MODELS = {
    # width: metres across (X) of the real thing, where that is the known measure.
    'workstation': dict(new=112, width=2.0, tex=2048, screens=True),
    'chair': dict(new=114, height=1.22, tex=1024),
    'storage': dict(new=115, height=2.2, tex=2048),
    # lift: Tripo printed its own dim studio shading into the colours.
    'rack': dict(new=109, height=1.6, tex=2048, lift=1.1),
    # The page lets a body sink into surfaces whose material is named duvet/sheet/pillow
    # (src/living-room/index.ts): the whole bed is one such material.
    'bed': dict(new=118, height=1.53, tex=2048, material='duvet_bed'),
    'nightstand': dict(new=120, height=.89, tex=1024),
    'table': dict(new=105, height=.575, tex=1024),
    'cart': dict(new=107, height=.88, tex=1024),
    # A sheet of separate floor things: split into its loose items (most triangles first), each
    # sized by its largest dimension and written into one file that shares one texture.
    'floor_items': dict(new=99, tex=2048, items=[
        ('plant', .30), ('laptop', .36), ('pedals', .42), ('amp', .42), ('cable', .30),
        ('spiral_pad', .30), ('magazine_box', .33), ('books_colour', .26), ('open_sketchbook', .42),
        ('books_dark', .26), ('binder_black', .30), ('binder_blue', .31), ('books_art', .25),
        ('pads_white', .30)]),
    'dark_shelf': dict(file='dark bookshelf 3d model.glb', height=2.3, tex=2048),
    'backpack': dict(file='khaki backpack 3d model.glb', height=.52, tex=1024),
}


def source(cfg):
    if 'new' in cfg:
        import glob
        found = glob.glob(NEW + '*#' + str(cfg['new']) + '.glb')
        if len(found) != 1:
            raise RuntimeError('expected one model #%s in %s, found %d' % (cfg['new'], NEW, len(found)))
        return found[0]
    return SRC + cfg['file']


def split_items(o, names):
    """The loose parts of `o`, grouped where their boxes come within 2 cm, as objects of their
    own: origin on the floor under the centre, largest dimension as asked."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    label = [-1] * len(bm.faces)
    boxes = []
    for f0 in bm.faces:
        if label[f0.index] >= 0:
            continue
        k = len(boxes)
        stack = [f0]
        label[f0.index] = k
        lo, hi = Vector((9, 9, 9)), Vector((-9, -9, -9))
        while stack:
            f = stack.pop()
            for v in f.verts:
                lo = Vector(map(min, lo, v.co))
                hi = Vector(map(max, hi, v.co))
            for e in f.edges:
                for g in e.link_faces:
                    if label[g.index] < 0:
                        label[g.index] = k
                        stack.append(g)
        boxes.append((lo, hi))
    parent = list(range(len(boxes)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(boxes)):
        for j in range(i):
            a, b = boxes[i], boxes[j]
            if all(a[0][k] - .02 <= b[1][k] and b[0][k] - .02 <= a[1][k] for k in range(3)):
                parent[find(i)] = find(j)
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(label[f.index]), []).append(f.index)
    bm.free()
    order = sorted(groups, key=lambda r: -len(groups[r]))
    if len(order) != len(names):
        raise RuntimeError('expected %d items, found %d' % (len(names), len(order)))
    for root, (name, size) in zip(order, names):
        sub = bmesh.new()
        sub.from_mesh(o.data)
        sub.faces.ensure_lookup_table()
        keep = set(groups[root])
        bmesh.ops.delete(sub, geom=[f for f in sub.faces if f.index not in keep], context='FACES')
        me = bpy.data.meshes.new('item_' + name)
        sub.to_mesh(me)
        sub.free()
        me.materials.append(o.data.materials[0])
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        lo, hi = co.min(0), co.max(0)
        s = size / (hi - lo).max()
        me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
        for p in me.polygons:
            p.use_smooth = True
        bpy.context.scene.collection.objects.link(bpy.data.objects.new('item_' + name, me))
        print('item', name, 'size', tuple(round(v * s, 3) for v in hi - lo), 'tris', len(keep))
    bpy.data.objects.remove(o, do_unlink=True)


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
    m.name = cfg.get('material', key)


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
                    # (Loose enough for a panel Tripo left a little wavy.)
                    if g.index in glow or g.normal.dot(n0) < .93 or abs(n0.dot(g.calc_center_median()) - d0) > .012:
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
    o = load(source(cfg))
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
    if cfg.get('items'):
        split_items(o, cfg['items'])
    else:
        # Origin at the floor under the centre, real size.
        co = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        lo, hi = co.min(0), co.max(0)
        s = cfg['width'] / (hi[0] - lo[0]) if cfg.get('width') else cfg['height'] / (hi[2] - lo[2])
        o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
        for p in o.data.polygons:
            p.use_smooth = True
        print(key, 'size', tuple(round(v, 3) for v in o.dimensions), 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))
    bpy.ops.export_scene.gltf(filepath=OUT + key + '.glb', export_format='GLB', export_image_format='JPEG',
                              export_jpeg_quality=88, export_normals=True, export_texcoords=True,
                              export_materials='EXPORT', export_animations=False, export_yup=True)
    os.remove(OUT + key + '_basecolor.jpg')
print('models prepared', OUT)
