# Tiandao AI Studio — API Reference

This document describes the primary API endpoints of the Tiandao pipeline engine.

## Base URL

```
http://<server>:16012
```

---

## Create a Drama

### `POST /api/drama-v7/create`

Generate a complete short drama from a text idea.

**Request Body:**

```json
{
  "idea": "A warrior returns home after 10 years",
  "style": "cinematic",
  "sceneCount": 3,
  "mode": "standard"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `idea` | string | required | The core story idea |
| `style` | string | `"cinematic"` | Visual style: `cinematic`, `anime`, `realistic` |
| `sceneCount` | number | `3` | Number of scenes (1-10) |
| `mode` | string | `"standard"` | Quality mode: `standard`, `quality`, `cinematic` |

**Response (202 Accepted):**

```json
{
  "taskId": "V7_abc12345",
  "status": "processing",
  "estimatedSeconds": 420
}
```

**Poll for completion:**

```
GET /api/drama-v7/status/:taskId
```

**Response (200 OK, when complete):**

```json
{
  "taskId": "V7_abc12345",
  "status": "completed",
  "output": "/path/to/final_video.mp4",
  "duration": 185,
  "scenes": 3,
  "fileSize": 2826248
}
```

---

## Check Service Health

### `GET /api/drama-v7/services`

Returns the status of all backend AI services.

```json
{
  "qwen": {"status": "healthy", "port": 8000},
  "flux": {"status": "healthy", "port": 8030},
  "sovits": {"status": "healthy", "port": 9880},
  "ace": {"status": "healthy", "port": 8001},
  "wan22": {"status": "healthy", "port": 8020},
  "musetalk": {"status": "healthy", "port": 8091}
}
```

---

## Service Ports Reference

| Service | Port | Protocol | Health Check |
|---------|------|----------|-------------|
| Qwen-72B | 8000 | HTTP | POST /v1/chat/completions |
| Kolors | 8010 | HTTP | POST /generate |
| FLUX | 8030 | HTTP | POST /generate |
| Wan2.2 | 8020 | HTTP | POST /generate |
| ACE | 8001 | HTTP | POST /generate |
| SoVITS | 9880 | HTTP | POST /tts |
| MuseTalk | 8091 | HTTP | POST /generate |
| Wav2Lip | 8089 | HTTP | POST /process |
| Tiandao Engine | 16012 | HTTP | GET /api/drama-v7/services |
