<p align="center">
  <h1 align="center">Tiandao AI Studio</h1>
  <p align="center">
    <em>Production-grade AI short drama pipeline. From script to finished video, fully automated.</em>
  </p>
  <p align="center">
    <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D18-green?style=flat-square" alt="Node 18+"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT"></a>
    <a href="#"><img src="https://img.shields.io/badge/GPU-RTX%205070%20%7C%20A100-orange?style=flat-square" alt="GPU"></a>
    <a href="#"><img src="https://img.shields.io/badge/status-production-brightgreen?style=flat-square" alt="Production"></a>
<a href="docs/MONETIZATION.md"><img src="https://img.shields.io/badge/monetization-business%20model-blueviolet?style=flat-square" alt="Monetization"></a>
<a href="https://github.com/qq2667117339/tiandao-ai-studio/tree/main/docs"><img src="https://img.shields.io/badge/landing%20page-HTML%20SaaS-blue?style=flat-square" alt="Landing Page"></a>
  </p>
</p>

---

## 🎯 Investor Summary

| Metric | Value |
|--------|-------|
| **Market** | AI short video generation — projected $500M+ by 2027 |
| **Status** | Working production pipeline |
| **Time to video** | ~7 minutes from text idea |
| **AI services** | 8 models (FLUX, Qwen, Wan2.2, SoVITS, ACE, MuseTalk, Kolors, Wav2Lip) |
| **Revenue streams** | 5 (Cloud API · Self-Hosted · Subscription · White-Label · Consulting) |
| **Projected revenue** | $24K–$264K/yr (see [MONETIZATION.md](docs/MONETIZATION.md)) |
| **Competition** | RunwayML ($1.5B), Pika, Synthesia — none offer full pipeline with lip sync |

**Why now?** TikTok/Reels/Shorts dominate content consumption. Creators need volume.
Existing tools (RunwayML, Pika, Kling) generate clips but not complete stories.
Tiandao is the **only open-architecture pipeline** that goes from text → full short drama.

> **We need: $50K seed for cloud GPU infrastructure + web UI development.**
> Investor deck: [docs/DECK.md](docs/DECK.md) (coming soon)

---

Tiandao is a **fully automated AI pipeline** that transforms text ideas into complete short-form videos with:

- 🎬 **Script generation** via LLM (Qwen-72B / Deepseek)
- 🎨 **Scene image generation** via FLUX / Kolors
- 🗣️ **Multi-voice dubbing** via SoVITS + Edge-TTS
- 🎵 **Background music** via ACE music generation
- 🎥 **Image-to-video** via Wan2.2
- 👄 **Lip sync** via MuseTalk / Wav2Lip
- ✨ **Post-processing**: Ken Burns effects, crossfade transitions, subtitles, audio normalization

**One API call. 7 minutes. A complete short drama.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Request                          │
│  POST /api/drama-v7/create { idea, style, sceneCount }  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Tiandao Pipeline Engine                  │
│                                                          │
│  Step 1: Script & Storyboard ──────── Qwen-72B (:8000)  │
│  Step 2: Scene Generation ──────────── FLUX (:8030)     │
│  Step 3: Multi-voice Dubbing ──────── SoVITS (:9880)    │
│  Step 4: Background Music ──────────── ACE (:8001)      │
│  Step 5: Image-to-Video ──────────── Wan2.2 (:8020)     │
│  Step 6: Lip Sync ──────────────── MuseTalk (:8091)     │
│  Step 7: Post-Processing ─────────────── FFmpeg         │
│           (Ken Burns + crossfade + subs + audio norm)    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
          ┌──────────────────┐
          │  Finished Video   │
          │  (MP4, H.264)     │
          └──────────────────┘
```

---

## Quick Start

```bash
# Prerequisites
node >= 18
ffmpeg with libx264
CUDA-compatible GPU (recommended: 24GB+ VRAM)

# 1. Clone & install
git clone https://github.com/qq2667117339/tiandao-ai-studio.git
cd tiandao-ai-studio
npm install

# 2. Configure AI services
# Each service runs on its own port. See docs/SERVICES.md for deployment.
export DEEPSEEK_API_KEY=your_key_here

# 3. Start the pipeline server
node server/drama-pipeline-v7.js

# 4. Create a drama
curl -X POST http://localhost:16012/api/drama-v7/create \
  -H "Content-Type: application/json" \
  -d '{"idea": "A warrior returns home", "style": "cinematic", "sceneCount": 3}'
