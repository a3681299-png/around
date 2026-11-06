# Converts a humanoid FBX (as extracted from a .unitypackage) into a VRM 1.0 with Blender and the
# VRM Add-on for Blender, from a JSON description that holds only names and numbers (no assets):
# the humanoid bone map, expressions from shape keys, MToon values in place of the Unity material,
# spring chains from bone names and their colliders. Unity's materials (lilToon) and PhysBones
# cannot be read, so the toon look is rebuilt from the textures and the springs from the bones.
#
#   blender -b --python scripts/characters/fbx_to_vrm.py -- <config.json> <model.fbx> <textures-dir> <out.vrm> [max-texture-px]
#
# max-texture-px overrides the config's material.maxTextureSize (a lighter variant).
# (Not --factory-startup: the VRM add-on must load.) Prints a JSON report (triangles, materials,
# textures, expressions, springs) as the last line, prefixed with "FBX_TO_VRM ".
import bpy, json, os, sys

argv = sys.argv[sys.argv.index("--") + 1 :]
config_path, fbx_path, texture_dir, out_path = argv[:4]
config = json.load(open(config_path, encoding="utf8"))

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx_path, **config.get("fbxImport", {}))

armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name not in config.get("dropMeshes", [])]
for o in [o for o in bpy.data.objects if o.type == "MESH" and o not in meshes]:
    bpy.data.objects.remove(o)
ext = armature.data.vrm_addon_extension
ext.spec_version = "1.0"
vrm1 = ext.vrm1

# --- Humanoid -------------------------------------------------------------------------------
bones = vrm1.humanoid.human_bones
missing = []
for vrm_name, source in config["humanoid"].items():
    if source not in armature.data.bones:
        missing.append(source)
        continue
    getattr(bones, vrm_name).node.bone_name = source
if missing:
    raise SystemExit(f"Bones not in the FBX: {missing}")

# --- Material: MToon rebuilt from the base color texture ------------------------------------
m = config["material"]
size = int(argv[4]) if len(argv) > 4 else m.get("maxTextureSize", 2048)
textures = {}


def image(name):
    if name in textures:
        return textures[name]
    img = bpy.data.images.load(os.path.join(texture_dir, name))
    if max(img.size) > size:
        # Above the budget (docs/characters): the GPU memory of a 4096 RGBA texture is 64MB.
        img.scale(size, size)
    img.pack()
    textures[name] = img
    return img


base = image(m["baseColor"])
materials = set()
for ob in meshes:
    for slot in ob.material_slots:
        if slot.material:
            materials.add(slot.material)
for mat in materials:
    mat.use_nodes = True
    mtoon = mat.vrm_addon_extension.mtoon1
    mtoon.enabled = True
    mtoon.pbr_metallic_roughness.base_color_texture.index.source = base
    mtoon.pbr_metallic_roughness.base_color_factor = m.get("baseColorFactor", [1, 1, 1, 1])
    mtoon.double_sided = m.get("doubleSided", False)
    toon = mtoon.extensions.vrmc_materials_mtoon
    toon.shade_multiply_texture.index.source = base
    toon.shade_color_factor = m["shadeColor"]
    toon.shading_shift_factor = m["shadingShift"]
    toon.shading_toony_factor = m["shadingToony"]
    if m.get("outlineWidth"):
        toon.outline_width_mode = "worldCoordinates"
        toon.outline_width_factor = m["outlineWidth"]
        toon.outline_color_factor = m["outlineColor"]
        toon.outline_lighting_mix_factor = m.get("outlineLightingMix", 1.0)
        if m.get("outlineMask"):
            toon.outline_width_multiply_texture.index.source = image(m["outlineMask"])

