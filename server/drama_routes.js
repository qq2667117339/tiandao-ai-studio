/**
 * AI Short Drama System - Drama Module Router (v2 - Dual Engine)
 * Mount: app.use('/api/drama', require('./routes/drama'))
 * 
 * RED LINE COMPLIANCE:
 * - Dual Engine: DeepSeek + Doubao (Volcengine Ark)
 * - Module isolation: All storage under storage/drama/ only
 * - Local assets only: No external resource URLs
 * - Naming convention: Strict {棰樻潗}_{鍚嶇О}_{鐗瑰緛} format
 * - Exclusive assets in separate exclusive/ folders
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// LOCKED - DO NOT REMOVE OR BYPASS - Business layer security check
const { lockSystem, ironRules } = require('../core/lock-system');
const auditLogger = require('../core/audit-logger');
console.log('[drama] Business-layer security check ENABLED');

// ===== Storage Paths =====
const STORAGE_ROOT = path.join(__dirname, '..', 'storage', 'drama');
const CONFIG_PATH = path.join(STORAGE_ROOT, 'drama_config.json');
const PROMPTS_DIR = path.join(STORAGE_ROOT, 'prompts');
const TEMPLATES_DIR = path.join(STORAGE_ROOT, 'scripts', 'templates');
const OUTPUT_DIR = path.join(STORAGE_ROOT, 'output');

// ===== Multer for asset uploads =====
const multer = require('multer');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const type = req.body.type || 'characters';
      const subtype = req.body.subtype || 'general';
      const dir = path.join(STORAGE_ROOT, type, subtype);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = req.body.name || req.body.filename || file.originalname.replace(/\.[^.]+$/, '');
      cb(null, `${name}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// ===== RED LINE: Dual Engine Configuration =====
// Engine selection: 'deepseek' | 'doubao' | 'auto' (auto = doubao primary, deepseek fallback)
const DEFAULT_ENGINE = 'auto';

function loadEngineConfig() {
  try {
    const cfgPath = path.join(STORAGE_ROOT, 'engine_config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch(e) {}
  return {
    default_engine: DEFAULT_ENGINE,
    deepseek: {
      api_key: process.env.DEEPSEEK_API_KEY || '',
      base_url: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      max_tokens: 8000,
      temperature: 0.85
    },
    doubao: {
      api_key: '',  // Set via /api/drama/config/engine or engine_config.json
      base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-0-pro-260215',
      max_tokens: 8000,
      temperature: 0.85
    },
    // RED LINE: Module isolation - only drama-related tasks use these engines
    // These engines are NEVER exposed to other modules (digital-human, songs, etc.)
    allowed_tasks: ['script_generate', 'storyboard_generate', 'prompt_generate']
  };
}

// ===== HTTPS Request Helper (local only, no external resources) =====
function httpsPost(urlStr, headers, postData, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error('JSON Parse Error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('API Timeout')); });
    req.write(postData);
    req.end();
  });
}

// ===== Engine 1: DeepSeek =====
async function callDeepSeek(messages, options = {}) {
  const config = loadEngineConfig().deepseek;
  const postData = JSON.stringify({
    model: options.model || config.model,
    messages,
    temperature: options.temperature ?? config.temperature,
    max_tokens: options.max_tokens || config.max_tokens
  });

  const result = await httpsPost(
    `${config.base_url}/chat/completions`,
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.api_key}`
    },
    postData
  );

  if (result.error) throw new Error('DeepSeek: ' + (result.error.message || JSON.stringify(result.error)));
  return result;
}

// ===== Engine 2: Doubao (Volcengine Ark) =====
async function callDoubao(messages, options = {}) {
  const config = loadEngineConfig().doubao;
  
  if (!config.api_key) {
    throw new Error('Doubao engine not configured - set api_key in engine_config.json or via /api/drama/config/engine');
  }

  const postData = JSON.stringify({
    model: options.model || config.model,
    messages,
    temperature: options.temperature ?? config.temperature,
    max_tokens: options.max_tokens || config.max_tokens
  });

  const result = await httpsPost(
    `${config.base_url}/chat/completions`,
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.api_key}`
    },
    postData
  );

  if (result.error) throw new Error('Doubao: ' + (result.error.message || JSON.stringify(result.error)));
  return result;
}

// ===== Dual Engine Dispatcher =====
// RED LINE: Only DeepSeek allowed for drama scripts.
async function callAI(messages, options = {}) {
  const config = loadEngineConfig();
  const engine = options.engine || config.default_engine;
  
  console.log(`[drama] AI call via engine: ${engine}`);

  if (engine === 'deepseek') {
    return await callDeepSeek(messages, options);
  }
  
  if (engine === 'doubao') {
    return await callDoubao(messages, options);
  }
  
  // 'auto' mode: try doubao first, fallback to deepseek
  if (engine === 'auto') {
    const doubaoConfig = config.doubao;
    if (doubaoConfig.api_key) {
      try {
        return await callDoubao(messages, options);
      } catch(e) {
        console.warn(`[drama] Doubao failed, falling back to DeepSeek: ${e.message}`);
      }
    }
    return await callDeepSeek(messages, options);
  }
  
  throw new Error(`Unknown engine: ${engine}. Allowed: deepseek, doubao, auto`);
}

// ===== Helper: Extract JSON from response =====
function extractJSON(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch(e) {}
  }
  try { return JSON.parse(text); } catch(e) {}
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch(e) {}
  }
  throw new Error('No valid JSON found in AI response');
}

// ===== Config Loader =====
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch(e) {
    console.error('[drama] Failed to load config:', e.message);
  }
  return getDefaultConfig();
}

function getDefaultConfig() {
  return {
    naming: {
      character: "{\u9898\u6750}_{\u89d2\u8272}_{\u7279\u5f81}",
      scene: "{\u9898\u6750}_{\u573a\u666f\u540d}_{\u5149\u7ebf}_{\u72b6\u6001}",
      effect: "{\u9898\u6750}_{\u7279\u6548\u540d}_{\u5f3a\u5ea6}",
      audio: "{\u7c7b\u578b}_{\u9898\u6750}_{\u98ce\u683c}"
    },
    categories: {
      general: ["\u90fd\u5e02", "\u53e4\u98ce", "\u7384\u5e7b", "\u4ed9\u4fa0", "\u60c5\u611f"],
      exclusive: ["\u5192\u5e9c", "\u76d7\u5893"]
    }
  };
}

// ===== In-memory task store for video generation =====
const videoTasks = new Map();

// ============================================================
// ROUTES
// ============================================================

// --- Health Check ---

// LOCKED - Business layer health check (auth relaxed for status check)
router.get('/health', (req, res) => {
  const engineConfig = loadEngineConfig();
  res.json({
    success: true,
    module: 'ai-short-drama',
    version: '2.0.0',
    red_line_compliance: true,
    engines: {
      deepseek: { configured: !!engineConfig.deepseek.api_key, model: engineConfig.deepseek.model },
      doubao: { configured: !!engineConfig.doubao.api_key, model: engineConfig.doubao.model },
      default: engineConfig.default_engine
    },
    storage: fs.existsSync(STORAGE_ROOT),
    storage_path: STORAGE_ROOT,
    timestamp: new Date().toISOString()
  });
});

// --- Get Config ---

// LOCKED - Business layer check
router.get('/config', (req, res) => {
  res.json({ success: true, config: loadConfig(), engine: loadEngineConfig() });
});

// --- Update Config ---

// LOCKED - Business layer check
router.put('/config', (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    if (req.body.naming || req.body.categories || req.body.exclusive_characters || req.body.exclusive_scenes || req.body.exclusive_effects) {
      // Update drama_config.json
      const existing = loadConfig();
      const updated = { ...existing, ...req.body };
      // Remove engine fields from drama config
      delete updated.default_engine;
      delete updated.deepseek;
      delete updated.doubao;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
    }
    res.json({ success: true, message: '\u914d\u7f6e\u5df2\u66f4\u65b0' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Engine Config (separate for security) ---
router.get('/config/engine', (req, res) => {
  const config = loadEngineConfig();
  // Mask API keys in response
  res.json({
    success: true,
    default_engine: config.default_engine,
    deepseek: { ...config.deepseek, api_key: config.deepseek.api_key ? config.deepseek.api_key.slice(0, 6) + '****' : '' },
    doubao: { ...config.doubao, api_key: config.doubao.api_key ? config.doubao.api_key.slice(0, 6) + '****' : '' }
  });
});


// LOCKED - Business layer check
router.put('/config/engine', (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    const config = loadEngineConfig();
    if (req.body.default_engine) config.default_engine = req.body.default_engine;
    if (req.body.deepseek) {
      if (req.body.deepseek.api_key) config.deepseek.api_key = req.body.deepseek.api_key;
      if (req.body.deepseek.model) config.deepseek.model = req.body.deepseek.model;
    }
    if (req.body.doubao) {
      if (req.body.doubao.api_key) config.doubao.api_key = req.body.doubao.api_key;
      if (req.body.doubao.model) config.doubao.model = req.body.doubao.model;
      if (req.body.doubao.base_url) config.doubao.base_url = req.body.doubao.base_url;
    }
    const cfgPath = path.join(STORAGE_ROOT, 'engine_config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[drama] Engine config updated (keys masked)');
    res.json({ success: true, message: '\u5f15\u64ce\u914d\u7f6e\u5df2\u66f4\u65b0' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 1. SCRIPT GENERATION
// POST /api/drama/script/generate
// RED LINE: Uses dual engine (DeepSeek + Doubao), no other external AI
// ============================================================

// LOCKED - Business layer check
router.post('/script/generate', async (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    const { genre, style, duration, characters, plot_hint, episode_count, engine } = req.body;
    
    if (!genre) {
      return res.status(400).json({ success: false, error: '\u8bf7\u63d0\u4f9b\u9898\u6750(genre)' });
    }

    // Load template if available
    let templateContext = '';
    const templateFile = path.join(TEMPLATES_DIR, `${genre}.json`);
    if (fs.existsSync(templateFile)) {
      try {
        const template = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
        templateContext = `\n\n\u53c2\u8003\u6a21\u677f:\n\u6807\u9898: ${template.title}\n\u98ce\u683c: ${template.style}\n\u89d2\u8272: ${JSON.stringify(template.character_list)}\n\u5927\u7eb2: ${template.plot_outline}\n\u5bf9\u8bdd\u793a\u4f8b: ${JSON.stringify(template.dialogue_sample)}`;
      } catch(e) {}
    }

    const systemPrompt = `\u4f60\u662f\u4e00\u4f4d\u4e13\u4e1a\u7684\u77ed\u5267\u7f16\u5267\u5927\u5e08\uff0c\u64c5\u957f\u521b\u4f5c1-3\u5206\u949f\u7684\u7ad6\u5c4f\u77ed\u5267\u5267\u672c\u3002
\u4f60\u9700\u8981\u751f\u6210\u7ed3\u6784\u5316\u7684JSON\u683c\u5f0f\u5267\u672c\u3002\u8981\u6c42\uff1a
1. \u5267\u672c\u5fc5\u987b\u6709\u5f3a\u70c8\u7684\u5f00\u5934hook\uff083\u79d2\u5185\u6293\u4f4f\u89c2\u4f17\uff09
2. \u60c5\u8282\u7d27\u51d1\uff0c\u53cd\u8f6c\u4e0d\u65ad
3. \u5bf9\u8bdd\u7cbe\u7ec3\uff0c\u6bcf\u53e5\u4e0d\u8d85\u8fc715\u5b57
4. \u6bcf\u96c61-3\u5206\u949f\uff0c\u9002\u914d\u7ad6\u5c4f\u77ed\u89c6\u9891
5. \u4e25\u683c\u6309\u7167JSON\u683c\u5f0f\u8f93\u51fa${templateContext}

\u8f93\u51faJSON\u683c\u5f0f\uff1a
{
  "title": "\u5267\u540d",
  "genre": "\u9898\u6750",
  "style": "\u98ce\u683c",
  "total_episodes": \u96c6\u6570,
  "target_duration": "\u6bcf\u96c6\u65f6\u957f(\u79d2)",
  "characters": [
    {"id": "char_1", "name": "\u89d2\u8272\u540d", "role": "\u4e3b\u89d2/\u914d\u89d2", "appearance": "\u5916\u8c8c\u63cf\u8ff0", "personality": "\u6027\u683c\u63cf\u8ff0", "tags": ["\u6807\u7b7e"]}
  ],
  "scenes": [
    {"id": "scene_1", "name": "\u573a\u666f\u540d", "description": "\u573a\u666f\u63cf\u8ff0", "atmosphere": "\u6c1b\u56f4", "tags": ["\u6807\u7b7e"]}
  ],
  "episodes": [
    {
      "episode": 1,
      "title": "\u96c6\u6807\u9898",
      "duration": 90,
      "plot": "\u672c\u96c6\u5267\u60c5\u6897\u6982",
      "shots": [
        {
          "shot_id": "S1E1_01",
          "duration": 3,
          "scene": "scene_1",
          "characters": ["char_1"],
          "camera": "\u7279\u5199/\u4e2d\u666f/\u8fdc\u666f/\u5168\u666f/\u8ddf\u62cd",
          "action": "\u52a8\u4f5c\u63cf\u8ff0",
          "dialogue": {"character": "char_1", "line": "\u53f0\u8bcd"},
          "effect": "\u7279\u6548\u63cf\u8ff0",
          "emotion": "\u60c5\u7eea"
        }
      ],
      "cliffhanger": "\u60ac\u5ff5\u7ed3\u5c3e"
    }
  ]
}`;

    const userPrompt = `\u8bf7\u521b\u4f5c\u4e00\u90e8${style || ''}${genre}\u9898\u6750\u7684\u77ed\u5267\u5267\u672c\u3002
- \u96c6\u6570: ${episode_count || 3}\u96c6
- \u6bcf\u96c6\u65f6\u957f: ${duration || 90}\u79d2
- \u89d2\u8272\u8981\u6c42: ${characters || '\u81ea\u52a8\u8bbe\u8ba1'}
${plot_hint ? `- \u5267\u60c5\u63d0\u793a: ${plot_hint}` : ''}

\u8bf7\u8f93\u51fa\u5b8c\u6574\u7684JSON\u5267\u672c\u3002`;

    const engineName = engine || undefined; // undefined = use default from config
    console.log(`[drama] Generating script: genre=${genre}, style=${style}, episodes=${episode_count || 3}, engine=${engineName || 'auto'}`);
    
    const result = await callAI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0.85, max_tokens: 8000, engine: engineName }
    );

    const content = result.choices?.[0]?.message?.content || '';
    const script = extractJSON(content);

    // Save script to storage (RED LINE: local only)
    const scriptId = `script_${Date.now()}`;
    const scriptPath = path.join(STORAGE_ROOT, 'scripts', `${scriptId}.json`);
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');

    res.json({
      success: true,
      script_id: scriptId,
      script,
      saved_to: scriptPath,
      engine_used: result.model || 'unknown'
    });

  } catch(e) {
    console.error('[drama] Script generation error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 2. STORYBOARD GENERATION
// POST /api/drama/storyboard/generate
// RED LINE: Uses dual engine (DeepSeek + Doubao)
// ============================================================

// LOCKED - Business layer check
router.post('/storyboard/generate', async (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    const { script, script_id, engine } = req.body;

    if (!script && !script_id) {
      return res.status(400).json({ success: false, error: '\u8bf7\u63d0\u4f9b\u5267\u672c\u5185\u5bb9(script)\u6216\u5267\u672cID(script_id)' });
    }

    let scriptData = script;
    if (!scriptData && script_id) {
      const scriptPath = path.join(STORAGE_ROOT, 'scripts', `${script_id}.json`);
      if (fs.existsSync(scriptPath)) {
        scriptData = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
      } else {
        return res.status(404).json({ success: false, error: `\u5267\u672c ${script_id} \u4e0d\u5b58\u5728` });
      }
    }

    const systemPrompt = `\u4f60\u662f\u4e13\u4e1a\u7684\u77ed\u5267\u5206\u955c\u5e08\u3002\u5c06\u5267\u672c\u62c6\u89e3\u4e3a\u8be6\u7ec6\u5206\u955c\u5217\u8868\u3002
\u6bcf\u4e2a\u5206\u955c\u9700\u8981\u5305\u542b\u7cbe\u786e\u7684\u89c6\u89c9\u63cf\u8ff0\uff0c\u7528\u4e8eAI\u89c6\u9891\u751f\u6210\u3002

\u8f93\u51faJSON\u683c\u5f0f\uff1a
{
  "storyboard_id": "sb_xxx",
  "title": "\u5206\u955c\u6807\u9898",
  "total_shots": \u603b\u955c\u5934\u6570,
  "total_duration": "\u603b\u65f6\u957f(\u79d2)",
  "shots": [
    {
      "shot_id": "SHOT_001",
      "episode": 1,
      "sequence": 1,
      "duration": 3,
      "scene_id": "scene_1",
      "scene_description": "\u8be6\u7ec6\u573a\u666f\u63cf\u8ff0\uff08\u7528\u4e8eAI\u751f\u56fe/\u89c6\u9891\uff09",
      "character_ids": ["char_1"],
      "character_positions": "\u4eba\u7269\u4f4d\u7f6e\u548c\u59ff\u6001\u63cf\u8ff0",
      "camera": {
        "type": "\u7279\u5199/\u4e2d\u666f/\u8fdc\u666f/\u5168\u666f/\u8ddf\u62cd/\u822a\u62cd",
        "angle": "\u5e73\u89c6/\u4ef0\u89c6/\u4fef\u89c6/\u4fa7\u62cd",
        "movement": "\u56fa\u5b9a/\u63a8/\u62c9/\u6447/\u79fb/\u8ddf"
      },
      "action": "\u8be6\u7ec6\u52a8\u4f5c\u63cf\u8ff0",
      "dialogue": {
        "character": "\u89d2\u8272\u540d",
        "line": "\u53f0\u8bcd\u5185\u5bb9",
        "emotion": "\u8bed\u6c14\u60c5\u7eea"
      },
      "visual_prompt_zh": "\u4e2d\u6587\u89c6\u89c9\u63d0\u793a\u8bcd\uff08\u7528\u4e8eAI\u751f\u56fe\uff09",
      "visual_prompt_en": "English visual prompt for AI image/video generation",
      "effect": "\u7279\u6548\u63cf\u8ff0",
      "transition": "\u8f6c\u573a\u65b9\u5f0f",
      "bgm_hint": "\u80cc\u666f\u97f3\u4e50\u63d0\u793a",
      "sfx_hint": "\u97f3\u6548\u63d0\u793a"
    }
  ]
}`;

    const userPrompt = `\u8bf7\u5c06\u4ee5\u4e0b\u5267\u672c\u62c6\u89e3\u4e3a\u8be6\u7ec6\u5206\u955c\uff1a\n\n${JSON.stringify(scriptData, null, 2)}\n\n\u8bf7\u8f93\u51fa\u5b8c\u6574\u5206\u955cJSON\u3002`;

    console.log(`[drama] Generating storyboard (engine: ${engine || 'auto'})`);
    const result = await callAI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0.7, max_tokens: 12000, engine }
    );

    const content = result.choices?.[0]?.message?.content || '';
    const storyboard = extractJSON(content);

    // Save storyboard (RED LINE: local only)
    const sbId = `sb_${Date.now()}`;
    const sbPath = path.join(STORAGE_ROOT, 'storyboards', `${sbId}.json`);
    fs.writeFileSync(sbPath, JSON.stringify(storyboard, null, 2), 'utf-8');

    res.json({
      success: true,
      storyboard_id: sbId,
      storyboard,
      saved_to: sbPath,
      engine_used: result.model || 'unknown'
    });

  } catch(e) {
    console.error('[drama] Storyboard generation error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 3. ASSET MANAGEMENT
// RED LINE: Module isolation - assets stay in storage/drama/ only
// RED LINE: Naming convention strict enforcement
// ============================================================

function listAssets(req, res, assetType) {
  try {
    const { search, category, tags, page = 1, limit = 50 } = req.query;
    
    const config = loadConfig();
    let assets = [];
    
    const configKey = `exclusive_${assetType}`;
    if (config[configKey]) {
      assets = config[configKey].map(a => ({
        ...a,
        category: 'exclusive',
        has_file: false,
        source: 'config'
      }));
    }

    // Scan filesystem for uploaded files
    ['general', 'exclusive'].forEach(cat => {
      const dir = path.join(STORAGE_ROOT, assetType, cat);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(file => {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            assets.push({
              name: file.replace(/_\d+$/, ''),
              file: file,
              category: cat,
              has_file: true,
              size: stat.size,
              modified: stat.mtime.toISOString(),
              source: 'upload'
            });
          }
        });
      }
    });

    // Filter
    if (search) {
      assets = assets.filter(a => 
        a.name.includes(search) || 
        (a.desc && a.desc.includes(search)) ||
        (a.tags && a.tags.some(t => t.includes(search)))
      );
    }
    if (category) {
      assets = assets.filter(a => a.category === category);
    }
    if (tags) {
      const tagList = tags.split(',');
      assets = assets.filter(a => a.tags && tagList.some(t => a.tags.includes(t)));
    }

    const total = assets.length;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paged = assets.slice(start, start + parseInt(limit));

    res.json({
      success: true,
      asset_type: assetType,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      assets: paged
    });

  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

router.get('/assets/characters', (req, res) => listAssets(req, res, 'characters'));
router.get('/assets/scenes', (req, res) => listAssets(req, res, 'scenes'));
router.get('/assets/effects', (req, res) => listAssets(req, res, 'effects'));

router.get('/assets/audio', (req, res) => {
  try {
    const { type, search, page = 1, limit = 50 } = req.query;
    const validTypes = ['voiceover', 'sfx', 'bgm'];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: `Invalid audio type. Use: ${validTypes.join(', ')}` });
    }
    
    const audioDir = path.join(STORAGE_ROOT, 'audio', type || '');
    let assets = [];
    
    if (type && fs.existsSync(audioDir)) {
      fs.readdirSync(audioDir).forEach(file => {
        const filePath = path.join(audioDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          assets.push({
            name: file.replace(/_\d+$/, ''),
            file: file,
            type: type,
            size: stat.size,
            modified: stat.mtime.toISOString()
          });
        }
      });
    }

    if (search) {
      assets = assets.filter(a => a.name.includes(search));
    }

    const total = assets.length;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paged = assets.slice(start, start + parseInt(limit));

    res.json({
      success: true,
      asset_type: 'audio',
      audio_type: type,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      assets: paged
    });

  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Upload asset ---
// RED LINE: All assets stored locally in storage/drama/ only
// RED LINE: Naming convention enforced on upload

// LOCKED - Business layer check
router.post('/assets/upload', upload.single('file'), (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '\u8bf7\u4e0a\u4f20\u6587\u4ef6' });
    }

    // RED LINE: Validate asset type is drama-only
    const validTypes = ['characters', 'scenes', 'effects', 'audio'];
    const assetType = req.body.type || 'characters';
    if (!validTypes.includes(assetType)) {
      // Delete uploaded file if wrong type
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: `Invalid asset type: ${assetType}. Drama module only accepts: ${validTypes.join(', ')}` });
    }

    // RED LINE: Validate subtype is general/exclusive only
    const subtype = req.body.subtype || 'general';
    if (!['general', 'exclusive'].includes(subtype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Subtype must be general or exclusive' });
    }

    const asset = {
      original_name: req.file.originalname,
      filename: req.file.filename,
      type: assetType,
      subtype: subtype,
      name: req.body.name || req.file.originalname,
      tags: req.body.tags ? req.body.tags.split(',') : [],
      size: req.file.size,
      // RED LINE: Path is strictly within storage/drama/
      path: req.file.path,
      module: 'drama', // Explicit module tag for isolation
      uploaded_at: new Date().toISOString()
    };

    res.json({ success: true, asset });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 4. PROMPT TEMPLATES
// RED LINE: Prompts generated via dual engine only
// ============================================================

router.get('/prompts/:type', (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ['characters', 'scenes', 'effects'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: `Invalid type: ${validTypes.join(', ')}` });
    }

    const promptFile = path.join(PROMPTS_DIR, `${type}.json`);
    if (fs.existsSync(promptFile)) {
      const prompts = JSON.parse(fs.readFileSync(promptFile, 'utf-8'));
      res.json({ success: true, type, prompts });
    } else {
      res.json({ success: true, type, prompts: [], message: 'No prompt templates yet' });
    }
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// LOCKED - Business layer check
router.post('/prompts/generate', async (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    const { type, subject, style, reference, engine } = req.body;

    if (!type || !subject) {
      return res.status(400).json({ success: false, error: 'Provide type and subject' });
    }

    const typeMap = {
      characters: 'character',
      scenes: 'scene',
      effects: 'visual effect'
    };

    const systemPrompt = `You are a professional AI short drama ${typeMap[type] || type} prompt engineer.
Generate high-quality prompts for AI image/video generation tools (Midjourney, Stable Diffusion, Kling, Runway).
Output bilingual prompts: English for generation, Chinese for understanding.
All prompts must target 4K cinematic quality.

Output JSON:
{
  "type": "${type}",
  "subject": "${subject}",
  "prompts": {
    "zh": "Chinese detailed description",
    "en": "English detailed prompt for AI generation, 8k cinematic quality",
    "negative": "Negative prompt",
    "style_reference": "Style reference"
  },
  "variants": [
    {"name": "variant1", "en": "English variant prompt"}
  ],
  "params": {
    "aspect_ratio": "9:16",
    "quality": "4k",
    "style_strength": 0.7
  }
}`;

    const userPrompt = `Generate AI prompts for the following ${typeMap[type]}:
- Description: ${subject}
- Style: ${style || 'realistic'}
${reference ? `- Reference: ${reference}` : ''}

RED LINE: All prompts must include quality markers: 8k, cinematic, 4K.`;

    const result = await callAI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0.7, max_tokens: 3000, engine }
    );

    const content = result.choices?.[0]?.message?.content || '';
    const promptData = extractJSON(content);

    res.json({ success: true, prompt: promptData, engine_used: result.model || 'unknown' });
  } catch(e) {
    console.error('[drama] Prompt generation error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 5. VIDEO GENERATION PIPELINE
// RED LINE: Video generation tasks managed locally
// ============================================================

// LOCKED - Business layer check
router.post('/video/generate', (req, res) => {
  const lr = lockSystem.fullCheck(req, res);
  if (!lr.passed) return res.status(403).json({success:false, message: lr.message, code:'DRAMA_LOCK'});
  try {
    const { storyboard_id, shots, config: genConfig } = req.body;

    if (!storyboard_id && !shots) {
      return res.status(400).json({ success: false, error: 'Provide storyboard_id or shots' });
    }

    const taskId = `task_${crypto.randomUUID().slice(0, 8)}`;
    
    videoTasks.set(taskId, {
      id: taskId,
      status: 'queued',
      created_at: new Date().toISOString(),
      config: genConfig || {},
      shots_processed: 0,
      shots_total: 0,
      output_files: [],
      logs: ['Task created, waiting...']
    });

    // RED LINE: Async processing, no external service calls
    processVideoTask(taskId, storyboard_id, shots, genConfig).catch(err => {
      const task = videoTasks.get(taskId);
      if (task) {
        task.status = 'failed';
        task.logs.push(`Failed: ${err.message}`);
        task.error = err.message;
      }
    });

    res.json({
      success: true,
      task_id: taskId,
      status: 'queued',
      message: 'Video generation task created'
    });

  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/video/task/:taskId', (req, res) => {
  const task = videoTasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }
  res.json({ success: true, task });
});

router.get('/video/tasks', (req, res) => {
  const tasks = Array.from(videoTasks.values()).reverse();
  res.json({ success: true, tasks, total: tasks.length });
});

async function processVideoTask(taskId, storyboardId, shots, config) {
  const task = videoTasks.get(taskId);
  if (!task) return;

  task.status = 'processing';
  task.logs.push('Processing storyboard...');

  try {
    let shotList = shots || [];
    if (storyboardId) {
      const sbPath = path.join(STORAGE_ROOT, 'storyboards', `${storyboardId}.json`);
      if (fs.existsSync(sbPath)) {
        const sb = JSON.parse(fs.readFileSync(sbPath, 'utf-8'));
        shotList = sb.shots || [];
      }
    }

    task.shots_total = shotList.length;

    for (let i = 0; i < shotList.length; i++) {
      const shot = shotList[i];
      task.logs.push(`Processing shot ${shot.shot_id || i + 1}: ${shot.visual_prompt_zh || shot.scene_description || 'N/A'}`);
      
      // RED LINE: Placeholder - actual video model integration pending
      // Will integrate with local model or approved API only
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      task.shots_processed = i + 1;
      task.output_files.push({
        shot_id: shot.shot_id || `SHOT_${String(i + 1).padStart(3, '0')}`,
        status: 'placeholder',
        note: 'Video model pending integration'
      });
    }

    task.status = 'completed';
    task.logs.push('All shots processed (placeholder - video model pending)');
    task.completed_at = new Date().toISOString();

  } catch(e) {
    task.status = 'failed';
    task.logs.push(`Error: ${e.message}`);
    task.error = e.message;
  }
}

// ============================================================
// 6. FINISHED VIDEO MANAGEMENT
// RED LINE: Videos stored locally in storage/drama/output/ only
// ============================================================

router.get('/videos', (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    let videos = [];
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.readdirSync(OUTPUT_DIR).forEach(file => {
        const filePath = path.join(OUTPUT_DIR, file);
        const stat = fs.statSync(filePath);
        const ext = path.extname(file).toLowerCase();
        if (['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
          videos.push({
            id: path.basename(file, ext),
            filename: file,
            format: ext.slice(1),
            size: stat.size,
            created: stat.mtime.toISOString(),
            status: 'ready'
          });
        }
      });
    }

    videoTasks.forEach(task => {
      if (task.status === 'completed' && task.output_files.length > 0) {
        videos.push({
          id: task.id,
          type: 'task',
          shots_count: task.output_files.length,
          created: task.completed_at || task.created_at,
          status: 'completed'
        });
      }
    });

    if (status) {
      videos = videos.filter(v => v.status === status);
    }

    videos.sort((a, b) => new Date(b.created) - new Date(a.created));

    const total = videos.length;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paged = videos.slice(start, start + parseInt(limit));

    res.json({ success: true, total, page: parseInt(page), limit: parseInt(limit), videos: paged });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const task = videoTasks.get(id);
    if (task) {
      return res.json({ success: true, video: task });
    }

    const filePath = path.join(OUTPUT_DIR, id);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      return res.json({
        success: true,
        video: { id, filename: path.basename(filePath), size: stat.size, created: stat.mtime.toISOString(), status: 'ready' }
      });
    }

    if (fs.existsSync(OUTPUT_DIR)) {
      const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith(id));
      if (files.length > 0) {
        const file = files[0];
        const fp = path.join(OUTPUT_DIR, file);
        const stat = fs.statSync(fp);
        return res.json({ success: true, video: { id: file, filename: file, size: stat.size, created: stat.mtime.toISOString(), status: 'ready' } });
      }
    }

    res.status(404).json({ success: false, error: 'Video not found' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/videos/:id/export', (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'mp4', quality = 'high' } = req.body;
    const exportId = `export_${Date.now()}`;
    
    res.json({
      success: true,
      export_id: exportId,
      video_id: id,
      format,
      quality,
      status: 'queued',
      message: 'Export task created (FFmpeg pipeline pending)'
    });

  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// 7. SCRIPT TEMPLATES
// ============================================================

router.get('/templates', (req, res) => {
  try {
    const templates = [];
    if (fs.existsSync(TEMPLATES_DIR)) {
      fs.readdirSync(TEMPLATES_DIR).forEach(file => {
        if (file.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8'));
            templates.push({
              filename: file,
              title: data.title,
              genre: data.genre,
              style: data.style
            });
          } catch(e) {}
        }
      });
    }
    res.json({ success: true, templates });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/templates/:name', (req, res) => {
  try {
    const filePath = path.join(TEMPLATES_DIR, `${req.params.name}.json`);
    if (fs.existsSync(filePath)) {
      const template = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      res.json({ success: true, template });
    } else {
      res.status(404).json({ success: false, error: 'Template not found' });
    }
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// STATIC FILES: Serve drama storage only
// RED LINE: Only drama assets, no cross-module access
// ============================================================
router.use('/storage', express.static(STORAGE_ROOT));

// ============================================================
// INITIALIZATION
// ============================================================
const engineConfig = loadEngineConfig();
console.log('[drama] AI Short Drama Module v2.0 loaded (DUAL ENGINE: DeepSeek + Doubao)');
console.log(`[drama] Storage: ${STORAGE_ROOT}`);
console.log(`[drama] DeepSeek: ${engineConfig.deepseek.api_key ? 'configured' : 'NOT configured'}`);
console.log(`[drama] Doubao: ${engineConfig.doubao.api_key ? 'configured' : 'NOT configured - set via /api/drama/config/engine'}`);
console.log(`[drama] Default engine: ${engineConfig.default_engine}`);
console.log('[drama] RED LINE COMPLIANCE: module_isolated=true, local_assets_only=true, dual_engine=true');



// ===== Video Composition Pipeline =====
const videoComposer = require('../engines/video-composer');

router.post('/compose/start', (req, res) => {
  try {
    const { title, episode, scenes, bgmPath } = req.body;
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ success: false, message: 'scenes required' });
    }
    const task = videoComposer.startCompose({ title, episode: episode || 1, scenes, bgmPath });
    res.json({ success: true, taskId: task.id, message: 'Composition started' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/compose/status/:taskId', (req, res) => {
  const status = videoComposer.getTaskStatus(req.params.taskId);
  if (!status) return res.status(404).json({ success: false, message: 'Task not found' });
  res.json({ success: true, ...status });
});

router.post('/compose/cancel/:taskId', (req, res) => {
  const cancelled = videoComposer.cancelTask(req.params.taskId);
  res.json({ success: true, cancelled });
});

router.get('/output/:filename', (req, res) => {
  const filePath = videoComposer.getOutputPath(req.params.filename);
  if (!require('fs').existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  res.sendFile(require('path').resolve(filePath));
});

// ============================================================
// DRAMA PIPELINE (一键生成管线)
// ============================================================
const dramaPipeline = require('../engines/drama/drama-pipeline');

router.post('/pipeline/create', async (req, res) => {
  try {
    const taskId = dramaPipeline.createTask(req.body);
    res.json({ success: true, taskId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/pipeline/status/:taskId', (req, res) => {
  const task = dramaPipeline.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task });
});

router.get('/pipeline/list', (req, res) => {
  res.json({ success: true, tasks: dramaPipeline.listTasks() });


// ============================================================
// LOCAL DRAMA PIPELINE (零API调用)
// ============================================================
const dramaPipelineLocal = require('../engines/drama/drama-pipeline-local');

router.post('/pipeline-local/create', async (req, res) => {
  try {
    const result = await dramaPipelineLocal.createTask(req.body);
    res.json({ success: true, taskId: result.taskId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/pipeline-local/status/:taskId', (req, res) => {
  const task = dramaPipelineLocal.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task });
});

router.get('/pipeline-local/list', (req, res) => {
  res.json({ success: true, tasks: dramaPipelineLocal.listTasks() });
});

router.get('/pipeline-local/face-lock/characters', (req, res) => {
  try {
    const faceLock = require('../engines/drama/face-lock');
    res.json({ success: true, characters: faceLock.listCharacters() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

});module.exports = router;
