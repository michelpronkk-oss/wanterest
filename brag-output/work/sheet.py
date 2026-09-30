import sys,glob
from PIL import Image, ImageDraw
fs=sys.argv[1:]
ims=[Image.open(f).resize((800,450)) for f in fs]
W=Image.new('RGB',(1600,450*((len(ims)+1)//2)),'white')
for i,(f,im) in enumerate(zip(fs,ims)):
  W.paste(im,((i%2)*800,(i//2)*450)); ImageDraw.Draw(W).text(((i%2)*800+8,(i//2)*450+8),f,fill='red')
W.save('sheet.jpg')
