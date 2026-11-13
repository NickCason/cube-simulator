#!/usr/bin/env python3
# Pictures side by side: tile.py out.png a.png b.png ... [--cols N] [--crop x0,y0,x1,y1] [--scale s] [--gap px]
# (in rows of N, each cropped the same, the whole scaled - to look at with the Read tool, under ~1200 px wide)
import sys
from PIL import Image
args, files, o = sys.argv[1:], [], {'cols': 0, 'crop': None, 'scale': 0.5, 'gap': 10}
out = args.pop(0)
i = 0
while i < len(args):
    a = args[i]
    if a.startswith('--'):
        o[a[2:]] = args[i + 1]; i += 2
    else:
        files.append(a); i += 1
ims = [Image.open(f).convert('RGB') for f in files]
if o['crop']:
    c = tuple(int(v) for v in o['crop'].split(','))
    ims = [im.crop(c) for im in ims]
cols = int(o['cols']) or len(ims)
w, h, g = max(im.width for im in ims), max(im.height for im in ims), int(o['gap'])
rows = (len(ims) + cols - 1) // cols
c = Image.new('RGB', (cols * (w + g) - g, rows * (h + g) - g), (255, 255, 255))
for n, im in enumerate(ims):
    c.paste(im, ((n % cols) * (w + g), (n // cols) * (h + g)))
s = float(o['scale'])
c = c.resize((max(1, int(c.width * s)), max(1, int(c.height * s))))
c.save(out)
print(out, c.size)
