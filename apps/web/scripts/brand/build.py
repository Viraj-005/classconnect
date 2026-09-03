"""Write the brand assets into apps/web from the traced paths.

Rasters are drawn from the traced vector rather than resampled from the
source JPEG. That keeps the alpha clean at the rounded corners: scaling
the JPEG would carry its white ground into every edge pixel and leave a
pale fringe on any surface that is not white.
"""

import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(WEB, "public")
os.makedirs(PUB, exist_ok=True)

d = json.load(open(os.path.join(HERE, "brand_paths.json")))

GRAD_FROM = (0x57, 0x2C, 0x74)
GRAD_TO = (0x91, 0x54, 0x9A)
PAGE = (0xED, 0xE0, 0xFC)
NODE = (0x3B, 0x5C, 0x85)


def parse(p):
    rings, cur = [], []
    for cmd, x, y in re.findall(r"([ML])(-?[\d.]+) (-?[\d.]+)", p):
        if cmd == "M" and cur:
            rings.append(cur)
            cur = []
        cur.append((float(x), float(y)))
    if cur:
        rings.append(cur)
    return rings


def mask_for(path, size, scale):
    """Even-odd fill of a path, as a boolean array."""
    acc = np.zeros((size, size), dtype=bool)
    for ring in parse(path):
        layer = Image.new("1", (size, size), 0)
        ImageDraw.Draw(layer).polygon([(x * scale, y * scale) for x, y in ring], fill=1)
        acc ^= np.asarray(layer)
    return acc


def diagonal_gradient(size):
    i = np.linspace(0, 1, size)
    t = (i[None, :] + i[:, None]) / 2.0
    out = np.zeros((size, size, 3), dtype=np.float64)
    for c in range(3):
        out[:, :, c] = GRAD_FROM[c] + (GRAD_TO[c] - GRAD_FROM[c]) * t
    return out


def render_icon(px, ss=4):
    """The app icon at `px`, supersampled then reduced."""
    S = px * ss
    scale = S / 100.0

    rgba = np.zeros((S, S, 4), dtype=np.uint8)
    shape = mask_for(d["iconShape"], S, scale)
    grad = diagonal_gradient(S)

    rgba[..., :3] = grad.astype(np.uint8)
    rgba[..., 3] = np.where(shape, 255, 0)

    pages = mask_for(d["iconPages"], S, scale) & shape
    for c in range(3):
        rgba[..., c] = np.where(pages, PAGE[c], rgba[..., c])

    node = mask_for(d["iconNode"], S, scale) & shape
    for c in range(3):
        rgba[..., c] = np.where(node, NODE[c], rgba[..., c])

    im = Image.fromarray(rgba, "RGBA")
    return im.resize((px, px), Image.LANCZOS)


def path_svg(path, fill, extra=""):
    return f'<path fill-rule="evenodd" fill="{fill}"{extra} d="{path}"/>'


# ----------------------------------------------------------------------
# SVG: the app icon
# ----------------------------------------------------------------------

icon_svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" '
    'aria-label="ClassConnect">'
    "<defs>"
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    f'<stop offset="0" stop-color="#{GRAD_FROM[0]:02X}{GRAD_FROM[1]:02X}{GRAD_FROM[2]:02X}"/>'
    f'<stop offset="1" stop-color="#{GRAD_TO[0]:02X}{GRAD_TO[1]:02X}{GRAD_TO[2]:02X}"/>'
    "</linearGradient>"
    "</defs>"
    + path_svg(d["iconShape"], "url(#g)")
    + path_svg(d["iconPages"], "#EDE0FC")
    + path_svg(d["iconNode"], "#3B5C85")
    + "</svg>"
)
open(os.path.join(PUB, "favicon.svg"), "w", encoding="utf-8").write(icon_svg)
print("favicon.svg", len(icon_svg), "bytes")

# ----------------------------------------------------------------------
# SVG: the horizontal lockup, for docs and anywhere outside the app
# ----------------------------------------------------------------------