```

---

## AI Services

| Service | Port | Model | Purpose |
|---------|------|-------|---------|
| **Qwen-72B** | 8000 | Qwen2.5-72B | Script & storyboard generation |
| **FLUX** | 8030 | FLUX.1-dev | Photorealistic scene images |
| **Kolors** | 8010 | Kolors | Text-to-image (fallback) |
| **Wan2.2** | 8020 | Wan2.1-I2V | Image-to-video generation |
| **SoVITS** | 9880 | GPT-SoVITS | Multi-voice text-to-speech |
| **ACE** | 8001 | ACE-Step | Background music generation |
| **MuseTalk** | 8091 | MuseTalk | Real-time lip sync |
| **Wav2Lip** | 8089 | Wav2Lip | Lip sync (fallback) |

---

## Pipeline Details

### Step 1: Script Generation
Qwen-72B generates a complete script with scene descriptions, dialogue, and camera directions from a simple idea.

### Step 2: Scene Images
FLUX generates photorealistic scenes with character consistency prompts. Each scene gets a unique image matching the script's visual description.

### Step 3: Multi-Voice Dubbing
SoVITS provides high-quality voice cloning for different characters (narrator, male lead, female lead, elder, villain). Edge-TTS serves as fallback.

### Step 4: Background Music
ACE generates scene-appropriate background music matching the emotional tone of each segment.

### Step 5: Image-to-Video
Wan2.2 animates still images into short video clips with natural motion. Supports vertical format (480×832) optimized for mobile viewing.

### Step 6: Lip Sync
MuseTalk provides high-resolution lip synchronization, replacing Wav2Lip's 96×96 limitation with full-face alignment.

### Step 7: Post-Processing
FFmpeg handles the final assembly:
- **Ken Burns effect** — smooth camera motion on still images
- **Crossfade transitions** — seamless scene changes
- **Subtitle rendering** — CJK-compatible font support
- **Audio normalization** — EBU R128 loudness standard
- **Quality** — CRF 17, preset slow, H.264

---

## Sample Outputs

Sample videos and test outputs are available in the `examples/` directory. Run times:

| Configuration | Duration | Size | Quality |
|--------------|----------|------|---------|
| 1 scene, standard | ~7 min | ~2.2 MB | 1080×1920, CRF 20 |
| 3 scenes, quality | ~12 min | ~6.5 MB | 1080×1920, CRF 17 |
| 5 scenes, cinematic | ~20 min | ~15 MB | 1080×1920, CRF 17 |

---

## Project Status

**Production-ready.** The pipeline has been tested end-to-end with multiple scenarios.

- [x] 7-step pipeline: script → images → audio → video → lip-sync → polish → output
- [x] All 8 AI services deployed and operational
- [x] Multi-voice dubbing with SoVITS
- [x] MuseTalk lip sync integration
- [x] CJK subtitle rendering
- [x] Ken Burns camera motion
- [x] Error recovery and retry logic
- [ ] Web UI for non-technical users
- [ ] Cloud deployment guide
- [ ] Batch processing

---

## Use Cases

- **Short drama production** — Generate 1-3 minute short dramas from text ideas
- **MV production** — Music video generation with lyrics synchronization
- **Advertising** — Quick commercial video production
- **Content farming** — Automated social media video pipelines

---

## Why This Matters

Traditional short drama production requires:
- Scriptwriter, storyboard artist, animator, voice actor, sound designer, video editor
- Days to weeks per episode
- $1,000-10,000+ per episode

**Tiandao does it in 7 minutes for pennies in GPU compute.**

---

## Business Model / SaaS

> **Investor-ready.** This is not just open-source — it's a sellable product with clear revenue paths.

| Revenue Stream | Model | Price Range | Target Customer |
|---------------|-------|-------------|----------------|
| **Cloud API** | Pay-per-video | $4.99-49.99/video | Content creators, studios |
| **Self-Hosted** | One-time license | $499-9,999 | Enterprise, agencies |
| **Managed** | Monthly subscription | $29-299/mo | Regular creators, agencies |
| **White-Label** | Full rebrand | $4,999-29,999 | Platforms, large studios |

**Conservative year-1 projection**: $24K profit (single GPU, 50 users)
**At scale**: $100K+/year with 4-GPU cluster + cloud auto-scaling

📊 [Full business model & financial projections →](docs/MONETIZATION.md)

---

### Competitive Moat

| Competitor | Weakness | **Tiandao Advantage** |
|-----------|----------|----------------------|
| RunwayML | Basic quality, $15/mo | Full drama pipeline, 7-min |
| Pika Labs | Short clips only | Complete narrative generation |
| Synthesia | Avatar-only | Full cinematic production |
| Sora (OpenAI) | Not yet available | **Working product TODAY** |

**Tiandao is the only automated pipeline from text → complete short drama with lip sync, multi-voice, and cinematic effects. Running now. Not a research paper.**

---

## License

MIT — Use it, build on it, invest in it. See [LICENSE](LICENSE).

---

<p align="center"><em>天道 — The Way of Heaven. Automated creation. Investor-ready.</em></p>
