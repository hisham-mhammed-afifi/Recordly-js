// compositor.worker.js

let ctx = null;
let canvas = null;
let isRunning = false;
let config = null;

let screenReader;
let webcamReader;
let writer;

let lastFrameTime = 0;

self.onmessage = async (e) => {
  const {
    type,
    screenReadable,
    webcamReadable,
    combinedWritable,
    config: cfg,
  } = e.data || {};

  if (type === "init") {
    try {
      if (!self.OffscreenCanvas)
        throw new Error("OffscreenCanvas not supported in Worker");

      config = cfg || {};
      const { width, height } = config;

      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("2D context unavailable");

      screenReader = screenReadable.getReader();
      webcamReader = webcamReadable.getReader();
      writer = combinedWritable.getWriter();

      isRunning = true;
      self.postMessage({ type: "ready" });

      composeLoop().catch((err) => {
        self.postMessage({ type: "error", data: String(err) });
      });
    } catch (err) {
      self.postMessage({ type: "error", data: String(err) });
    }
    return;
  }

  if (type === "stop") {
    stop();
  }
};

async function composeLoop() {
  let screenFrame = null;
  let webcamFrame = null;

  // Attempt to draw VideoFrame directly; if not, fallback to ImageBitmap
  const draw = async (vf, dx, dy, dw, dh) => {
    try {
      // Chrome supports drawImage(VideoFrame) on 2D; if it throws, use bitmap
      ctx.drawImage(vf, dx, dy, dw, dh);
    } catch {
      const bmp = await createImageBitmap(vf);
      ctx.drawImage(bmp, dx, dy, dw, dh);
      bmp.close();
    }
  };

  const targetFrameTime = 1000 / (config.frameRate || 30);

  while (isRunning) {
    const now = performance.now();
    const delta = now - lastFrameTime;
    if (delta < targetFrameTime) {
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }

    // Read newest available frames
    const [s, w] = await Promise.all([
      screenReader.read(),
      webcamReader.read(),
    ]);
    if (s.done || w.done) break;

    if (screenFrame) screenFrame.close();
    if (webcamFrame) webcamFrame.close();

    screenFrame = s.value; // VideoFrame
    webcamFrame = w.value; // VideoFrame

    // Composite
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    await draw(screenFrame, 0, 0, W, H);

    // PiP sizing/position (mirrored)
    const pipW = Math.min(200, Math.floor(W * 0.2));
    const pipH = Math.floor(
      (pipW * webcamFrame.displayHeight) / webcamFrame.displayWidth
    );
    const pipX = W - pipW - 20;
    const pipY = H - pipH - 20;

    ctx.save();
    ctx.scale(-1, 1);
    // Note: x is negative because we flipped the x-axis
    await draw(webcamFrame, -pipX - pipW, pipY, pipW, pipH);
    ctx.restore();

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(pipX, pipY, pipW, pipH);

    // Create composed frame (timestamp: keep screenFrame timestamp if present)
    const composed = new VideoFrame(canvas, {
      timestamp:
        typeof screenFrame.timestamp === "number"
          ? screenFrame.timestamp
          : Math.round(now * 1000),
    });

    await writer.write(composed);
    composed.close();

    lastFrameTime = now;
  }

  // Cleanup
  if (screenFrame) screenFrame.close();
  if (webcamFrame) webcamFrame.close();
  await closeWriter();
}

async function closeWriter() {
  try {
    await writer?.close();
  } catch {}
}

function stop() {
  isRunning = false;
  closeWriter();
}
