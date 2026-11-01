"""PWA icons into dist/ (run after `node build.js`). Needs Pillow.

Design: a 4x4 board with the red 2x2 in the middle, ringed by the other block types (small corners,
wide top/bottom, tall sides) and the green exit under the bottom wide block. Every block sits on whole
grid cells with one gap size, so the blocks keep their in-game proportions (1x1, 2x1, 1x2, 2x2).
The board is sized so round launcher masks only trim the corner blocks. No emblem on the red block
(the in-game piece keeps its triangle)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'dist')
BG = '#0d1117'; RED = '#e63946'; BLUE = '#2f80ed'; YEL = '#f5b82e'; GRN = '#3ddc84'
TOP, CELL, GAP, EXIT_H = 0.075, 0.190, 0.030, 0.062   # fractions of the icon size
BLOCKS = [(0, 0, 1, 1, YEL), (1, 0, 2, 1, BLUE), (3, 0, 1, 1, YEL),
          (0, 1, 1, 2, BLUE), (1, 1, 2, 2, RED), (3, 1, 1, 2, BLUE),
          (0, 3, 1, 1, YEL), (1, 3, 2, 1, BLUE), (3, 3, 1, 1, YEL)]
SS = 4   # supersampling for smooth edges

def draw(size, mono=False):
    """mono: white shapes on a transparent canvas (Android 13+ themed icon uses only the alpha shape)."""
    n = size * SS
    img = Image.new('RGBA' if mono else 'RGB', (n, n), (0, 0, 0, 0) if mono else BG)
    d = ImageDraw.Draw(img)
    x0 = 0.5 - 2 * CELL
    def rr(a, b, e, f, col, rad):
        d.rounded_rectangle([a * n, b * n, e * n, f * n], radius=rad * n, fill='#ffffff' if mono else col)
    for c, r, w, h, col in BLOCKS:
        rr(x0 + c * CELL + GAP / 2, TOP + r * CELL + GAP / 2,
           x0 + (c + w) * CELL - GAP / 2, TOP + (r + h) * CELL - GAP / 2, col, CELL * 0.18)
    ey = TOP + 4 * CELL + GAP / 2
    rr(x0 + CELL + GAP / 2, ey, x0 + 3 * CELL - GAP / 2, ey + EXIT_H, GRN, EXIT_H / 2)   # exit
    return img.resize((size, size), Image.LANCZOS)

draw(192).save(os.path.join(OUT, 'icon-192.png'))
draw(512).save(os.path.join(OUT, 'icon-512.png'))
draw(512).save(os.path.join(OUT, 'icon-maskable-512.png'))          # same art: built to survive round masks
draw(512, mono=True).save(os.path.join(OUT, 'icon-monochrome-512.png'))
draw(180).save(os.path.join(OUT, 'apple-touch-icon.png'))            # iOS: opaque, iOS rounds the corners
print('icons written')
