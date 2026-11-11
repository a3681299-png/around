# The lights (Cycles): the emissive meshes already light the room; these lamps shape it.
# Night, blue-violet: the monitors and the moon are cool, the lamps and string lights warm.
C = wipe('lights')
R90 = math.radians(90)
# monitors throw their colour onto the desk, the chair and the floor in front
light('L_monitor', 'AREA', (DX, DY + 0.17, DZ + 0.36), C, '#8f9cff', 26, size=0.8, size_y=0.34, rot=(-R90, 0, 0))  # an area light shines along its -Z: -90° about X turns that to -Y
light('L_monitor2', 'AREA', (DX - 0.67, DY + 0.07, DZ + 0.36), C, '#a47bff', 7, size=0.28, size_y=0.46, rot=(-R90, 0, math.radians(-24)))
# moonlight and the city's glow through the window, onto the bed and the floor
light('L_moon', 'AREA', (1.25, HALF + 0.35, 1.75), C, '#7d96ff', 120, size=1.3, size_y=1.1, rot=(math.radians(-62), 0, math.radians(8)))
# warm lamps
light('L_nightstand', 'POINT', (bpy.data.objects['nightstand_root'].location.x + 0.07, HALF - 0.21, 0.87), C, '#ffae6a', 14, size=0.03)
light('L_floorlamp', 'SPOT', (-2.08 + 0.525, -1.95 + 0.652, 1.62), C, '#ffb777', 60, size=0.05, rot=(math.radians(-16), math.radians(12), 0), spot=120)
light('L_globe', 'POINT', (-HALF + 0.3, 0.35 - 1.15 / 2 + 0.235, 1.33), C, '#ffc98a', 2.5, size=0.07)
for i, (x, y) in enumerate(((-HALF + 0.12, -1.6), (-HALF + 0.12, 1.3), (-0.75, HALF - 0.12), (1.7, HALF - 0.12))):
    light(f'L_string_{i}', 'POINT', (x, y, 2.38), C, '#ffbf78', 5, size=0.3)
# coloured accents
light('L_neon', 'AREA', (-HALF + 0.1, -1.5, 2.15), C, '#ff62c0', 10, size=0.5, rot=(0, -R90, 0))
light('L_led_shelf', 'AREA', (-1.31, HALF - 0.06, 1.44), C, '#b06bff', 9, size=1.2, size_y=0.04, rot=(0, 0, 0))
light('L_led_bed', 'AREA', (HALF - 1.12 - 0.03 + 0.2, HALF - 2.06 / 2 - 0.05, 0.16), C, '#a878ff', 5, size=0.1, size_y=1.7)
# a soft violet fill from above the open side so the near floor and the beanbag keep their form
light('L_fill', 'AREA', (0.6, -2.6, 3.4), C, '#6c63d8', 55, size=3.0, rot=(math.radians(28), 0, 0))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'GPU'
sc.cycles.samples = 96
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
sc.view_settings.view_transform = 'AgX'
try:
    sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception as e:
    print('look', e)
sc.view_settings.exposure = 0.6
sc.render.film_transparent = False
print('lights done')
