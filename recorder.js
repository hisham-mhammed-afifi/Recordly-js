/**
 * Recordly - Recording Engine
 * Handles MediaRecorder, stream management, and WebCodecs optimization
 */

export class Recorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.streams = {
      screen: null,
      webcam: null,
      combined: null,
    };
    this.capabilities = {
      webCodecs: false,
      offscreenCanvas: false,
    };
    this.eventListeners = new Map();
    this.worker = null;
    this.canvas = null;
    this.canvasStream = null;
    this.audioContext = null;
    this.isRecording = false;
    this.maxChunks = 1000; // Bounded queue size
  }

  /**
   * Set browser capabilities
   */
  setCapabilities(capabilities) {
    this.capabilities = { ...capabilities };
    console.log("Recorder capabilities set:", this.capabilities);
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Emit event
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Start recording with given configuration
   */
  async start(config) {
    try {
      performance.mark("recorder-start");

      await this.setupStreams(config);
      await this.setupRecorder(config);

      this.mediaRecorder.start(1000); // 1 second timeslice for bounded memory
      this.isRecording = true;

      performance.mark("recorder-start-complete");
      console.log("Recording started with config:", config);
    } catch (error) {
      await this.cleanup();
      throw new Error(`Failed to start recording: ${error.message}`);
    }
  }

  /**
   * Setup media streams based on mode
   */
  async setupStreams(config) {
    const { mode, video, audio, deviceId } = config;

    try {
      // Screen capture
      if (mode === "screen" || mode === "combined") {
        this.streams.screen = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: video.width,
            height: video.height,
            frameRate: video.frameRate,
          },
          audio: audio.system,
        });

        // Handle screen share stop
        this.streams.screen
          .getVideoTracks()[0]
          .addEventListener("ended", () => {
            console.log("Screen sharing stopped by user");
            this.emit("error", new Error("Screen sharing was stopped"));
          });
      }

      // Webcam capture
      if (mode === "webcam" || mode === "combined") {
        const constraints = {
          video: {
            width: { ideal: video.width },
            height: { ideal: video.height },
            frameRate: { ideal: video.frameRate },
          },
          audio: audio.mic,
        };

        if (deviceId && deviceId !== "") {
          constraints.video.deviceId = { exact: deviceId };
        }

        this.streams.webcam = await navigator.mediaDevices.getUserMedia(
          constraints
        );
      }

      // Create combined stream if needed
      if (mode === "combined") {
        await this.createCombinedStream(config);
      }
    } catch (error) {
      throw new Error(`Stream setup failed: ${error.message}`);
    }
  }

  /**
   * Create combined stream with screen + webcam overlay
   */
  async createCombinedStream(config) {
    // Use WebCodecs path if available, otherwise fall back to Canvas
    if (this.capabilities.webCodecs && this.capabilities.offscreenCanvas) {
      await this.createCombinedStreamWebCodecs(config);
    } else {
      await this.createCombinedStreamCanvas(config);
    }
  }

  /**
   * Create combined stream using WebCodecs (optimized path)
   */
  async createCombinedStreamWebCodecs(config) {
    // Wrap the whole init in a promise that resolves when combined stream is set
    return new Promise(async (resolve, reject) => {
      try {
        this.worker = new Worker("./compositor.worker.js", { type: "module" });

        const { video } = config;
        const screenTrack = this.streams.screen.getVideoTracks()[0];
        const webcamTrack = this.streams.webcam.getVideoTracks()[0];

        // Build insertable streams
        const screenProcessor = new MediaStreamTrackProcessor({
          track: screenTrack,
        });
        const webcamProcessor = new MediaStreamTrackProcessor({
          track: webcamTrack,
        });
        const combinedGenerator = new MediaStreamTrackGenerator({
          kind: "video",
        });

        // Optional frame-rate hint
        if (video?.frameRate) {
          screenTrack
            .applyConstraints?.({ frameRate: video.frameRate })
            .catch(() => {});
          webcamTrack
            .applyConstraints?.({ frameRate: video.frameRate })
            .catch(() => {});
        }

        const onError = (msg) => {
          console.error("Worker error:", msg);
          // Fallback to canvas; resolve/reject based on fallback result
          this.fallbackToCanvas(config).then(resolve).catch(reject);
        };

        this.worker.onmessage = (e) => {
          const { type, data } = e.data || {};
          if (type === "ready") {
            // Build final stream (video from generator + mixed audio)
            this.combineAudioWithVideoTrack(combinedGenerator, config)
              .then((stream) => {
                this.streams.combined = stream;
                resolve(); // ✅ now setupStreams() can continue
              })
              .catch((err) => {
                console.warn("Audio mixing failed, using video only:", err);
                this.streams.combined = new MediaStream([combinedGenerator]);
                resolve();
              });
          } else if (type === "error") {
            onError(data);
          }
        };

        // Send transferable streams
        this.worker.postMessage(
          {
            type: "init",
            screenReadable: screenProcessor.readable,
            webcamReadable: webcamProcessor.readable,
            combinedWritable: combinedGenerator.writable,
            config: {
              width: video.width,
              height: video.height,
              frameRate: video.frameRate,
            },
          },
          [
            screenProcessor.readable,
            webcamProcessor.readable,
            combinedGenerator.writable,
          ]
        );

        // Safety timeout (optional)
        setTimeout(() => {
          if (!this.streams.combined) {
            onError("Timed out waiting for worker ready");
          }
        }, 5000);
      } catch (error) {
        console.warn("WebCodecs path failed, falling back to Canvas:", error);
        try {
          await this.createCombinedStreamCanvas(config);
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  /**
   * Terminate worker (if any) and fall back to Canvas compositor.
   */
  async fallbackToCanvas(config) {
    try {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    } catch (_) {
      /* no-op */
    }
    await this.createCombinedStreamCanvas(config);
  }

  /**
   * Create combined stream using Canvas (fallback path)
   */
  async createCombinedStreamCanvas(config) {
    const { video } = config;

    // Create canvas for compositing
    this.canvas = document.createElement("canvas");
    this.canvas.width = video.width;
    this.canvas.height = video.height;

    const ctx = this.canvas.getContext("2d");

    // Create video elements for sources
    const screenVideo = document.createElement("video");
    const webcamVideo = document.createElement("video");

    screenVideo.srcObject = this.streams.screen;
    webcamVideo.srcObject = this.streams.webcam;
    screenVideo.muted = true;
    webcamVideo.muted = true;

    // Wait for videos to be ready
    await Promise.all([
      new Promise((resolve) => {
        screenVideo.addEventListener("loadedmetadata", resolve);
        screenVideo.play();
      }),
      new Promise((resolve) => {
        webcamVideo.addEventListener("loadedmetadata", resolve);
        webcamVideo.play();
      }),
    ]);

    // Set up compositing loop
    const drawFrame = () => {
      // Keep preview alive regardless of MediaRecorder state
      if (!this.streams.screen && !this.streams.webcam) return; // nothing to draw
      // if (!this.isRecording) return;

      // Clear canvas
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, video.width, video.height);

      // Draw screen
      if (screenVideo.videoWidth > 0 && screenVideo.videoHeight > 0) {
        ctx.drawImage(screenVideo, 0, 0, video.width, video.height);
      }

      // Draw webcam overlay (mirrored, bottom-right)
      if (webcamVideo.videoWidth > 0 && webcamVideo.videoHeight > 0) {
        const pipWidth = Math.min(200, video.width * 0.2);
        const pipHeight =
          (pipWidth * webcamVideo.videoHeight) / webcamVideo.videoWidth;
        const pipX = video.width - pipWidth - 20;
        const pipY = video.height - pipHeight - 20;

        ctx.save();
        // Mirror the webcam feed
        ctx.scale(-1, 1);
        ctx.drawImage(webcamVideo, -pipX - pipWidth, pipY, pipWidth, pipHeight);
        ctx.restore();

        // Draw border
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(pipX, pipY, pipWidth, pipHeight);
      }

      requestAnimationFrame(drawFrame);
    };

    drawFrame();

    // Create stream from canvas
    this.canvasStream = this.canvas.captureStream(video.frameRate);

    // Combine audio tracks
    await this.combineAudioTracks(config);

    console.log("Using Canvas path for stream composition");
  }

  /**
   * Combine audio tracks from multiple sources
   */
  async combineAudioTracks(config) {
    const audioTracks = [];

    // Collect audio tracks
    if (config.audio.mic && this.streams.webcam) {
      const micTracks = this.streams.webcam.getAudioTracks();
      audioTracks.push(...micTracks);
    }

    if (config.audio.system && this.streams.screen) {
      const systemTracks = this.streams.screen.getAudioTracks();
      audioTracks.push(...systemTracks);
    }

    if (audioTracks.length === 0) {
      this.streams.combined = this.canvasStream;
      return;
    }

    try {
      // Use Web Audio API to mix tracks
      this.audioContext = new AudioContext();
      const destination = this.audioContext.createMediaStreamDestination();

      audioTracks.forEach((track) => {
        const source = this.audioContext.createMediaStreamSource(
          new MediaStream([track])
        );
        source.connect(destination);
      });

      // Combine video from canvas with mixed audio
      const combinedTracks = [
        ...this.canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ];

      this.streams.combined = new MediaStream(combinedTracks);
    } catch (error) {
      console.warn("Audio mixing failed, using single track:", error);

      // Fallback: use first available audio track
      const combinedTracks = [
        ...this.canvasStream.getVideoTracks(),
        audioTracks[0],
      ];

      this.streams.combined = new MediaStream(combinedTracks);
    }
  }

  /**
   * Build a MediaStream from a provided video track/generator and mixed audio.
   * @param {MediaStreamTrack|MediaStreamTrackGenerator} videoTrackOrGen
   * @param {object} config
   * @returns {Promise<MediaStream>}
   */
  async combineAudioWithVideoTrack(videoTrackOrGen, config) {
    const videoTrack =
      videoTrackOrGen instanceof MediaStreamTrackGenerator
        ? videoTrackOrGen
        : videoTrackOrGen; // supports either

    const audioTracks = [];

    if (config.audio?.mic && this.streams.webcam) {
      audioTracks.push(...this.streams.webcam.getAudioTracks());
    }
    if (config.audio?.system && this.streams.screen) {
      audioTracks.push(...this.streams.screen.getAudioTracks());
    }

    if (audioTracks.length === 0) {
      return new MediaStream([videoTrack]);
    }

    try {
      this.audioContext = new AudioContext();
      const destination = this.audioContext.createMediaStreamDestination();

      audioTracks.forEach((t) => {
        const src = this.audioContext.createMediaStreamSource(
          new MediaStream([t])
        );
        src.connect(destination);
      });

      const out = new MediaStream([
        videoTrack,
        ...destination.stream.getAudioTracks(),
      ]);
      return out;
    } catch (err) {
      console.warn("Audio mix failed, falling back to first audio track:", err);
      const out = new MediaStream([videoTrack, audioTracks[0]].filter(Boolean));
      return out;
    }
  }

  /**
   * Setup MediaRecorder
   */
  async setupRecorder(config) {
    const { mode, bitrate } = config;

    // Select appropriate stream
    let stream;
    switch (mode) {
      case "screen":
        stream = this.streams.screen;
        break;
      case "webcam":
        stream = this.streams.webcam;
        break;
      case "combined":
        stream = this.streams.combined;
        break;
      default:
        throw new Error(`Unknown recording mode: ${mode}`);
    }

    if (!stream) {
      throw new Error("No stream available for recording");
    }

    // Determine best codec
    const mimeTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=h264,opus",
      "video/webm",
    ];

    let selectedMimeType;
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        break;
      }
    }

    if (!selectedMimeType) {
      throw new Error("No supported video format found");
    }

    // Configure MediaRecorder
    const options = {
      mimeType: selectedMimeType,
      videoBitsPerSecond: bitrate.video,
      audioBitsPerSecond: bitrate.audio,
    };

    this.mediaRecorder = new MediaRecorder(stream, options);
    this.chunks = [];

    // Event handlers
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        performance.mark("chunk-received");

        // Bounded queue management
        if (this.chunks.length >= this.maxChunks) {
          console.warn("Chunk queue full, removing oldest chunk");
          this.chunks.shift();
        }

        this.chunks.push(e.data);
        this.emit("dataavailable", e.data);

        performance.mark("chunk-processed");
        performance.measure(
          "chunk-processing",
          "chunk-received",
          "chunk-processed"
        );
      }
    };

    this.mediaRecorder.onerror = (e) => {
      console.error("MediaRecorder error:", e);
      this.emit(
        "error",
        new Error(`Recording error: ${e.error?.message || "Unknown error"}`)
      );
    };

    this.mediaRecorder.onstop = () => {
      console.log("MediaRecorder stopped");
    };

    console.log(`MediaRecorder configured with ${selectedMimeType}`);
  }

  /**
   * Pause recording
   */
  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
      console.log("Recording paused");
    }
  }

  /**
   * Resume recording
   */
  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
      console.log("Recording resumed");
    }
  }

  /**
   * Stop recording and return blob
   */
  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      const handleStop = () => {
        try {
          performance.mark("blob-creation-start");

          const blob = new Blob(this.chunks, {
            type: this.mediaRecorder.mimeType || "video/webm",
          });

          performance.mark("blob-creation-complete");
          performance.measure(
            "blob-creation",
            "blob-creation-start",
            "blob-creation-complete"
          );

          console.log(
            `Recording blob created: ${(blob.size / (1024 * 1024)).toFixed(
              1
            )} MB from ${this.chunks.length} chunks`
          );

          this.cleanup();
          resolve(blob);
        } catch (error) {
          console.error("Error creating blob:", error);
          this.cleanup();
          reject(error);
        }
      };

      this.mediaRecorder.addEventListener("stop", handleStop, { once: true });

      if (
        this.mediaRecorder.state === "recording" ||
        this.mediaRecorder.state === "paused"
      ) {
        this.mediaRecorder.stop();
      } else {
        handleStop();
      }
    });
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.isRecording = false;

    // Stop MediaRecorder
    if (
      this.mediaRecorder &&
      (this.mediaRecorder.state === "recording" ||
        this.mediaRecorder.state === "paused")
    ) {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;

    // Stop all tracks
    Object.values(this.streams).forEach((stream) => {
      if (stream) {
        stream.getTracks().forEach((track) => {
          track.stop();
          console.log(`Stopped ${track.kind} track`);
        });
      }
    });

    // Cleanup streams
    this.streams = {
      screen: null,
      webcam: null,
      combined: null,
    };

    // Cleanup canvas stream
    if (this.canvasStream) {
      this.canvasStream.getTracks().forEach((track) => track.stop());
      this.canvasStream = null;
    }

    // Cleanup audio context
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch (error) {
        console.warn("Error closing audio context:", error);
      }
      this.audioContext = null;
    }

    // Cleanup worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // Cleanup canvas
    if (this.canvas) {
      this.canvas = null;
    }

    // Clear chunks
    this.chunks = [];

    console.log("Recorder cleanup complete");
  }

  /**
   * Get current recording state
   */
  getState() {
    return {
      isRecording: this.isRecording,
      state: this.mediaRecorder?.state || "inactive",
      chunksCount: this.chunks.length,
      totalSize: this.chunks.reduce((sum, chunk) => sum + chunk.size, 0),
    };
  }
}
