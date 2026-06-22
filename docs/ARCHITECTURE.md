# Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Tiandao Pipeline Engine                         │
│                        (Node.js, port 16012)                           │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │                    Request Handler                              │     │
│  │  POST /api/drama-v7/create → drama-pipeline-v7.js              │     │
│  │                    ↓                                            │     │
│  │              createDrama(taskId)                                 │     │
│  │                    ↓                                            │     │
│  │    ┌─────────────────────────────────────────────────┐         │     │
│  │    │           Parallel Executor                       │         │     │
│  │    │                                                   │         │     │
│  │    │  1. Script → Qwen-72B API  (HTTP POST :8000)     │         │     │
│  │    │  2. Parse storyboard from script                  │         │     │
│  │    │  3. For each scene:                               │         │     │
│  │    │     a. Generate image → FLUX (:8030)              │         │     │
│  │    │     b. Generate audio → SoVITS (:9880)            │         │     │
│  │    │     c. Generate video → Wan2.2 (:8020)            │         │     │
│  │    │     d. Generate BGM → ACE (:8001)                 │         │     │
│  │    │  4. Lip sync → MuseTalk (:8091)                   │         │     │
│  │    │  5. FFmpeg assembly:                              │         │     │
│  │    │     - Ken Burns (scale + pad animation)           │         │     │
│  │    │     - Crossfade (xfade filter)                    │         │     │
│  │    │     - Subtitles (ass format overlay)              │         │     │
│  │    │     - Audio mix (amix, loudnorm)                  │         │     │
│  │    │     - Encode (libx264, CRF 17)                    │         │     │
│  │    └─────────────────────────────────────────────────┘         │     │
│  └──────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
tiandao-ai-studio/
├── server/
│   ├── drama-pipeline-v7.js      # Main pipeline orchestration
│   ├── drama_routes.js           # Express API routes
│   └── drama_pipeline_engine.js  # Core pipeline engine
├── services/
│   └── musetalk_server.py        # MuseTalk API server
├── docs/
│   ├── API.md                    # API reference
│   ├── ROADMAP.md                # Development roadmap
│   └── SERVICES.md               # Service deployment guide
├── scripts/
│   └── deploy.sh                 # Deployment script
├── examples/                     # Sample outputs
├── package.json
├── README.md
└── LICENSE
```

## Data Flow

```
Input: { idea, style, sceneCount }
  │
  ▼
Task Queue (in-memory, keyed by taskId)
  │
  ▼
Pipeline (async, Promise chain with error recovery)
  │
  ├─ Step 1: Script Generation ─────────► Qwen-72B
  │   Output: script.json with scene breakdown
  │
  ├─ Step 2: Scene Image ───────────────► FLUX
  │   Output: scene_N.png per scene
  │
  ├─ Step 3: Dubbing ───────────────────► SoVITS
  │   Output: character_N.wav per dialogue line
  │
  ├─ Step 4: Background Music ──────────► ACE
  │   Output: bgm_N.wav per scene
  │
  ├─ Step 5: Animation ────────────────► Wan2.2
  │   Output: scene_video_N.mp4 per scene
  │
  ├─ Step 6: Lip Sync ────────────────► MuseTalk
  │   Output: lipsync_N.mp4 per scene
  │
  ├─ Step 7: Assembly ────────────────► FFmpeg
  │   Output: final.mp4
  │
  ▼
Result: { taskId, output, status }
```

## Service Communication

All services communicate via HTTP REST on localhost. The pipeline engine handles:

- **Connection retry** (3 attempts with exponential backoff)
- **Timeouts** (per-step configurable, default 120s)
- **Error recovery** (service failure → fallback service)
- **Temp file cleanup** (auto-removed after assembly)
