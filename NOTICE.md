# Third-party notices

Huarong Road itself is MIT licensed (see `LICENSE`).

## Icons

Most button icons (undo/redo arrow, light bulb, checklist, replay, volume on/off, vibration, palette, help, delete, download,
expand arrow, back chevron, play arrow, star, save, dashboard, notifications bell) are adapted from **Material Design icons** by Google, licensed under the
**Apache License 2.0** (full text in `third_party/Apache-2.0.txt`): https://github.com/google/material-design-icons

They were re-typed into a single inline SVG sprite (`<symbol>` elements at the top of `src/index.html`, drawn with
`currentColor`) and may differ slightly from the originals. The gear, globe and timer icons are original to this project.
No Flaticon files are used.

## Fonts

Thai text is set in **Anuphan** (Copyright 2019 The Anuphan Project Authors, https://github.com/cadsondemak/Anuphan), licensed under the
**SIL Open Font License 1.1** (full text in `third_party/OFL-Anuphan.txt`). `src/fonts/Anuphan-thai.woff2` is the unmodified Thai-script
subset of the variable font as served by Google Fonts (weights 400-700); `build.js` inlines it into the page as base64 and it is used
only when the language is set to Thai. English text uses the phone's system font.
