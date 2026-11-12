# Rebuilds the reference room in Blender MCP, or with the same script headlessly:
#   blender -b --python scripts/living-room/run_all.py
# Environment (all optional):
#   WW_SAVE=<path.blend>   save the built room here (default: art/living-room/living-room.blend)
#   WW_RENDER=<path.png>   also render camera_main there (Cycles, WW_RENDER_SAMPLES, default 128)
#   WW_SKIP_BAKE=1         stop before the bake (no GLB/lightmap written)
#   WW_OUT=<dir>           where the bake writes room.glb, lightmap.png, room.json
#   WW_LM_SIZE / WW_SAMPLES / WW_VC_SAMPLES   bake quality (4096 / 128 / 128 for the committed room)
# The parts are the numbered scripts next to this file; each one wipes and rebuilds its collection.
import bpy, os, builtins

# The parts share this namespace and use short names of their own (20_desk.py makes `D`, the desk,
# 55_right.py makes `G`, the dresser): everything this runner needs starts with an underscore.
_DIR = os.path.dirname(os.path.abspath(__file__)) + os.sep
_ART = os.path.normpath(_DIR + '../../art/living-room') + os.sep
_NS = globals()
_NS['WWD'] = _DIR
builtins.WWD = _DIR


def wwrun(name):
    exec(compile(open(_DIR + name, encoding='utf-8').read(), name, 'exec'), _NS)


_NS['wwrun'] = wwrun
builtins.wwrun = wwrun

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
              'reference_lighting.py', 'reference_meta.py'):
    wwrun(_part)

_sc = bpy.context.scene
for _name in ('shell', 'desk', 'bed', 'left', 'decor', 'right'):
    bpy.data.collections[_name].hide_render = False

_save = os.environ.get('WW_SAVE') or _ART + 'living-room.blend'
_render = os.environ.get('WW_RENDER')
if _render:
    _sc.cycles.samples = int(os.environ.get('WW_RENDER_SAMPLES', '128'))
    _sc.render.resolution_percentage = 100
    _sc.render.filepath = _render
    bpy.ops.render.render(write_still=True)

if os.environ.get('WW_SKIP_BAKE') != '1':
    for _key in ('WW_LM_SIZE', 'WW_SAMPLES', 'WW_VC_SAMPLES'):
        if os.environ.get(_key):
            _NS[_key] = int(os.environ[_key])
    if os.environ.get('WW_OUT'):
        _NS['WW_OUT'] = os.environ['WW_OUT'].rstrip('/\\') + '/'
    wwrun('80_bake.py')

# Rebuilds are reproducible from these scripts; Blender's backup would duplicate the large asset.
for _o in bpy.data.collections['lighting_baffles'].objects:
    _o.hide_set(True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=_save, compress=True)
print('run_all done', _save)
