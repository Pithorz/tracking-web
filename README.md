# PERIMETER — Visual Telemetry Console

A premium, dark, glassmorphic camera dashboard with an OSINT-tool-inspired
HUD: scan-line sweeps, a radar instrument, corner brackets, a live reticle,
and a real-time telemetry readout — all wrapped around a genuine live
camera preview. There is no fake location tracking, no simulated personal
data, and no invented "target" information anywhere in the app; every
number on screen (resolution, frame rate, facing mode, device count,
clock, capture count, session time) is read directly from the browser's
Media Capture APIs.

## Features

- **Camera**
  - Automatic detection of available cameras (`enumerateDevices`)
  - Front (selfie) / back camera switching, one tap
  - High-resolution live preview (`1920×1080` ideal, cover-fit)
  - Torch/flash toggle when the active device supports it
  - Clear, specific error states: permission denied, no camera found,
    camera busy, unsupported browser
- **HUD dashboard**
  - Animated boot / calibration sequence tied to real init steps
  - Live status pill (STANDBY / CONNECTING / LIVE / OFFLINE)
  - Radar sweep, scanning line, reticle, corner brackets — pure CSS/JS,
    GPU-friendly transforms and opacity only
  - Optional rule-of-thirds composition grid
  - Collapsible session log panel with real timestamped events and
    live metrics (resolution, lens, device count, fps, captures, uptime)
- **Capture**
  - Snap the current frame to a review modal
  - Download the capture as a PNG (mirrored correctly for the front camera)
- **UX**
  - Glassmorphism panels (backdrop blur + translucent borders)
  - Dark mode by default, tuned for OLED contrast
  - Fully responsive: mobile (mobile-first), tablet, desktop
  - Reduced-motion support (`prefers-reduced-motion`)
  - No build step — plain HTML/CSS/JS, works by opening `index.html`

## Project structure

```
/project
├── index.html        Markup for boot screen, HUD, dock, log panel, modal
├── style.css          Design tokens + all styling/animation
├── script.js          Camera logic, HUD telemetry, capture, session log
├── assets/
│   └── logo.svg        Brand mark (reticle motif)
├── icons/               UI icons (SVG, currentColor-based)
│   ├── camera-switch.svg
│   ├── capture.svg
│   ├── flash-on.svg / flash-off.svg
│   ├── grid.svg
│   ├── download.svg
│   ├── close.svg
│   ├── target.svg
│   ├── log.svg
│   └── chevron.svg
├── fonts/
│   └── README.txt       How to swap the CDN Google Fonts for local files
└── README.md
```

## Running it

No build tools, no dependencies, no server required:

1. Extract the ZIP.
2. Open `index.html` in a modern browser (Chrome, Edge, Safari, Firefox).
3. Allow camera access when prompted.

Camera access requires a **secure context**. Opening the file directly
(`file://`) works in most desktop browsers for local testing, but for
mobile devices or stricter browsers, serve it over `https://` or
`http://localhost`. A one-line local server, if you want one:

```bash
# Python 3
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Browser support notes

- Torch/flash control depends on `MediaTrackCapabilities.torch`, which is
  currently Chromium-only on Android; the button hides itself automatically
  when unsupported.
- Precise frame-rate measurement uses `requestVideoFrameCallback` where
  available, with a `requestAnimationFrame`-based fallback otherwise.
- All camera errors (`NotAllowedError`, `NotFoundError`, `NotReadableError`,
  `OverconstrainedError`) are caught and shown as specific, actionable
  messages instead of a generic failure.

## Customizing

All colors, type, radii, and easing live as CSS custom properties at the
top of `style.css` (`:root`), so re-theming is a matter of editing one
block rather than hunting through the file.
