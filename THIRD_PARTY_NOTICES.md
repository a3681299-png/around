# Third-party notices

## Lottie Web Light 5.13.0

This experimental branch bundles the SVG-only, expression-free light player
from [airbnb/lottie-web](https://github.com/airbnb/lottie-web), under the MIT license.
Copyright (c) 2015 Bodymovin.

The upstream automatic document discovery interval is disabled: the extension
only supplies validated local `animationData`, never page-provided paths.
The pinned source, checksums, and modification are in `src/vendor/lottie-source.json`.
Run `npm pack lottie-web@5.13.0 --pack-destination .work --ignore-scripts` and
`python scripts/vendor_lottie.py` to reproduce the bundled file.
The complete license is preserved in `assets/licenses/lottie-web-MIT.txt`.

## PixelMplus12 Regular

This extension bundles `assets/fonts/PixelMplus12-Regular.woff2`, a WOFF2
compression of the full PixelMplus12 Regular font without glyph subsetting.

Copyright (C) 2013 itouhiro  
Copyright (C) 2002-2013 M+ FONTS PROJECT

- Project: https://github.com/itouhiro/PixelMplus
- Source commit: `d89b95f04eeb95bf98bb09cb9234a2f99d186df5`
- License: **M+ FONT LICENSE** (the original upstream version)
- Original license: [`assets/fonts/PixelMplus-LICENSE.txt`](assets/fonts/PixelMplus-LICENSE.txt)
- Upstream README: [`assets/fonts/PixelMplus-README.upstream.md`](assets/fonts/PixelMplus-README.upstream.md)
- Source and generated-file hashes: [`assets/fonts/PixelMplus-SOURCE.json`](assets/fonts/PixelMplus-SOURCE.json)
- Rebuild and integration notes: [`assets/fonts/README.md`](assets/fonts/README.md)

The font's license is preserved verbatim with the bundled files. It grants
unlimited permission to use, copy and distribute the fonts, with or without
modification, commercially or noncommercially, without warranty. The font
continues to be distributed under its upstream license; the extension's own
license does not replace it.

## Three.js 0.186.1

Bundled locally from [mrdoob/three.js](https://github.com/mrdoob/three.js/tree/r186).
Copyright © 2010–2026 three.js authors. MIT license, preserved in
`assets/licenses/three-MIT.txt`. GLTFLoader and SkeletonUtils use the same license.
No CDN, remote decoder or third-party executable asset is loaded at runtime.

## @pixiv/three-vrm 3.5.5

Bundled locally from [pixiv/three-vrm](https://github.com/pixiv/three-vrm).
Copyright (c) 2019-2026 pixiv Inc. MIT license, preserved verbatim in
`assets/licenses/three-vrm-MIT.txt`. The bundled core, MToon, HDR emissive,
VRM 0.x material compatibility, node constraint and spring bone packages
use the same upstream license. Package versions are pinned in package-lock.json.

No third-party avatar, model texture or avatar screenshot is included.
An avatar's own license remains separate from these software licenses.
