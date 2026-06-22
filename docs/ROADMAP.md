# 短剧管线修复路线图

## 一、现状

```
当前调用链 (红色=断点)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  用户请求
    │
    ▼
  server.js :3993
    │
    └─ /api/drama → routes/drama.js
                     │
                     ▼
               drama-pipeline-local.js  (80KB)
                     │
             ┌───────┼────────┐
             ▼       ▼        ▼
       qwen-engine  face-lock  rife-interpolator  ...
        (win路径)   (win路径)    (win路径)
          ❌         ❌          ❌


  可用服务:  :8000 Qwen    :8030 FLUX    :8020 Wan    :9880 SoVITS    :8001 ACE
             剧本          场景图        视频          配音            音乐
              ✅           ✅            ✅          ✅             ✅

  实际调用:   ❌           ❌            ❌          ❌             ❌

  drama-pipeline-local: 一个 HTTP 端口都不调
```

---

## 二、目标：商业级 9 步链路

```
  用户输入 → 剧本 → 分镜 → 场景图 → 配音 → BGM → 视频 → 口型 → 增强 → 字幕合成 → 成品

  ① 剧本生成    Qwen-72B :8000          ✅ 已可用
  ② 分镜规划    台词分割+镜头描述         ⚠️ 需重写
  ③ 场景图      FLUX :8030              ✅ 已可用
      备用       Kolors :8010            📞 需接入
  ④ 配音        SoVITS :9880            ✅ 已可用
      备用       edge-tts                ✅ 已可用
  ⑤ BGM        ACE :8001               ✅ 已可用
  ⑥ 视频        Wan2.2 I2V :8020        ✅ 已可用
  ⑦ 口型同步    Wav2Lip :8089            ⚠️ 缺模型
  ⑧ 后期增强    帧插值/超分/调色         ❌ 缺模型
  ⑨ 字幕合成    卡拉OK字串+拼接          ⚠️ 需验证
```

---

## 三、修复方案：4 阶段

### Phase 1：打通核心链路（30分钟）
在现有代码基础上，直接对 HTTP 端口

```
  新建或改造 → 让 createDrama() 调用:
    ├─ Qwen-72B :8000  → 生成剧本+分镜
    ├─ FLUX :8030      → 每场景一张图
    ├─ SoVITS :9880    → 角色配音
    ├─ Wan2.2 :8020    → 图→视频片段
    └─ ffmpeg 合成     → 完整短剧
```

### Phase 2：加入音乐+字幕（30分钟）
```
  ├─ ACE :8001    → 场景背景乐
  ├─ 字幕引擎     → 修复 subtitle-sync.js
  └─ 多段合成     → crossfade + 过渡效果
```

### Phase 3：高级功能（60分钟）
```
  ├─ Wav2Lip 模型下载 → :8089 口型同步
  ├─ 帧插值(RIFE)模型下载
  ├─ 人脸锁定(insightface)
  └─ 超分放大(RealESRGAN)
```

### Phase 4：商业级完善（持续）
```
  ├─ 节拍卡点         ├─ 批量生产
  ├─ 多分辨率输出     └─ 错误恢复/重试
```

---

## 四、关键决策

```
Q1: 改 drama-pipeline-local.js (80KB)
    还是新建 cloud-drama-v8.js？
    推荐：新建，彻底抛弃 Windows 旧包袱

Q2: 剧本走 Qwen-72B :8000
    还是本地 LLM？
    推荐：Qwen-72B — 70B参数已部署

Q3: BGM 走 ACE :8001
    还是 musicgen？
    推荐：ACE — 已部署可直接调用
```

---

## 五、可用资源

| 服务 | 端口 | 状态 | 接口 |
|------|------|------|------|
| Qwen-72B 剧本 | 8000 | ✅ | POST /v1/chat/completions |
| FLUX 场景图 | 8030 | ✅ | POST /generate → image_b64 |
| Wan2.2 视频 | 8020 | ✅ | POST /generate |
| Kolors 文生图 | 8010 | ✅ | POST /generate |
| ACE 音乐 | 8001 | ✅ | POST /generate |
| SoVITS 配音 | 9880 | ✅ | POST /tts |
| Wav2Lip 口型 | 8089 | ⚠️ 缺模型 | - |
| SadTalker | 7860 | ✅ stub | POST /inference |
| py_server | 9000 | ✅ | Flask |
| server.js | 16012 | ✅ | Node.js |
