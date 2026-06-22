/**
 * 天道AI短剧管线 v2.0 — 标准化约束式
 * 6大底层锁死 + 镜头拆解 + 动作库 + 剧本审核 + 嘴型同步 + 自动后期
 * 锁死项：人物长相/场景画面/镜头格式/视频参数/关键词/后期模板
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFile, exec } = require('child_process');
const config = require('../../config')
const workArchiver = require('../../core/work-archiver');
const { queryAssets } = require('../../core/unified-asset-lib');

// ===== 路径（中文安全，写死不修改） =====
const BASE_DIR = config.BASE_DIR;
const STORAGE = path.join(BASE_DIR, 'storage', 'drama');
const OUTPUT_DIR = path.join(STORAGE, 'output');
const TEMP_BASE = path.join(STORAGE, '.pipeline_temp');
const REF_DIR = path.join(STORAGE, 'references');
const SADTALKER_DIR = config.SADTALKER_DIR;
const SADTALKER_PY = config.SADTALKER_PYTHON;
const ASCII_TMP = config.DRAMA_TMP;
if (!fs.existsSync(ASCII_TMP)) fs.mkdirSync(ASCII_TMP, { recursive: true });

// 获取推广引流文字（从platform_settings读取，fallback到默认值）
function getPromoText() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(path.dirname(path.dirname(path.dirname(__dirname))), 'data', 'platform.db'), { readonly: true });
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'promo_drawtext'").get();
    db.close();
    if (row && row.value) return row.value;
  } catch(e) {}
  return '点下方链接 做同款视频';
}

const FFMPEG_BIN = config.FFMPEG_BIN;

// Global crash protection
process.on('unhandledRejection', (reason) => { console.error('[CRASH GUARD] Unhandled rejection:', reason?.message || reason); });
process.on('uncaughtException', (err) => { console.error('[CRASH GUARD] Uncaught exception:', err?.message); });
const FFPROBE_BIN = config.FFMPEG_BIN.replace('ffmpeg.exe', 'ffprobe.exe');

// ===== API密钥 =====
const TTS_KEY = config.VOLCANO_TTS_KEY;
const TTS_RES = 'seed-tts-2.0';
const unifiedBrain = require('../../core/unified-brain');

const ttsEngine = require('../tts/tts-engine');

// ================================================================
//  ★★★ 锁死1：人物配置（100%锁死，永不修改）★★★
// ================================================================
const CHAR_LOCK = {
  male_lead: {
    name: '男主',
    zh: '28岁男性，黑色短发，白T恤+黑外套，身材挺拔，眼神坚毅',
    en: '28yo male, black short hair, white t-shirt, black jacket, tall athletic, sharp determined eyes',
    pos: 'handsome male, black short hair, white t-shirt, black jacket, tall, muscular, sharp eyes, photorealistic, cinematic portrait, 8k',
    neg: 'facial distortion, deformed, blurred, ugly, old, feminine, multiple faces, wrong clothing',
    voice: 'zh_male_taocheng_uranus_bigtts',
    faceFile: 'male_lead.jpg'
  },
  female_lead: {
    name: '女主',
    zh: '25岁女性，黑色长直发，白色连衣裙，面容清冷',
    en: '25yo female, long straight black hair, white dress, cold elegant face, slim figure',
    pos: 'beautiful female, long straight black hair, white dress, cold elegant, slim, photorealistic, cinematic portrait, 8k',
    neg: 'facial distortion, deformed, blurred, ugly, masculine, multiple faces, wrong clothing',
    voice: 'zh_female_vv_uranus_bigtts',
    faceFile: 'female_lead.jpg'
  },
  male_rival: {
    name: '男二',
    zh: '30岁男性，棕色短发，西装革履，目光阴沉',
    en: '30yo male, brown short hair, tailored suit, cold calculating eyes',
    pos: 'handsome male 30yo, brown short hair, black business suit, cold piercing eyes, wealthy, photorealistic, cinematic portrait, 8k',
    neg: 'facial distortion, deformed, blurred, ugly, casual clothes',
    voice: 'zh_male_taocheng_uranus_bigtts',
    faceFile: 'male_rival.jpg'
  },
  female_friend: {
    name: '闺蜜',
    zh: '24岁女性，棕色卷发，活泼可爱',
    en: '24yo female, wavy brown hair, cute lively face, slim',
    pos: 'cute young female 24yo, wavy brown hair, warm smile, fashionable casual clothes, photorealistic, cinematic portrait, 8k',
    neg: 'facial distortion, deformed, blurred, ugly',
    voice: 'zh_female_meilinvyou_uranus_bigtts',
    faceFile: 'female_friend.jpg'
  },
  elder_male: {
    name: '长辈男',
    zh: '55岁男性，灰白短发，皱纹深刻，威严',
    en: '55yo male, gray white hair, deep wrinkles, dignified authority',
    pos: 'elderly distinguished male 55yo, gray white hair, deep wrinkles, stern dignified, traditional Chinese clothes, photorealistic, cinematic portrait, 8k',
    neg: 'facial distortion, deformed, blurred, young',
    voice: 'zh_male_taocheng_uranus_bigtts',
    faceFile: 'elder_male.jpg'
  },
  young_boy: {
    name: '少年',
    zh: '18岁男性，学生短发，阳光帅气',
    en: '18yo male, student short hair, sunny handsome',
    pos: 'handsome young male 18yo, student short black hair, bright sunny smile, school uniform, photorealistic, cinematic portrait, 8k',
    neg: 'facial distortion, deformed, blurred, old, ugly',
    voice: 'zh_male_taocheng_uranus_bigtts',
    faceFile: 'young_boy.jpg'
  }
};

// ================================================================
//  ★★★ 锁死2：场景配置（100%锁死）★★★
// ================================================================
const SCENE_LOCK = {
  living_room: {
    name: '出租屋客厅',
    zh: '暖黄光，灰色沙发，白色茶几，简约装修，温馨但略旧',
    en: 'apartment living room, warm yellow lighting, gray sofa, white coffee table, simple modest decor, cozy',
    pos: 'apartment living room interior, warm yellow lighting, gray sofa, white coffee table, simple decor, cozy, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'cluttered, bright daylight, modern luxury, messy, outdoor'
  },
  outdoor_evening: {
    name: '小区楼下',
    zh: '傍晚，路灯亮起，路边绿植，安静小区道路',
    en: 'residential outdoors, evening dusk, street lights on, roadside greenery, quiet path',
    pos: 'residential area outdoors, evening, street lights, greenery, quiet path, golden hour, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'bright daylight, highway, crowded, beach, forest'
  },
  office: {
    name: '办公室',
    zh: '现代写字楼，落地玻璃窗，电脑桌，文件堆叠',
    en: 'modern office, floor-to-ceiling glass windows, computer desk, stacked documents',
    pos: 'modern corporate office interior, glass windows, computer desk, documents, professional, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'messy, dark, old, casual'
  },
  cafe: {
    name: '咖啡厅',
    zh: '暖色调咖啡厅，木质桌椅，窗边座位，柔和灯光',
    en: 'warm tone cafe, wooden tables and chairs, window seat, soft lighting',
    pos: 'cozy warm cafe interior, wooden furniture, window seat, soft ambient lighting, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'bright harsh, empty, dark, modern'
  },
  hospital: {
    name: '医院走廊',
    zh: '白色走廊，消毒水味，冰冷灯光，长椅',
    en: 'white hospital corridor, sterile, cold fluorescent lighting, bench',
    pos: 'hospital corridor interior, white walls, cold fluorescent lights, bench, sterile atmosphere, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'warm, colorful, dark, outdoor'
  },
  rooftop: {
    name: '天台',
    zh: '高楼天台，夜晚城市灯光，风吹头发',
    en: 'rooftop at night, city lights below, wind blowing hair',
    pos: 'building rooftop at night, city skyline lights below, dramatic sky, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'daytime, indoor, low angle'
  },
  street_night: {
    name: '夜市街头',
    zh: '繁华夜市，霓虹灯，人潮涌动，小吃摊',
    en: 'bustling night market, neon signs, crowds, food stalls',
    pos: 'vibrant night market street, neon signs glowing, crowds of people, food stalls, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'empty, daytime, quiet'
  },
  rain_street: {
    name: '雨天街道',
    zh: '细雨中，湿漉漉的街道，雨伞，路灯倒影',
    en: 'drizzling rain, wet glistening street, umbrellas, street lamp reflections',
    pos: 'rainy street scene, wet reflections on ground, umbrellas, street lamp glow, moody atmosphere, cinematic 8k, vertical 9:16, photorealistic',
    neg: 'sunny, dry, indoor'
  }
};

// ================================================================
//  ★★★ 锁死3：镜头格式 ★★★
// ================================================================

// ===== 本地素材库加载 =====
var LOCAL_ASSETS = { characters:{}, scenes:{}, effects:{} };
(function loadLocalAssets() {
  try {
    ["characters","scenes","effects"].forEach(function(cat) {
      var catDir = path.join(STORAGE, cat);
      if (!fs.existsSync(catDir)) return;
      ["exclusive","general"].forEach(function(sub) {
        var subDir = path.join(catDir, sub);
        if (!fs.existsSync(subDir)) return;
        fs.readdirSync(subDir).filter(function(f){return f.endsWith(".json");}).forEach(function(f) {
          try { var d=JSON.parse(fs.readFileSync(path.join(subDir,f),"utf-8")); if(d.id) LOCAL_ASSETS[cat][d.id]=d; } catch(e){}
        });
      });
    });
    console.log("[Assets] "+Object.keys(LOCAL_ASSETS.characters).length+" chars, "+Object.keys(LOCAL_ASSETS.scenes).length+" scenes, "+Object.keys(LOCAL_ASSETS.effects).length+" fx");
  } catch(e) { console.warn('[Assets] load error:', e.message); }
})();

// ===== ★ 场景素材强制匹配器（禁止AI生成新图） =====
var SCENE_IMAGE_MAP = {}; // Cache: sceneName → imagePath

(function buildSceneImageMap() {
  try {
    var assetBase = path.join(STORAGE, 'assets');
    var sceneFolders = [
      { dir: 'mengpo/scene', keywords: ['孟婆','黄泉','忘川','奈何','彼岸','冥府','三生','幽冥','轮回','烛火','判官','亡魂','黄泉渡口','黄泉城门','黄泉古道'] },
      { dir: 'wangzhe', keywords: ['王者','峡谷','联盟','荣耀'] },
      { dir: 'tao_clear', keywords: ['陶','道','清'] },
      { dir: 'urban', keywords: ['都市','城市','现代','urban'] },
      { dir: 'drama_assets/scenes', keywords: ['drama','短剧','scene'] }
    ];

    sceneFolders.forEach(function(folder) {
      var fullDir = path.join(assetBase, folder.dir);
      if (!fs.existsSync(fullDir)) return;
      var files = fs.readdirSync(fullDir).filter(function(f) { return /\.(jpg|jpeg|png|webp)$/i.test(f); });
      files.forEach(function(f) {
        var nameNoExt = f.replace(/\.[^.]+$/, '');
        // Map the filename as a scene name
        SCENE_IMAGE_MAP[nameNoExt] = path.join(fullDir, f);
        // Also map with common suffixes stripped
        var aliases = [nameNoExt];
        if (nameNoExt.endsWith('内')) aliases.push(nameNoExt.slice(0, -1));
        if (nameNoExt.endsWith('外')) aliases.push(nameNoExt.slice(0, -1));
        if (nameNoExt.endsWith('上')) aliases.push(nameNoExt.slice(0, -1));
        if (nameNoExt.endsWith('前')) aliases.push(nameNoExt.slice(0, -1));
        if (nameNoExt.endsWith('畔')) aliases.push(nameNoExt.slice(0, -1));
        if (nameNoExt.endsWith('头')) aliases.push(nameNoExt.slice(0, -1));
        aliases.forEach(function(a) {
          if (!SCENE_IMAGE_MAP[a]) SCENE_IMAGE_MAP[a] = path.join(fullDir, f);
        });
      });
    });

    console.log('[AssetForce] 场景素材库加载: ' + Object.keys(SCENE_IMAGE_MAP).length + ' 个场景映射');
  } catch(e) {
    console.warn('[AssetForce] 加载失败:', e.message.substring(0, 80));
  }
})();

/**
 * 根据场景名查找本地素材图（强制优先，禁止AI生成）
 * @param {string} sceneName - 场景名（如"忘川河畔""奈何桥头"）
 * @param {string} genreHint - 曲风提示（如"孟婆黄泉"）
 * @returns {{imagePath: string, matchedName: string}|null}
 */
