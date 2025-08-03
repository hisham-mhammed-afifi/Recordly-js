/**
 * Recordly - Main Application Controller
 * Orchestrates UI, state management, and recording workflow
 */

import { Recorder } from "./recorder.js";

class RecordlyApp {
  constructor() {
    this.recorder = new Recorder();
    this.state = {
      mode: "screen",
      quality: "720p",
      bitrate: 5000000,
      micEnabled: true,
      systemAudioEnabled: true,
      isRecording: false,
      isPaused: false,
      devices: [],
      selectedDevice: "",
      startTime: null,
      duration: 0,
      fileSize: 0,
      droppedFrames: 0,
    };

    this.elements = {};
    this.animationFrame = null;
    this.micAnalyzer = null;
    this.performanceMetrics = {
      startTime: 0,
      chunkCount: 0,
      totalBytes: 0,
    };

    this.init();
  }

  /**
   * Initialize the application
   */
  async init() {
    this.bindElements();
    this.attachEventListeners();
    this.setupPerformanceMonitoring();
    await this.detectCapabilities();
    await this.loadDevices();
    this.updateUI();

    // Cleanup on page unload
    window.addEventListener("beforeunload", () => this.cleanup());

    console.log("Recordly initialized");
    performance.mark("recordly-init-complete");
  }

