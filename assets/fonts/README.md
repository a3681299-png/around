# Offline pixel font

`PixelMplus12-Regular.woff2` is the complete, unsubsetted PixelMplus12 Regular
font, compressed from the original TTF. No external font request is required.

- Upstream family: `"PixelMplus12"`; application alias: `"Web World Pixel"`
- Native intended size: **12 CSS px**; use whole multiples such as 24px when
  scaling intentionally, and an explicit line-height appropriate for the UI
- Weight/style: `400` / `normal`; use `font-synthesis: none` to avoid synthetic bold
- Size: 275,832 bytes (about 269 KiB)
- Coverage: all 7,253 upstream glyphs and 7,251 Unicode mappings, including
  upstream's JIS level-1 and level-2 kanji, kana, and Latin-1
- This is not every Unicode character. Keep a system fallback for characters
  outside the source font, including emoji and less common scripts/kanji

The extension registers a local `FontFace` using `format("woff2")` and
`chrome.runtime.getURL("assets/fonts/PixelMplus12-Regular.woff2")`, then adds it
to the document font set so both page chrome and the Shadow DOM editor can use it.
The build copies this file; the manifest exposes only this font to YouTube through
`web_accessible_resources`. No `local()` source or third-party font request is used. Browser/device pixel ratio and zoom still
affect rasterization; CSS font-smoothing properties cannot guarantee aliased
text on every platform.

## License and source

The upstream **M+ FONT LICENSE** permits use, copying and distribution, with or
without modification, commercially or noncommercially. The unmodified license
is in `PixelMplus-LICENSE.txt`; the unmodified upstream README is preserved in
`PixelMplus-README.upstream.md`. This older PixelMplus source uses the M+ license,
not the SIL OFL used by some newer, separate M+ font projects.

Copyright (C) 2013 itouhiro  
Copyright (C) 2002-2013 M+ FONTS PROJECT

- Project: https://github.com/itouhiro/PixelMplus
- Pinned commit: `d89b95f04eeb95bf98bb09cb9234a2f99d186df5`
- Version: `2013.0602`
- Retrieved: 2026-10-04 UTC
- Detailed source URLs, input/output hashes, sizes and validation results:
  `PixelMplus-SOURCE.json`

## Rebuild and verify

Download the original TTF from the immutable upstream URL recorded in
`PixelMplus-SOURCE.json`, then run:

```sh
python assets/fonts/rebuild_pixelmplus.py /path/to/PixelMplus12-Regular.ttf
```

The script checks the source SHA-256 before conversion. It uses fontTools
4.61.1, Node.js 24.19.0's built-in Brotli 1.2.0, WOFF2 font-mode quality 11, and
`recalcTimestamp=False`. No glyphs are removed or redesigned. It decodes the
result and compares every glyph outline, character map, horizontal metric and
name-table byte with the original. It also checks the exact output SHA-256:

`d49850831cea1508ed8e3b0ea8ace259a779807ce6c891d5bc30966b1d234b62`

The source TTF is not duplicated in the extension to keep its download small.
