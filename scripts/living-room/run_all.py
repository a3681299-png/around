# Rebuilds the reference room in Blender MCP, or with the same script headlessly:
#   blender -b --python scripts/living-room/run_all.py
# Environment (all optional):
#   AROUND_SAVE=<path.blend>   save the built room here (default: art/living-room/living-room.blend)
#   AROUND_RENDER=<path.png>   also render camera_main there (Cycles, AROUND_RENDER_SAMPLES, default 128)
#   AROUND_SKIP_BAKE=1         stop before the bake (no GLB/lightmap written)
#   AROUND_OUT=<dir>           where the bake writes room.glb, lightmap.png, room.json
#   AROUND_LM_SIZE / AROUND_SAMPLES / AROUND_VC_SAMPLES   bake quality (4096 / 128 / 128 for the committed room)
# The parts are the numbered scripts next to this file; each one wipes and rebuilds its collection.
import bpy, os, builtins

# The parts share this namespace and use short names of their own (20_desk.py makes `D`, the desk,
# 55_right.py makes `G`, the dresser): everything this runner needs starts with an underscore.
_DIR = os.path.dirname(os.path.abspath(__file__)) + os.sep
_ART = os.path.normpath(_DIR + '../../art/living-room') + os.sep
_NS = globals()
_NS['AROUND_DIR'] = _DIR
builtins.AROUND_DIR = _DIR


def around_run(name):
    exec(compile(open(_DIR + name, encoding='utf-8').read(), name, 'exec'), _NS)


_NS['around_run'] = around_run
builtins.around_run = around_run

# a clean scene: the parts rebuild everything they need (camera, world, lights)
for _o in list(bpy.data.objects):
    bpy.data.objects.remove(_o, do_unlink=True)
for _c in list(bpy.data.collections):
    bpy.data.collections.remove(_c)
# A rebuild in a live MCP session must not accumulate orphan meshes and packed images.
bpy.data.orphans_purge(do_recursive=True)

# Cycles on whatever GPU there is (the bake and the render need it); the CPU otherwise
try:
    _prefs = bpy.context.preferences.addons['cycles'].preferences
    for _kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            _prefs.compute_device_type = _kind
            _prefs.get_devices()
            if any(_d.type != 'CPU' for _d in _prefs.devices):
                for _d in _prefs.devices:
                    _d.use = _d.type != 'CPU'
                break
        except Exception:
            continue
except Exception as _error:
    print('no GPU setup:', _error)

for _part in ('lib.py', 'reference_common.py', 'reference_shell.py', 'reference_storage.py',
              'reference_desk.py', 'reference_bed.py', 'reference_props.py', 'reference_models.py',
              'reference_otaku.py', 'reference_lighting.py', 'reference_meta.py'):
    around_run(_part)

_sc = bpy.context.scene
for _name in ('shell', 'desk', 'bed', 'left', 'decor', 'right', 'otaku'):
    bpy.data.collections[_name].hide_render = False

# Blender resolves a relative image path from the drive's root, not from where it was started
# (a render or a lightmap asked for as `art/…` lands in C:/art/…): every path is made absolute.
_save = os.path.abspath(os.environ.get('AROUND_SAVE') or _ART + 'living-room.blend')
_render = os.environ.get('AROUND_RENDER') and os.path.abspath(os.environ['AROUND_RENDER'])
if _render:
    # The page's own view (src/living-room/index.ts VIEW and SUBJECT): from the open front at eye
    # height. camera_main, the old look down on the cutaway, now only sees the ceiling.
    # AROUND_RENDER_VIEW="x,y,z,tx,ty,tz,fov" looks from somewhere else (Blender's axes, degrees);
    # several views separated by ";" are written as <name>.png, <name>-1.png, …
    _views = [[float(_x) for _x in _one.split(',')]
              for _one in (os.environ.get('AROUND_RENDER_VIEW') or '.1,-5.6,1.7,-.05,1,.95,42').split(';')]
    _eye = bpy.data.objects.new('camera_review', bpy.data.cameras.new('camera_review'))
    _sc.collection.objects.link(_eye)
    _eye.data.sensor_fit = 'VERTICAL'
    _eye.data.clip_start = .02
    _eye.data.clip_end = 80
    _main, _size = _sc.camera, (_sc.render.resolution_x, _sc.render.resolution_y)
    _sc.camera = _eye
    # As the room stands with the desktop closed: without the glow of the page's windows.
    for _o in bpy.data.collections['lights'].objects:
        _o.hide_render = _o.get('layer') == 'ui'
    _sc.render.resolution_x, _sc.render.resolution_y = 1280, 720
    _sc.cycles.samples = int(os.environ.get('AROUND_RENDER_SAMPLES', '128'))
    _sc.render.resolution_percentage = 100
    for _i, _v in enumerate(_views):
        _eye.location = _v[:3]
        _eye.rotation_euler = (Vector(_v[3:6]) - _eye.location).to_track_quat('-Z', 'Y').to_euler()
        _eye.data.angle_y = math.radians(_v[6])
        _sc.render.filepath = _render if not _i else _render.rsplit('.', 1)[0] + '-' + str(_i) + '.png'
        bpy.ops.render.render(write_still=True)
    _sc.camera = _main
    _sc.render.resolution_x, _sc.render.resolution_y = _size
    bpy.data.cameras.remove(_eye.data)

if os.environ.get('AROUND_SKIP_BAKE') != '1':
    for _key in ('AROUND_LM_SIZE', 'AROUND_SAMPLES', 'AROUND_VC_SAMPLES'):
        if os.environ.get(_key):
            _NS[_key] = int(os.environ[_key])
    if os.environ.get('AROUND_OUT'):
        _NS['AROUND_OUT'] = os.path.abspath(os.environ['AROUND_OUT']).rstrip('/\\') + '/'
    around_run('80_bake.py')

# Rebuilds are reproducible from these scripts; Blender's backup would duplicate the large asset.
for _o in bpy.data.collections['lighting_baffles'].objects:
    _o.hide_set(True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=_save, compress=True)
print('run_all done', _save)