  /**
   * Bind DOM elements
   */
  bindElements() {
    const ids = [
      "modeSelect",
      "qualitySelect",
      "bitrateSelect",
      "deviceSelect",
      "deviceGroup",
      "micToggle",
      "systemAudioToggle",
      "systemAudioGroup",
      "micLevel",
      "startBtn",
      "pauseBtn",
      "resumeBtn",
      "stopBtn",
      "previewVideo",
      "pipVideo",
      "pipContainer",
      "pipHandle",
      "previewOverlay",
      "statusDot",
      "statusText",
      "durationDisplay",
      "fileSizeDisplay",
      "droppedFramesDisplay",
      "errorMessage",
      "errorText",
      "errorClose",
      "saveDialog",
      "filenameInput",
      "openAfterSave",
      "confirmSave",
      "cancelSave",
    ];

    ids.forEach((id) => {
      this.elements[id] = document.getElementById(id);
      if (!this.elements[id]) {
        console.warn(`Element with id '${id}' not found`);
      }
    });
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Mode and quality controls
    this.elements.modeSelect.addEventListener("change", () => {
      this.state.mode = this.elements.modeSelect.value;
      this.updateUI();
    });

    this.elements.qualitySelect.addEventListener("change", () => {
      this.state.quality = this.elements.qualitySelect.value;
    });

    this.elements.bitrateSelect.addEventListener("change", () => {
      this.state.bitrate = parseInt(this.elements.bitrateSelect.value);
    });

    this.elements.deviceSelect.addEventListener("change", () => {
      this.state.selectedDevice = this.elements.deviceSelect.value;
    });

    // Audio controls
    this.elements.micToggle.addEventListener("change", () => {
      this.state.micEnabled = this.elements.micToggle.checked;
    });

    this.elements.systemAudioToggle.addEventListener("change", () => {
      this.state.systemAudioEnabled = this.elements.systemAudioToggle.checked;
    });

    // Recording controls
    this.elements.startBtn.addEventListener("click", () =>
      this.startRecording()
    );
    this.elements.pauseBtn.addEventListener("click", () =>
      this.pauseRecording()
    );
    this.elements.resumeBtn.addEventListener("click", () =>
      this.resumeRecording()
    );
    this.elements.stopBtn.addEventListener("click", () => this.stopRecording());

    // Error handling
    this.elements.errorClose.addEventListener("click", () => this.hideError());

    // Save dialog
    this.elements.confirmSave.addEventListener("click", () =>
      this.confirmSave()
    );
    this.elements.cancelSave.addEventListener("click", () => this.cancelSave());

    // PiP dragging (simplified for performance)
    this.setupPiPDragging();

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "r":
            e.preventDefault();
            if (!this.state.isRecording) this.startRecording();
            break;
          case "s":
            e.preventDefault();
            if (this.state.isRecording) this.stopRecording();
            break;
          case " ":
            e.preventDefault();
            if (this.state.isRecording && !this.state.isPaused) {
              this.pauseRecording();
            } else if (this.state.isPaused) {
              this.resumeRecording();
            }
            break;
        }
      }
    });
  }

  /**
   * Setup performance monitoring
   */
  setupPerformanceMonitoring() {
    // Monitor long tasks
    if ("PerformanceObserver" in window) {
      const observer = new PerformanceObserver((list) => {
        const longTasks = list.getEntries();
        if (longTasks.length > 0 && this.state.isRecording) {
          console.warn(
            `Long tasks detected: ${longTasks.length}, max duration: ${Math.max(
              ...longTasks.map((t) => t.duration)
            )}ms`
          );
        }
      });

      try {
        observer.observe({ entryTypes: ["longtask"] });
      } catch (e) {
        console.log("Long task monitoring not supported");
      }
    }

    // Setup recorder event listeners
    this.recorder.on("dataavailable", (data) => {
      this.performanceMetrics.chunkCount++;
      this.performanceMetrics.totalBytes += data.size;
      this.state.fileSize = this.performanceMetrics.totalBytes;
    });

    this.recorder.on("error", (error) => {
      this.showError(error.message);
      this.resetRecording();
    });
  }

  /**
   * Detect browser capabilities
   */
  async detectCapabilities() {
    const capabilities = {
      getDisplayMedia: "getDisplayMedia" in navigator.mediaDevices,
      getUserMedia: "getUserMedia" in navigator.mediaDevices,
      mediaRecorder: "MediaRecorder" in window,
      webCodecs: "VideoEncoder" in window && "AudioEncoder" in window,
      offscreenCanvas: "OffscreenCanvas" in window,
    };

    console.log("Browser capabilities:", capabilities);

    if (!capabilities.mediaRecorder) {
      this.showError("MediaRecorder is not supported in this browser");
      return;
    }

    if (!capabilities.getDisplayMedia) {
      this.showError(
        "Screen capture is not supported. Webcam-only mode available."
      );
      this.elements.modeSelect.querySelector(
        'option[value="screen"]'
      ).disabled = true;
      this.elements.modeSelect.querySelector(
        'option[value="combined"]'
      ).disabled = true;
      this.elements.modeSelect.value = "webcam";
      this.state.mode = "webcam";
    }

    // Configure recorder with capabilities
    this.recorder.setCapabilities(capabilities);
  }

  /**
   * Load available devices
   */
  async loadDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.state.devices = devices.filter(
        (device) => device.kind === "videoinput"
      );

      this.elements.deviceSelect.innerHTML =
        '<option value="">Default Camera</option>';
      this.state.devices.forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || `Camera ${device.deviceId.slice(0, 8)}`;
        this.elements.deviceSelect.appendChild(option);
      });
    } catch (error) {
      console.warn("Could not enumerate devices:", error);
    }
  }

  /**
   * Setup PiP dragging functionality
   */
  setupPiPDragging() {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startLeft, startTop, startWidth, startHeight;

    const pipContainer = this.elements.pipContainer;
    const pipHandle = this.elements.pipHandle;

    // Dragging
    pipContainer.addEventListener("mousedown", (e) => {
      if (e.target === pipHandle) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = pipContainer.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      pipContainer.style.transition = "none";
    });

    // Resizing
    pipHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = pipContainer.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      pipContainer.style.transition = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (isDragging) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const newLeft = Math.max(
          0,
          Math.min(
            startLeft + deltaX,
            window.innerWidth - pipContainer.offsetWidth
          )
        );
        const newTop = Math.max(
          0,
          Math.min(
            startTop + deltaY,
            window.innerHeight - pipContainer.offsetHeight
          )
        );

        pipContainer.style.left = newLeft + "px";
        pipContainer.style.top = newTop + "px";
        pipContainer.style.right = "auto";
        pipContainer.style.bottom = "auto";
      } else if (isResizing) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const newWidth = Math.max(120, Math.min(startWidth + deltaX, 400));
        const newHeight = Math.max(90, Math.min(startHeight + deltaY, 300));

        pipContainer.style.width = newWidth + "px";
        pipContainer.style.height = newHeight + "px";
      }
    });

    document.addEventListener("mouseup", () => {
      if (isDragging || isResizing) {
        pipContainer.style.transition = "";
        isDragging = false;
        isResizing = false;
      }
    });
  }

  /**
   * Start recording
   */
  async startRecording() {
    try {
      performance.mark("recording-start");
      this.performanceMetrics.startTime = Date.now();
      this.performanceMetrics.chunkCount = 0;
      this.performanceMetrics.totalBytes = 0;

      const config = this.getRecordingConfig();
      await this.recorder.start(config);

      this.state.isRecording = true;
      this.state.isPaused = false;
      this.state.startTime = Date.now();
      this.state.fileSize = 0;
      this.state.droppedFrames = 0;

      const stream = this.getPreviewStream();
      if (stream) {
        this.elements.previewVideo.srcObject = stream;
        try {
          await this.elements.previewVideo.play();
        } catch {}
      }

      // Avoid double PiP when we already compose PiP into the output
      if (this.state.mode === "combined") {
        this.elements.pipContainer.style.display = "none";
      } else if (this.state.mode === "screen" && this.recorder.streams.webcam) {
        // Optional: show live webcam PiP over raw screen preview
        this.elements.pipVideo.srcObject = this.recorder.streams.webcam;
        try {
          await this.elements.pipVideo.play();
        } catch {}
        this.elements.pipContainer.style.display = "block";
      }

      this.updateUI();
      this.startUpdateLoop();
      this.setupMicAnalyzer();

      performance.mark("recording-start-complete");
      performance.measure(
        "recording-start-duration",
        "recording-start",
        "recording-start-complete"
      );
    } catch (error) {
      console.error("Failed to start recording:", error);
      this.showError(`Failed to start recording: ${error.message}`);
      this.resetRecording();
    }
  }

  /**
   * Pause recording
   */
  pauseRecording() {
    try {
      this.recorder.pause();
      this.state.isPaused = true;
      this.updateUI();
    } catch (error) {
      console.error("Failed to pause recording:", error);
      this.showError(`Failed to pause recording: ${error.message}`);
    }
  }

  /**
   * Resume recording
   */
  resumeRecording() {
    try {
      this.recorder.resume();
      this.state.isPaused = false;
      this.updateUI();
    } catch (error) {
      console.error("Failed to resume recording:", error);
      this.showError(`Failed to resume recording: ${error.message}`);
    }
  }

  /**
   * Stop recording
   */
  async stopRecording() {
    try {
      performance.mark("recording-stop");

      const blob = await this.recorder.stop();
      this.resetRecording();

      if (blob && blob.size > 0) {
        this.showSaveDialog(blob);
      } else {
        this.showError("Recording failed - no data captured");
      }

      performance.mark("recording-stop-complete");
      performance.measure(
        "recording-stop-duration",
        "recording-stop",
        "recording-stop-complete"
      );

      // Log performance metrics
      const duration = Date.now() - this.performanceMetrics.startTime;
      console.log("Recording performance:", {
        duration: `${duration}ms`,
        chunks: this.performanceMetrics.chunkCount,
        totalBytes: this.performanceMetrics.totalBytes,
        avgChunkSize: Math.round(
          this.performanceMetrics.totalBytes /
            this.performanceMetrics.chunkCount
        ),
        avgBytesPerSecond: Math.round(
          this.performanceMetrics.totalBytes / (duration / 1000)
        ),
      });
    } catch (error) {
      console.error("Failed to stop recording:", error);
      this.showError(`Failed to stop recording: ${error.message}`);
      this.resetRecording();
    }
  }

  /**
   * Get recording configuration
   */
  getRecordingConfig() {
    const qualityMap = {
      "1080p": { width: 1920, height: 1080 },
      "720p": { width: 1280, height: 720 },
      "480p": { width: 854, height: 480 },
    };

    return {
      mode: this.state.mode,
      video: {
        ...qualityMap[this.state.quality],
        frameRate: 30,
      },
      audio: {
        mic: this.state.micEnabled,
        system: this.state.systemAudioEnabled && this.state.mode !== "webcam",
      },
      bitrate: {
        video: this.state.bitrate,
        audio: 128000,
      },
      deviceId: this.state.selectedDevice || undefined,
    };
  }

  /**
   * Get preview stream
   * @returns {MediaStream}
   */
  getPreviewStream() {
    switch (this.state.mode) {
      case "screen":
        return this.recorder.streams.screen;
      case "webcam":
        return this.recorder.streams.webcam;
      case "combined":
        // WebCodecs and Canvas paths both set this.streams.combined
        return this.recorder.streams.combined;
      default:
        return null;
    }
  }

  /**
   * Setup microphone analyzer for level meter
   */
  async setupMicAnalyzer() {
    if (!this.state.micEnabled) return;

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(micStream);

      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      microphone.connect(analyser);

      const updateLevel = () => {
        if (audioContext.state !== "closed" && !this.state.isRecording) {
          audioContext.close();
          micStream.getTracks().forEach((track) => track.stop());
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const average =
          dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        const level = Math.min(100, (average / 255) * 100);

        this.elements.micLevel.style.width = level + "%";

        requestAnimationFrame(updateLevel);
      };

      updateLevel();
      this.micAnalyzer = { audioContext, micStream };
    } catch (error) {
      console.warn("Could not setup mic analyzer:", error);
    }
  }

  /**
   * Start the update loop for live stats
   */
  startUpdateLoop() {
    const update = () => {
      if (!this.state.isRecording) return;

      // Update duration
      if (!this.state.isPaused) {
        this.state.duration = Date.now() - this.state.startTime;
      }

      // Update UI
      this.updateLiveStats();

      this.animationFrame = requestAnimationFrame(update);
    };

    update();
  }

  /**
   * Update live statistics
   */
  updateLiveStats() {
    // Duration
    const minutes = Math.floor(this.state.duration / 60000);
    const seconds = Math.floor((this.state.duration % 60000) / 1000);
    this.elements.durationDisplay.textContent = `${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

    // File size
    const sizeMB = (this.state.fileSize / (1024 * 1024)).toFixed(1);
    this.elements.fileSizeDisplay.textContent = `${sizeMB} MB`;

    // Dropped frames (simplified)
    this.elements.droppedFramesDisplay.textContent =
      this.state.droppedFrames.toString();
  }

  /**
   * Update UI based on current state
   */
  updateUI() {
    // Status indicator
    if (this.state.isRecording) {
      this.elements.statusDot.className = this.state.isPaused
        ? "status-dot paused"
        : "status-dot recording";
      this.elements.statusText.textContent = this.state.isPaused
        ? "Paused"
        : "Recording";
    } else {
      this.elements.statusDot.className = "status-dot";
      this.elements.statusText.textContent = "Ready";
    }

    // Device selector visibility
    const showDevices =
      this.state.mode === "webcam" || this.state.mode === "combined";
    this.elements.deviceGroup.style.display = showDevices ? "block" : "none";

    // System audio toggle visibility
    const showSystemAudio =
      this.state.mode === "screen" || this.state.mode === "combined";
    this.elements.systemAudioGroup.style.display = showSystemAudio
      ? "block"
      : "none";

    // Recording controls
    this.elements.startBtn.disabled = this.state.isRecording;
    this.elements.pauseBtn.disabled =
      !this.state.isRecording || this.state.isPaused;
    this.elements.pauseBtn.style.display = this.state.isPaused
      ? "none"
      : "flex";
    this.elements.resumeBtn.disabled = !this.state.isPaused;
    this.elements.resumeBtn.style.display = this.state.isPaused
      ? "flex"
      : "none";
    this.elements.stopBtn.disabled = !this.state.isRecording;

    // Show PiP overlay only when previewing a raw screen feed (not combined)
    const showPip =
      this.state.isRecording &&
      this.state.mode === "screen" &&
      !!this.recorder.streams.webcam;

    this.elements.pipContainer.style.display = showPip ? "block" : "none";

    this.elements.previewOverlay.style.display = this.state.isRecording
      ? "none"
      : "flex";

    // Mode-specific controls
    const controls = [
      "modeSelect",
      "qualitySelect",
      "bitrateSelect",
      "deviceSelect",
    ];
    controls.forEach((control) => {
      this.elements[control].disabled = this.state.isRecording;
    });
  }

  /**
   * Show save dialog
   */
  showSaveDialog(blob) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const filename = `recordly-${timestamp}.webm`;

    this.elements.filenameInput.value = filename;
    this.elements.saveDialog.style.display = "flex";
    this.elements.filenameInput.focus();
    this.elements.filenameInput.select();

    this.pendingBlob = blob;
  }

  /**
   * Confirm save
   */
  confirmSave() {
    const filename = this.elements.filenameInput.value || "recording.webm";
    const openAfter = this.elements.openAfterSave.checked;

    this.downloadBlob(this.pendingBlob, filename, openAfter);
    this.elements.saveDialog.style.display = "none";
    this.pendingBlob = null;
  }

  /**
   * Cancel save
   */
  cancelSave() {
    this.elements.saveDialog.style.display = "none";
    if (this.pendingBlob) {
      URL.revokeObjectURL(this.pendingBlob);
      this.pendingBlob = null;
    }
  }

  /**
   * Download blob as file
   */
  downloadBlob(blob, filename, openAfter = false) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (openAfter) {
      const newWindow = window.open(url, "_blank");
      if (!newWindow) {
        console.warn("Could not open recording in new window - popup blocked?");
      }
    }

    // Cleanup URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log(
      `Recording saved as ${filename} (${(blob.size / (1024 * 1024)).toFixed(
        1
      )} MB)`
    );
  }

  /**
   * Reset recording state
   */
  resetRecording() {
    this.state.isRecording = false;
    this.state.isPaused = false;
    this.state.startTime = null;
    this.state.duration = 0;
    this.state.fileSize = 0;
    this.state.droppedFrames = 0;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.micAnalyzer) {
      this.micAnalyzer.audioContext.close().catch(console.warn);
      this.micAnalyzer.micStream.getTracks().forEach((track) => track.stop());
      this.micAnalyzer = null;
    }

    if (this.elements.previewVideo) this.elements.previewVideo.srcObject = null;
    if (this.elements.pipVideo) this.elements.pipVideo.srcObject = null;

    this.elements.micLevel.style.width = "0%";
    this.updateUI();
  }

  /**
   * Show error message
   */
  showError(message) {
    this.elements.errorText.textContent = message;
    this.elements.errorMessage.style.display = "block";

    // Auto-hide after 5 seconds
    setTimeout(() => this.hideError(), 5000);
  }

  /**
   * Hide error message
   */
  hideError() {
    this.elements.errorMessage.style.display = "none";
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.resetRecording();
    this.recorder.cleanup();

    if (this.pendingBlob) {
      URL.revokeObjectURL(this.pendingBlob);
    }
  }
}

// Initialize app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new RecordlyApp());
} else {
  new RecordlyApp();
}
