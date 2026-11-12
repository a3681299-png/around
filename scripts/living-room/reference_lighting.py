# Screen light is the main illumination; blue curtain wash and warm practicals are secondary.
C=wipe('lights')
# One soft panel light on each display of tex_workstation (reference_models.py measures them):
# about the brightness per square metre the hand-built monitors had.
for _i,(_c,_w,_h,_n,_a) in enumerate(PANELS[:4]):
    _q=_n.to_track_quat('-Z','Y').to_euler()
    _o=light('L_screen_'+str(_i),'AREA',tuple(_c+_n*.012),C,'#bed6ff',max(18,125*_a),size=_w*.9,size_y=_h*.9,rot=tuple(_q))
    # The main monitor shows the virtual desktop (docs/living-desktop.md): its light is a layer of
    # its own, white here, tinted by the page with what the monitor shows.
    if _i==MONITOR_PANEL:
        _o['layer']='screen';_o.data.color=(1,1,1)
# The virtual desktop opens in front of the room, on the viewer's side: its glow comes in through
# the open front, a broad soft light, white here and tinted by the page. Just inside the front
# bounce baffle (which would block it).
light('L_ui','AREA',(0,-2.76,1.45),C,'#ffffff',150,size=5.2,size_y=2.3,rot=(R90,0,0))['layer']='ui'
light('L_curtain_cove','AREA',(-.22,2.43,2.81),C,'#1255ff',27,size=2.30,size_y=.07,rot=(math.radians(28),0,0))
for i,x in enumerate((-.95,-.37,.22,.78)):
    light('L_curtain_uplight_'+str(i),'AREA',(x,2.35,.89),C,'#0755ff',24,size=.18,size_y=.10,rot=(math.radians(142),0,0))
light('L_shelf_strip','AREA',(-1.95,2.22,2.28),C,'#ffe0b1',5,size=.72,size_y=.10)
light('L_bedside','POINT',(NX,NY-.06,.735),C,'#ffbd7d',20,size=.045)
light('L_room_bounce','AREA',(0,-2.52,2.65),C,'#b6c7ed',120,size=4.5,size_y=2.0,rot=(math.radians(25),0,0))
light('L_front_wall_bounce','AREA',(0,-2.68,1.75),C,'#94afe3',25,size=3.5,size_y=1.2,rot=(math.radians(70),0,0))
light('L_blue_floor_bounce','AREA',(-.12,1.0,.22),C,'#075cff',6,size=.6,size_y=.13)
# The white clothes rack in the near-right corner reads as a bright frame in the reference;
# nothing else reaches that corner of the room.
# Just inside the front bounce baffle (which would block it), high up, tilted onto the rack front.
light('L_rack_fill','AREA',(2.3,-2.76,2.75),C,'#c3d0f0',40,size=1.3,size_y=.5,rot=(math.radians(60),0,0))
light('L_left_bounce','AREA',(-2.30,-.50,2.58),C,'#6495ed',5,size=2.0,size_y=.7)
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='GPU'
sc.cycles.samples=64;sc.cycles.use_denoising=True;sc.cycles.max_bounces=8
sc.cycles.sample_clamp_indirect=4
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
sc.view_settings.exposure=.6;sc.render.film_transparent=False
print('reference lighting ready')
