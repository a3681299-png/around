# Blue-hour skylight and small warm practicals, shaped for soft contact shadows.
C = wipe('lights')
R90 = math.pi/2
light('L_window','AREA',(-1.15,3.58,2.05),C,'#b2d9df',260,size=2.0,size_y=1.5,rot=(-R90,0,0))
light('L_monitor','AREA',(DX,DY+.17,DZ+.36),C,'#94bcc7',14,size=.8,size_y=.34,rot=(-R90,0,0))
for i,(x,y,z) in enumerate([(-1.8,2.7,2.22),(-1.2,2.95,2.38),(-.55,2.8,2.12)]):
    light('L_pendant_'+str(i),'POINT',(x,y,z-.03),C,'#ffd3a0',12,size=.045)
light('L_nightstand','POINT',(N.location.x+.07,N.location.y+.03,.87),C,'#ffd1a0',22,size=.06)
light('L_floorlamp','SPOT',(-1.555,-1.298,1.62),C,'#ffce97',65,size=.09,
      rot=(math.radians(-16),math.radians(12),0),spot=120)
light('L_globe','POINT',(-HALF+.3,.01,1.33),C,'#ffd8ae',5,size=.07)
# The cutaway receives the room's bounced light; a broad weak fill supplies the missing fourth wall.
light('L_bounce','AREA',(0,-2.35,2.65),C,'#b4c8c9',35,size=3,rot=(math.radians(25),0,0))
sc=bpy.context.scene
sc.render.engine='CYCLES'
sc.cycles.device='GPU'
sc.cycles.samples=64
sc.cycles.use_denoising=True
sc.cycles.max_bounces=6
sc.view_settings.view_transform='AgX'
sc.view_settings.look='AgX - Medium High Contrast'
sc.view_settings.exposure=.5
sc.render.film_transparent=False
print('lights done')