function matchLocalSceneImage(sceneName, genreHint) {
  if (!sceneName) return null;

  // 1. Exact match
  if (SCENE_IMAGE_MAP[sceneName]) {
    return { imagePath: SCENE_IMAGE_MAP[sceneName], matchedName: sceneName };
  }

  // 2. Substring match: sceneName contains asset key OR asset key contains sceneName
  var keys = Object.keys(SCENE_IMAGE_MAP);
  for (var i = 0; i < keys.length; i++) {
    if (sceneName.includes(keys[i]) || keys[i].includes(sceneName)) {
      return { imagePath: SCENE_IMAGE_MAP[keys[i]], matchedName: keys[i] };
    }
  }

  // 3. Character-level match: find best overlap
  var bestMatch = null;
  var bestScore = 0;
  for (var j = 0; j < keys.length; j++) {
    var score = 0;
    for (var ci = 0; ci < sceneName.length; ci++) {
      if (keys[j].includes(sceneName[ci])) score++;
    }
    if (score > bestScore && score >= 2) {
      bestScore = score;
      bestMatch = { imagePath: SCENE_IMAGE_MAP[keys[j]], matchedName: keys[j] };
    }
  }

  // 4. Unified asset lib drop-in: query all asset presets
  if (!bestMatch) {
    try {
      var assets = queryAssets('drama', { parsed: { theme: genreHint || sceneName } });
      if (assets.scenes && assets.scenes.length > 0) {
        var pick = assets.scenes[0];
        var p = pick.path || pick.filePath || pick.imagePath;
        if (p && fs.existsSync(p)) {
          bestMatch = { imagePath: p, matchedName: '素材库: ' + (pick.name || sceneName) };
        }
      }
    } catch(e) { /* fallback */ }
  }
  return bestMatch;
}

// Character image matcher
function matchLocalCharacterImage(charName, charLook) {
  try {
    var charDir = path.join(STORAGE, 'assets', 'mengpo', 'character');
    if (!fs.existsSync(charDir)) return null;

    var files = fs.readdirSync(charDir).filter(function(f) { return /\.(jpg|jpeg|png|webp)$/i.test(f); });
    // Try matching by character role name
    var roleMap = {
      'female_lead': ['female_lead', 'female', '女主', '女'],
      'male_lead': ['male_lead', 'male', '男主', '男'],
      'villain': ['villain', '反派'],
      'judge': ['judge', '判官'],
      'mengpo': ['mengpo', '孟婆', 'black_robe'],
      'ghost': ['ghost', '鬼', '幽魂']
    };

    // Find character subfolder or matching file
    for (var i = 0; i < files.length; i++) {
      var fname = files[i].toLowerCase().replace(/\.[^.]+$/, '');
      if (charName && (fname.includes(charName.toLowerCase()) || charName.toLowerCase().includes(fname))) {
        return path.join(charDir, files[i]);
      }
    }

    // Try role-based matching
    if (charName) {
      for (var role in roleMap) {
        var aliases = roleMap[role];
        if (charName.includes(role) || aliases.some(function(a) { return charName.includes(a); })) {
          // Find any file with this role prefix
          for (var j = 0; j < files.length; j++) {
            if (files[j].toLowerCase().includes(role) || aliases.some(function(a) { return files[j].toLowerCase().includes(a); })) {
              return path.join(charDir, files[j]);
            }
          }
        }
      }
    }

    // Random pick as last resort (still local)
    if (files.length > 0) {
      return path.join(charDir, files[Math.floor(Math.random() * files.length)]);
    }
  } catch(e) {}
  return null;
}

function findLocalScene(name) {
  if (!name) return null;
  var keys = Object.keys(LOCAL_ASSETS.scenes);
  var m = keys.find(function(k){return k===name||LOCAL_ASSETS.scenes[k].name===name;});
  if (m) return LOCAL_ASSETS.scenes[m];
  m = keys.find(function(k){return name.replace(/ /g,"").includes(k.replace(/_/g,""))||k.replace(/_/g,"").includes(name.replace(/ /g,""));});
  return m ? LOCAL_ASSETS.scenes[m] : null;
}
function findLocalCharacter(name) {
  if (!name) return null;
  var keys = Object.keys(LOCAL_ASSETS.characters);
  var m = keys.find(function(k){return k===name||LOCAL_ASSETS.characters[k].name===name;});
  if (m) return LOCAL_ASSETS.characters[m];
  m = keys.find(function(k){return name.replace(/ /g,"").includes(k.replace(/_/g,""))||k.replace(/_/g,"").includes(name.replace(/ /g,""));});
  return m ? LOCAL_ASSETS.characters[m] : null;
}
const SHOT_LOCK = { durMin:2, durMax:8 };

// ================================================================
//  ★★★ 锁死4：视频参数 ★★★
// ================================================================
const VID = {
  w: 1080, h: 1920, fps: 24, crf: 18, preset: 'slow',
  audioBitrate: '192k', audioSampleRate: 44100, audioChannels: 2, imgSize: '1440x2560'
};

// ================================================================
//  ★★★ 锁死5：关键词 ★★★
// ================================================================
const KW = {
  posBase: 'cinematic, 8K, ultra detailed, photorealistic, professional photography, movie still, 9:16 vertical portrait, vertical composition, no text, no watermark, no logo, no English letters, clean scene, pure visual, main light from upper-front 45 degrees, soft diffused lighting, 5500K color temperature, consistent white balance',
  neg: 'text, watermark, logo, English letters, sign, low quality, blurry, distorted, deformed, extra limbs, bad anatomy, worst quality, jpeg artifacts, nsfw',
  styleMap: {
    '都市逆袭': 'modern city, realistic, urban photography, dramatic lighting',
    '古风情感': 'ancient Chinese, traditional, elegant, soft lighting',
    '武侠仙侠': 'wuxia, martial arts, flowing robes, ethereal',
    '科幻未来': 'sci-fi, futuristic, neon, cyberpunk',
    '都市悬疑': 'noir, mystery, dark tones, shadows, moody',
    '动漫二次元': 'anime style, vibrant, clean lines',
    '孟婆黄泉': 'dark underworld, ethereal ghosts, blue purple mist',
    '都市情感': 'romantic, soft lighting, warm tones, emotional'
  }
};

// ================================================================
//  ★★★ 锁死6：后期模板 ★★★
// ================================================================
const POST = {
  sub: { font:'Microsoft YaHei', size:36, primary:'&H00FFFFFF', outline:'&H80000000', outlineW:4, marginV:120, align:2, BackColour:'&H80000000', BorderStyle:3, shadow:1 },
  color: { brightness:0.02, contrast:1.12, saturation:1.15 },
  bgm: { volume:0.55, fadeIn:1.5, fadeOut:3 },
  xfade: 0.5,
  adSlot: { time:999999, dur:15 }
};

// ===== 系列色调锁死（底层写死）=====
const SERIES_STYLE = {
  mengpo: { name:"孟婆黄泉", filter:"colorbalance=rs=0.1:gs=-0.05:bs=-0.1,eq=brightness=-0.03:contrast=1.12:saturation=0.75", prompt:", dark tone, red black gray, cinematic underworld, ethereal fog, melancholy" },
  urban:  { name:"都市逆袭", filter:"eq=brightness=0.03:contrast=1.15:saturation=1.15,unsharp=5:5:1.0:5:5:0", prompt:", high saturation, sharp, cold white, CEO luxury, cinematic 8k" },
  wuxia:  { name:"古风武侠", filter:"eq=brightness=0.01:contrast=1.05:saturation=0.95,curves=preset=lighter", prompt:", warm ancient Chinese, film grain, soft focus, wuxia aesthetic" },
  nature: { name:"自然风景", filter:"eq=brightness=0.02:contrast=1.08:saturation=1.1", prompt:", clear HD, natural colors, HDR dynamic lighting" },
  palace: { name:"宫廷权谋", filter:"eq=brightness=0.02:contrast=1.1:saturation=0.85,unsharp=3:3:0.5:3:3:0", prompt:", golden palace, rich silk, dramatic shadows, imperial court, cinematic 8k" },
  romantic: { name:"温馨情感", filter:"eq=brightness=0.05:contrast=0.95:saturation=1.05,unsharp=2:2:0.3:2:2:0", prompt:", soft warm lighting, gentle bokeh, intimate, romantic, cinematic 8k" },
  scifi: { name:"科幻未来", filter:"eq=brightness=-0.02:contrast=1.2:saturation=1.3,unsharp=4:4:0.8:4:4:0", prompt:", neon lights, futuristic, cold blue, cyberpunk, holographic, cinematic 8k" },
  workplace: { name:"职场商业", filter:"eq=brightness=0.03:contrast=1.1:saturation=1.0,unsharp=3:3:0.5:3:3:0", prompt:", modern office, glass building, professional, business suit, sharp cinematic 8k" }
};
function getSeriesStyle(genre) {
  var g = (genre||"").toLowerCase();
  if (g.includes("孟婆")||g.includes("黄泉")||g.includes("地府")||g.includes("mengpo")) return SERIES_STYLE.mengpo;
  if (g.includes("都市")||g.includes("逆袭")||g.includes("霸总")||g.includes("urban")) return SERIES_STYLE.urban;
  if (g.includes("古风")||g.includes("武侠")||g.includes("仙侠")||g.includes("wuxia")) return SERIES_STYLE.wuxia;
  if (g.includes("自然")||g.includes("风景")||g.includes("nature")) return SERIES_STYLE.nature;
  if (g.includes("权谋")||g.includes("宫廷")||g.includes("朝堂")) return SERIES_STYLE.palace;
  if (g.includes("情感")||g.includes("婚姻")||g.includes("生活")||g.includes("romantic")) return SERIES_STYLE.romantic;
  if (g.includes("科幻")||g.includes("未来")||g.includes("机甲")||g.includes("scifi")) return SERIES_STYLE.scifi;
  if (g.includes("职场")||g.includes("创业")||g.includes("商业")) return SERIES_STYLE.workplace;
  return null;
}