lock_svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {d["lockW"]} {d["lockH"]}" '
    'role="img" aria-label="ClassConnect">'
    + path_svg(d["lockInk"], "#5A256D")
    + path_svg(d["lockNode"], "#3B5E84")
    + "</svg>"
)
open(os.path.join(PUB, "logo.svg"), "w", encoding="utf-8").write(lock_svg)
print("logo.svg    ", len(lock_svg), "bytes")

# ----------------------------------------------------------------------
# Rasters
# ----------------------------------------------------------------------

for name, px in [
    ("favicon-16.png", 16),
    ("favicon-32.png", 32),
    ("favicon-48.png", 48),
    ("apple-touch-icon.png", 180),
    ("icon-192.png", 192),
    ("icon-512.png", 512),
]:
    im = render_icon(px)
    im.save(os.path.join(PUB, name))
    print(f"{name:22} {px}x{px}  {os.path.getsize(os.path.join(PUB, name))} bytes")

# A multi size .ico, because some Windows surfaces still ask for one.
ico = render_icon(64)
ico.save(
    os.path.join(PUB, "favicon.ico"),
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
)
print("favicon.ico            ", os.path.getsize(os.path.join(PUB, "favicon.ico")), "bytes")

# ----------------------------------------------------------------------
# Manifest
# ----------------------------------------------------------------------

manifest = {
    "name": "ClassConnect",
    "short_name": "ClassConnect",
    "description": "Content, fees, attendance and analytics for schools and tutoring centres.",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#F7F4FA",
    "theme_color": "#5A256D",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml"},
    ],
}
open(os.path.join(PUB, "site.webmanifest"), "w", encoding="utf-8").write(
    json.dumps(manifest, indent=2) + "\n"
)
print("site.webmanifest written")

# ----------------------------------------------------------------------
# Path data for the React components
# ----------------------------------------------------------------------

js = f'''/*
  Brand path data, traced from the supplied artwork.

  The logo and app icon arrived as JPEG on a white ground. Neither could
  be used as delivered: no alpha, so the logo rendered as a white block
  on the dark sidebar, and over a megabyte apiece for a mark that draws
  at 24px. The shapes were traced to vector instead, which fixed both
  and made the mark recolourable, so the same file serves the purple
  lockup on the login screen and the white one in the sidebar.

  Generated, not hand written. Do not edit these strings. The tracer and
  its fidelity check live alongside the design notes in DESIGN.md
  section 14.

  Every path is filled even-odd, which is what carves the counters in
  the wordmark and the halo around the node out of the page shapes.
*/

/* The open book, from the logo lockup. viewBox 100 x {d["markH"]}. */
export const MARK_W = {d["markW"]};
export const MARK_H = {d["markH"]};
export const MARK_BOOK = "{d["markBook"]}";
export const MARK_NODE = "{d["markNode"]}";

/* Book plus the ClassConnect wordmark. viewBox 400 x {d["lockH"]}. */
export const LOCKUP_W = {d["lockW"]};
export const LOCKUP_H = {d["lockH"]};
export const LOCKUP_INK = "{d["lockInk"]}";
export const LOCKUP_NODE = "{d["lockNode"]}";

/* The app icon, squircle included. viewBox 100 x 100. */
export const ICON_SHAPE = "{d["iconShape"]}";
export const ICON_PAGES = "{d["iconPages"]}";
export const ICON_NODE = "{d["iconNode"]}";

/* Sampled off the supplied artwork. */
export const BRAND_INK = "#5A256D";
export const BRAND_NODE = "#3B5E84";
export const BRAND_PAGE = "#EDE0FC";
export const BRAND_GRADIENT = ["#572C74", "#91549A"];
'''
dest = os.path.join(WEB, "src", "brand", "paths.js")
os.makedirs(os.path.dirname(dest), exist_ok=True)
open(dest, "w", encoding="utf-8").write(js)
print("src/brand/paths.js", len(js), "bytes")
