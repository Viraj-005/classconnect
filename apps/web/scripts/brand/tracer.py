"""Trace the supplied brand JPEGs into SVG paths.

The artwork arrived as JPEG on a white ground. That is unusable as it
stands: no alpha, so the logo would render as a white block on the dark
sidebar, and 1.2MB of photograph for a mark that draws at 24px.

So the shapes are extracted here and emitted as vector. Marching squares
runs over an antialiased coverage mask rather than a hard threshold,
which keeps the JPEG's own edge softening and gives smooth curves
instead of a staircase. Contours are then simplified with
Douglas-Peucker and written as one even-odd path per colour, so holes
(letter counters, the halo around the node) fall out of the fill rule
rather than needing to be identified.
"""

import numpy as np
from PIL import Image

# ----------------------------------------------------------------------
# Coverage mask
# ----------------------------------------------------------------------


def coverage(img, target, bg=(255, 255, 255), tol=0.34):
    """How much of `target` each pixel holds, 0..1.

    Projecting the pixel onto the background-to-target line gives a
    coverage figure that follows the JPEG's antialiasing, so edges come
    out smooth. Pixels far off that line (a different brand colour) are
    rejected by the perpendicular distance.
    """
    a = np.asarray(img, dtype=np.float64) / 255.0
    bg = np.array(bg, dtype=np.float64) / 255.0
    tg = np.array(target, dtype=np.float64) / 255.0

    d = tg - bg
    v = a - bg
    t = (v @ d) / (d @ d)
    perp = np.linalg.norm(v - t[..., None] * d, axis=-1)

    cov = np.clip(t, 0.0, 1.0)
    cov[perp > tol] = 0.0
    return cov


# ----------------------------------------------------------------------
# Marching squares
# ----------------------------------------------------------------------


def _interp(p, q, vp, vq, level):
    if abs(vq - vp) < 1e-12:
        return (p[0], p[1])
    s = (level - vp) / (vq - vp)
    return (p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1]))


def marching_squares(field, level=0.5):
    """Closed contours of `field` at `level`, in (x, y) pixel space."""
    h, w = field.shape
    # Pad so shapes touching the border still close.
    f = np.zeros((h + 2, w + 2), dtype=field.dtype)
    f[1:-1, 1:-1] = field

    segs = {}

    def add(a, b):
        ka = (round(a[0], 4), round(a[1], 4))
        kb = (round(b[0], 4), round(b[1], 4))
        if ka == kb:
            return
        segs.setdefault(ka, []).append(kb)

    H, W = f.shape
    above = f >= level
    for y in range(H - 1):
        for x in range(W - 1):
            tl, tr, bl, br = (
                above[y, x],
                above[y, x + 1],
                above[y + 1, x],
                above[y + 1, x + 1],
            )
            idx = (tl << 3) | (tr << 2) | (br << 1) | bl
            if idx in (0, 15):
                continue

            vtl, vtr, vbl, vbr = (
                f[y, x],
                f[y, x + 1],
                f[y + 1, x],
                f[y + 1, x + 1],
            )
            P = (x, y)
            Q = (x + 1, y)
            R = (x + 1, y + 1)
            S = (x, y + 1)

            top = _interp(P, Q, vtl, vtr, level)
            right = _interp(Q, R, vtr, vbr, level)
            bottom = _interp(S, R, vbl, vbr, level)
            left = _interp(P, S, vtl, vbl, level)

            # Segments wound so the inside stays on the left.
            table = {
                1: [(left, bottom)],
                2: [(bottom, right)],
                3: [(left, right)],
                4: [(right, top)],
                6: [(bottom, top)],
                7: [(left, top)],
                8: [(top, left)],
                9: [(top, bottom)],
                11: [(top, right)],
                12: [(right, left)],
                13: [(right, bottom)],
                14: [(bottom, left)],
                5: [(left, top), (right, bottom)],
                10: [(top, right), (bottom, left)],
            }
            for a, b in table[idx]:
                add(a, b)

    # Stitch segments into closed rings.
    rings = []
    while segs:
        start = next(iter(segs))
        ring = [start]
        cur = start
        while True:
            nxts = segs.get(cur)
            if not nxts:
                break
            nxt = nxts.pop()
            if not nxts:
                del segs[cur]
            ring.append(nxt)
            cur = nxt
            if cur == start:
                break
        if len(ring) > 3:
            rings.append([(x - 1, y - 1) for x, y in ring])
    return rings


# ----------------------------------------------------------------------
# Douglas-Peucker
# ----------------------------------------------------------------------


def simplify(points, tol):
    if len(points) < 3:
        return points
    pts = np.asarray(points, dtype=np.float64)
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True

    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        L = np.hypot(*ab)
        seg = pts[i + 1 : j]
        if L < 1e-9:
            d = np.hypot(*(seg - a).T)
        else:
            d = np.abs(np.cross(ab, seg - a)) / L
        k = int(np.argmax(d))
        if d[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack.append((i, m))
            stack.append((m, j))
    return [tuple(p) for p in pts[keep]]


# ----------------------------------------------------------------------
# Path emission
# ----------------------------------------------------------------------


def to_path(rings, sx, sy, ox, oy, tol, min_area, places=2):
    parts = []
    for ring in rings:
        # Drop specks: JPEG noise leaves a few stray one pixel rings.
        pts = np.asarray(ring, dtype=np.float64)
        area = 0.5 * abs(
            np.dot(pts[:, 0], np.roll(pts[:, 1], 1))
            - np.dot(pts[:, 1], np.roll(pts[:, 0], 1))
        )
        if area < min_area:
            continue
        s = simplify(ring, tol)
        if len(s) < 3:
            continue
        d = []
        for i, (x, y) in enumerate(s):
            X = round((x - ox) * sx, places)
            Y = round((y - oy) * sy, places)
            d.append(f"{'M' if i == 0 else 'L'}{X:g} {Y:g}")
        parts.append("".join(d) + "Z")
    return "".join(parts)


def trace(img, target, box, view_w, view_h, tol, min_area, tol_col=0.34):
    """Trace one colour inside `box` into a path string."""
    x0, y0, x1, y1 = box
    crop = img.crop(box)
    cov = coverage(crop, target, tol=tol_col)
    rings = marching_squares(cov, 0.5)
    sx = view_w / (x1 - x0)
    sy = view_h / (y1 - y0)
    return to_path(rings, sx, sy, 0, 0, tol, min_area)