// ================================================================
//  动作库（强制调用，不准AI瞎编）
// ================================================================
const ACTIONS = {
  '站立说话':'standing, talking, mouth moving, natural posture',
  '缓慢走路':'walking slowly, steady steps, calm pace',
  '快步走':'walking fast, urgent pace, forward movement',
  '快步奔跑':'running fast, dynamic movement, rushing',
  '转身':'turning body around, rotation',
  '起身':'standing up from sitting, rising motion',
  '坐下':'sitting down, lowering body',
  '坐下站起':'transitioning from sitting to standing',
  '挥手':'waving hand, casual gesture',
  '抬手指向':'raising arm, pointing finger forward',
  '低头沉思':'head bowed down, deep in thought, contemplative',
  '抬头仰望':'looking up, face tilted upward',
  '低头看手机':'head tilted down, eyes on phone screen',
  '猛地抬头':'head snapping up suddenly, startled reaction',
  '转身离开':'turning around, walking away',
  '打斗挥拳':'punching, fighting stance, dynamic combat movement',
  '拱手行礼':'clasping hands in greeting, traditional bow',
  '难过低头':'head down, slumped shoulders, sad posture',
  '开心大笑':'laughing happily, wide bright smile',
  '愤怒皱眉':'angry frown, furrowed brows, intense expression',
  '攥紧拳头':'clenching fists tight, tense hands, knuckles white',
  '攥紧手机':'tightly gripping phone, white knuckles',
  '抓门把手':'hand grabbing door handle, reaching for door',
  '手插兜':'both hands in pockets, casual stance',
  '抬手停顿':'raising hand, pausing mid-air, frozen gesture',
  '递东西':'reaching out hand, offering something',
  '上前一步伸手':'stepping forward, reaching out hand',
  '后退一步摇头':'stepping back, shaking head',
  '垂手低头站立':'standing still, arms hanging down, head bowed',
  '静立':'standing still, motionless, waiting',
  '开门快步走出':'opening door, stepping out quickly',
  '微微转头':'slightly turning head, subtle movement'
};

const EXPR_MAP = {
  '紧绷':'tense, strained expression','压抑':'suppressed, holding back emotion',
  '难以置信':'disbelief, shocked, incredulous','疑惑':'confused, puzzled',
  '焦急':'anxious, worried, urgent','冷漠':'cold, indifferent, detached',
  '坚定':'determined, resolute, firm','落寞':'lonely, desolate, melancholic',
  '隐忍':'restrained, jaw clenched, enduring','温柔':'gentle, tender, soft',
  '愤怒':'angry, furious, furrowed brows','开心':'happy, joyful, bright smile',
  '悲伤':'sad, sorrowful, teary','平静':'calm, serene, peaceful',
  '泛红':'eyes reddened, emotional, tears forming','冷淡':'cold detached gaze',
  '决绝':'determined resolute eyes, unwavering'
};

const CAM_MAP = {
  '特写':'extreme close-up','近景':'close-up shot','中景':'medium shot',
  '远景':'wide shot','侧景':'side profile shot','全景':'full body shot'
};

// ================================================================
//  内置测试剧本：出租屋分手（12镜头）
// ================================================================
const TEST_SCRIPT = {
  title: '出租屋分手', genre: '都市情感', episode: 1,
  characters: { male_lead: {...CHAR_LOCK.male_lead}, female_lead: {...CHAR_LOCK.female_lead} },
  scenes: { living_room: {...SCENE_LOCK.living_room}, outdoor_evening: {...SCENE_LOCK.outdoor_evening} },
  shots: [
    {id:1,action:'男主坐在客厅沙发，低头攥紧手机，指节发白',camera:'中景',expression:'紧绷、压抑',scene:'living_room',chars:['male_lead'],dialogue:'',duration:3},
    {id:2,action:'手机屏幕特写，显示一条分手消息',camera:'特写',expression:'',scene:'living_room',chars:[],dialogue:'',duration:3},
    {id:3,action:'男主猛地抬头，眉头紧锁，眼神泛红',camera:'近景',expression:'难以置信',scene:'living_room',chars:['male_lead'],dialogue:'为什么？',duration:3},
    {id:4,action:'男主起身，脚步急促走向门口，手抓门把手',camera:'中景',expression:'焦急',scene:'living_room',chars:['male_lead'],dialogue:'',duration:3},
    {id:5,action:'男主拉开房门，快步走出',camera:'远景',expression:'',scene:'living_room',chars:['male_lead'],dialogue:'',duration:3},
    {id:6,action:'男主快步走在小区楼下，双手插兜，低头快步',camera:'中景',expression:'焦急',scene:'outdoor_evening',chars:['male_lead'],dialogue:'',duration:3},
    {id:7,action:'女主站在路灯下，背对男主，长发被风吹动',camera:'中景',expression:'',scene:'outdoor_evening',chars:['female_lead'],dialogue:'',duration:3},
    {id:8,action:'男主走到女主身后半步，停下脚步',camera:'侧景',expression:'隐忍',scene:'outdoor_evening',chars:['male_lead'],dialogue:'你说清楚',duration:3},
    {id:9,action:'女主缓缓转身，眼神冷淡，避开男主目光',camera:'近景',expression:'冷漠',scene:'outdoor_evening',chars:['female_lead'],dialogue:'不合适',duration:3},
    {id:10,action:'男主上前一步，伸手想碰女主肩膀，手停在半空',camera:'中景',expression:'悲伤',scene:'outdoor_evening',chars:['male_lead'],dialogue:'我哪里不好？',duration:3},
    {id:11,action:'女主后退一步，摇头',camera:'近景',expression:'坚定',scene:'outdoor_evening',chars:['female_lead'],dialogue:'别再找我了',duration:3},
    {id:12,action:'女主转身快步离开，男主站在原地看着背影',camera:'远景',expression:'落寞',scene:'outdoor_evening',chars:['male_lead','female_lead'],dialogue:'',duration:3}
  ]
};

// ================================================================
//  AI 大脑（统一：DeepSeek直连→ARK DeepSeek→ARK Doubao）
// ================================================================
function dsChat(messages, opts) {
  opts = opts || {};
  return unifiedBrain.chat({
    messages: messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.85,
    maxTokens: opts.max_tokens || 8000
  });
}

function extractJSON(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(m) try{return JSON.parse(m[1].trim());}catch(e){}
  try{return JSON.parse(text);}catch(e){}
  const j = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if(j) try{return JSON.parse(j[1]);}catch(e){}
  throw new Error('No JSON in response');
}

// ================================================================
//  FFmpeg
// ================================================================
function runFF(args, timeout) {
  timeout = timeout || 300000;
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, {timeout, maxBuffer:50*1024*1024, windowsHide:true},
      (err, stdout, stderr) => {
        if(err) {
          // Sanitize stderr - remove x264 stats that clutter errors
          const cleanErr = (stderr||'').split('\n').filter(l =>
            !l.match(/^(\[|ref |kb[s:])/)
          ).join('\n').slice(-200);
          reject(new Error('FF: ' + cleanErr));
        }
        else resolve(stdout);
      });
  });
}

