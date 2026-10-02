"""Punch up a pale wallpaper hero so the skin's background reads clearly.

Why this exists: many anime-style wallpapers are washed out on purpose (large
white paper areas, thin grey line art). Under WorkBuddy's translucent panels
they turn into a flat white haze, and no amount of veil tuning fixes it --
verified by pixel sampling: the panel fill was fully transparent yet the UI
still looked like a plain white card. The fix is to raise the *source* image's
contrast, saturation and level stretch, not to touch the CSS.

Runs inside Blender (ships numpy), so it needs no Pillow / sharp install:

    blender.exe -b --factory-startup -P enhance-hero.py -- \
        <src.webp> <dst.webp> [strength] [contrast] [saturation] [scurve]

Defaults: strength 0.88, contrast 1.13, saturation 1.28, scurve 0.24
(middle-of-the-road preset for a pale collage wallpaper).

  strength   0..1   how far to pull the 1%..99% luminance range to full scale
  contrast   1.0    contrast about mid-grey (1.0 = untouched)
  saturation 1.0    chroma boost (1.0 = untouched)
  scurve     0..1   how much smoothstep S-curve to blend in (firms midtones)

Keep a copy of the untouched hero (`hero-original.webp`) before overwriting.
Raising these too far blows out white fabric and crushes dark corners; if the
result looks harsh, lower `strength` first, then `contrast`.
"""

import os
import sys

import bpy
import numpy as np

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

DEFAULTS = (0.88, 1.13, 1.28, 0.24)


def enhance(src, dst, strength, contrast, saturation, scurve):
    img = bpy.data.images.load(src)
    width, height = img.size

    buf = np.empty(width * height * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    px = buf.reshape(-1, 4)
    orig = px[:, :3].copy()

    # 1) level stretch: pull the 1%..99% luminance band to full scale, so the
    #    grey film over a washed-out wallpaper gets removed.
    lo, hi = np.percentile(orig @ LUMA, [1.0, 99.0])
    stretched = (orig - lo) / max(hi - lo, 1e-6)
    rgb = orig + (stretched - orig) * strength

    # 2) contrast about mid-grey
    rgb = (rgb - 0.5) * contrast + 0.5

    # 3) saturation
    lum = (rgb @ LUMA)[:, None]
    rgb = lum + (rgb - lum) * saturation

    # 4) smoothstep S-curve: firm up midtones without crushing either end
    x = np.clip(rgb, 0.0, 1.0)
    rgb = (x * x * (3.0 - 2.0 * x)) * scurve + x * (1.0 - scurve)

    px[:, :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels.foreach_set(px.reshape(-1))

    img.filepath_raw = dst
    img.file_format = "WEBP"
    try:
        img.save()
    except Exception:
        # some builds lack a WebP writer; the theme loader sniffs magic bytes,
        # so a PNG payload under a .webp name still loads fine.
        img.filepath_raw = os.path.splitext(dst)[0] + ".png"
        img.file_format = "PNG"
        img.save()

    print("enhanced:", src, "->", dst)
    print("  luminance before:", np.round(np.percentile(orig @ LUMA, [1, 5, 50, 95, 99]), 3))
    print("  luminance after :", np.round(np.percentile(px[:, :3] @ LUMA, [1, 5, 50, 95, 99]), 3))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    src, dst = argv[0], argv[1]
    given = [float(v) for v in argv[2:6]]
    strength, contrast, saturation, scurve = given + list(DEFAULTS[len(given):])
    if not os.path.exists(src):
        raise SystemExit(f"source not found: {src}")
    enhance(src, dst, strength, contrast, saturation, scurve)


main()
