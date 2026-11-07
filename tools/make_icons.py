#!/usr/bin/env python3
"""Генерирует иконки приложения (оригинальный знак: капля-колба с буквой «И»)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"


def make(size, maskable=False):
    s = size * 4
    img = Image.new("RGBA", (s, s))
    d = ImageDraw.Draw(img)
    # фон: мягкий градиент
    top, bot = (124, 92, 255), (40, 199, 170)
    for y in range(s):
        t = y / s
        c = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)) + (255,)
        d.line([(0, y), (s, y)], fill=c)
    if not maskable:
        m = Image.new("L", (s, s), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, s, s], radius=int(s * 0.225), fill=255)
        img.putalpha(m)
    pad = 0.2 if maskable else 0.12
    # стеклянная капля
    glass = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    g = ImageDraw.Draw(glass)
    cx, cy, r = s / 2, s * 0.56, s * (0.5 - pad) * 0.78
    g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 70), outline=(255, 255, 255, 200), width=int(s * 0.012))
    g.polygon([(cx - r * 0.62, cy - r * 0.78), (cx, cy - r * 1.75), (cx + r * 0.62, cy - r * 0.78)], fill=(255, 255, 255, 70))
    glass = glass.filter(ImageFilter.GaussianBlur(s * 0.002))
    img.alpha_composite(glass)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, int(s * (0.34 if not maskable else 0.28)))
    txt = "И"
    bb = d.textbbox((0, 0), txt, font=f)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]), txt, font=f, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


for sz in (180, 192, 512):
    make(sz).save(OUT / f"icon-{sz}.png")
make(512, maskable=True).save(OUT / "icon-maskable-512.png")
make(32).save(OUT / "favicon-32.png")
print("ok")