function probeDur(filePath) {
  return new Promise(resolve => {
    execFile(FFPROBE_BIN, ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',filePath],
      {windowsHide:true},(err,out)=>resolve(err?5:(parseFloat(out.trim())||5)));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ================================================================
//  TTS (字节 SeedTTS)
// ================================================================
async function genTTS(text, voiceId, emotion, outputPath) {
  try {
    const emoMap = {'严肃':'serious','温柔':'gentle','悲伤':'sad','开心':'happy','愤怒':'angry','平静':'gentle','隐忍':'serious','冷漠':'gentle','焦急':'serious'};
    const result = await ttsEngine.synthesize(text.substring(0,500), {
      voice: voiceId || 'zh_female_meilinvyou_uranus_bigtts',
      emotion: emoMap[emotion] || 'gentle'
    });
    if(result && result.filePath && fs.existsSync(result.filePath)) {
      if(result.filePath !== outputPath) fs.copyFileSync(result.filePath, outputPath);
      return true;
    }
  } catch(e) { console.log('[TTS] Engine fail:', e.message); }
  // Fallback
  try {
    const crypto = require('crypto');
    const uuid = crypto.randomUUID ? crypto.randomUUID() : 'drama-'+Date.now();
    const payload = JSON.stringify({user:{uid:'tiandao_drama'},req_params:{
      text:text.replace(/\n/g,' '),speaker:voiceId||'zh_female_vv_uranus_bigtts',
      audio_params:{format:'mp3',sample_rate:24000,speech_rate:-5,loudness_rate:0,emotion:emotion||'gentle'}
    }});
    const req = https.request({
      hostname:'openspeech.bytedance.com',path:'/api/v3/tts/unidirectional',method:'POST',
      headers:{'Content-Type':'application/json','X-Api-Key':TTS_KEY,'X-Api-Resource-Id':TTS_RES,'X-Api-Request-Id':uuid}
    },res=>{
      let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{
        const re=/\{[^{}]*\}/g;let bufs=[];let m2;
        while((m2=re.exec(raw))!==null){try{const o=JSON.parse(m2[0]);if(o.code===0&&o.data)bufs.push(Buffer.from(o.data,'base64'));}catch(e){}}
        if(bufs.length>0){fs.writeFileSync(outputPath,Buffer.concat(bufs));console.log('[TTS] HTTP OK');}
      });
    });
    req.on('error',e=>console.log('[TTS] HTTP err:',e.message));
    req.setTimeout(30000,()=>req.destroy());
    req.write(payload);req.end();
    await sleep(3000);
    return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>1000;
  } catch(e) { return false; }
}

// ================================================================
//  Prompt构建（6锁强制）
// ================================================================
function buildScenePrompt(sceneId) {
  const sc = SCENE_LOCK[sceneId];
  if(!sc) return KW.posBase;
  return sc.pos+', '+KW.posBase;
}

function buildShotPrompt(shot, script, prevShot) {
  let p = '';
  let chars = [];
  let charLocks = [];

  // 角色 — 完整锁死外观
  if(shot.chars && shot.chars.length > 0) {
    for(const cid of shot.chars) {
      const ch = (script.characters&&script.characters[cid]) || CHAR_LOCK[cid];
      if(ch) {
        chars.push(ch.en);
        charLocks.push(ch.pos || ch.en);
      }
    }
  }
  // 如果没匹配到角色但剧本有主角描述，强制加入
  if(chars.length === 0 && script.protagonist) {
    chars.push(script.protagonist);
  }

  // ★ 方向控制 — 基于前后镜头推断合理朝向
  let dirHint = '';
  if(shot.dialogue && !shot.action) {
    // 有对话无动作 → 面向镜头（说话场景）
    dirHint = 'medium close-up shot, facing camera, looking at viewer, shoulder and upper body visible, ';
  } else if(shot.action) {
    const act = shot.action || '';
    if(act.includes('离开') || act.includes('走远') || act.includes('背影') || act.includes('背对') || act.includes('转身离开') || act.includes('转身走')) {
      dirHint = 'facing away from camera, back view, walking away, ';
    } else if(act.includes('走向') || act.includes('冲向') || act.includes('奔跑')) {
      dirHint = 'facing toward camera, moving forward, dynamic stride, ';
    } else if(act.includes('回头') || act.includes('转身') || act.includes('望向')) {
      dirHint = 'profile view, looking back over shoulder, three-quarter angle, ';
    } else if(act.includes('坐') || act.includes('躺') || act.includes('沉思')) {
      dirHint = 'slightly angled toward camera, contemplative pose, ';
    } else {
      dirHint = 'facing camera, natural posture, ';
    }
  } else {
    dirHint = 'facing camera, ';
  }

  // ★ 场景切换检测 — 如果场景变了，加过渡暗示
  let sceneTrans = '';
  if(prevShot && shot.scene !== prevShot.scene) {
    const newSc = (script.scenes&&script.scenes[shot.scene]) || SCENE_LOCK[shot.scene];
    if(newSc) {
      // 新场景的第一帧应该是全景/中景建立镜头
      sceneTrans = 'establishing shot, ' + newSc.en + ', ';
      p += sceneTrans;
    }
  }

  // 构建 prompt: 场景 → 角色外观(完整pos) → 动作 → 表情 → 方向 → 对话 → 风格
  // 1) 场景
  if(!sceneTrans) {
    const sc = (script.scenes&&script.scenes[shot.scene]) || SCENE_LOCK[shot.scene];
    if(sc) p += sc.en + ', ';
  }

  // 2) 角色 — 使用完整的 pos 描述（含外观锁死）
  if(charLocks.length > 0) {
    p += charLocks.join(' and ') + ', ';
  } else if(chars.length > 0) {
    p += chars.join(', ') + ', ';
  }

  // 3) ★ 强制服装一致性 — 从 CHAR_LOCK 提取服装关键词
  if(shot.chars && shot.chars.length > 0) {
    const clothParts = [];
    for(const cid of shot.chars) {
      const ch = CHAR_LOCK[cid] || (script.characters&&script.characters[cid]);
      if(ch && ch.zh) {
        // 提取服装描述
        const clothMatch = ch.zh.match(/[一-龥]*(?:T恤|衬衫|西装|连衣裙|外套|裙|裤|鞋|夹克|卫衣|马甲|风衣)[一-龥]*/g);
        if(clothMatch) clothParts.push(clothMatch.join(', '));
        // 也提取发色/发型
        const hairMatch = ch.zh.match(/[一-龥]*(?:长发|短发|直发|卷发|马尾|黑发|棕发|金发)[一-龥]*/g);
        if(hairMatch) clothParts.push(hairMatch.join(', '));
      }
    }
    if(clothParts.length > 0) {
      // 翻译常见服装词
      const cn2en = {
        '白T恤':'white t-shirt','白T':'white t-shirt','白色T恤':'white t-shirt',
        '黑外套':'black jacket','黑色外套':'black jacket','黑色夹克':'black jacket',
        '黑色短发':'black short hair','短发':'short hair','黑发':'black hair',
        '白色连衣裙':'white dress','白裙':'white dress',
        '长直发':'long straight black hair','黑色长直发':'long straight black hair',
        '棕色短发':'brown short hair','棕发':'brown hair',
        '西装':'tailored suit','西装革履':'formal suit','高跟鞋':'high heels',
        '连衣裙':'dress','衬衫':'button-up shirt','卫衣':'hoodie'
      };
      const enCloth = clothParts.map(cp => cn2en[cp] || cp);
      p += enCloth.join(', ') + ', exact same clothing, ';
    }
  }

  // 4) 动作
  let actionEn = '';
  if(shot.action) {
    for(const [zh,en] of Object.entries(ACTIONS)) {
      const clean = zh.replace(/[、，。]/g,'');
      if(shot.action.includes(clean)) { actionEn = en; break; }
    }
    if(!actionEn) actionEn = shot.action;
    // Prevent Chinese text leaking into English prompt
    if(actionEn && /[\u4e00-\u9fa5]/.test(actionEn)) actionEn = 'action scene, dynamic pose';
    p += actionEn + ', ';
  }

  // 5) 表情
  if(shot.expression) {
    const exprParts = shot.expression.split(/[、，]/).filter(Boolean);
    const exprEn = exprParts.map(e => EXPR_MAP[e.trim()] || e.trim()).join(', ');
    if(exprEn) p += exprEn + ', ';
  }

  // 6) ★ 方向约束（放在动作后面强化）
  p += dirHint;

  // 7) 对话暗示
  if(shot.dialogue) p += 'lips moving, speaking, mouth slightly open, natural expression, ';

  // 8) 风格
  const styleKw = KW.styleMap[script.genre] || '';
  if(styleKw) p += styleKw + ', ';

  // 9) 锁死基础词
  p += KW.posBase;

  // ★ 帧锚定指令：[Fxx:动作] 锁定关键帧动作节奏
  if(shot.action && shot.duration) {
    var midFrame = Math.round(shot.duration * 12); // 24fps中点帧
    p += ' [F' + midFrame + ':' + shot.action + ']';
  }
  return p;
}

// ================================================================
//  SadTalker 嘴型同步
// ================================================================
let SAD_OK = false;
function checkSadTalker() {
  try {
    SAD_OK = fs.existsSync(path.join(SADTALKER_DIR,'inference.py')) && fs.existsSync(SADTALKER_PY);
    console.log('[LipSync] '+(SAD_OK?'ENABLED':'DISABLED'));
  } catch(e) { SAD_OK = false; }
}

function runSadTalker(faceImg, audioFile, outDir, poseStyle) {
  return new Promise(resolve => {
    if(!SAD_OK) { resolve(null); return; }
    if(!fs.existsSync(faceImg)||!fs.existsSync(audioFile)) { resolve(null); return; }
    if(!fs.existsSync(outDir)) fs.mkdirSync(outDir,{recursive:true});
    execFile(SADTALKER_PY, [
      'inference.py','--driven_audio',audioFile,'--source_image',faceImg,
      '--enhancer','none','--result_dir',outDir,'--preprocess','crop',
      '--expression_scale','1.0','--pose_style',String(poseStyle||1),'--size','512'
    ],{cwd:SADTALKER_DIR,timeout:180000,windowsHide:true},(err,stdout,stderr)=>{
      if(err){console.log('[LipSync] Err:',(stderr||'').slice(-200));resolve(null);return;}
      try{
        const files=fs.readdirSync(outDir);
        const mp4=files.find(f=>f.endsWith('.mp4')&&!f.startsWith('temp_'));
        if(mp4){const fp=path.join(outDir,mp4);if(fs.statSync(fp).size>5000){resolve(fp);return;}}
      }catch(e){}
      resolve(null);
    });
  });
}

// ================================================================
//  Zoompan (静态图+慢动作快速模式)
// ================================================================
async function renderZoompan(imgPath, audioPath, duration, outputPath, emotionHint) {
  const dur = Math.max(duration||5, 3);
  const COLOR_UNIFY = 'colorbalance=rs=0.03:gs=0.01:bs=-0.02,eq=contrast=1.05:brightness=-0.02:saturation=1.1';
  const frames = Math.ceil(dur * VID.fps);
  const f = frames; // shorthand

  // ===== Ken Burns 12种运镜（正弦曲线呼吸感，非线性） =====
  const kbVariants = [
    // 1. 慢推+微摇（平静/叙事）
    () => "zoompan=z='1.0+0.12*sin(on/"+f+"*3.14159/2)':x='iw/2-(iw/zoom/2)+sin(on*0.06)*0.008*iw':y='ih/2-(ih/zoom/2)+cos(on*0.05)*0.005*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 2. 慢推焦点偏上（对话/人物）
    () => "zoompan=z='1.0+0.10*sin(on/"+f+"*3.14159/2)':x='iw/2-(iw/zoom/2)':y='ih/3-(ih/zoom/3)+cos(on*0.04)*0.003*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 3. 缓慢左摇（叙事/行走）
    () => "zoompan=z='1.04+0.03*sin(on/"+f+"*3.14159)':x='(iw-iw/1.04)*(0.5-0.5*cos(on/"+f+"*3.14159))':y='ih/2-(ih/zoom/2)+sin(on*0.03)*0.003*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 4. 缓慢右摇（叙事/行走）
    () => "zoompan=z='1.04+0.03*sin(on/"+f+"*3.14159)':x='(iw-iw/1.04)*(0.5+0.5*cos(on/"+f+"*3.14159))':y='ih/2-(ih/zoom/2)+cos(on*0.03)*0.003*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 5. 推进到特写（紧张/情感）
    () => "zoompan=z='1.0+0.18*sin(on/"+f+"*3.14159/2)*sin(on/"+f+"*3.14159/2)':x='iw/2-(iw/zoom/2)+sin(on*0.08)*0.004*iw':y='ih/3-(ih/zoom/3)':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 6. 缓慢拉远（悲伤/离别）
    () => "zoompan=z='1.18-0.14*sin(on/"+f+"*3.14159/2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+sin(on*0.03)*0.005*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 7. 缓慢下摇（环境/场景建立）
    () => "zoompan=z='1.05+0.04*sin(on/"+f+"*3.14159)':x='iw/2-(iw/zoom/2)':y='(ih-ih/1.05)*(0.5-0.5*cos(on/"+f+"*3.14159))':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 8. 上摇（仰望/天台/回忆）
    () => "zoompan=z='1.05+0.04*sin(on/"+f+"*3.14159)':x='iw/2-(iw/zoom/2)':y='(ih-ih/1.05)*(0.5+0.5*cos(on/"+f+"*3.14159))':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 9. 对角线运镜（动态叙事）
    () => "zoompan=z='1.0+0.10*sin(on/"+f+"*3.14159/2)':x='(iw-iw/1.1)*(0.5-0.5*cos(on/"+f+"*3.14159))':y='ih/3+(ih*0.4)*(0.5-0.5*cos(on/"+f+"*3.14159))':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 10. 呼吸式微缩放（安静/回忆/独白）
    () => "zoompan=z='1.05+0.03*sin(on/"+f+"*6.28318)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 11. 快推+微抖（紧张/愤怒/冲突）
    () => "zoompan=z='1.0+0.15*sin(on/"+f+"*3.14159/2)':x='iw/2-(iw/zoom/2)+sin(on*0.15)*0.006*iw':y='ih/2-(ih/zoom/2)+cos(on*0.12)*0.004*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p",
    // 12. 固定微动（对话/稳定场景）
    () => "zoompan=z='1.03+0.02*sin(on/"+f+"*6.28318)':x='iw/2-(iw/zoom/2)+sin(on*0.08)*0.003*iw':y='ih/2-(ih/zoom/2)+cos(on*0.06)*0.002*ih':d="+f+":s="+VID.w+"x"+VID.h+":fps="+VID.fps+",format=yuv420p"
  ];

  // ===== 情绪匹配运镜 =====
  let kbIdx;
  const emo = (emotionHint || '').toLowerCase();
  if (emo.includes('紧') || emo.includes('愤怒') || emo.includes('焦急')) {
    kbIdx = 10; // 快推+微抖
  } else if (emo.includes('悲伤') || emo.includes('落寞') || emo.includes('离别') || emo.includes('隐忍')) {
    kbIdx = 5; // 缓慢拉远
  } else if (emo.includes('开心') || emo.includes('温柔') || emo.includes('平静')) {
    kbIdx = 9; // 呼吸式微缩放
  } else if (emo.includes('坚定') || emo.includes('冷漠') || emo.includes('决绝')) {
    kbIdx = 4; // 推进到特写
  } else if (emo.includes('难以置信') || emo.includes('震惊')) {
    kbIdx = 10; // 快推
  } else {
    kbIdx = Math.floor(Math.random() * 6); // 叙事类随机1-6
  }

  const zoom = kbVariants[kbIdx]();
  const colorFilt = "eq=brightness="+POST.color.brightness+":contrast="+POST.color.contrast+":saturation="+POST.color.saturation+",deband=1thr=0.02:2thr=0.04:blur=1,unsharp=3:3:0.5:3:3:0";
  const args = ['-y'];
  if(audioPath && fs.existsSync(audioPath)) {
    args.push('-loop','1','-i',imgPath,'-i',audioPath);
    args.push('-vf', zoom+','+colorFilt+','+COLOR_UNIFY);
    args.push('-af','afade=t=in:st=0:d=0.3,afade=t=out:st='+Math.max(0,dur-0.3)+':d=0.3');
    args.push('-c:v','libx264','-preset','slow','-crf','18','-r',String(VID.fps),'-keyint_min','30','-g','60','-bf','3','-x264-params','me=umh:subme=9:trellis=2:refs=4');
    args.push('-c:a','aac','-b:a',VID.audioBitrate,'-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-shortest','-movflags','+faststart');
  } else {
    args.push('-loop','1','-i',imgPath);
    args.push('-vf', zoom+','+colorFilt+','+COLOR_UNIFY);
    args.push('-c:v','libx264','-preset','slow','-crf','18','-r',String(VID.fps),'-keyint_min','30','-g','60','-bf','3','-x264-params','me=umh:subme=9:trellis=2:refs=4');
    args.push('-an','-t',String(dur),'-frames:v',String(frames),'-movflags','+faststart');
  }
  args.push(outputPath);
  await runFF(args, 300000);
  return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>1000;
}

// ================================================================
//  BGM
// ================================================================
async function genBGM(duration, outputPath, seriesStyle) {
  // BGM自动切换：根据系列选择不同风格
  const style = (seriesStyle && seriesStyle.bgmStyle) || 'default';
  const dur = Math.max(duration, 60);
  const chords=[[261.6,329.6,392.0],[220.0,261.6,311.1],[349.2,440.0,523.3],[196.0,246.9,293.7]];
  const chordDur=8, total=Math.ceil(dur/chordDur);
  let parts=[], ic=0;
  const args=['-y'];
  for(let i=0;i<total;i++){
    const c=chords[i%chords.length];
    args.push('-f','lavfi','-i','sine=frequency='+c[0]+':duration='+chordDur);
    args.push('-f','lavfi','-i','sine=frequency='+(c[0]*1.002)+':duration='+chordDur);
    args.push('-f','lavfi','-i','sine=frequency='+c[1]+':duration='+chordDur);
    args.push('-f','lavfi','-i','sine=frequency='+(c[2]*0.998)+':duration='+chordDur);
    ic+=4;
    for(let j=0;j<4;j++) parts.push('['+(ic-4+j)+':a]volume=0.12,lowpass=f=800[a'+(ic-4+j)+']');
    if(i===0) parts.push('[a0][a1][a2][a3]amix=inputs=4:duration=longest:dropout_transition=1[mix0]');
    else parts.push('[mix'+(i-1)+'][a'+(ic-4)+'][a'+(ic-3)+'][a'+(ic-2)+'][a'+(ic-1)+']amix=inputs=5:duration=longest:dropout_transition=1[mix'+i+']');
  }
  const last='mix'+Math.min(total-1,chords.length*3-1);
  parts.push('['+last+']afade=t=out:st='+Math.max(0,dur-3)+':d=3[out]');
  args.push('-filter_complex',parts.join(';'));
  args.push('-map','[out]','-t',String(dur),'-c:a','libmp3lame','-b:a','128k',outputPath);
  try{await runFF(args,60000);return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>1000;}
  catch(e){
    await runFF(['-y','-f','lavfi','-i','anoisesrc=d='+dur+':c=pink:r=44100:a=0.02',
      '-af','lowpass=f=600,highpass=f=150,volume=0.06,afade=t=out:st='+Math.max(0,dur-2)+':d=2',
      '-t',String(dur),'-c:a','libmp3lame','-b:a','128k',outputPath],30000);
    return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>100;
  }
}

// ================================================================
//  后期合成
// ================================================================
async function concatSegs(files, outputPath) {
  // ASCII临时目录避免FFmpeg中文路径报错
  const path2 = require('path');
  const safeDir = path2.join(ASCII_TMP, 'seg_' + Date.now());
  if (!fs.existsSync(safeDir)) fs.mkdirSync(safeDir, { recursive: true });
  const safeFiles = [];
  for (let i = 0; i < files.length; i++) {
    if (fs.existsSync(files[i])) {
      const dst = path2.join(safeDir, String(i).padStart(4,'0') + '.mp4');
      fs.copyFileSync(files[i], dst);
      safeFiles.push(dst);
    }
  }
  if (safeFiles.length === 0) { console.log('[concat] No segments'); return false; }
  const list = path2.join(safeDir, 'c.txt');
  fs.writeFileSync(list, safeFiles.map(f => "file '" + f.replace(/\\/g, '/') + "'").join('\n'));
  const outDir = path2.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const safeOut = path2.join(safeDir, 'out.mp4');
    // M13: Normalize audio tracks - add silent audio to segments without audio
  for (let i = 0; i < safeFiles.length; i++) {
    const hasAudio = await new Promise(resolve => {
      const { execFile } = require('child_process');
      execFile(FFPROBE_BIN, ['-v','error','-select_streams','a','-show_entries','stream=codec_type','-of','csv=p=0',safeFiles[i]],
        {windowsHide:true},(err,out)=>resolve(!err&&out.trim().length>0));
    });
    if (!hasAudio) {
      const normalized = safeFiles[i] + '.norm.mp4';
      await runFF(['-y','-i',safeFiles[i],'-f','lavfi','-i','anullsrc=r=44100:cl=stereo',
        '-c:v','copy','-c:a','aac','-b:a','128k','-af','volume=1.5','-shortest','-movflags','+faststart',normalized],60000);
      if (fs.existsSync(normalized) && fs.statSync(normalized).size > 1000) {
        try { fs.unlinkSync(safeFiles[i]); } catch(e) {}
        fs.renameSync(normalized, safeFiles[i]);
      }
    }
  }
  console.log('[concat] Audio normalized for '+safeFiles.length+' segments');

  // xfade transition between shots (video only — audio mixed separately)
    // Audio normalization already done above (all segments have audio track)
    if (safeFiles.length >= 2) {
      const xfadeDur = 0.5;
      const segDurs = [];
      for (let si = 0; si < safeFiles.length; si++) {
        try {
          const d = await new Promise((resolve) => {
            const { execFile } = require('child_process');
            execFile(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', safeFiles[si]],
              { windowsHide: true }, (err, out) => resolve(err ? 4 : (parseFloat(out.trim()) || 4)));
          });
          segDurs.push(d);
        } catch(e) { segDurs.push(4); }
      }

      // Step 1: Concat video with xfade transitions
      const TRANS_POOL = ['fade','fadeblack','dissolve','smoothleft','smoothright','fadewhite','slideleft','slideright']; function pickT(i){return TRANS_POOL[((i*7+3)^(i*13))%TRANS_POOL.length];}
      let vParts = [];
      let offset = 0;
      for (let si = 0; si < safeFiles.length - 1; si++) {
        const lbl = si === safeFiles.length - 2 ? 'vout' : 'vt' + (si + 1);
        offset += segDurs[si] - xfadeDur;
        vParts.push('[' + si + ':v][' + (si + 1) + ':v]xfade=transition=' + pickT(si) + ':duration=' + xfadeDur + ':offset=' + offset.toFixed(2) + '[' + lbl + ']');
      }
      const vFilter = vParts.join(';');

      // Step 2: Concat audio (simple, reliable)
      let aInputs = '';
      for (let ai = 0; ai < safeFiles.length; ai++) {
        aInputs += '[' + ai + ':a]';
      }
      const aFilter = aInputs + 'concat=n=' + safeFiles.length + ':v=0:a=1[aout]';

      // Step 3: Combine
      let xfadeArgs = ['-y'];
      for (let xi = 0; xi < safeFiles.length; xi++) xfadeArgs.push('-i', safeFiles[xi]);
      xfadeArgs.push('-filter_complex', vFilter + ';' + aFilter);
      xfadeArgs.push('-map', '[vout]', '-map', '[aout]');
      xfadeArgs.push('-c:v', 'libx264', '-preset', VID.preset, '-crf', String(VID.crf));
      xfadeArgs.push('-c:a', 'aac', '-b:a', VID.audioBitrate, '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', safeOut);
      try {
        await runFF(xfadeArgs, 600000);
      } catch(xfadeErr) {
        console.log('[xfade] Failed, fallback to simple concat:', xfadeErr.message.substring(0, 100));
        // Fallback: simple concat without transitions
        await runFF(['-y', '-f', 'concat', '-safe', '0', '-i', list,
          '-c:v', 'libx264', '-preset', VID.preset, '-crf', String(VID.crf),
          '-c:a', 'aac', '-b:a', VID.audioBitrate, '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', safeOut], 600000);
      }
    } else {
      // Single segment, just copy
      await runFF(['-y', '-i', safeFiles[0], '-c', 'copy', safeOut], 60000);
    }
      if(fs.existsSync(safeOut)&&fs.statSync(safeOut).size>100*1024*1024){console.log('[size] '+(fs.statSync(safeOut).size/1024/1024).toFixed(0)+'MB>100MB, re-encoding...');const bp=safeOut+'.big.mp4';fs.renameSync(safeOut,bp);await runFF(['-y','-i',bp,'-c:v','libx264','-preset','medium','-crf','26','-c:a','aac','-b:a','96k','-pix_fmt','yuv420p','-movflags','+faststart',safeOut],600000);try{fs.unlinkSync(bp);}catch(e){}console.log('[size] Now '+(fs.existsSync(safeOut)?(fs.statSync(safeOut).size/1024/1024).toFixed(0)+'MB':'FAIL'));}
    if (fs.existsSync(safeOut) && fs.statSync(safeOut).size > 1000) {
    fs.copyFileSync(safeOut, outputPath);
    console.log('[concat] OK: ' + safeFiles.length + ' segs');
  }
  try { fs.rmSync(safeDir, { recursive: true, force: true }); } catch(e) {}
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
}

async function addBGM(videoPath, bgmPath, outputPath) {
  const dur = await probeDur(videoPath);
  const hasAudio = await new Promise(resolve=>{
    execFile(FFPROBE_BIN,['-v','error','-select_streams','a','-show_entries','stream=codec_type','-of','csv=p=0',videoPath],
      {windowsHide:true},(err,out)=>resolve(!err&&out.trim().length>0));
  });
  const bgmFilt = '[1:a]volume='+POST.bgm.volume+',afade=t=out:st='+Math.max(0,dur-POST.bgm.fadeOut)+':d='+POST.bgm.fadeOut+'[bgm]';
  if(!hasAudio) {
    const tmp=outputPath+'.silent.mp4';
    await runFF(['-y','-i',videoPath,'-f','lavfi','-i','anullsrc=r=44100:cl=stereo',
      '-t',String(dur),'-c:v','copy','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',tmp],300000);
    if(fs.existsSync(tmp)&&fs.statSync(tmp).size>1000){
      await runFF(['-y','-i',tmp,'-i',bgmPath,
        '-filter_complex',bgmFilt+';[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]',
        '-map','0:v','-map','[aout]','-c:v','copy','-c:a','aac','-b:a',VID.audioBitrate,'-shortest','-movflags','+faststart',outputPath],300000);
      try{fs.unlinkSync(tmp);}catch(e){}
      return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>1000;
    }
  }
  await runFF(['-y','-i',videoPath,'-i',bgmPath,
    '-filter_complex',bgmFilt+';[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]',
    '-map','0:v','-map','[aout]','-c:v','copy','-c:a','aac','-b:a',VID.audioBitrate,'-shortest','-movflags','+faststart',outputPath],300000);
  return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>1000;
}

async function burnSubs(videoPath, srtContent, outputPath) {
  const workDir = path.dirname(outputPath);
  const srtFile = path.join(workDir, 'subs_'+Date.now()+'.srt');
  fs.writeFileSync(srtFile,'\uFEFF'+srtContent,'utf-8');
  // Build force_style string - use temp ASS file to avoid path escaping issues
  const assFile = path.join(workDir, 'style_'+Date.now()+'.ass');
  const assHeader = '[Script Info]\nTitle: Tiandao Subs\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,'+( POST.sub.font||'Arial')+','+POST.sub.size+','+POST.sub.primary+',&H000000FF,'+POST.sub.outline+',&H00000000,0,0,0,0,100,100,0,0,1,'+POST.sub.outlineW+',0,'+POST.sub.align+',0,0,'+POST.sub.marginV+',1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const lines = srtContent.split('\n');
  let events = '';
  for(let i=0; i<lines.length; i+=4) {
    if(lines[i].match(/^\d+$/) && lines[i+1] && lines[i+2]) {
      const timeMatch = lines[i+1].match(/(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/);
      if(timeMatch) {
        const text = (lines[i+2]||'').replace(/\n/g,'\\N');
        events += 'Dialogue: 0,'+timeMatch[1]+'.'+timeMatch[2]+','+timeMatch[3]+'.'+timeMatch[4]+',Default,,0,0,0,,'+text+'\n';
      }
    }
  }
  fs.writeFileSync(assFile, assHeader + events, 'utf-8');
  const safeAssPath = assFile.replace(/\\/g,'/').replace(/:/g,'\\\\:');
  await runFF(['-y','-i',videoPath,'-vf','subtitles='+safeAssPath,'-c:v','libx264','-preset',VID.preset,'-crf',String(VID.crf),'-c:a','copy','-pix_fmt','yuv420p','-movflags','+faststart',outputPath],300000);
  try{fs.unlinkSync(srtFile);}catch(e){}
  try{fs.unlinkSync(assFile);}catch(e){}
  return fs.existsSync(outputPath)&&fs.statSync(outputPath).size>1000;
}



function buildSRT(items) {
  let srt='', t=0;
  items.forEach((item,i)=>{
    const start=t, end=t+item.duration;
    srt+=String(i+1)+'\n'+fmtTime(start)+' --> '+fmtTime(end)+'\n'+item.text+'\n\n';
    t=end;
  });
  return srt;
}

function fmtTime(sec) {
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=Math.floor(sec%60),ms=Math.floor((sec%1)*1000);
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+','+String(ms).padStart(3,'0');
}

// ================================================================
//  剧本生成（DeepSeek 标准化镜头格式）
// ================================================================
/**
 * 规范化场景：将AI生成的场景描述映射到SCENE_LOCK预定义场景
 * 保持AI的场景名和中文描述，但替换en/pos/neg为高质量模板
 */
function normalizeScenes(script) {
  if (!script.scenes) return script;
  
  // 场景关键词映射表：AI的场景描述 → SCENE_LOCK key
  const sceneMap = [
    [/客厅|客厅沙发|客厅里|出租屋|家里|家中|公寓|房间|卧室|室内/,'living_room'],
    [/办公室|写字楼|公司|工位|会议室/,'office'],
    [/咖啡|cafe|茶座|饮品店/,'cafe'],
    [/医院|病房|走廊.*医|急诊/,'hospital'],
    [/街道|路上|小区.*下|外面|户外|街头|马路/,'outdoor_evening'],
    [/公园|花园|草地|广场/,'park'],
    [/酒吧|夜店|ktv|KTV/,'bar'],
    [/餐厅|饭馆|饭店|食堂/,'restaurant'],
    [/商场|超市|购物中心/,'mall'],
    [/学校|教室|校园|图书馆/,'school'],
    [/天桥|桥上|过街天桥/,'bridge'],
    [/车库|停车场|地下车库/,'parking'],
    [/电梯|电梯间/,'elevator']
  ];
  
  const newScenes = {};
  const idMapping = {}; // old_id → new_id
  
  for (const [sid, sc] of Object.entries(script.scenes)) {
    const matchKey = Object.keys(SCENE_LOCK).find(lockKey => {
      const lockSc = SCENE_LOCK[lockKey];
      return lockSc.zh && (sc.zh || '').includes(lockSc.zh.substring(0, 4));
    });
    
    // 尝试关键词匹配
    let mapped = null;
    const desc = (sc.zh || sc.name || sc.en || '');
    for (const [regex, key] of sceneMap) {
      if (regex.test(desc)) { mapped = key; break; }
    }
    
    if (mapped && SCENE_LOCK[mapped]) {
      // 使用SCENE_LOCK的en/pos/neg，但保留AI的名字
      const locked = SCENE_LOCK[mapped];
      newScenes[mapped] = {
        name: sc.name || locked.name,
        zh: locked.zh,
        en: locked.en,
        pos: locked.pos,
        neg: locked.neg
      };
      idMapping[sid] = mapped;
    } else {
      // 没有匹配到预定义场景 → 用AI的描述但补全pos字段
      newScenes[sid] = {
        name: sc.name || sid,
        zh: sc.zh || desc,
        en: sc.en || desc,
        pos: (sc.en || desc) + ', cinematic 8k, vertical 9:16, photorealistic, detailed',
        neg: KW.neg
      };
      idMapping[sid] = sid;
    }
  }
  
  script.scenes = newScenes;
  
  // 更新所有镜头的scene引用
  if (script.shots) {
    script.shots.forEach(shot => {
      if (shot.scene && idMapping[shot.scene]) {
        shot.scene = idMapping[shot.scene];
      }
    });
  }
  
  return script;
}

async function generateScript(params) {
  const {title,protagonist,genre,style,episodes:epCount,totalShots:maxShots} = params;
  const totalEps = Math.min(Math.max(parseInt(epCount)||1,1),40);

  const sysPrompt = [
    '你是一位专业的短剧编导，必须严格按照标准化镜头格式输出JSON。',
    '',
    '## 核心规则（违反任何一条都算错误）',
    '1. 每个镜头只做一件事：一个动作 OR 一句台词，绝对不能混',
    '2. 动作描述必须具体（不写"很生气"，写"攥紧拳头，眉头紧皱"）',
    '3. 每句台词不超过15个字',
    '4. 每镜头3-5秒',
    '5. 同一场景的镜头集中在一起，减少场景切换',
    '6. 镜头景别只用：特写、近景、中景、远景、侧景、全景',
    '7. 表情只选：紧绷、压抑、难以置信、疑惑、焦急、冷漠、坚定、落寞、隐忍、温柔、愤怒、开心、悲伤、平静',
    '',
    '## 输出JSON格式（严格照抄，不要加减字段）',
    '{',
    '  "title": "剧名",',
    '  "genre": "题材",',
    '  "episode": 1,',
    '  "characters": {',
    '    "male_lead": {"name":"男主名","zh":"外貌描述","en":"English appearance"},',
    '    "female_lead": {"name":"女主名","zh":"外貌描述","en":"English appearance"}',
    '  },',
    '  "scenes": {',
    '    "scene_1": {"name":"场景名","zh":"场景描述","en":"English scene description"},',
    '    "scene_2": {"name":"场景名","zh":"场景描述","en":"English scene description"}',
    '  },',
    '  "shots": [',
    '    {"id":1,"action":"具体动作描述","camera":"中景","expression":"表情","scene":"scene_1","chars":["male_lead"],"dialogue":"","duration":3},',
    '    {"id":2,"action":"具体动作描述","camera":"近景","expression":"疑惑","scene":"scene_1","chars":["male_lead"],"dialogue":"不超过15个字","duration":4}',
    '  ]',
    '}',
    '',
    '只输出JSON，不要任何其他文字。'
  ].join('\n');

  const userPrompt = '创作一部'+totalEps+'集的'+(genre||'')+(style||'')+'短剧《'+title+'》。\n主角：'+protagonist+'\n要求：'+totalEps+'集，每集'+(maxShots?'最多'+maxShots+'个镜头':'20-30个镜头')+'，每集总时长90-180秒。\n如果只有1集，直接输出全部镜头，'+(maxShots?'【重要】总镜头数严格不超过'+maxShots+'个':'')+'。';

  const result = await dsChat([
    {role:'system',content:sysPrompt},
    {role:'user',content:userPrompt}
  ], {temperature:0.85,max_tokens:12000});

  const content = result.choices&&result.choices[0]&&result.choices[0].message&&result.choices[0].message.content || '';
  let script = extractJSON(content);

  if(!script.shots||!Array.isArray(script.shots)) throw new Error('剧本格式错误：缺少shots');
  script.shots.forEach(function(s,i){
    s.id = i+1;
    s.duration = Math.min(Math.max(s.duration||3,SHOT_LOCK.durMin),SHOT_LOCK.durMax);
  });
  // ★ 场景规范化：把AI生成的场景映射到SCENE_LOCK预定义场景
  script = normalizeScenes(script);
  return script;
}

// ================================================================
//  剧本逻辑审核
// ================================================================
/**
 * 生成续集剧本（承接上一集结尾）
 */
async function generateEpisodeScript(prevScript, epNum, task) {
  const prevShots = prevScript.shots || [];
  const lastShot = prevShots[prevShots.length - 1] || {};
  const lastScene = lastShot.scene || '';
  const lastDialogue = lastShot.dialogue || lastShot.action || '';
  const lastChars = (lastShot.chars || []).join('、');

  const sysPrompt = [
    '你是一位专业的短剧编导，正在创作连续剧的第' + epNum + '集。',
    '必须承接上集结尾，保持人物性格、场景、剧情的一致性。',
    '',
    '## 上集结尾',
    '场景: ' + lastScene,
    '角色: ' + lastChars,
    '最后镜头: ' + lastDialogue,
    '上集标题: ' + (prevScript.title || ''),
    '',
    '## 核心规则（与第1集相同）',
    '1. 每个镜头只做一件事：一个动作 OR 一句台词',
    '2. 动作描述必须具体',
    '3. 每句台词不超过15个字',
    '4. 每镜头3-5秒',
    '5. 同场景镜头集中',
    '6. 景别：特写、近景、中景、远景、侧景、全景',
    '7. 表情：紧绷、压抑、难以置信、疑惑、焦急、冷漠、坚定、落寞、隐忍、温柔、愤怒、开心、悲伤、平静',
    '',
    '## 输出JSON格式（与第1集相同）',
    '{',
    '  "title": "剧名",',
    '  "genre": "题材",',
    '  "episode": ' + epNum + ',',
    '  "characters": { ... 保持与上集一致 },',
    '  "scenes": { ... 可新增场景 },',
    '  "shots": [ ... 20-30个镜头 ]',
    '}',
    '',
    '只输出JSON，不要任何其他文字。'
  ].join('\n');

  const userPrompt = '创作《' + (prevScript.title || '') + '》第' + epNum + '集。承接上集结尾（' + lastDialogue.substring(0, 50) + '），保持剧情连贯。本集20-30个镜头，总时长90-180秒。';

  try {
    const result = await dsChat([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.85, max_tokens: 12000 });

    const content = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content || '';
    let script = extractJSON(content);
    if (!script.shots || !Array.isArray(script.shots)) throw new Error('剧本格式错误');
    script.episode = epNum;
    script.shots.forEach(function (s, i) {
      s.id = i + 1;
      s.duration = Math.min(Math.max(s.duration || 3, SHOT_LOCK.durMin), SHOT_LOCK.durMax);
    });
    // Inherit characters from previous episode if missing
    if (!script.characters && prevScript.characters) script.characters = prevScript.characters;
    // Inherit scenes from previous episode and merge
    if (prevScript.scenes) {
      script.scenes = Object.assign({}, prevScript.scenes, script.scenes || {});
    }
    // ★ 场景规范化
    script = normalizeScenes(script);
    return script;
  } catch (e) {
    console.log('[Episode ' + epNum + '] Script gen failed:', e.message);
    return null;
  }
}

async function validateScript(script) {
  try {
    const shotsJSON = JSON.stringify(script.shots.slice(0,20));
    const result = await dsChat([
      {role:'system',content:'你是短剧剧本审核员。检查镜头序列逻辑一致性。找出：1.表情与动作不匹配 2.场景切换不合理 3.台词与情绪不匹配 4.人物出场/消失不连贯。只返回JSON：{"valid":true/false,"issues":["问题描述"]}'},
      {role:'user',content:'审核以下镜头序列：\n'+shotsJSON}
    ],{temperature:0.3,max_tokens:2000});
    const content = result.choices&&result.choices[0]&&result.choices[0].message&&result.choices[0].message.content||'';
    const review = extractJSON(content);
    console.log('[Audit] '+(review.valid?'PASS':'ISSUES: '+(review.issues||[]).join('; ')));
    return review;
  } catch(e) { console.log('[Audit] err:',e.message); return {valid:true,issues:[]}; }
}

// ================================================================
//  单镜头渲染
// ================================================================

async function renderShot(shot, shotIdx, epDir, script, task, shotsTotal, prevShot) {
  const shotDir = path.join(epDir, 'shot_'+String(shotIdx).padStart(3,'0'));
  if(!fs.existsSync(shotDir)) fs.mkdirSync(shotDir,{recursive:true});

  // 1. 生成图片
  const imgPath = path.join(shotDir, 'image.jpg');
  let imgOk = false;
  
  // ★ 场景内复用策略：同一场景的第2+个无对话镜头复用第1张图
  // 对话镜头仍独立生成（需要嘴型匹配）
  let reuseImg = false;
  if(!shot.dialogue && shot.scene && renderShot._sceneImages && renderShot._sceneImages[shot.scene]) {
    // 复用同场景已有图片
    try {
      fs.copyFileSync(renderShot._sceneImages[shot.scene], imgPath);
      imgOk = true;
      reuseImg = true;
      console.log('[Shot '+shotIdx+'] IMG REUSED from scene: '+shot.scene);
    } catch(e) {}
  }
  
  if(!imgOk) {
    // ★★ 强制使用本地素材，禁止AI生成新图 ★★
    var _sceneAsset = matchLocalSceneImage(shot.scene, shot.seriesStyle);
    if (_sceneAsset && fs.existsSync(_sceneAsset.imagePath)) {
      try {
        fs.copyFileSync(_sceneAsset.imagePath, imgPath);
        imgOk = true;
        console.log('[Shot '+shotIdx+'] IMG: 本地素材命中 ('+_sceneAsset.matchedName+' -> '+path.basename(_sceneAsset.imagePath)+')');
      } catch(copyErr) {
        console.warn('[Shot '+shotIdx+'] 本地素材复制失败:', copyErr.message.substring(0,60));
      }
    }

    if(!imgOk) {
      // 场景图未匹配，按关键字再搜一轮
      var _fallbackAsset = null;
      var _sceneKeys = Object.keys(SCENE_IMAGE_MAP);
      if (shot.scene) {
        for(var _si=0;_si<_sceneKeys.length;_si++){
          if(shot.scene.includes(_sceneKeys[_si]) || _sceneKeys[_si].includes(shot.scene)){
            _fallbackAsset = SCENE_IMAGE_MAP[_sceneKeys[_si]]; break;
          }
        }
      }
      if (_fallbackAsset && fs.existsSync(_fallbackAsset)) {
        try {
          fs.copyFileSync(_fallbackAsset, imgPath);
          imgOk = true;
          console.log('[Shot '+shotIdx+'] IMG: 模糊匹配素材 ('+path.basename(_fallbackAsset)+')');
        } catch(e2) {}
      }
    }

    if(!imgOk) {
      // 绝对兜底：随机取一张场景图，也绝不调AI
      var _randKeys = Object.keys(SCENE_IMAGE_MAP);
      if (_randKeys.length > 0) {
        var _randImg = SCENE_IMAGE_MAP[_randKeys[shotIdx % _randKeys.length]];
        if (fs.existsSync(_randImg)) {
          fs.copyFileSync(_randImg, imgPath);
          imgOk = true;
          console.log('[Shot '+shotIdx+'] IMG: 轮转素材兜底 ('+path.basename(_randImg)+')');
        }
      }
    }

    if(!imgOk) { console.log('[Shot '+shotIdx+'] IMG FAIL (素材库为空)'); return null; }
    
    // 记录此场景的第一张图供后续复用
    if(!renderShot._sceneImages) renderShot._sceneImages = {};
    if(!renderShot._sceneImages[shot.scene]) {
      renderShot._sceneImages[shot.scene] = imgPath;
    }
  }

  // 2. TTS
  let audioPath = null;
  let audioDur = shot.duration||3;
  if(shot.dialogue && shot.dialogue.length > 0) {
    audioPath = path.join(shotDir, 'voice.mp3');
    const speakChar = (shot.chars&&shot.chars[0])||'male_lead';
    const charCfg = (script.characters&&script.characters[speakChar])||CHAR_LOCK[speakChar];
    const voiceId = charCfg ? charCfg.voice : 'zh_female_vv_uranus_bigtts';
    const emo = (shot.expression||'').split(/[、，]/)[0]||'温柔';
    const ttsOk = await genTTS(shot.dialogue, voiceId, emo, audioPath);
    if(ttsOk) {
      audioDur = await probeDur(audioPath);
      console.log('[Shot '+shotIdx+'] TTS OK: '+audioDur.toFixed(1)+'s');
    } else { audioPath = null; }
  }

  let segPath = path.join(shotDir, 'segment.mp4');
    // Per-scene seed: same scene = same seed for visual consistency
    if (!renderShot._sceneSeeds) renderShot._sceneSeeds = {};
    // ★ Seed锁死：禁止随机，从masterSeed确定性派生
    if (!renderShot._masterSeed) renderShot._masterSeed = 314159;
    if (!renderShot._sceneSeeds[shot.scene]) {
      // 从场景名hash确定性生成，同一场景永远同一组seed
      var sc = (shot.scene || 'default');
      var h = 0; for(var ci=0;ci<sc.length;ci++) h = ((h<<5)-h+sc.charCodeAt(ci))|0;
      h = Math.abs(h);
      renderShot._sceneSeeds[shot.scene] = {
        front: 100000 + (h % 800000),
        side:  200000 + ((h*7) % 800000),
        back:  300000 + ((h*13) % 800000)
      };
    }
    // Pick seed by camera angle hint in shot action
    const sceneSeeds = renderShot._sceneSeeds[shot.scene];
    let sceneSeed = sceneSeeds.front;
    if (shot.action && (shot.action.includes('转身') || shot.action.includes('离开') || shot.action.includes('背影'))) {
      sceneSeed = sceneSeeds.back;
    } else if (shot.action && (shot.action.includes('回头') || shot.action.includes('转身') || shot.action.includes('侧'))) {
      sceneSeed = sceneSeeds.side;
    }
    // sceneSeed already declared above as let

  let videoOk = false;

  // 本地渲染: 静态图+音频 Ken Burns 运镜
  videoOk = await renderZoompan(imgPath, audioPath, audioDur, segPath, shot ? shot.expression : '');
  if(videoOk) {
    console.log('[Shot '+shotIdx+'] Zoompan OK ('+audioDur.toFixed(1)+'s)');
  }

  if(!videoOk) { console.log('[Shot '+shotIdx+'] 镜头生成失败，跳过'); shot._skip = true; }
  console.log('[Shot '+shotIdx+'] OK ('+audioDur.toFixed(1)+'s)');
  return {segPath:segPath, duration:audioDur, dialogue:shot.dialogue||''};
}

// ================================================================
//  集渲染
// ================================================================
async function renderEpisode(script, bgmPath, workDir, task, epNum) {
  epNum = epNum || 1;
  const epDir = path.join(workDir, 'ep' + epNum);
  if(!fs.existsSync(epDir)) fs.mkdirSync(epDir,{recursive:true});

  const shots = script.shots||[];
  const segments = [];
  const subItems = [];

  for(let i=0;i<shots.length;i++){
    task.progress = Math.round(10+(i/shots.length)*75);
    task.step = '生成镜头 '+(i+1)+'/'+shots.length;
    task.logs.push('  镜头'+(i+1)+': '+(shots[i].action||'').substring(0,30)+'...');
    const result = await renderShot(shots[i], i, epDir, script, task, shots.length, shots[i-1] || null);
    if(result) {
      segments.push(result.segPath);
      if(result.dialogue) subItems.push({text:result.dialogue,duration:result.duration});
    }
    await sleep(500);
  }

  if(segments.length===0) throw new Error('所有镜头渲染失败');

  // 拼接
  task.progress=88; task.step='拼接镜头...';
  const rawPath = path.join(epDir,'raw.mp4');
  await concatSegs(segments, rawPath);

  // 广告位
  const totalDur = await probeDur(rawPath);
  if(totalDur>=POST.adSlot.time) {
    // 广告位拼接：全部用ASCII临时目录避免中文路径
    const adTmp = path.join(ASCII_TMP, 'ad_' + Date.now());
    if (!fs.existsSync(adTmp)) fs.mkdirSync(adTmp, { recursive: true });
    const safePre = path.join(adTmp, 'pre.mp4');
    const safePost = path.join(adTmp, 'post.mp4');
    const safeBlack = path.join(adTmp, 'black.mp4');
    const safeRaw = path.join(adTmp, 'raw.mp4');
    const adList = path.join(adTmp, 'ad.txt');

    // 生成广告位片段（在ASCII目录）
    await runFF(['-y','-i',rawPath,'-t',String(POST.adSlot.time),'-c','copy',safePre],120000);
    await runFF(['-y','-i',rawPath,'-ss',String(POST.adSlot.time),'-c','copy',safePost],120000);
    await runFF(['-y','-f','lavfi','-i','color=c=black:s=1080x1920:d='+POST.adSlot.dur+':r='+VID.fps,
      '-c:v','libx264','-preset','ultrafast','-t',String(POST.adSlot.dur),safeBlack],120000);
    fs.writeFileSync(adList, "file '" + safePre + "'\nfile '" + safeBlack + "'\nfile '" + safePost + "'\nfile '" + safeRaw + "'");

    // 拼接原始视频到ASCII目录
    if (fs.existsSync(rawPath)) fs.copyFileSync(rawPath, safeRaw);

    const adPath = path.join(adTmp, 'output.mp4');
    await runFF(['-y','-f','concat','-safe','0','-i',adList,'-c','copy',adPath],120000);

    // 拷回结果
    if (fs.existsSync(adPath) && fs.statSync(adPath).size > 1000) {
      const backup = rawPath + '.bak';
      try { fs.unlinkSync(backup); } catch(e) {}
      fs.renameSync(rawPath, backup);
      fs.copyFileSync(adPath, rawPath);
      try { fs.unlinkSync(backup); } catch(e) {}
      console.log('[AdSlot] OK: ad injected');
    } else {
      console.log('[AdSlot] WARN: concat failed, using raw without ad');
    }

    // 清理ASCII临时目录
    try { fs.rmSync(adTmp, { recursive: true, force: true }); } catch(e) {}
    // 清理可能残留的临时文件
    [safePre, safePost, safeBlack, safeRaw, adList, adPath].forEach(function(f){ try{fs.unlinkSync(f);}catch(e){} });
  }

  // BGM
  task.progress=92; task.step='添加BGM...';
  let finalPath = rawPath;
  if(bgmPath&&fs.existsSync(bgmPath)){
    const bgmOut=path.join(epDir,'with_bgm.mp4');
    if(await addBGM(rawPath,bgmPath,bgmOut)) finalPath=bgmOut;
  }

  // 字幕
  if(subItems.length>0){
    task.progress=96; task.step='烧录字幕...';
    const srt=buildSRT(subItems);
    const subOut=path.join(epDir,'final.mp4');
    if(await burnSubs(finalPath,srt,subOut)) finalPath=subOut;
  }


  // 烧录引流文字 — 已禁用（水印影响观感）
  task.progress = 100; task.step = '完成！';


  segments.forEach(function(f){try{fs.unlinkSync(f);}catch(e){}});
  return finalPath;
}

// ================================================================
//  任务管理
// ================================================================
const tasks = new Map();

function createTask(params) {
  const taskId = 'drp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const workDir = path.join(TEMP_BASE, taskId);
  [workDir,OUTPUT_DIR].forEach(function(d){if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});});
  const task = {
    id:taskId,status:'running',progress:0,step:'初始化...',
    logs:['任务创建: '+new Date().toLocaleTimeString()],
    title:params.title||'短剧',workDir:workDir,
    createdAt:new Date().toISOString(),result:null,error:null
  };
  tasks.set(taskId, task);
  _run(taskId, params).catch(function(err){
    task.status='failed';task.error=err.message;task.logs.push('X '+err.message);
  });
  return taskId;
}

async function _run(taskId, params) {
  const task = tasks.get(taskId);
  if(!task) return;
  try {
    // 剧本
    var script;
    if(params.mode==='test') {
      task.logs.push('使用内置测试剧本: '+TEST_SCRIPT.title);
      script = JSON.parse(JSON.stringify(TEST_SCRIPT));
    } else if(params.script) {
      script = params.script;
      task.logs.push('使用自定义剧本');
    } else {
      task.progress=3; task.step='DeepSeek生成剧本...';
      task.logs.push('Step 1: 生成标准化镜头剧本...');
      script = await generateScript(params);
      task.logs.push('剧本OK: '+(script.shots?script.shots.length:0)+'个镜头');
      // Cap shots to totalShots if specified
      if(params.totalShots && script.shots && script.shots.length > params.totalShots) {
        var origLen = script.shots.length;
        script.shots = script.shots.slice(0, params.totalShots);
        task.logs.push('裁剪镜头: '+origLen+' -> '+params.totalShots);
      }
    }
    fs.writeFileSync(path.join(task.workDir,'script.json'),JSON.stringify(script,null,2),'utf-8');

    // 审核
    task.progress=6; task.step='审核剧本...';
    task.logs.push('Step 2: 剧本逻辑审核...');
    var review = await validateScript(script);
    task.logs.push(review.valid?'审核通过':'审核问题: '+(review.issues||[]).slice(0,5).join('; '));

    // 场景底图
    task.progress=8; task.step='生成场景底图...';
    task.logs.push('Step 3: 生成场景参考底图...');
    var sceneIds = [];
    var seen = {};
    (script.shots||[]).forEach(function(s){if(s.scene&&!seen[s.scene]){seen[s.scene]=1;sceneIds.push(s.scene);}});
    var scImgDir = path.join(task.workDir,'scenes');
    if(!fs.existsSync(scImgDir)) fs.mkdirSync(scImgDir,{recursive:true});
    for(var si=0;si<sceneIds.length;si++){
      var scImg = path.join(scImgDir,sceneIds[si]+'.jpg');
      if(!fs.existsSync(scImg)){
        // ★ 强制使用本地素材，禁止AI生成
        var _scAsset = matchLocalSceneImage(sceneIds[si], '');
        if (_scAsset && fs.existsSync(_scAsset.imagePath)) {
          try { fs.copyFileSync(_scAsset.imagePath, scImg); var ok = true; } catch(e) { var ok = false; }
          task.logs.push((ok?'OK(素材)':'FAIL(素材复制)')+' 场景: '+sceneIds[si]+' -> '+_scAsset.matchedName);
        } else {
          // Fallback: random asset
          var _rk = Object.keys(SCENE_IMAGE_MAP);
          if (_rk.length > 0) {
            var _ri = SCENE_IMAGE_MAP[_rk[si % _rk.length]];
            if (fs.existsSync(_ri)) { fs.copyFileSync(_ri, scImg); var ok = true; }
          }
          // genImage removed - only local assets
          task.logs.push((ok?'OK':'FAIL(无本地素材)')+' 场景: '+sceneIds[si]);
        }
        if(ok){try{const {execFileSync:efs}=require('child_process');const FF=require('D:/天道v4.2-绿色免安装版/config/paths.json').FFMPEG_BIN;const clp=scImg+'.clean.jpg';efs(FF,['-y','-i',scImg,'-vf','crop=1440:2440:0:0','-q:v','2',clp],{stdio:'pipe',windowsHide:true,timeout:30000});if(fs.existsSync(clp)&&fs.statSync(clp).size>1000){fs.copyFileSync(clp,scImg);try{fs.unlinkSync(clp);}catch(e){}}}catch(e){}}
      }
      await sleep(500);
    }

    // BGM
    task.progress=9; task.logs.push('Step 4: 生成BGM...');
    var estDur = (script.shots?script.shots.length:0)*4;
    var bgmPath = path.join(task.workDir,'bgm.mp3');
    var bgmOk = await genBGM(Math.max(estDur,60),bgmPath);
    task.logs.push(bgmOk?'BGM OK':'BGM simplified');

    // 渲染
    // 渲染多集
    var totalEps = script.total_episodes || (params.episodes ? parseInt(params.episodes) : 1);
    task.logs.push('Step 5: 渲染 ' + totalEps + '集, 共'+(script.shots?script.shots.length:0)+'个镜头...');
    var episodeResults = [];

    for (var epNum = 1; epNum <= Math.min(totalEps, 40); epNum++) {
      task.progress = Math.round(10 + ((epNum - 1) / totalEps) * 80);
      task.step = '渲染第 ' + epNum + '/' + totalEps + ' 集...';
      task.logs.push('--- 第' + epNum + '集 ---');

      var epScript;
      var epShotCap = params.totalShots || 0;
      if (epNum === 1) {
        epScript = script;
      } else {
        task.step = '生成第 ' + epNum + ' 集剧本（承接上集）...';
        epScript = await generateEpisodeScript(script, epNum, task);
        if (!epScript) { task.logs.push('第'+epNum+'集剧本失败,跳过'); continue; }
        if (epShotCap && epScript.shots && epScript.shots.length > epShotCap) {
          task.logs.push('第'+epNum+'集镜头裁剪: '+(epScript.shots.length)+'->'+epShotCap);
          epScript.shots = epScript.shots.slice(0, epShotCap);
        }
        fs.writeFileSync(path.join(task.workDir, 'script_ep'+epNum+'.json'), JSON.stringify(epScript, null, 2), 'utf-8');
      }

      var epBgm = bgmOk ? bgmPath : null;
      if (!epBgm) {
        var epBgmPath = path.join(task.workDir, 'bgm_ep'+epNum+'.mp3');
        var epBgmOk = await genBGM(Math.max((epScript.shots?epScript.shots.length:0)*5, 90), epBgmPath);
        epBgm = epBgmOk ? epBgmPath : null;
      }

      var videoPath = await renderEpisode(epScript, epBgm, task.workDir, task, epNum);
      if (!videoPath) { task.logs.push('第'+epNum+'集渲染失败'); continue; }

      var outName = 'drama_'+taskId.replace('drp_','')+'_ep'+epNum+'.mp4';
      var outPath = path.join(OUTPUT_DIR, outName);
      fs.copyFileSync(videoPath, outPath);
      var dur = await probeDur(outPath);
      var size = fs.statSync(outPath).size;
      episodeResults.push({ episode:epNum, filename:outName, url:'/storage/drama/output/'+outName, size:size, duration:dur });
      task.logs.push('第'+epNum+'集完成: '+outName+' ('+(size/1024/1024).toFixed(1)+'MB, '+Math.round(dur)+'s)');
    }

    if (episodeResults.length === 0) throw new Error('所有集渲染失败');

    try {
      const dGenre = task.genre || task.style || '';
      const archived = workArchiver.archiveWork({
        sourcePath: path.join(OUTPUT_DIR, episodeResults[0].filename),
        type: 'drama', genre: dGenre, topic: task.title||task.topic||'',
        keywords: (dGenre+' '+(task.title||'')).toLowerCase(),
        params: { taskId:task.id, genre:dGenre, title:task.title, episodes:episodeResults.length }
      });
      if (archived) console.log('[Drama] Archived: '+archived.category);
    } catch(e) { console.warn('[Drama] Archive failed:', e.message); }

    task.progress=99; task.step='输出成品...';
    task.result = {
      episodes: episodeResults.length,
      title: script.title||'短剧',
      files: episodeResults,
      totalDuration: episodeResults.reduce((s,e)=>s+(e.duration||0),0),
      totalSize: episodeResults.reduce((s,e)=>s+(e.size||0),0)
    };
    task.progress=100;task.status='completed';task.step='完成！';
    task.completedAt=new Date().toISOString();
    task.logs.push('全部完成: '+episodeResults.length+'集, 总时长'+Math.round(task.result.totalDuration)+'秒');
    console.log('[Pipeline] Task '+taskId+' done');
  } catch(err) {
    task.status='failed';task.error=err.message;task.logs.push('X '+err.message);
    console.error('[Pipeline] Task '+taskId+' fail:',err);
  }
}

checkSadTalker();

function getTask(taskId) { return tasks.get(taskId)||null; }
function listTasks() { return Array.from(tasks.values()).reverse().slice(0,50); }

module.exports = { createTask:createTask, getTask:getTask, listTasks:listTasks, matchLocalSceneImage:matchLocalSceneImage, matchLocalCharacterImage:matchLocalCharacterImage };
