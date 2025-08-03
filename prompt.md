You are a senior web-performance engineer and UX designer. Build a production-ready, high-performance browser-only web app named “Recordly” using pure HTML + CSS + vanilla ES-modules (no frameworks or external libraries).
=============== 1. File layout ===============
• index.html
• /css/style.css
• /js/app.js
=============== 2. Functional spec ===============
A. Capture

1. Primary source: full screen, window or tab, with system or tab audio – use navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }).
2. Secondary source: user webcam + mic via getUserMedia, rendered simultaneously as picture-in-picture overlay (PiP).
3. Composite the two sources into a single stream:
   • Use an <canvas> whose 2D context is drawn to via requestAnimationFrame.
   • Draw display frame first, then webcam frame clipped to a circle.
   • The resulting canvas.captureStream(30) is the video track fed to MediaRecorder.
   • Merge audio tracks with new MediaStream([displayAudio, micAudio]) via AudioContext to avoid echo.
4. Encode with MediaRecorder (target mime video/webm;codecs=vp9,opus). Use timeslice = 4 000 ms to flush small blobs and keep memory low; concatenate on stop.

B. Controls
• “Start” (disabled until both permissions granted)
• “Pause / Resume”
• “Stop & Save”
• Live HH:MM:SS timer
• Thumbnail gallery of finished recordings (object URLs, auto-revoke after download)
C. Overlay UX
• Circular webcam overlay (default 22 % of shorter viewport edge)
• Draggable and resizable (CSS resize: both) within viewport bounds
• Double-click toggles between 4 preset sizes
• Keyboard ←↑→↓ nudges (8 px)
=============== 3. Performance & resource guarantees ===============

1. Zero large synchronous work on the main thread:
   • Defer script and split non-critical code behind requestIdleCallback.
2. Memory ceiling ≤ 200 MB in a 1080p/30 session:
   • Flush recorder every 4 s.
   • Revoke all object URLs after use.
3. UI thread FPS ≥ 55 on a 2018 MacBook Air:
   • Only one RAF loop, no setInterval for video drawing.
   • Use CSS Transforms for overlay movement (no layout thrash).
4. Stop every track and disconnect AudioNodes on:
   • “Stop”, page hide, or beforeunload.

=============== 4. Progressive enhancement ===============
• If MediaStreamTrackProcessor & WebCodecs are supported, bypass canvas compositing and encode with VideoEncoder for ~30 % lower CPU; otherwise gracefully fall back.
• Feature-detect HEVC and AV1 codecs and choose the first supported.
=============== 5. UI / visual design ===============
• Clean, card-based layout in the middle of the viewport.
• Tailwind-like palette:
– Primary #6366F1
– Accent (success) #10B981
– Accent (error) #EF4444
• Responsive: mobile first, max-width 960 px desktop card.
• Dark-mode via @media (prefers-color-scheme: dark).
• Reduced-motion media query disables button ripple.
• Icon buttons (SVG inline, no fonts).
• Smooth 200 ms transitions, will-change: transform for overlay.
=============== 6. Code quality rules ===============
• One ES6 module /js/app.js, top-level init() called on DOMContentLoaded.
• Use strict TypeScript-compatible JSDoc on every function.
• No global leaks (everything inside the module scope).
• Use async/await; never .then().catch() chains.
• Wrap every async call in try/catch with user-facing toast on error.
• eslint-style: 2-space indent, semicolons mandatory, single quotes.
=============== 7. Deliverables format ===============
Return three fenced code blocks tagged html, css, javascript, in that order, containing:

1. Full index.html with <link rel="preload"> for critical CSS, <meta name="viewport">, and defer script load.
2. style.css (only what is not inlined as critical CSS).
3. app.js.
   After the code blocks, add a short “Run locally” section (open index.html). No other narrative.

=============== 8. Extra credit (implement if time budget allows) ===============
• Recording scheduler: start after N-second countdown.
• Option to hide cursor in final video.
• Basic internationalisation scaffold (JSON locale files).
IMPORTANT: Your solution must pass Google Lighthouse Performance ≥ 95 on desktop 1366×768, CPU throttling “4× slow”.
Focus relentlessly on performance, memory, and UX polish.
