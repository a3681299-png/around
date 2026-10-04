#!/usr/bin/env python3
"""Rebuild the full PixelMplus12 WOFF2 from the pinned upstream TTF.

Usage: python assets/fonts/rebuild_pixelmplus.py /path/to/PixelMplus12-Regular.ttf
Requires fontTools 4.61.1 and Node.js with built-in Brotli (no npm dependencies).
The exact bundled output was built with Node.js 24.19.0 / Brotli 1.2.0.
This script does not download files or install anything.
"""

import hashlib
from pathlib import Path
import subprocess
import sys

from fontTools.ttLib import TTFont, woff2


class NodeBrotli:
    """Use the existing Node runtime when Python's optional Brotli is absent."""

    MODE_GENERIC = 0
    MODE_TEXT = 1
    MODE_FONT = 2

    @staticmethod
    def compress(data, mode=0):
        script = """
const fs = require('node:fs');
const zlib = require('node:zlib');
process.stdout.write(zlib.brotliCompressSync(fs.readFileSync(0), {params: {
  [zlib.constants.BROTLI_PARAM_MODE]: Number(process.argv[1]),
  [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
}}));
"""
        return subprocess.run(
            ["node", "-e", script, str(mode)], input=data, capture_output=True,
            check=True,
        ).stdout

    @staticmethod
    def decompress(data):
        script = """
const fs = require('node:fs');
const zlib = require('node:zlib');
process.stdout.write(zlib.brotliDecompressSync(fs.readFileSync(0)));
"""
        return subprocess.run(
            ["node", "-e", script], input=data, capture_output=True, check=True,
        ).stdout


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    source = Path(sys.argv[1])
    expected_source = "02f19467ea7cc235cc06c570b7f6c3b0a12a6f682bc8d74c43f2d323d97bcd12"
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_source:
        raise SystemExit("Source SHA-256 mismatch; use the pinned upstream TTF.")
    woff2.brotli = NodeBrotli
    woff2.haveBrotli = True
    output = Path(__file__).with_name("PixelMplus12-Regular.woff2")
    font = TTFont(source, recalcTimestamp=False)
    font.flavor = "woff2"
    font.save(output)

    original = TTFont(source, recalcTimestamp=False)
    bundled = TTFont(output, recalcTimestamp=False)
    assert original.getBestCmap() == bundled.getBestCmap()
    assert original.getGlyphOrder() == bundled.getGlyphOrder()
    assert original["hmtx"].metrics == bundled["hmtx"].metrics
    assert original["name"].compile(original) == bundled["name"].compile(bundled)
    for name in original.getGlyphOrder():
        assert (original["glyf"][name].getCoordinates(original["glyf"])
                == bundled["glyf"][name].getCoordinates(bundled["glyf"]))
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f"{output.name}: {output.stat().st_size} bytes; SHA-256 {digest}")
    expected_output = "d49850831cea1508ed8e3b0ea8ace259a779807ce6c891d5bc30966b1d234b62"
    if digest != expected_output:
        raise SystemExit("Font data verified, but output bytes differ; check tool versions.")
    print("Verified the exact output hash and unchanged glyphs, cmap, metrics, and names.")


if __name__ == "__main__":
    main()
