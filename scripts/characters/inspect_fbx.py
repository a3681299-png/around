# Prints what a character FBX holds, as JSON: armature bones (with parents), meshes (triangles,
# shape keys, materials, vertex groups) and images. Used before converting a model to VRM.
#   blender -b --factory-startup --python scripts/characters/inspect_fbx.py -- <model.fbx> [out.json]
import bpy, json, sys

argv = sys.argv[sys.argv.index("--") + 1 :]
src = argv[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    bpy.ops.import_scene.fbx(filepath=src)

report = {"armatures": [], "meshes": [], "images": [], "actions": [a.name for a in bpy.data.actions]}
for ob in bpy.data.objects:
    if ob.type == "ARMATURE":
        report["armatures"].append(
            {
                "name": ob.name,
                "bones": [
                    {"name": b.name, "parent": b.parent.name if b.parent else None,
                     "head": [round(v, 4) for v in (ob.matrix_world @ b.head_local)]}
                    for b in ob.data.bones
                ],
            }
        )
    elif ob.type == "MESH":
        me = ob.data
        me.calc_loop_triangles()
        report["meshes"].append(
            {
                "name": ob.name,
                "triangles": len(me.loop_triangles),
                "vertices": len(me.vertices),
                "shape_keys": [k.name for k in me.shape_keys.key_blocks] if me.shape_keys else [],
                "materials": [m.name if m else None for m in me.materials],
                "vertex_groups": len(ob.vertex_groups),
                "dimensions": [round(v, 4) for v in ob.dimensions],
            }
        )
for img in bpy.data.images:
    report["images"].append({"name": img.name, "size": list(img.size), "file": img.filepath})

text = json.dumps(report, ensure_ascii=False, indent=1)
if len(argv) > 1:
    open(argv[1], "w", encoding="utf8").write(text)
else:
    print(text)
