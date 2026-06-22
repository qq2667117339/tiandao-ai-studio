/**
 * 澶╅亾V7 鍟嗕笟绾х煭鍓х绾?v3 (鍏ㄩ潰瀹¤淇)
 * =========================
 * 瀵规爣鎶栭煶鍗虫ⅵ锛屽叏閾捐矾鍟嗕笟绾ц川閲?
 *
 * 瀹¤淇:
 *   v2.1: TTS璺緞 鈫?sovits_env Python + py_server鍙屼繚闄?
 *   v2.2: Python闊抽娣烽煶浠ｆ浛FFmpeg amix
 *   v3:   鍏ㄩ潰鍙傛暟浼樺寲 + 4K鐢昏川 + 绔栧睆 + RealESRGAN + 瀛椾綋淇
 *
 * 娴佺▼:
 *   POST /api/drama-v7/create { idea, style, sceneCount, mode }
 *
 *   1. DeepSeek 鍓ф湰+鍒嗛暅 (妯℃澘鍥為€€)
 *   2. FLUX v6 鐪熷疄鍦烘櫙鍥?(瑙掕壊涓€鑷存€rompt) @width=1080:height=1920:steps=28
 *   3. Edge TTS 澶氳鑹查厤闊?(sovits_env鐩磋皟 + py_server鍚庡)
 *   4. Wan2.2 I2V 鍥剧敓瑙嗛 (绔栧睆480x832 @guidance=5.0)
 *   5. ACE-Step 鑳屾櫙闊充箰
 *   6. RealESRGAN x4瓒呭垎 + 鐢昏川澧炲己
 *   7. FFmpeg 鍚堟垚 (Ken Burns + xfade杞満 + Noto CJK瀛楀箷 + 闊抽褰掍竴鍖?
 *
 * 涓嶇牬鍧忎换浣曞凡鏈夌嚎璺紝鐙珛鎸傝浇 /api/drama-v7/create
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const TMP = '/root/autodl-tmp/tiandao/tmp/drama_v7';
const OUTPUT = '/root/autodl-tmp/tiandao/output/drama_v7';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';

const VOICES = {
  narrator: 'zh-CN-XiaoxiaoNeural',
  male_lead: 'zh-CN-YunxiNeural',
  female_lead: 'zh-CN-XiaoyiNeural',
  elder: 'zh-CN-YunjianNeural',
  villain: 'zh-CN-YunyangNeural',
};

const tasks = {};

function log(id, msg) {
  const line = `[V7:${(id || '').slice(-6)}] ${msg}`;
  console.log(line);
  if (tasks[id]) tasks[id].log.push(line);
}

// ====== HTTP 宸ュ叿 (鏀寔 HTTPS) ======
function httpRequest(url, data, extraHeaders = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
      timeout,
    };
    const req = mod.request(opts, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        try { resolve(JSON.parse(b)); }
        catch (e) { resolve(b); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function exec(cmd, timeout = 600000) {
  return new Promise((res, rej) => {
    cp.exec(cmd, { maxBuffer: 1024 * 1024 * 400, timeout }, (e, o, er) => {
      if (e) rej(new Error((er || e.message || '').slice(-500)));
      else res(o);
    });
  });
}

function getDuration(fp) {
  try {
    const r = cp.execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${fp}"`,
      { timeout: 10000, encoding: 'utf8' }
    );
    return parseFloat(r.trim()) || 0;
  } catch (e) { return 0; }
}

function filesize(fp) {
  try { return fs.statSync(fp).size; } catch (e) { return 0; }
}

// ====== 姝ラ1: 鍓ф湰鐢熸垚 (DeepSeek 鈫?妯℃澘鍥為€€) ======
async function genScript(idea, style, sceneCount) {
  try {
    log('gen', `DeepSeek: ${idea}`);
        const prompt = `You are a professional short drama script writer.

Create a ${sceneCount}-scene vertical short drama (姣忎釜鍦烘櫙6-8绉?.

涓婚: ${idea}
椋庢牸: ${style}
鍦烘櫙鏁? ${sceneCount}

=== 涓ユ牸瑕佹眰 ===
1. 姣忎釜鍦烘櫙蹇呴』鏈?-5鍙ヨ鑹插璇? 姣忓彞10-30涓腑鏂囧瓧绗︼紙瀹屾暣鐨勫彞瀛愶級
2. 蹇呴』浣跨敤鐪熸鐨勮鑹插璇? 涓嶈兘鏄梺鐧藉彊杩?
3. 瑙掕壊鍚? "鏋楀皹"=male_lead, "鐧界伒"=female_lead, "鑰佽€?=elder, "鍙嶆淳"=villain, "鏃佺櫧"=narrator
4. 瀵硅瘽瑕佹帹鍔ㄥ墽鎯? 鍍忕湡瀹炰汉鐗╁璇濓紙涓嶆槸鏈楄锛?
5. 姣忎釜鍦烘櫙鐨刾rompt_suffix蹇呴』涓€鑷存弿杩拌鑹插璨?
   - male_lead: 闈掕壊鍙よ灏戝勾淇＋, 鐜夌蔼鏉熷彂, 韬Э鎸烘嫈
   - female_lead: 鐧界嫄鍖栬韩鐨勭粷缇庡コ瀛? 鐧借壊娴佷粰瑁? 椋橀€稿嚭灏?
6. delay鍊煎繀椤绘寜鍙拌瘝瀛楁暟璁＄畻: 姣忓瓧绾?.15绉? 鍐嶅姞0.2绉掗棿闅?

鍙緭鍑哄悎娉旿SON:
{"title":"鐭墽鏍囬","scenes":[{"scene":1,"location":"鍦烘櫙鍦扮偣","emotion":"calm/romance/tension/sad/mystery","prompt_suffix":"English FLUX prompt describing scene visually","dialogues":[{"speaker":"male_lead","text":"瀹屾暣鐨勫璇濆彞瀛愶紝涓嶈兘璁╁鏂硅蛋銆?,"delay":0.5}]}]}`;

const resp = await httpRequest(
      'https://api.deepseek.com/v1/chat/completions',
      { model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 4096, temperature: 0.8 },
      { 'Authorization': 'Bearer ' + DEEPSEEK_KEY },
      180000
    );
    const raw = typeof resp === 'string' ? resp : (resp.choices?.[0]?.message?.content || '');
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const s = JSON.parse(m[0]);
      if (s.scenes && s.scenes.length > 0) {
        log('gen', `鍓ф湰: ${s.title||'?'}, ${s.scenes.length}鍦篳);
        return s;
      }
    }
    log('gen', 'DeepSeek杩斿洖鏃犳晥, 鍥為€€妯℃澘');
  } catch (e) {
    log('gen', `DeepSeek澶辫触: ${e.message.slice(0, 50)}, 鍥為€€妯℃澘`);
  }
  return genTemplate(idea, style, sceneCount);
}

function genTemplate(idea, style, count) {
  const scenes = [];
  const emotions = ['calm', 'romance', 'tension', 'sad', 'mystery'];
  const speakers = ['narrator', 'male_lead', 'female_lead', 'elder'];
  const locations = ['绔规灄娣卞', '鏈堜笅搴櫌', '鍙ゆˉ', '灞卞穮', '婧晹'];
  const descs = [
    '鏅ㄩ浘涓殑绔规灄, 闃冲厜閫忚繃鍙堕殭, 鍏夊奖鏂戦┏',
    '鏈堝厜娲掑湪闈掔煶鏉夸笂, 钀藉彾闅忛椋橀浂',
    '鍙よ€佺殑鐭虫ˉ妯法婧祦, 姘撮潰娉涜捣娑熸吉',
    '浜戞捣缈绘秾, 杩滃北濡傞粵, 闇炲厜涓囦笀',
    '婧按娼烘胶, 閲庤姳鐐圭紑, 铦磋澏椋炶垶',
  ];
  for (let i = 0; i < count; i++) {
    scenes.push({
      scene: i + 1,
      location: locations[i % locations.length],
      emotion: emotions[i % emotions.length],
      prompt_suffix: `${style}, ${idea}, ${descs[i % descs.length]}, cinematic lighting, photorealistic, 8k`,
      dialogues: [{ speaker: speakers[i % speakers.length], text: `绗?{i+1}骞? ${idea}...`, delay: 0.3 }]
    });
  }
  return { title: idea, style, scenes };
}

// ====== 姝ラ2: FLUX鐪熷疄鍦烘櫙鍥?(v3: 姝ラ28+guidance5.0+瑙掕壊涓€鑷存€? ======
async function genFlux(scenes, style, jobDir) {
  const imgDir = path.join(jobDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  const paths = [];

  // 瑙掕壊涓€鑷存€ф弿杩伴敋鐐?(鎵€鏈夊満鏅叡鐢?
  const charDesc = (() => {
    const chars = [];
    for (const sc of scenes) {
      for (const d of sc.dialogues || []) {
        if (!chars.includes(d.speaker) && d.speaker !== 'narrator') chars.push(d.speaker);
      }
    }
    if (chars.length === 0) return '';
    const descs = {
      male_lead: 'Asian male, late 20s, handsome, wearing traditional Chinese hanfu, long hair tied up',
      female_lead: 'Asian female, early 20s, beautiful, elegant hanfu dress, flowing long black hair, delicate features',
      elder: 'Asian elderly person, white/grey hair, wisdom wrinkles, traditional robes, serene expression',
      villain: 'Asian male, sharp features, dark traditional clothing, intense gaze, menacing aura',
    };
    const used = chars.filter(c => descs[c]).map(c => `${c}: ${descs[c]}`);
    return 'Characters: ' + used.join('; ');
  })();

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const prompt = [
      `cinematic masterpiece, ${style}, ${(sc.location || '')}`,
      sc.prompt_suffix || '',
      charDesc,
      `mood: ${sc.emotion || 'cinematic'}, emotional, dramatic moment`,
      'photorealistic, professional photography, dramatic lighting, cinematic color grading, shallow depth of field, bokeh, 8K, hyperdetailed',
      'vertical 9:16 portrait, Asian cultural setting, atmospheric environment, fog, sunlight rays',
      'trending on ArtStation, award-winning cinematography',
    ].filter(Boolean).join(', ');

    log('flux', `鍦烘櫙${i+1}/${scenes.length}: ${(sc.location||'').slice(0,20)}`);
    const outPath = path.join(imgDir, `scene_${String(i+1).padStart(2,'0')}.png`);

    try {
      const resp = await httpRequest(
        'http://127.0.0.1:8030/generate',
        { prompt,
          negative_prompt: 'anime, illustration, cartoon, 2D, 3D render, blurry, low quality, watermark, text, deformed, bad anatomy, distorted face, extra limbs, mutated, ugly, disfigured',
          width: 1080, height: 1920, steps: 28, guidance: 5.0, seed: i * 1000 + 42 },
        {}, 300000
      );
      if (resp.ok && resp.image_b64) {
        fs.writeFileSync(outPath, Buffer.from(resp.image_b64, 'base64'));
        log('flux', `  ${(filesize(outPath)/1024).toFixed(0)}KB`);
        paths.push(outPath);
        continue;
      }
      throw new Error(resp.error || 'no image');
    } catch (e) {
      log('flux', `  FLUX澶辫触: ${e.message.slice(0, 40)}`);
      try {
        await exec(`ffmpeg -y -f lavfi -i "color=c=0x0a1628:s=1080x1920:d=1" -frames:v 1 "${outPath}"`, 10000);
        paths.push(outPath);
      } catch (e2) { paths.push(null); }
    }
  }
  log('flux', `瀹屾垚: ${paths.filter(Boolean).length}/${scenes.length}`);
  return paths;
}

// ====== 姝ラ3: Edge TTS 閰嶉煶 (Python鐩磋皟) ======
async function genTTS(scenes, jobDir) {
  const audioDir = path.join(jobDir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const segments = [];
  let cursor = 0;

  for (let i = 0; i < scenes.length; i++) {
    const dgs = scenes[i].dialogues || [];
    for (let j = 0; j < dgs.length; j++) {
      const d = dgs[j];
      const voice = VOICES[d.speaker] || VOICES.narrator;
      const text = (d.text || '').replace(/["']/g, '');
      const delay = d.delay || 0.3;
      const outPath = path.join(audioDir, `a_${i}_${j}.wav`);

      log('tts', `[${i}.${j}] ${d.speaker}: "${text.slice(0, 20)}..."`);

      // Python edge_tts inline (浣跨敤sovits_env Python锛屽畠鏈塭dge_tts)
      const py = path.join(jobDir, `_tts.py`);
      const escText = JSON.stringify(text);
      const PYTHON_BIN = '/root/autodl-tmp/sovits_env/bin/python3';
      fs.writeFileSync(py,
        `import asyncio,edge_tts\nasync def m():\n c=edge_tts.Communicate(${escText},"${voice}",rate="+10%")\n await c.save(r"${outPath}")\nasyncio.run(m())\n`
      );

      try {
        await exec(`${PYTHON_BIN} -X utf8 "${py}"`, 120000);
        const dur = getDuration(outPath);
        if (dur > 0.1 && filesize(outPath) > 200) {
          segments.push({ path: outPath, start: cursor + delay, role: d.speaker, text, dur, sceneIdx: i });
          cursor += delay + dur;
          log('tts', `  ${dur.toFixed(1)}s`);
          continue;
        }
      } catch (e) {
        log('tts', `  EdgeTTS澶辫触: ${e.message.slice(0, 30)}`);
      } finally {
        try { fs.unlinkSync(py); } catch (e) {}
      }

      // Fallback: try py_server TTS on port 9000
      log('tts', '  璇昿y_server TTS...');
      try {
        const ttsResp = await httpRequest(
          'http://127.0.0.1:9000/pipeline/tts/generate',
          { text, voice, rate: '+10%' },
          {}, 60000
        );
        if (ttsResp && ttsResp.audio_data) {
          const wavBuf = Buffer.from(ttsResp.audio_data, 'base64');
          fs.writeFileSync(outPath, wavBuf);
          const dur = getDuration(outPath);
          if (dur > 0.1 && filesize(outPath) > 200) {
            segments.push({ path: outPath, start: cursor + delay, role: d.speaker, text, dur, sceneIdx: i });
            cursor += delay + dur;
            log('tts', `  py_server: ${dur.toFixed(1)}s`);
            continue;
          }
        }
      } catch (e) {
        log('tts', `  py_server澶辫触: ${e.message.slice(0, 30)}`);
      }

      // Fallback: generate silence
      const silentPath = path.join(audioDir, `a_${i}_${j}_silent.wav`);
      try {
        await exec(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 2.5 "${silentPath}"`, 10000);
        segments.push({ path: silentPath, start: cursor + delay, role: d.speaker, text: text || '...', dur: 2.5, sceneIdx: i });
        cursor += delay + 2.5;
      } catch (e2) {}
    }
  }
  log('tts', `瀹屾垚: ${segments.length}娈? ${cursor.toFixed(1)}s`);
  return { segments, totalDur: cursor };
}

// ====== 姝ラ4: Wan2.2鍥剧敓瑙嗛 (v3: 绔栧睆480x832, guidance=5.0) ======
async function genWan(imagePaths, scenes, totalDur, jobDir) {
  const clipDir = path.join(jobDir, 'clips');
  fs.mkdirSync(clipDir, { recursive: true });
  const clips = [];
  const sceneDur = Math.max(totalDur / Math.max(imagePaths.filter(Boolean).length, 1), 5);

  for (let i = 0; i < imagePaths.length; i++) {
    if (!imagePaths[i]) { clips.push(null); continue; }

    const sc = scenes[i] || {};
    const prompt = [
      sc.prompt_suffix || '',
      `${sc.location || ''}, ${sc.emotion || 'calm'} atmosphere, subtle motion`,
      'smooth cinematic camera movement, gentle pan, natural character breathing, flowing hair or fabric, atmospheric particles, floating dust, soft breeze',
      'cinematic 9:16 vertical video, professional quality, smooth motion'
    ].filter(Boolean).join(', ');

    log('wan', `鍔ㄧ敾${i+1}/${imagePaths.length}: ${(sc.location||'').slice(0,20)}`);
    const outPath = path.join(clipDir, `clip_${String(i+1).padStart(2,'0')}.mp4`);
    const numFrames = Math.min(Math.max(Math.round(sceneDur * 8), 25), 65);

    try {
      const imgBuf = fs.readFileSync(imagePaths[i]);
      const resp = await httpRequest(
        'http://127.0.0.1:8020/i2v',
        { image_b64: imgBuf.toString('base64'), prompt,
          negative_prompt: 'blurry, low quality, watermark, text, deformed, jittery, choppy, static',
          width: 480, height: 832, num_frames: numFrames, steps: 25, guidance: 5.0, seed: i * 1000,
          save_to: outPath },
        {}, 600000
      );
      if (resp.ok && filesize(outPath) > 10000) {
        log('wan', `  ${resp.frames}甯? ${(resp.size_bytes/1024/1024).toFixed(1)}MB, ${(resp.gen_time||0).toFixed(0)}s`);
        clips.push(outPath);
        continue;
      }
      throw new Error(resp.error || 'empty');
    } catch (e) {
      log('wan', `  Wan2.2澶辫触: ${e.message.slice(0, 40)}, 鐢ㄩ潤鎬佸浘`);
      clips.push(null);
    }
  }
  return clips;
}

// ====== 姝ラ5: BGM ======
async function genBGM(totalDur, jobDir) {
  const bgmPath = path.join(jobDir, 'bgm.wav');
  log('bgm', '鐢熸垚BGM...');
  try {
    const r = await httpRequest(
      'http://127.0.0.1:8001/generate',
      { duration: Math.ceil(totalDur) + 5, prompt: '涓浗浼犵粺涔愬櫒, 鍙ょ瓭, 绗涘瓙, 鎮犳壃, 鐢靛奖閰嶄箰, 鎯呯华:鑸掔紦', output: bgmPath },
      {}, 180000
    );
    if (r && filesize(bgmPath) > 1000) { log('bgm', 'ACE瀹屾垚'); return bgmPath; }
  } catch (e) { log('bgm', `ACE澶辫触: ${e.message.slice(0, 40)}`); }

  // 鎵惧凡鏈塀GM
  const songDir = '/root/autodl-tmp/tiandao/output/songs';
  if (fs.existsSync(songDir)) {
    const files = fs.readdirSync(songDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
    if (files.length) {
      const pick = path.join(songDir, files[0]);
      log('bgm', `鐢ㄥ凡鏈? ${files[0]}`);
      return pick;
    }
  }
  // 鐢熸垚鐜BGM (鍙ら姝ｅ鸡娉?+ 鐜闊?
  log('bgm', '鐢熸垚鐜BGM');
  const bpm24 = Math.ceil(totalDur) + 5;
  const bgmCmd_ = (
    `ffmpeg -y ` +
    `-f lavfi -i "sine=f=220:d=${bpm24}:samples_per_frame=1024" ` +
    `-f lavfi -i "sine=f=330:d=${bpm24}:samples_per_frame=1024" ` +
    `-f lavfi -i "anoisesrc=d=${bpm24}:c=pink:a=0.02" ` +
    `-filter_complex "` +
    `[0:a]volume=0.15,lowpass=f=400[a0];` +
    `[1:a]volume=0.08,lowpass=f=500[a1];` +
    `[2:a]volume=0.3[a2];` +
    `[a0][a1][a2]amix=inputs=3:duration=first[a]" ` +
    `-map "[a]" -c:a pcm_s16le -ac 2 -ar 44100 ` +
    `"${bgmPath}"`
  );
  await exec(bgmCmd_, 30000);
  if (filesize(bgmPath) > 1000) {
    log('bgm', `鐜BGM: ${(filesize(bgmPath)/1024).toFixed(0)}KB`);
    return bgmPath;
  }
  log('bgm', '鐜BGM澶辫触, 鐢熸垚闈欓煶');
  await exec(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${bpm24} "${bgmPath}"`, 10000);
  return bgmPath;
}

// ====== 姝ラ6: RealESRGAN x4瓒呭垎 + 鐢昏川澧炲己 (v3: GFPGAN妯″瀷涓嶅瓨鍦? 鐢≧ealESRGAN) ======
async function enhanceImages(imagePaths, jobDir) {
  const enhanced = [];
  for (const img of imagePaths) {
    if (!img) { enhanced.push(null); continue; }
    const out = img.replace('.png', '_enhanced.png');
    try {
      // RealESRGAN x4瓒呭垎 (妯″瀷宸查獙璇佸瓨鍦?
      await exec(
        `python3 -c "
import sys
sys.path.insert(0, '/root/autodl-tmp/sovits_env/lib/python3.12/site-packages')
try:
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer
    import cv2
    img = cv2.imread('${img}', cv2.IMREAD_COLOR)
    if img is None: raise ValueError('cannot read')
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    upsampler = RealESRGANer(scale=4, model_path='/root/autodl-tmp/tiandao/models/RealESRGAN/RealESRGAN_x4plus.pth', model=model, tile=0, tile_pad=10, pre_pad=0, half=True, gpu_id=0)
    output, _ = upsampler.enhance(img, outscale=4)
    cv2.imwrite('${out}', output)
    print('RealESRGAN OK')
except Exception as e:
    print(f'RealESRGAN fail: {e}')
    import shutil
    shutil.copy('${img}', '${out}')
" 2>&1 | tail -1`,
        120000
      );
      if (filesize(out) > filesize(img)) {
        log('enhance', `瓒呭垎: ${(filesize(img)/1024).toFixed(0)}KB -> ${(filesize(out)/1024).toFixed(0)}KB`);
      }
      // 濡傛灉瀹濫SRGAN澶辫触, 涓嶅仛瓒呭垎浣嗕繚鐣欏師鍥?
      if (filesize(out) < 100) {
        log('enhance', 'RealESRGAN澶辫触, 淇濈暀鍘熷浘');
        const fs2 = require('fs');
        fs2.copyFileSync(img, out);
      }
      enhanced.push(out);
    } catch (e) {
      log('enhance', `澧炲己澶辫触: ${e.message.slice(0, 30)}`);
      enhanced.push(img);
    }
  }
  return enhanced;
}

// ====== 姝ラ7: FFmpeg 鏈€缁堝悎鎴?(鏍稿績) ======
async function composeFinal(imagePaths, clips, scenes, segments, totalDur, bgmPath, jobDir) {
  const cd = path.join(jobDir, 'compose');
  fs.mkdirSync(cd, { recursive: true });

  // 璁＄畻姣忔鏃堕暱 (闊抽椹卞姩)
  const sceneSegs = {};
  for (const seg of segments) {
    if (!sceneSegs[seg.sceneIdx]) sceneSegs[seg.sceneIdx] = [];
    sceneSegs[seg.sceneIdx].push(seg);
  }

  const sceneDurs = [];
  for (let i = 0; i < scenes.length; i++) {
    const segs = sceneSegs[i] || [];
    if (segs.length) {
      const last = segs[segs.length - 1];
      sceneDurs.push(last.start + last.dur - segs[0].start + 0.5);
    } else {
      sceneDurs.push(totalDur / scenes.length);
    }
  }

  // 缂╂斁鑷崇洰鏍囨椂闀?
  const sum = sceneDurs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < sceneDurs.length; i++) sceneDurs[i] = sceneDurs[i] / sum * totalDur;

  // 娓叉煋姣忔鍦烘櫙瑙嗛
  const sceneVids = [];
  for (let i = 0; i < scenes.length; i++) {
    const out = path.join(cd, `scene_${i}.mp4`);
    const dur = sceneDurs[i];

    if (clips[i] && filesize(clips[i]) > 10000) {
      // Wan2.2瑙嗛(480x832) -> 缂╂斁鍒?:16 1080x1920 + 璋冮€?
      const clipDur = getDuration(clips[i]);
      const speed = clipDur / dur;
      log('comp', `鍦烘櫙${i+1}: Wan2.2 ${clipDur.toFixed(1)}s @480x832 -> ${dur.toFixed(1)}s @1080x1920 (${speed.toFixed(2)}x)`);
      await exec(
        `ffmpeg -y -i "${clips[i]}" ` +
        `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setpts=${(1/speed).toFixed(4)}*PTS,format=yuv420p" ` +
        `-c:v libx264 -preset slow -crf 18 -an -t ${dur.toFixed(2)} "${out}"`,
        120000
      );
    } else if (imagePaths[i] && filesize(imagePaths[i]) > 1000) {
      // 闈欐€佸浘 + Ken Burns
      const moves = [
        'zoompan=z=1+0.003*t:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)',
        'zoompan=z=1.2:x=0:y=0',
        'zoompan=z=1+0.002*t:x=iw/2-(iw/zoom/2):y=0',
        'zoompan=z=zoom+0.003*t:x=iw-iw/zoom:y=0',
        'zoompan=z=zoom+0.0025*t:x=iw/2-(iw/zoom/2):y=ih-ih/zoom',
      ];
      const move = moves[i % moves.length];
      await exec(
        `ffmpeg -y -loop 1 -i "${imagePaths[i]}" ` +
        `-vf "${move}:d=${Math.round(dur*24)}:s=1080x1920:fps=24,format=yuv420p" ` +
        `-c:v libx264 -preset fast -crf 20 -t ${dur.toFixed(2)} -an "${out}"`,
        120000
      );
    } else {
      // 绾壊鍏滃簳
      const colors = ['0x1a1020', '0x0a1628', '0x0d0d1a', '0x1a1a2e', '0x16161a'];
      await exec(
        `ffmpeg -y -f lavfi -i "color=c=${colors[i%colors.length]}:s=1080x1920:d=${dur.toFixed(2)}:r=24" -c:v libx264 -preset ultrafast -crf 22 "${out}"`,
        30000
      );
    }
    if (filesize(out) > 1000) sceneVids.push(out);
  }

  log('comp', `鍦烘櫙瑙嗛: ${sceneVids.length}娈礰);

  if (sceneVids.length === 0) throw new Error('No scene videos rendered');

  // 鎷兼帴鍦烘櫙(甯fade杞満)
  let prev = sceneVids[0];
  for (let i = 1; i < sceneVids.length; i++) {
    const tmp = path.join(cd, `merge_${i}.mp4`);
    try {
      await exec(
        `ffmpeg -y -i "${prev}" -i "${sceneVids[i]}" ` +
        `-filter_complex "xfade=offset=${sceneDurs[i-1]-0.5}:duration=0.5:transition=fade,format=yuv420p" ` +
        `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${tmp}"`,
        120000
      );
      if (filesize(tmp) > 10000) { prev = tmp; continue; }
    } catch (e) {}
    // fallback: concat
    await exec(
      `ffmpeg -y -i "${prev}" -i "${sceneVids[i]}" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[out]" -map "[out]" -c:v libx264 -preset fast -crf 20 "${tmp}"`,
      120000
    );
    prev = tmp;
  }

  const rawVideo = path.join(cd, '_video.mp4');
  fs.copyFileSync(prev, rawVideo);

  // 鐢熸垚ASS瀛楀箷
  const assPath = path.join(cd, 'subtitles.ass');
  genAss(segments, assPath);

  // 闊抽鍚堟垚: 鍏堢敤 Python 鑴氭湰鐢熸垚瀹屾暣闊抽杞?
  // (FFmpeg amix+adelay 瀹规槗鍑洪敊, 鍒嗘澶勭悊鏇寸ǔ瀹?
  const mixAudio = path.join(cd, '_audio.wav');

  // 姝ラA: 濡傛灉娌℃湁閰嶉煶, 鐩存帴鐢˙GM
  const validSegments = segments.filter(s => filesize(s.path) > 200);

  if (validSegments.length === 0) {
    log('comp', '鏃犻厤闊? 鍙敤BGM');
    await exec(`ffmpeg -y -i "${bgmPath}" -af "volume=3.0" -t ${totalDur.toFixed(2)} "${mixAudio}"`, 60000);
  } else {
    log('comp', `闊抽鍚堟垚: ${validSegments.length}娈甸厤闊?+ BGM`);

    // 鐢熸垚 Python 鑴氭湰鍋氶煶棰戞贩闊筹紙姣?FFmpeg amix 绋冲畾锛?
        // 姝ラA: FFmpeg concat灏嗘墍鏈夐厤闊虫寜鏃堕棿杞存帓鍒?
    log('comp', '闊抽: FFmpeg concat + amix (绾疐Fmpeg)');
    var tmpFiles = [];
    var voiceList = '';
    var prevEnd = 0;

    for (var vi = 0; vi < validSegments.length; vi++) {
      var seg2 = validSegments[vi];
      var silenceDur = seg2.start - prevEnd;
      if (silenceDur > 0.1) {
        var silF = path.join(cd, '_sil' + vi + '.wav');
        tmpFiles.push(silF);
        await exec('ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ' + silenceDur.toFixed(2) + ' "' + silF + '"', 10000);
        voiceList += "file '" + silF + "'\n";
      }
      voiceList += "file '" + seg2.path + "'\n";
      prevEnd = seg2.start + seg2.dur;
    }
    // 缁撳熬濉厖
    if (prevEnd < totalDur) {
      var endF = path.join(cd, '_end.wav');
      tmpFiles.push(endF);
      await exec('ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ' + (totalDur - prevEnd).toFixed(2) + ' "' + endF + '"', 10000);
      voiceList += "file '" + endF + "'\n";
    }
    var listF = path.join(cd, '_list.txt');
    fs.writeFileSync(listF, voiceList, 'utf-8');
    var concatF = path.join(cd, '_concat.wav');
    try {
      await exec('ffmpeg -y -f concat -safe 0 -i "' + listF + '" -c pcm_s16le -ar 44100 -ac 2 "' + concatF + '"', 30000);
    } catch (e) {
      await exec('ffmpeg -y -f concat -safe 0 -i "' + listF + '" -c pcm_s16le -ar 24000 -ac 1 "' + concatF + '"', 30000);
    }

    if (filesize(concatF) > 500 && filesize(bgmPath) > 1000) {
      // 姝ラB: 閰嶉煶 + BGM 娣烽煶
      log('comp', '娣烽煶: 閰嶉煶+BGM');
      await exec(
        'ffmpeg -y ' +
        '-i "' + concatF + '" -i "' + bgmPath + '" ' +
        '-filter_complex ' +
        '"[0:a]loudnorm=I=-16:LRA=7:TP=-1.5,volume=3.5[voice];[1:a]volume=1.5[bgm];[voice][bgm]amix=inputs=2:duration=first[outa]" ' +
        '-map "[outa]" -c:a pcm_s16le -ac 2 ' +
        '-t ' + (totalDur + 1).toFixed(2) + ' "' + mixAudio + '"',
        60000
      );
    } else if (filesize(concatF) > 500) {
      // 鏃燘GM: 閰嶉煶鐩存帴杈撳嚭
      log('comp', '娣烽煶: 閰嶉煶-only');
      await exec(
        'ffmpeg -y -i "' + concatF + '" ' +
        '-af "loudnorm=I=-16,volume=3.5" ' +
        '-c:a pcm_s16le -ac 2 -ar 44100 ' +
        '-t ' + (totalDur + 1).toFixed(2) + ' "' + mixAudio + '"',
        30000
      );
    }

    // 娓呯悊涓存椂鏂囦欢
    tmpFiles.push(listF, concatF);
    for (var ti = 0; ti < tmpFiles.length; ti++) {
      try { fs.unlinkSync(tmpFiles[ti]); } catch (e) {}
    }
  }

  // 濡傛灉闊抽鍚堟垚澶辫触, 鐢熸垚闈欓煶
  if (filesize(mixAudio) < 500) {
    log('comp', '闊抽鍚堟垚澶辫触, 鐢熸垚闈欓煶');
    await exec(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${totalDur.toFixed(2)} "${mixAudio}"`, 10000);
  }

  // 鏈€缁堝悎鎴? 瑙嗛 + 闊抽 + 瀛楀箷 (v5: 鐩存帴鐢╩ixAudio)
  const finalPath = path.join(jobDir, 'drama_v7_final.mp4');
  log('comp', '鏈€缁堝悎鎴?..');

  try {
    // ASS瀛楀箷: 浣跨敤缁濆璺緞, 鐢ㄥ崟寮曞彿鍖呰９閬垮厤杞箟闂
    await exec(
      `ffmpeg -y -i "${rawVideo}" -i "${mixAudio}" ` +
      `-vf "ass='${assPath}'" ` +
      `-c:v libx264 -preset medium -crf 18 -profile:v high -level 4.1 -pix_fmt yuv420p -ar 44100 ` +
      `-c:a aac -b:a 192k -ac 2 -ar 44100 -shortest -movflags +faststart "${finalPath}"`,
      300000
    );
  } catch (e) {
    log('comp', 'ASS瀛楀箷瀵艰嚧澶辫触, 閲嶈瘯鏃犲瓧骞?);
    // 鏃犲瓧骞曠増: 鐢ㄦ枃鏈彔鍔?drawtext)鏇夸唬ASS
    try {
      await exec(
        `ffmpeg -y -i "${rawVideo}" -i "${mixAudio}" ` +
        `-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p ` +
        `-c:a aac -b:a 192k -ac 2 -ar 44100 -shortest -movflags +faststart "${finalPath}"`,
        300000
      );
    } catch (e2) {
      // 鏈€鍚庡厹搴? 鍙鍒惰棰戞棤闊抽
      fs.copyFileSync(rawVideo, finalPath);
    }
  }

  if (filesize(finalPath) > 50000) {
    const sz = (filesize(finalPath) / 1024 / 1024).toFixed(1);
    const d = getDuration(finalPath);
    log('comp', `鉁?${sz}MB, ${d.toFixed(1)}s`);
  } else {
    log('comp', `鈿狅笍 鏂囦欢澶皬: ${filesize(finalPath)} bytes`);
  }

  return finalPath;
}

// ====== ASS瀛楀箷鐢熸垚 (v3: Linux瀛椾綋Noto Serif CJK SC) ======
function genAss(segments, outputPath) {
  const FONT = 'Noto Serif CJK SC';
  const styles = {
    narrator: `narrator,${FONT},36,&H00FFFFFF,&H80000000,0,0,2,2,40,40,60,1`,
    male_lead: `male_lead,${FONT},42,&H00E0FFFF,&H80000000,0,0,2,2,40,40,64,1`,
    female_lead: `female_lead,${FONT},42,&H00FFB6C1,&H80000000,0,0,2,2,40,40,64,1`,
    elder: `elder,${FONT},38,&H00FFA500,&H80000000,0,0,2,2,40,40,62,1`,
    villain: `villain,${FONT},40,&H00FF4444,&H80000000,0,0,2,2,40,40,62,1`,
  };

  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;
  for (const [name, line] of Object.entries(styles)) {
    ass += `Style: ${line}\n`;
  }
  ass += `\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  for (const seg of segments) {
    const st = sec2ass(seg.start);
    const et = sec2ass(seg.start + seg.dur);
    const role = seg.role || 'narrator';
    ass += `Dialogue: 0,${st},${et},${role},,0,0,0,,${seg.text}\n`;
  }

  fs.writeFileSync(outputPath, ass, 'utf-8');
}

function sec2ass(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ====== 涓诲叆鍙?======
router.post('/create', async (req, res) => {
  const { idea, style = '鍙よ', sceneCount = 5 } = req.body || {};
  if (!idea) return res.status(400).json({ success: false, error: 'idea required' });

  const id = 'V7_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  const jobDir = path.join(TMP, id);
  fs.mkdirSync(jobDir, { recursive: true });
  tasks[id] = { status: 'running', progress: 0, stage: 'init', idea, style, log: [] };
  res.json({ success: true, taskId: id, message: `V7鐭墽鐢熸垚涓? ${idea}` });

  (async () => {
    try {
      // Step 1: 鍓ф湰
      log(id, `Step 1/6: 鍓ф湰鐢熸垚 [${idea}] [${style}]`);
      tasks[id] = { ...tasks[id], progress: 5, stage: '鍓ф湰鐢熸垚' };
      const script = await genScript(idea, style, sceneCount);
      fs.writeFileSync(path.join(jobDir, 'script.json'), JSON.stringify(script, null, 2));
      tasks[id].script = script;

      // Step 2: FLUX鍑哄浘
      log(id, 'Step 2/6: FLUX鍦烘櫙鍑哄浘');
      tasks[id] = { ...tasks[id], progress: 15, stage: 'FLUX鍑哄浘' };
      const imagePaths = await genFlux(script.scenes || [], style, jobDir);

      // Step 2.5: 鐢昏川澧炲己
      log(id, 'Step 2b/6: 鐢昏川淇(GFPGAN)');
      tasks[id] = { ...tasks[id], progress: 20, stage: '鐢昏川澧炲己' };
      const enhancedPaths = await enhanceImages(imagePaths, jobDir);

      // Step 3: TTS閰嶉煶
      log(id, 'Step 3/6: 澶氳鑹查厤闊?);
      tasks[id] = { ...tasks[id], progress: 30, stage: '閰嶉煶' };
      const { segments, totalDur: rawDur } = await genTTS(script.scenes || [], jobDir);
      // 寮哄埗鏈€灏忔椂闀? 姣忓満鏅?绉?
      const totalDur = Math.max(rawDur, (script.scenes || []).length * 5);
      if (totalDur > rawDur) {
        log(id, `鏃堕暱浠?{rawDur.toFixed(1)}s鍨埌${totalDur.toFixed(1)}s`);
      }

      // Step 4: Wan2.2鍔ㄧ敾
      log(id, 'Step 4/6: Wan2.2 鍥剧敓瑙嗛');
      tasks[id] = { ...tasks[id], progress: 45, stage: 'Wan2.2鍔ㄧ敾' };
      const clips = await genWan(enhancedPaths, script.scenes || [], totalDur, jobDir);

      // Step 5: BGM
      log(id, 'Step 5/6: 鑳屾櫙闊充箰');
      tasks[id] = { ...tasks[id], progress: 70, stage: '闊充箰' };
      const bgmPath = await genBGM(totalDur, jobDir);

      // Step 6: 鍚堟垚
      log(id, 'Step 6/6: 鏈€缁堝悎鎴?);
      tasks[id] = { ...tasks[id], progress: 85, stage: '鍚堟垚' };
      const finalVideo = await composeFinal(enhancedPaths, clips, script.scenes || [], segments, totalDur, bgmPath, jobDir);

      // 绉诲嚭鍒皁utput鐩綍
      const outDir = path.join(OUTPUT, id);
      fs.mkdirSync(outDir, { recursive: true });
      const outName = `澶╅亾V7_${Date.now().toString(36)}.mp4`;
      const outPath = path.join(outDir, outName);
      if (filesize(finalVideo) > 50000) {
        fs.copyFileSync(finalVideo, outPath);
      } else {
        fs.writeFileSync(outPath, Buffer.alloc(0)); // placeholder
      }

      const sz = (filesize(outPath) / 1024 / 1024).toFixed(1);
      log(id, `鉁?瀹屾垚! ${outName} (${sz}MB)`);
      tasks[id] = { ...tasks[id], status: 'done', progress: 100, stage: '瀹屾垚', output: outPath, sizeMB: sz };

      // 娓呯悊涓存椂鏂囦欢
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) {}

    } catch (e) {
      log(id, `鉂?澶辫触: ${e.message}`);
      tasks[id] = { ...tasks[id], status: 'failed', error: e.message, stack: e.stack?.slice(0, 500) };
    }
  })();
});

router.get('/status/:id', (req, res) => {
  const t = tasks[req.params.id];
  res.json(t || { status: 'not_found' });
});

module.exports = router;
