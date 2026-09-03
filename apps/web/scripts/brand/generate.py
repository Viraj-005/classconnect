"""Regenerate the brand assets from the artwork in brand/source.

    python apps/web/scripts/brand/generate.py     # trace to brand_paths.json
    python apps/web/scripts/brand/build.py        # write icons and paths.js

Needs Pillow and numpy. Nothing else, and nothing at build time: this is
run by hand when the artwork changes, and its output is committed.

Each trace prints an IoU against the source mask. Treat anything below
about 0.95 as a regression and look at it before committing, because a
bad trace is not obvious from the numbers alone.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from PIL import Image, ImageDraw

from tracer import coverage, marching_squares, simplify

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SRC = os.path.join(REPO, "brand", "source")
LOGO = os.path.join(SRC, "app-logo.jpeg")
ICON = os.path.join(SRC, "app-icon.jpeg")

PURPLE = (0x5A, 0x25, 0x6D)
BLUE = (0x3B, 0x5E, 0x84)
PAGE = (0xED, 0xE0, 0xFC)
ICON_BLUE = (0x3B, 0x5C, 0x85)
ICON_BG = (0x74, 0x40, 0x8B)  # midpoint of the gradient
WHITE = (255, 255, 255)

# Boxes measured off the source files.
LOGO_MARK = (203, 691, 677, 1101)
LOGO_FULL = (203, 691, 2198, 1101)
ICON_BOX = (255, 255, 1793, 1793)


def rings(img, box, target, bg, tol_col, tol, min_area):
    cov = coverage(img.crop(box), target, bg=bg, tol=tol_col)
    out = []
    for r in marching_squares(cov, 0.5):
        p = np.asarray(r, float)
        area = 0.5 * abs(
            np.dot(p[:, 0], np.roll(p[:, 1], 1)) - np.dot(p[:, 1], np.roll(p[:, 0], 1))
        )
        if area < min_area:
            continue
        s = simplify(r, tol)
        if len(s) >= 3:
            out.append(s)
    return cov, out


def emit(rs, box, view_w, places=2):
    x0, y0, x1, y1 = box
    k = view_w / (x1 - x0)
    parts = []
    for r in rs:
        d = []
        for i, (x, y) in enumerate(r):
            d.append(f"{'M' if i == 0 else 'L'}{round(x * k, places):g} {round(y * k, places):g}")
        parts.append("".join(d) + "Z")
    return "".join(parts)


def iou(cov, rs, shape):
    h, w = shape
    acc = np.zeros((h * 2, w * 2), dtype=bool)
    for r in rs:
        layer = Image.new("1", (w * 2, h * 2), 0)
        ImageDraw.Draw(layer).polygon([(x * 2, y * 2) for x, y in r], fill=1)
        acc ^= np.asarray(layer)
    got = np.asarray(Image.fromarray(acc).resize((w, h), Image.BOX)).astype(bool)
    want = cov >= 0.5
    u = (got | want).sum()
    return round(float((got & want).sum() / u), 4) if u else 1.0


def build(name, img, box, target, bg, tol_col, tol, min_area, view_w):
    cov, rs = rings(img, box, target, bg, tol_col, tol, min_area)
    path = emit(rs, box, view_w)
    print(f"  {name:22} rings={len(rs):3d}  chars={len(path):6d}  IoU={iou(cov, rs, cov.shape)}")
    return path


logo = Image.open(LOGO).convert("RGB")
icon = Image.open(ICON).convert("RGB")

# The squircle has rounded corners, so the crop still contains white
# outside it. Left alone, that white traces as a page (it is far closer
# to the pale page colour than to the purple ground) and comes out as a
# frame around the whole icon. Flooding it with the ground colour first
# leaves only the real artwork to trace.
_a = np.asarray(icon).astype(int)
_white = (_a[:, :, 0] > 232) & (_a[:, :, 1] > 232) & (_a[:, :, 2] > 232)
_flat = np.asarray(icon).copy()
_flat[_white] = ICON_BG
icon_inner = Image.fromarray(_flat)

out = {}

print("logo mark (viewBox 100 wide):")
mw, mh = LOGO_MARK[2] - LOGO_MARK[0], LOGO_MARK[3] - LOGO_MARK[1]
out["markW"] = 100
out["markH"] = round(100 * mh / mw, 2)
out["markBook"] = build("book", logo, LOGO_MARK, PURPLE, WHITE, 0.12, 0.3, 6, 100)
out["markNode"] = build("node", logo, LOGO_MARK, BLUE, WHITE, 0.12, 0.18, 6, 100)

print("\nfull lockup (viewBox 400 wide):")
fw, fh = LOGO_FULL[2] - LOGO_FULL[0], LOGO_FULL[3] - LOGO_FULL[1]
out["lockW"] = 400
out["lockH"] = round(400 * fh / fw, 2)
out["lockInk"] = build("book + wordmark", logo, LOGO_FULL, PURPLE, WHITE, 0.12, 0.45, 8, 400)
out["lockNode"] = build("node", logo, LOGO_FULL, BLUE, WHITE, 0.12, 0.45, 6, 400)

print("\napp icon (viewBox 100 wide, inside the squircle):")
out["iconW"] = 100
out["iconShape"] = build("squircle", icon, ICON_BOX, ICON_BG, WHITE, 0.34, 0.8, 60, 100)
out["iconPages"] = build("pages", icon_inner, ICON_BOX, PAGE, ICON_BG, 0.30, 1.0, 60, 100)
out["iconNode"] = build("node", icon_inner, ICON_BOX, ICON_BLUE, PAGE, 0.10, 0.6, 30, 100)

json.dump(out, open(os.path.join(HERE, "brand_paths.json"), "w"), indent=1)
print("\nwrote brand_paths.json", sum(len(v) for v in out.values() if isinstance(v, str)), "chars of path data")
