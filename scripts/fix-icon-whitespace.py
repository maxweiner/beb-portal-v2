#!/usr/bin/env python3
"""
Fix iPhone home-screen icon whitespace.

The WOPR artwork in public/icons/icon-512.png has a baked-in rounded
squircle sitting on a *white* background. When iOS adds its own
home-screen mask (which is slightly larger than the artwork's
squircle), the white corners bleed through and the icon looks like
it has a chunky white border.

Fix: flood-fill from each of the four corners with the dark squircle
edge colour. Flood-fill (vs. a naive "if white, replace") is the safe
move here because the WOPR text *inside* the panel is also white —
but it isn't connected to the corners, so flood ignores it.

We do it on the 512x512 master and downscale to every size the app
needs (apple-touch-icon + the manifest set).

Run with: python3 scripts/fix-icon-whitespace.py
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "public" / "icons"
APPLE_TOUCH = ROOT / "public" / "apple-touch-icon.png"
MASTER = ICONS_DIR / "icon-512.png"

# Sampled from the squircle edge at diag 80px: rgb(52,57,55).
# We use a fractionally darker shade so the corner fill blends into
# the (already shadowed) squircle edge rather than introducing a
# brighter halo.
DARK = (32, 38, 36, 255)

# Tolerance for the corner flood. 80 catches the antialiased ring of
# off-white pixels around the squircle without bleeding into the dark
# squircle itself (which is >120 away from white).
FLOOD_THRESH = 80

SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512]


def fix_master() -> Image.Image:
    im = Image.open(MASTER).convert("RGBA")
    w, h = im.size
    # Flood from each corner. The lower corners aren't pure white
    # (they pick up a faint shadow from the squircle drop-shadow,
    # ~rgb(177,177,177) and rgb(209,209,208)) so flooding from those
    # corner pixels with thresh=80 still catches the right area
    # without crossing into the dark squircle.
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(im, corner, DARK, thresh=FLOOD_THRESH)
    return im


def main() -> None:
    fixed = fix_master()

    # Save back the master at its original 512x512.
    fixed.save(MASTER, format="PNG", optimize=True)
    print(f"wrote {MASTER.relative_to(ROOT)}")

    # Downscale and write every other size. LANCZOS is the right
    # resample filter for shrinking photographic/iconographic PNGs.
    for size in SIZES:
        if size == 512:
            continue
        scaled = fixed.resize((size, size), Image.LANCZOS)
        out = ICONS_DIR / f"icon-{size}.png"
        scaled.save(out, format="PNG", optimize=True)
        print(f"wrote {out.relative_to(ROOT)}  ({size}x{size})")

    # apple-touch-icon.png is 180x180 — copy from the scaled set.
    apple = fixed.resize((180, 180), Image.LANCZOS)
    apple.save(APPLE_TOUCH, format="PNG", optimize=True)
    print(f"wrote {APPLE_TOUCH.relative_to(ROOT)}  (180x180)")


if __name__ == "__main__":
    main()
