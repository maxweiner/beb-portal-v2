#!/usr/bin/env python3
"""
Regenerate every iOS / PWA icon size from a high-resolution master.

Run with one argument — the path to the source PNG (any square size,
1024+ recommended):

    python3 scripts/regenerate-icons.py ~/Desktop/wopr\\ icon.png

Or with no arguments, defaults to ./icon-source.png next to the
script. The source is resampled with LANCZOS once per output size
(rather than chain-resampling 1254 → 512 → 256 → 128 etc.) so each
small icon gets the best fidelity possible.

Replaces the older scripts/fix-icon-whitespace.py — that one flood-
filled stray white corners from a corrupted source. The current
artwork is clean, so we just resize.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "public" / "icons"
APPLE_TOUCH = ROOT / "public" / "apple-touch-icon.png"

# Every size the app references — must stay in sync with:
#   - app/layout.tsx (icons.icon + icons.apple)
#   - public/manifest.json (icons array)
SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512]


def main() -> None:
    if len(sys.argv) >= 2:
        src = Path(sys.argv[1]).expanduser().resolve()
    else:
        src = ROOT / "scripts" / "icon-source.png"
    if not src.is_file():
        print(f"source not found: {src}", file=sys.stderr)
        sys.exit(1)

    master = Image.open(src).convert("RGBA")
    print(f"source: {src}  ({master.size[0]}x{master.size[1]})")

    for size in SIZES:
        out = ICONS_DIR / f"icon-{size}.png"
        master.resize((size, size), Image.LANCZOS).save(out, format="PNG", optimize=True)
        print(f"  wrote {out.relative_to(ROOT)}  ({size}x{size})")

    # apple-touch-icon.png is 180x180 — mirror the icon-180 output.
    master.resize((180, 180), Image.LANCZOS).save(APPLE_TOUCH, format="PNG", optimize=True)
    print(f"  wrote {APPLE_TOUCH.relative_to(ROOT)}  (180x180)")


if __name__ == "__main__":
    main()