# --- Expressions from shape keys -------------------------------------------------------------
presets = vrm1.expressions.preset
bound = {}
for preset, binds in config["expressions"].items():
    expression = getattr(presets, preset)
    for mesh_name, key in binds:
        ob = bpy.data.objects.get(mesh_name)
        if not ob or not ob.data.shape_keys or key not in ob.data.shape_keys.key_blocks:
            continue
        bind = expression.morph_target_binds.add()
        bind.node.mesh_object_name = ob.name
        bind.index = key
        bind.weight = 1.0
        bound.setdefault(preset, []).append(f"{mesh_name}:{key}")
    for flag in ("override_blink", "override_mouth", "override_look_at"):
        if preset in config.get(flag, {}):
            setattr(expression, flag, config[flag][preset])

# --- Spring bones: one spring per chain, followed from each named root ----------------------
sb = ext.spring_bone1
name = armature.name
colliders = {}
for c in config["springs"]["colliders"]:
    bpy.ops.vrm.add_spring_bone1_collider(armature_object_name=name)
    collider = sb.colliders[-1]
    collider.node.bone_name = c["bone"]
    collider.shape_type = "Sphere"
    collider.shape.sphere.offset = c.get("offset", [0, 0, 0])
    collider.shape.sphere.radius = c["radius"]
    colliders[c["name"]] = collider
groups = {}
for group_name, members in config["springs"]["colliderGroups"].items():
    bpy.ops.vrm.add_spring_bone1_collider_group(armature_object_name=name)
    group = sb.collider_groups[-1]
    group.vrm_name = group_name
    for member in members:
        ref = group.colliders.add()
        ref.collider_uuid = colliders[member].uuid
    groups[group_name] = group


def chain(root):
    out, bone = [], armature.data.bones[root]
    while bone:
        out.append(bone.name)
        # A chain is a line of single children; a fork ends it (each branch has its own root).
        bone = bone.children[0] if len(bone.children) == 1 else None
    return out


springs = []
for spec in config["springs"]["chains"]:
    for root in spec["roots"]:
        bpy.ops.vrm.add_spring_bone1_spring(armature_object_name=name)
        spring = sb.springs[-1]
        spring.vrm_name = root
        joints = chain(root)
        for i, bone_name in enumerate(joints):
            joint = spring.joints.add()
            joint.node.bone_name = bone_name
            joint.stiffness = spec["stiffness"]
            joint.drag_force = spec["drag"]
            joint.gravity_power = spec.get("gravity", 0)
            joint.hit_radius = spec["hitRadius"]
        for group_name in spec.get("colliderGroups", []):
            ref = spring.collider_groups.add()
            ref.collider_group_uuid = groups[group_name].uuid
        springs.append({"root": root, "joints": len(joints)})

# --- Meta: a private conversion, never redistributed -----------------------------------------
meta = vrm1.meta
meta.vrm_name = config["meta"]["name"]
bpy.ops.vrm.add_vrm1_meta_author(armature_object_name=name)
meta.authors[-1].value = config["meta"]["author"]
meta.copyright_information = config["meta"].get("copyright", "")
meta.license_url = config["meta"].get("licenseUrl", "https://vrm.dev/licenses/1.0/")
meta.avatar_permission = "onlyAuthor"
meta.commercial_usage = "personalNonProfit"
meta.allow_redistribution = False
meta.modification = "prohibited"
meta.other_license_url = config["meta"].get("termsUrl", "")

# --- Export ------------------------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
result = bpy.ops.export_scene.vrm(filepath=out_path)
triangles = 0
for ob in meshes:
    ob.data.calc_loop_triangles()
    triangles += len(ob.data.loop_triangles)
print(
    "FBX_TO_VRM "
    + json.dumps(
        {
            "result": list(result),
            "bytes": os.path.getsize(out_path) if os.path.exists(out_path) else 0,
            "triangles": triangles,
            "meshes": [o.name for o in meshes],
            "materials": sorted(m.name for m in materials),
            "textures": {k: list(v.size) for k, v in textures.items()},
            "expressions": bound,
            "springs": springs,
        },
        ensure_ascii=False,
    )
)
