#!/usr/bin/env python3
"""
Render the Bench V1 mark (brass 'B' + bench line on warm walnut) to PNG
at the sizes iOS / PWA install needs. Output goes to public/icons/icon-{N}-bench.png.

Why a script and not the SVG favicon directly: iOS doesn't honor SVG for
apple-touch-icon, and the PWA manifest expects PNG. The favicon stays
SVG (small, sharp at any size); these PNGs are the home-screen flavor.

Dependencies: Pillow (pure-Python apart from libjpeg/libpng which macOS
ships). Run with:  python3 scripts/build-bench-icons.py
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
SIZES = [180, 192, 512]

# Palette from the Bench five-color system.
WALNUT       = (26, 14, 8)     # #1A0E08 — gradient dark stop
WALNUT_LIGHT = (122, 74, 40)   # #7A4A28 — gradient light stop
BRASS        = (201, 165, 92)  # #C9A55C — primary mark color
BRASS_LIGHT  = (240, 213, 138) # #F0D58A — upper highlight on the B
BRASS_DEEP   = (122, 90, 44)   # #7A5A2C — lower shadow on the B

# Serif font candidates. Order matters — first match wins.
FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Georgia.ttf',
    '/Library/Fonts/Georgia.ttf',
    '/System/Library/Fonts/Times.ttc',
    '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf',
]


def find_font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    raise FileNotFoundError('No usable serif font on this system')


def render(size: int) -> Image.Image:
    img = Image.new('RGB', (size, size), WALNUT)
    draw = ImageDraw.Draw(img)

    # Vertical gradient: walnut-light at the top fading to deep walnut at
    # the bottom. Cheaper than a true radial gradient and visually similar
    # at icon resolutions — the favicon SVG keeps the full radial for the
    # browser-tab version.
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(WALNUT_LIGHT[0] + (WALNUT[0] - WALNUT_LIGHT[0]) * t)
        g = int(WALNUT_LIGHT[1] + (WALNUT[1] - WALNUT_LIGHT[1]) * t)
        b = int(WALNUT_LIGHT[2] + (WALNUT[2] - WALNUT_LIGHT[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))

    # The 'B'. Sized + positioned to match the SVG mark (font-size 68 in
    # a 100-unit viewBox, text y=72). Scaled to whatever PNG size we're
    # rendering. Georgia is the safest fallback for Fraunces — both are
    # transitional serifs with similar B proportions.
    font_path = find_font_path()
    font_size = int(size * 0.72)
    font = ImageFont.truetype(font_path, font_size)
    bbox = draw.textbbox((0, 0), 'B', font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    tx = (size - text_w) // 2 - bbox[0]
    ty = int(size * 0.10) - bbox[1]
    draw.text((tx, ty), 'B', font=font, fill=BRASS)

    # Bench line — horizontal brass underline anchoring the mark. Matches
    # SVG: x1=22, x2=78, y=84 (in 100-unit space).
    line_y = int(size * 0.84)
    line_x_start = int(size * 0.22)
    line_x_end = int(size * 0.78)
    line_width = max(2, size // 50)
    draw.line([(line_x_start, line_y), (line_x_end, line_y)],
              fill=BRASS, width=line_width)

    return img


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for size in SIZES:
        img = render(size)
        out_path = os.path.join(OUTPUT_DIR, f'icon-{size}-bench.png')
        img.save(out_path, 'PNG', optimize=True)
        print(f'wrote {out_path}  ({size}x{size})')


if __name__ == '__main__':
    main()
