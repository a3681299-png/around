# Screen light is the room's illumination.
C=wipe('lights')
# One soft panel light on each display of tex_workstation (reference_models.py measures them):
# about the brightness per square metre the hand-built monitors had.
for _i,(_c,_w,_h,_n,_a) in enumerate(PANELS[:4]):
    _q=_n.to_track_quat('-Z','Y').to_euler()
    _o=light('L_screen_'+str(_i),'AREA',tuple(_c+_n*.012),C,'#bed6ff',max(24,185*_a),size=_w*.9,size_y=_h*.9,rot=tuple(_q))
    # The main monitor shows the virtual desktop (docs/living-desktop.md): its light is a layer of
    # its own, white here, tinted by the page with what the monitor shows.
    if _i==MONITOR_PANEL:
        _o['layer']='screen';_o.data.color=(1,1,1)
# The virtual desktop opens in front of the room, on the viewer's side: its glow comes in through
# the open front, a broad soft light, white here and tinted by the page. Just inside the front
# bounce baffle (which would block it).
light('L_ui','AREA',(0,-2.76,1.45),C,'#ffffff',150,size=5.2,size_y=2.3,rot=(R90,0,0))['layer']='ui'
# The screens are the room's light (2026-11-13, the user's decision): no lamps, no coloured strips,
# no neon. The only other screen is the old television in the near left corner, playing to the rug.
light('L_tv','AREA',tv_point(-.14,.27,.615),C,'#ffb08c',14,size=.40,size_y=.30,rot=(R90,0,TV_TURN))
# What the screens' light does after the walls the cutaway leaves out (the front wall behind the
# viewer): a dim, even return, so the near half of the room is dark but can be read.
light('L_room_bounce','AREA',(0,-2.52,2.65),C,'#b9c6e4',48,size=4.5,size_y=2.0,rot=(math.radians(25),0,0))
light('L_front_wall_bounce','AREA',(0,-2.68,1.75),C,'#a3b6dc',12,size=3.5,size_y=1.2,rot=(math.radians(70),0,0))
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='GPU'
sc.cycles.samples=64;sc.cycles.use_denoising=True;sc.cycles.max_bounces=8
sc.cycles.sample_clamp_indirect=4
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
sc.view_settings.exposure=.6;sc.render.film_transparent=False
print('reference lighting ready')
