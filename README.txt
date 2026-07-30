This project uses two type families loaded from Google Fonts at runtime
(see the <link> tags in index.html):

  - "Space Grotesk"  -> display / headings / brand
  - "JetBrains Mono" -> HUD labels, telemetry, monospaced data readouts
  - "Inter"          -> body copy / UI text

If you need a fully offline build (no CDN calls), download the three
families from https://fonts.google.com, drop the .woff2 files in this
folder, and replace the Google Fonts <link> tags in index.html with local
@font-face declarations pointing at fonts/<file>.woff2. The app already
has a full system-font fallback stack, so it works correctly even with
no network access -- the CDN fonts are a visual upgrade, not a dependency.
