import json,sys
from PIL import Image,ImageDraw
d=json.load(open(sys.argv[1])); s=float(sys.argv[2]) if len(sys.argv)>2 else 8
W,H=d['W'],d['H']; im=Image.new('RGB',(int(W*s)+20,int(H*s)+20),(255,255,255)); dr=ImageDraw.Draw(im)
P=lambda x,y:(10+x*s,10+(H-y)*s)
dr.rounded_rectangle([P(0,H),P(W,0)],radius=3*s,fill=(40,44,52))
def fill(polys,col):
  m=Image.new('L',im.size,0); md=ImageDraw.Draw(m)
  # Even-odd per XOR-Maske
  for p in polys:
    t=Image.new('L',im.size,0); ImageDraw.Draw(t).polygon([P(*q) for q in p],fill=255)
    from PIL import ImageChops; m=ImageChops.logical_xor(m.convert('1'),t.convert('1')).convert('L')
  im.paste(Image.new('RGB',im.size,col),mask=m)
fill(d['textPolys'],(245,245,240))
if len(sys.argv)>3: fill(d['lostPolys'],(230,40,40))
im.save(sys.argv[1].replace('.json',('_verlust' if len(sys.argv)>3 else '')+'.png'))
