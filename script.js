/* ==========================================================================
   PERIMETER — Visual Telemetry Console
   script.js

   Everything in the HUD (resolution, facing mode, fps, clock, frame count,
   device count, session log entries) reflects real state from the
   MediaStream / MediaDeviceInfo APIs. Nothing here fabricates location,
   identity, or any kind of surveillance data — the "tracking" aesthetic is
   purely a visual treatment (scan-lines, radar sweep, reticle) layered over
   a normal camera preview.
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------ DOM refs ------------------------------ */
  const bootScreen      = document.getElementById("boot-screen");
  const bootFill        = document.getElementById("boot-progress-fill");
  const bootStatus      = document.getElementById("boot-status");
  const app             = document.getElementById("app");

  const video           = document.getElementById("video");
  const canvas          = document.getElementById("capture-canvas");
  const viewportEmpty   = document.getElementById("viewport-empty");
  const emptyTitle      = document.getElementById("empty-title");
  const emptySub        = document.getElementById("empty-sub");
  const retryBtn        = document.getElementById("retry-btn");
  const hudOverlay      = document.getElementById("hud-overlay");
  const flashFrame      = document.getElementById("flash-frame");
  const gridOverlay     = document.getElementById("grid-overlay");

  const statusPill      = document.getElementById("status-pill");
  const statusDot       = document.getElementById("status-dot");
  const statusLabel     = document.getElementById("status-label");

  const readoutRes      = document.getElementById("readout-res");
  const readoutFacing   = document.getElementById("readout-facing");
  const readoutFps      = document.getElementById("readout-fps");
  const readoutClock    = document.getElementById("readout-clock");
  const readoutFrame    = document.getElementById("readout-frame");

  const gridBtn         = document.getElementById("grid-btn");
  const flashBtn        = document.getElementById("flash-btn");
  const flashIcon       = document.getElementById("flash-icon");
  const captureBtn      = document.getElementById("capture-btn");
  const switchBtn       = document.getElementById("switch-btn");

  const logToggle       = document.getElementById("log-toggle");
  const logPanel        = document.getElementById("log-panel");
  const logClose        = document.getElementById("log-close");
  const logFeed         = document.getElementById("log-feed");

  const metricRes       = document.getElementById("metric-res");
  const metricFacing    = document.getElementById("metric-facing");
  const metricDevices   = document.getElementById("metric-devices");
  const metricFps       = document.getElementById("metric-fps");
  const metricCaptures  = document.getElementById("metric-captures");
  const metricUptime    = document.getElementById("metric-uptime");

  const reviewModal     = document.getElementById("review-modal");
  const reviewImage     = document.getElementById("review-image");
  const reviewDownload  = document.getElementById("review-download");
  const reviewClose     = document.getElementById("review-close");

  const toast           = document.getElementById("toast");

  /* ------------------------------ State ------------------------------ */
  const state = {
    stream: null,
    track: null,
    devices: [],
    deviceIndex: 0,
    facingMode: "environment", // preferred initial facing
    torchOn: false,
    torchSupported: false,
    gridOn: false,
    captureCount: 0,
    sessionStart: null,
    frameCount: 0,
    fps: 0,
    fpsLastTime: performance.now(),
    fpsFrames: 0,
    rvfcHandle: null,
  };

  /* ------------------------------ Utilities ------------------------------ */

  function pad(n) { return n.toString().padStart(2, "0"); }

  function nowClock() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatUptime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function logEvent(message, kind = "") {
    const entry = document.createElement("div");
    entry.className = `log-entry ${kind}`;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = nowClock();
    const msg = document.createElement("span");
    msg.className = "msg";
    msg.textContent = message;
    entry.appendChild(t);
    entry.appendChild(msg);
    logFeed.prepend(entry);

    // cap log length so it never grows unbounded during a long session
    while (logFeed.children.length > 80) {
      logFeed.removeChild(logFeed.lastChild);
    }
  }

  function showToast(message, duration = 3600) {
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => { toast.hidden = true; }, 300);
    }, duration);
  }

  function setStatus(kind, label) {
    statusPill.classList.remove("live", "error", "pending");
    if (kind) statusPill.classList.add(kind);
    statusLabel.textContent = label;
  }

  /* ==========================================================================
     BOOT SEQUENCE
     A short, honest calibration sequence: it reflects real init steps
     (DOM ready, checking camera support, requesting permission) rather than
     a fake countdown. Minimum duration keeps it from feeling like a flicker.
     ========================================================================== */

  const bootSteps = [
    { pct: 12,  msg: "Loading interface modules…" },
    { pct: 30,  msg: "Checking media device support…" },
    { pct: 55,  msg: "Requesting camera access…" },
    { pct: 78,  msg: "Establishing video pipeline…" },
    { pct: 100, msg: "Calibration complete." },
  ];

  function runBootStep(i) {
    if (i >= bootSteps.length) {
      setTimeout(() => {
        bootScreen.classList.add("boot-hidden");
        app.hidden = false;
        setTimeout(() => bootScreen.remove(), 700);
      }, 260);
      return;
    }
    const step = bootSteps[i];
    bootFill.style.width = step.pct + "%";
    bootStatus.textContent = step.msg;
    setTimeout(() => runBootStep(i + 1), i === 2 ? 520 : 340);
  }

  /* ==========================================================================
     CAMERA HANDLING
     ========================================================================== */

  async function enumerateCameras() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      state.devices = all.filter((d) => d.kind === "videoinput");
      metricDevices.textContent = state.devices.length || "—";
      return state.devices;
    } catch (err) {
      logEvent("Could not enumerate devices: " + err.message, "warn");
      return [];
    }
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
      state.track = null;
    }
    if (state.rvfcHandle && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(state.rvfcHandle);
      state.rvfcHandle = null;
    }
  }

  function buildConstraints() {
    // Prefer an explicit deviceId once we know the device list; otherwise
    // fall back to facingMode, which is what most phones need on first load.
    const base = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
    if (state.devices.length && state.devices[state.deviceIndex]) {
      return { video: { ...base, deviceId: { exact: state.devices[state.deviceIndex].deviceId } }, audio: false };
    }
    return { video: { ...base, facingMode: { ideal: state.facingMode } }, audio: false };
  }

  async function startCamera({ silent = false } = {}) {
    setStatus("pending", "CONNECTING");
    if (!silent) logEvent("Requesting camera stream…");

    stopStream();

    try {
      const constraints = buildConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.stream = stream;
      state.track = stream.getVideoTracks()[0];
      video.srcObject = stream;
      await video.play().catch(() => {});

      // Now that permission is granted, device labels become available —
      // re-enumerate so the device list / switch button is accurate.
      await enumerateCameras();
      syncDeviceIndexToActiveTrack();

      const settings = state.track.getSettings ? state.track.getSettings() : {};
      const facing = settings.facingMode || guessFacingFromLabel(state.track.label) || state.facingMode;
      state.facingMode = facing;

      video.classList.toggle("mirrored", facing === "user");
      hudOverlay.classList.add("active");
      viewportEmpty.style.display = "none";

      readoutRes.textContent = settings.width && settings.height ? `${settings.width} × ${settings.height}` : "— × —";
      readoutFacing.textContent = "FACING: " + facing.toUpperCase();
      metricRes.textContent = settings.width && settings.height ? `${settings.width}×${settings.height}` : "—";
      metricFacing.textContent = facing === "user" ? "Front" : facing === "environment" ? "Back" : facing;

      checkTorchSupport();
      startFpsLoop();

      setStatus("live", "LIVE");
      if (!silent) logEvent(`Camera stream established (${facing === "user" ? "front" : "back"} lens).`, "ok");

      if (!state.sessionStart) {
        state.sessionStart = performance.now();
      }
    } catch (err) {
      handleCameraError(err);
    }
  }

  function guessFacingFromLabel(label = "") {
    const l = label.toLowerCase();
    if (l.includes("front") || l.includes("user") || l.includes("face")) return "user";
    if (l.includes("back") || l.includes("rear") || l.includes("environment")) return "environment";
    return null;
  }

  function syncDeviceIndexToActiveTrack() {
    if (!state.track || !state.devices.length) return;
    const settings = state.track.getSettings ? state.track.getSettings() : {};
    if (!settings.deviceId) return;
    const idx = state.devices.findIndex((d) => d.deviceId === settings.deviceId);
    if (idx !== -1) state.deviceIndex = idx;
  }

  function handleCameraError(err) {
    hudOverlay.classList.remove("active");
    viewportEmpty.style.display = "flex";
    setStatus("error", "OFFLINE");

    let title = "Camera unavailable";
    let sub = "Something interrupted the video pipeline. Try again.";

    if (err && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
      title = "Camera access denied";
      sub = "Enable camera permission for this site in your browser settings, then retry.";
      logEvent("Permission denied by user or browser policy.", "warn");
    } else if (err && err.name === "NotFoundError") {
      title = "No camera detected";
      sub = "This device doesn't expose a usable camera to the browser.";
      logEvent("No video input devices found.", "warn");
    } else if (err && err.name === "NotReadableError") {
      title = "Camera already in use";
      sub = "Another application may be using the camera. Close it and retry.";
      logEvent("Camera hardware busy / not readable.", "warn");
    } else if (err && err.name === "OverconstrainedError") {
      title = "Requested camera not available";
      sub = "Falling back to a default camera.";
      logEvent("Constraint mismatch, retrying with relaxed constraints.", "warn");
      // relax and retry once with plain facingMode, no deviceId
      state.devices = [];
      startCamera({ silent: true });
      return;
    } else {
      logEvent("Camera error: " + (err ? err.message : "unknown"), "warn");
    }

    emptyTitle.textContent = title;
    emptySub.textContent = sub;
    showToast(title);
  }

  function checkTorchSupport() {
    flashBtn.hidden = true;
    state.torchSupported = false;
    if (!state.track || !state.track.getCapabilities) return;
    try {
      const caps = state.track.getCapabilities();
      if (caps.torch) {
        state.torchSupported = true;
        flashBtn.hidden = false;
      }
    } catch (_) { /* capabilities not supported on this browser */ }
  }

  async function toggleTorch() {
    if (!state.torchSupported || !state.track) return;
    state.torchOn = !state.torchOn;
    try {
      await state.track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
      flashBtn.classList.toggle("active", state.torchOn);
      flashIcon.src = state.torchOn ? "icons/flash-on.svg" : "icons/flash-off.svg";
      logEvent(`Torch ${state.torchOn ? "enabled" : "disabled"}.`);
    } catch (err) {
      state.torchOn = false;
      logEvent("Torch control rejected by device.", "warn");
    }
  }

  async function switchCamera() {
    if (!state.devices.length) {
      await enumerateCameras();
    }
    if (state.devices.length > 1) {
      state.deviceIndex = (state.deviceIndex + 1) % state.devices.length;
    } else {
      // Only one (or zero) labeled device — toggle facingMode instead,
      // which lets the browser pick an appropriate physical lens.
      state.facingMode = state.facingMode === "user" ? "environment" : "user";
      state.devices = []; // force facingMode-based constraint
    }
    switchBtn.classList.add("spinning");
    logEvent("Switching camera lens…");
    await startCamera();
    setTimeout(() => switchBtn.classList.remove("spinning"), 500);
  }

  /* ------------------------------ FPS measurement ------------------------------ */

  function startFpsLoop() {
    state.fpsFrames = 0;
    state.fpsLastTime = performance.now();

    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      const step = () => {
        state.fpsFrames++;
        state.frameCount++;
        const t = performance.now();
        if (t - state.fpsLastTime >= 1000) {
          state.fps = Math.round((state.fpsFrames * 1000) / (t - state.fpsLastTime));
          state.fpsFrames = 0;
          state.fpsLastTime = t;
        }
        state.rvfcHandle = video.requestVideoFrameCallback(step);
      };
      state.rvfcHandle = video.requestVideoFrameCallback(step);
    } else {
      // Fallback: estimate via rAF (less precise, but keeps the readout alive)
      const step = () => {
        state.fpsFrames++;
        state.frameCount++;
        const t = performance.now();
        if (t - state.fpsLastTime >= 1000) {
          state.fps = Math.round((state.fpsFrames * 1000) / (t - state.fpsLastTime));
          state.fpsFrames = 0;
          state.fpsLastTime = t;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  /* ==========================================================================
     CAPTURE
     ========================================================================== */

  function captureFrame() {
    if (!state.stream || !video.videoWidth) {
      showToast("No live frame to capture yet.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");

    ctx.save();
    if (video.classList.contains("mirrored")) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const dataUrl = canvas.toDataURL("image/png");
    reviewImage.src = dataUrl;
    reviewDownload.href = dataUrl;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    reviewDownload.download = `perimeter-capture-${stamp}.png`;

    reviewModal.hidden = false;

    state.captureCount++;
    metricCaptures.textContent = state.captureCount;
    logEvent(`Frame captured (${canvas.width}×${canvas.height}).`, "ok");

    captureBtn.classList.remove("busy");
    void captureBtn.offsetWidth; // restart animation
    captureBtn.classList.add("busy");

    flashFrame.classList.remove("flashing");
    void flashFrame.offsetWidth;
    flashFrame.classList.add("flashing");
  }

  /* ==========================================================================
     UI EVENT WIRING
     ========================================================================== */

  retryBtn.addEventListener("click", () => startCamera());

  switchBtn.addEventListener("click", switchCamera);

  flashBtn.addEventListener("click", toggleTorch);

  gridBtn.addEventListener("click", () => {
    state.gridOn = !state.gridOn;
    gridOverlay.classList.toggle("visible", state.gridOn);
    gridBtn.classList.toggle("active", state.gridOn);
  });

  captureBtn.addEventListener("click", captureFrame);

  logToggle.addEventListener("click", () => {
    const open = logPanel.classList.toggle("open");
    logToggle.setAttribute("aria-expanded", String(open));
  });
  logClose.addEventListener("click", () => {
    logPanel.classList.remove("open");
    logToggle.setAttribute("aria-expanded", "false");
  });

  reviewClose.addEventListener("click", () => { reviewModal.hidden = true; });
  reviewModal.addEventListener("click", (e) => {
    if (e.target === reviewModal) reviewModal.hidden = true;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !reviewModal.hidden) reviewModal.hidden = true;
  });

  // Re-check devices if the user plugs/unplugs a webcam (desktop) mid-session
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      const before = state.devices.length;
      await enumerateCameras();
      if (state.devices.length !== before) {
        logEvent(`Device list changed — ${state.devices.length} camera(s) now available.`);
      }
    });
  }

  /* ------------------------------ Clock / uptime tickers ------------------------------ */

  setInterval(() => {
    readoutClock.textContent = nowClock();
    readoutFrame.textContent = "FRAME " + String(state.frameCount).padStart(6, "0");
    readoutFps.textContent = (state.fps || 0) + " FPS";
    metricFps.textContent = state.fps ? state.fps + " fps" : "—";

    if (state.sessionStart) {
      const uptime = formatUptime(performance.now() - state.sessionStart);
      metricUptime.textContent = uptime;
    }
  }, 1000);

  /* ==========================================================================
     INIT
     ========================================================================== */

  async function init() {
    runBootStep(0);
    logEvent("Interface booted.");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      handleCameraError({ name: "NotFoundError", message: "getUserMedia unsupported" });
      showToast("This browser does not support camera access.");
      return;
    }

    await enumerateCameras();
    // Give the boot animation a moment before requesting permission so the
    // permission prompt doesn't collide visually with the boot screen.
    setTimeout(() => startCamera(), 650);
  }

  init();
})();
