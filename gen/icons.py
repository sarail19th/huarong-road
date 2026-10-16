from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'dist')

def draw(size, safe):
    img = Image.new('RGB', (size, size), '#0d1117')
    d = ImageDraw.Draw(img)
    m = size * (0.5 - safe / 2)          # margin so maskable icons keep content in the safe zone
    s = size * safe / 4                   # one board column
    r = s * 0.16
    def block(c0, r0, w, h, col):
        x0 = m + c0 * s + s * 0.05; y0 = m + r0 * s * 1.0 + s * 0.05
        d.rounded_rectangle([x0, y0, x0 + w * s - s * 0.1, y0 + h * s - s * 0.1], radius=r, fill=col)
    # 4x4 mini board: red 2x2 at the top, blues beside it, yellow + exit strip at the bottom
    block(1, 0, 2, 2, '#e63946')
    block(0, 0, 1, 2, '#2f80ed'); block(3, 0, 1, 2, '#2f80ed')
    block(1, 2, 2, 1, '#2f80ed')
    block(0, 2, 1, 1, '#f5b82e'); block(3, 2, 1, 1, '#f5b82e')
    block(1, 3, 1, 1, '#f5b82e'); block(2, 3, 1, 1, '#f5b82e')
    gy = m + 4 * s + s * 0.02
    d.rounded_rectangle([m + s, gy, m + 3 * s, gy + s * 0.13], radius=s * 0.06, fill='#3ddc84')
    return img

draw(192, 0.72).save(os.path.join(OUT, 'icon-192.png'))
draw(512, 0.72).save(os.path.join(OUT, 'icon-512.png'))
draw(512, 0.56).save(os.path.join(OUT, 'icon-maskable-512.png'))
print('icons written')
