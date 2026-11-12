# Screen light is the main illumination; blue curtain wash and warm practicals are secondary.
C=wipe('lights')
light('L_main_monitor','AREA',(.25,2.025,1.36),C,'#bed6ff',82,size=1.02,size_y=.60,rot=(-R90,0,0))
light('L_portrait_monitor','AREA',(-.74,2.055,1.55),C,'#b8caff',33,size=.43,size_y=.88,rot=(-R90,0,0))
light('L_pen_display','AREA',(-.20,1.46,1.015),C,'#bfd5ff',32,size=.94,size_y=.48,rot=(math.pi+math.radians(24),0,0))
light('L_curtain_cove','AREA',(-.22,2.43,2.81),C,'#1255ff',27,size=2.30,size_y=.07,rot=(math.radians(28),0,0))
for i,x in enumerate((-.95,-.37,.22,.78)):
    light('L_curtain_uplight_'+str(i),'AREA',(x,2.35,.89),C,'#0755ff',24,size=.18,size_y=.10,rot=(math.radians(142),0,0))
light('L_shelf_strip','AREA',(-1.95,2.22,2.28),C,'#ffe0b1',5,size=.72,size_y=.10)
light('L_bedside','POINT',(NX,NY-.06,.735),C,'#ffbd7d',20,size=.045)
light('L_room_bounce','AREA',(0,-2.52,2.65),C,'#b6c7ed',120,size=4.5,size_y=2.0,rot=(math.radians(25),0,0))
light('L_front_wall_bounce','AREA',(0,-2.68,1.75),C,'#94afe3',25,size=3.5,size_y=1.2,rot=(math.radians(70),0,0))
light('L_blue_floor_bounce','AREA',(-.12,1.0,.22),C,'#075cff',6,size=.6,size_y=.13)
light('L_left_bounce','AREA',(-2.30,-.50,2.58),C,'#6495ed',5,size=2.0,size_y=.7)
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='GPU'
sc.cycles.samples=64;sc.cycles.use_denoising=True;sc.cycles.max_bounces=8
sc.cycles.sample_clamp_indirect=4
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
sc.view_settings.exposure=.6;sc.render.film_transparent=False
print('reference lighting ready')
