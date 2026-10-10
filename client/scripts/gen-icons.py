"""Render Crumbbase PWA icons from the icon.svg geometry (flat shapes only).

Source of truth: client/public/icon.svg (viewBox 512). This script mirrors
that geometry in PIL at 4x supersample, then downscales for clean edges.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (15, 17, 21, 255)        # --bg #0f1115
ACCENT = (110, 168, 254)      # --accent #6ea8fe
PAPER = (232, 234, 240, 255)  # --text #e8eaf0

# geometry in 512 units: (cx, cy, r, alpha) crumbs, node rect, inner cutout
CRUMBS = [(118, 392, 30, 140), (198, 338, 41, 191), (266, 294, 48, 255)]
NODE = (306, 182, 148, 148, 34)   # x, y, w, h, radius
INNER = (344, 220, 72, 72, 18)
TILE_R = 112
SS = 4  # supersample factor


def draw_art(size, tile=True):
    """Transparent RGBA `size`px image with the crumb-trail art."""
    big = size * SS
    k = big / 512.0
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if tile:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(TILE_R * k), fill=BG)
    for cx, cy, r, a in CRUMBS:
        d.ellipse(
            [int((cx - r) * k), int((cy - r) * k), int((cx + r) * k), int((cy + r) * k)],
            fill=ACCENT + (a,),
        )
    x, y, w, h, rad = NODE
    d.rounded_rectangle(
        [int(x * k), int(y * k), int((x + w) * k), int((y + h) * k)],
        radius=int(rad * k),
        fill=PAPER,
    )
    ix, iy, iw, ih, irad = INNER
    d.rounded_rectangle(
        [int(ix * k), int(iy * k), int((ix + iw) * k), int((iy + ih) * k)],
        radius=int(irad * k),
        fill=BG,
    )
    return img.resize((size, size), Image.LANCZOS)


def flat_bg(size, color=BG):
    return Image.new("RGBA", (size, size), color)


# purpose "any": rounded tile w/ transparency outside corners
art512 = draw_art(512)
art512.save(os.path.join(OUT, "icon-512.png"))
draw_art(192).save(os.path.join(OUT, "icon-192.png"))

# purpose "maskable": full-bleed bg, art at 80% centered (safe zone)
maskable = flat_bg(512)
small = art512.resize((410, 410), Image.LANCZOS)
maskable.alpha_composite(small, (51, 51))
maskable.convert("RGB").save(os.path.join(OUT, "icon-maskable-512.png"))

# apple touch: full-bleed bg, art padded, no alpha
apple = flat_bg(180)
tiny = draw_art(512).resize((148, 148), Image.LANCZOS)
apple.alpha_composite(tiny, (16, 16))
apple.convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))

print("wrote:", sorted(os.listdir(OUT)))
