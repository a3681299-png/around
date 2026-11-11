"""Denoise a baked atlas through Blender's bundled OpenImageDenoise compositor."""
import os
import tempfile
import bpy
import numpy as np


def denoise_atlas(color, albedo, temporary_root):
    height, width, _ = color.shape
    images = []
    scene = bpy.data.scenes.new('Bake denoising')
    camera_data = bpy.data.cameras.new('Bake denoising camera')
    camera = bpy.data.objects.new('Bake denoising camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    # The desktop's HIP denoiser crashes; CPU denoising leaves the working GPU bake unchanged.
    scene.render.compositor_device = 'CPU'
    scene.render.compositor_denoise_device = 'CPU'
    scene.render.resolution_x = scene.render.resolution_y = 4
    tree = bpy.data.node_groups.new('Bake denoising', 'CompositorNodeTree')
    scene.compositing_node_group = tree
    denoise = tree.nodes.new('CompositorNodeDenoise')
    for name, pixels in [('Image', color), ('Albedo', albedo)]:
        image = bpy.data.images.new('Bake ' + name, width, height, alpha=True, float_buffer=True)
        images.append(image)
        image.colorspace_settings.name = 'Non-Color'
        rgba = np.ones((height, width, 4), dtype=np.float32)
        rgba[:, :, :3] = pixels[:, :, :3]
        image.pixels.foreach_set(rgba.ravel())
        node = tree.nodes.new('CompositorNodeImage')
        node.image = image
        tree.links.new(node.outputs['Image'], denoise.inputs[name])
    output = tree.nodes.new('CompositorNodeOutputFile')
    output.file_output_items.new('RGBA', 'Image')
    output.format.media_type = 'IMAGE'
    output.format.file_format = 'OPEN_EXR'
    output.format.color_depth = '32'
    output.save_as_render = False
    tree.links.new(denoise.outputs['Image'], output.inputs[0])
    try:
        # The EXR is a lossless bridge to the compositor result, removed before this call returns.
        with tempfile.TemporaryDirectory(prefix='ww-room-bake-', dir=os.path.abspath(temporary_root)) as directory:
            output.directory = directory
            output.file_name = 'bake'
            bpy.ops.render.render(scene=scene.name)
            files = [os.path.join(directory, file) for file in os.listdir(directory) if file.endswith('.exr')]
            if len(files) != 1:
                raise RuntimeError('The denoiser did not write its atlas')
            result = bpy.data.images.load(files[0], check_existing=False)
            try:
                if tuple(result.size) != (width, height):
                    raise RuntimeError('The denoiser changed the atlas size')
                return np.array(result.pixels[:], dtype=np.float32).reshape(height, width, 4)[:, :, :3]
            finally:
                bpy.data.images.remove(result)
    finally:
        bpy.data.scenes.remove(scene)
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)
        bpy.data.node_groups.remove(tree)
        for image in images:
            bpy.data.images.remove(image)
