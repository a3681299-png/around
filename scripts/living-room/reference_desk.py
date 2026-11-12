C=wipe('desk')
# The desk, its displays and equipment, and the chair are the user's models
# (reference_models.py: tex_workstation, tex_chair). Only the sweatshirt draped over the
# chair back is built here, sized to that chair.
cx,cy=-.45,.72
JACKET=mat('sweatshirt','#202942',.98);surface(JACKET,(90,90,100),.13,.2)
soft_box('hoodie_body',(.55,.16,.70),(cx,cy-.37,.84),C,JACKET,cuts=7,levels=1,puff=.13,noise=.07)
for s in (-1,1):
    soft_box('hoodie_sleeve',(.16,.18,.61),(cx+s*.31,cy-.32,.80),C,JACKET,rot=(0,s*-.14,0),cuts=6,levels=1,noise=.08)
soft_box('hood',(.30,.23,.21),(cx,cy-.29,1.22),C,JACKET,cuts=6,levels=1,puff=.4)
for a in range(6):
    angle=a*math.tau/6
    rod('embroidered_snowflake',(cx,cy-.461,.92),(cx+.073*math.sin(angle),cy-.461,.92+.073*math.cos(angle)),.003,C,PAPER)
print('reference desk ready',len(C.objects))
