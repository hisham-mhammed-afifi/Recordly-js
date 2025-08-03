# Recordly

A high-performance, production-ready screen and webcam recorder built with vanilla HTML/CSS/JavaScript. Recordly prioritizes performance with bounded memory usage, 60fps UI, and WebCodecs optimization for modern browsers.

## Features

### Recording Modes

- **Screen Only**: Capture screen/window/tab with optional system audio
- **Webcam Only**: Record from camera with microphone
- **Screen + Webcam**: Combined recording with draggable picture-in-picture webcam overlay

### Audio Support

- Microphone capture with real-time level meter
- System audio capture (when browser permissions allow)
- Intelligent audio mixing for combined recordings
- Per-source audio controls

### Performance Optimizations

- **Bounded Memory**: Chunked recording with queue management (< 200MB for 5min at 1080p)
- **WebCodecs Path**: Hardware-accelerated encoding when available
- **60fps UI**: RequestAnimationFrame-based updates, no blocking operations
- **Web Workers**: Offloaded composition work for complex recordings
- **Performance Monitoring**: Built-in metrics and long-task detection

### Output

- Single `.webm` file download (VP9/Opus codec)
- Timestamped filenames
- No server required - pure client-side processing
- Optional post-save file opening

## Browser Support

### Primary (Full Support)

- **Chrome 94+** (Desktop)
- **Edge 94+** (Desktop)

### Secondary (Graceful Degradation)

- **Firefox**: Webcam recording works, screen capture limited
- **Safari**: Webcam recording works, no screen capture
- **Mobile browsers**: Limited support

## Technical Architecture

### Core Components

#### `script.js` - Application Controller

- UI state management
- Event handling and keyboard shortcuts
- Performance monitoring
- Device enumeration and permissions

#### `recorder.js` - Recording Engine

- MediaRecorder pipeline with chunked recording
- Multi-stream management (screen, webcam, combined)
- Canvas-based composition fallback
- Audio track mixing with Web Audio API

#### `compositor.worker.js` - WebCodecs Optimization

- Hardware-accelerated stream composition
- OffscreenCanvas rendering
- VideoEncoder/AudioEncoder when available
- Graceful fallback to main thread

### Performance Characteristics

#### Memory Usage

- **Bounded**: Maximum 1000 chunks in memory queue
- **Streaming**: 1-second timeslices prevent memory accumulation
- **Target**: <200MB additional memory during 5-minute 1080p recording

#### CPU Usage

- **Target**: ≤8ms main thread time per frame during recording
- **Optimization**: OffscreenCanvas + Web Workers for composition
- **Monitoring**: PerformanceObserver for long task detection

#### Frame Rate

- **UI**: Stable 60fps preview and controls
- **Recording**: 30fps default, configurable
- **Composition**: Hardware-accelerated when WebCodecs available

## Configuration Options

### Quality Presets

- **1080p**: 1920×1080, ideal for detailed content
- **720p**: 1280×720, balanced quality/performance (default)
- **480p**: 854×480, optimal for lower-end devices

### Bitrate Options

- **8 Mbps**: High quality, larger files
- **5 Mbps**: Balanced quality/size (default)
- **3 Mbps**: Good compression
- **2 Mbps**: High compression
- **1 Mbps**: Maximum compression

## Known Limitations

### Browser-Specific

- **System Audio**: Only available in Chrome/Edge with user permission
- **WebCodecs**: Chrome 94+ only, graceful fallback provided
- **Screen Capture**: Not supported in Safari, limited in Firefox

### Technical Constraints

- **File Size**: Large recordings may hit browser memory limits (>2GB)
- **Codec Support**: VP9 preferred, falls back to VP8 or H.264
- **Audio Sync**: Composition may introduce minor A/V drift (<50ms typical)

### Platform Limitations

- **Mobile**: Limited screen capture support
- **Linux**: System audio capture restrictions in some configurations
- **Corporate**: May be blocked by enterprise security policies

## Performance Monitoring

Recordly includes built-in performance monitoring:

```javascript
// Access metrics in browser console
performance
  .getEntriesByType("measure")
  .filter((m) => m.name.startsWith("recordly"))
  .forEach((m) => console.log(`${m.name}: ${m.duration}ms`));
```

### Key Metrics

- `recordly-init-complete`: Application startup time
- `recording-start-duration`: Time to begin recording
- `chunk-processing`: Per-chunk processing overhead
- `blob-creation`: Final file assembly time

## Troubleshooting

### Common Issues

**"Permission denied" errors**

- Ensure HTTPS or localhost
- Check browser permission settings
- Try refreshing and re-granting permissions

**"No supported video format" error**

- Update browser to latest version
- Check if WebM is supported: `MediaRecorder.isTypeSupported('video/webm')`

**High CPU usage**

- Lower quality setting
- Disable system audio if not needed
- Check for other high-CPU applications

**Large memory usage**

- Shorter recording sessions
- Lower bitrate settings
- Stop other browser tabs during recording

### Debug Mode

Enable debug logging:

```javascript
// In browser console
localStorage.setItem("recordly-debug", "true");
// Reload page
```

## Development

### Code Structure

- **ES2020 modules** - No transpilation required
- **Zero dependencies** - Pure browser APIs
- **Performance-first** - Every operation optimized for 60fps
- **Accessible** - ARIA labels, keyboard navigation, focus management

### Key Design Decisions

- **Chunked recording** prevents memory accumulation
- **Bounded queues** ensure predictable memory usage
- **Feature detection** enables progressive enhancement
- **Web Workers** keep main thread responsive

### Extending Recordly

#### Adding New Codecs

```javascript
// In recorder.js, modify mimeTypes array
const mimeTypes = [
  "video/webm;codecs=av01.0.00M.08,opus", // Add AV1 support
  "video/webm;codecs=vp9,opus",
  // ... existing codecs
];
```

#### Custom Audio Processing

```javascript
// In recorder.js, extend combineAudioTracks()
const gainNode = this.audioContext.createGain();
gainNode.gain.value = 0.8; // Reduce volume
source.connect(gainNode);
gainNode.connect(destination);
```

## License

MIT License - see source files for details.

## Contributing

Performance improvements and bug fixes welcome. Please test on target browsers and include performance measurements in pull requests.
