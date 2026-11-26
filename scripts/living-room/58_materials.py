# Procedural surfaces are baked with the lighting, so their grain survives the Web export.
# World-space coordinates keep the real-world pattern scale after the bake joins objects.
PALETTE = {
    'desk_top': '#9e7950', 'shelf_wood': '#8b6849', 'bed_wood': '#977657',
    'white_paint': '#bdb9a7', 'white_steel': '#8c9386', 'chair_shell': '#414c45',
    'chair_fabric': '#757969', 'pink_soft': '#967562', 'lavender_fabric': '#8b8b76',
    'duvet': '#6e8581', 'duvet_inside': '#b6b5a1', 'sheet': '#d2ccba',
    'pillow': '#d6cfb7', 'pillow_pink': '#aa8e78', 'headboard': '#6b7972',
    'throw': '#ad8a59', 'beanbag': '#8b664d', 'rug_cream': '#a69a7b',
    'rug_lilac': '#526c65', 'rug_pink': '#9b6e4c', 'floor_shade': '#c7c4ae',
    'pot_terra': '#9e684c', 'pot_white': '#b1b59c', 'mint': '#94a08e',
    'leaf': '#4f694b', 'leaf_dark': '#2f503c', 'desk_mat': '#36413c',
    'cream': '#c8c6b6', 'grey_plastic': '#626c66', 'guitar_top': '#ae8051',
    'ceramic_lilac': '#8c9d8f', 'plush': '#b9aa8e',
}
WOOD = {'desk_top','shelf_wood','bed_wood','guitar_top','guitar_side','door_wood'}
FABRIC = {'chair_fabric','lavender_fabric','duvet','duvet_inside','sheet','pillow','pillow_pink',
          'headboard','throw','beanbag','rug_cream','rug_lilac','rug_pink','curtain_linen','denim','sweater'}


def texture_surface(m, kind):
    nt=m.node_tree
    p=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    base=tuple(p.inputs['Base Color'].default_value)
    coord=nt.nodes.new('ShaderNodeNewGeometry')
    scale=nt.nodes.new('ShaderNodeVectorMath')
    scale.operation='MULTIPLY'
    scale.inputs[1].default_value={'wood':(1.8,65,14),'fabric':(220,220,220),'plaster':(55,55,55)}[kind]
    nt.links.new(coord.outputs['Position'],scale.inputs[0])
    noise=nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=1
    noise.inputs['Detail'].default_value=3
    noise.inputs['Roughness'].default_value=.7
    nt.links.new(scale.outputs['Vector'],noise.inputs['Vector'])
    ramp=nt.nodes.new('ShaderNodeValToRGB')
    spread=.42 if kind=='wood' else .16 if kind=='fabric' else .025
    for element,mult in zip(ramp.color_ramp.elements,(1-spread,1+spread)):
        element.color=tuple(min(1,c*mult) for c in base[:3])+(1,)
    nt.links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'],p.inputs['Base Color'])
    bump=nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value=.27 if kind=='wood' else .34
    bump.inputs['Distance'].default_value=.0005 if kind=='plaster' else .0015
    nt.links.new(noise.outputs['Fac'],bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'],p.inputs['Normal'])
    p.inputs['Roughness'].default_value={'wood':.56,'fabric':.92,'plaster':.9}[kind]
    m['surface']=kind


for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if not p:
        continue
    if m.name in PALETTE:
        p.inputs['Base Color'].default_value=srgb(PALETTE[m.name])
    if m.name in WOOD or m.name.startswith('oak_'):
        texture_surface(m,'wood')
    elif m.name in FABRIC:
        texture_surface(m,'fabric')
    elif m.name=='wall_plaster':
        texture_surface(m,'plaster')
    # Screens and PC LEDs are visible, but they no longer bleach the surrounding objects.
    if m.name.startswith(('pc_ring_','ui_')):
        p.inputs['Emission Strength'].default_value*=.32

# Small props use vertex lighting. Large textile and timber surfaces need an image atlas.
for name in ('shell','desk','bed','left','decor','right'):
    for obj in coll(name).objects:
        if obj.type!='MESH' or obj.name.startswith(('dyn_','pbr_')):
            continue
        if any(m and m.get('surface') for m in obj.data.materials):
            obj['lm']=1
print('materials done')
