"use strict";
/* ==================================================================
   1. 기반 — 상태 · 저장 · 유틸
   ================================================================== */
const $  = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,10);
const tok = s => Math.ceil(String(s||'').length/3);
const clone = o => JSON.parse(JSON.stringify(o));

const KEY = 'orrery.v1';
const DRAFT_KEY = 'orrery.draft.v1';
const OLDKEYS = ['vivarium.v1','terrarium.v1','casting.v1'];
let S = {
  connections: [], activeConn: null,
  assets: [], assetFolders: [],
  presets: [], activePreset: null,
  opts: { mode:'w2c', modeBy:{world:'new',character:'w2c',prompt:'new'}, buildMode:'staged', lang:'한국어', tone:'', seedCount:5, castCount:3, nsfw:false, extra:'', extraBy:{world:'',character:'',prompt:''}, check:true, brief:'', group:'world' },
  project: { digest:null, digestSrc:'', seeds:[], sel:[], card:null, locked:{}, violations:null, verdict:null, cast:[], relations:null, qa:[], libId:null, digestBy:{}, digestMeta:null },
  library: [],
  chat: { role:'world', msgs:[], ctx:{assets:true, digest:true, card:false} },
  customTalkPrompts: {},
  logVerbose: false
};
let LOG = [];
let ABORT = null;
let LAST_USAGE = null;
let LAST_RAW = '', LAST_RAW_AT = 0;
let DRAFT_DIRTY = false, DRAFT_TIMER = null, BOOTING = true;

const ASSET_PURPOSE_LABEL = {world:'세계', character:'인물', prompt:'프롬프트'};
const ASSET_PURPOSE_KEYS = Object.keys(ASSET_PURPOSE_LABEL);
function defaultAssetPurposes(kind){
  return kind==='character' ? ['character'] : kind==='lorebook' ? ['world'] : [];
}
function cleanAssetPurposes(value, kind){
  if(!Array.isArray(value)) return defaultAssetPurposes(kind);
  return [...new Set(value.map(String).filter(x=>ASSET_PURPOSE_KEYS.includes(x)))];
}
function cleanAssetTags(value){
  const raw=Array.isArray(value) ? value : String(value||'').split(',');
  const seen=new Set(), out=[];
  raw.forEach(item=>{
    const tag=String(item||'').trim().replace(/^#+/,'').replace(/\s+/g,' ').slice(0,40);
    const key=tag.toLocaleLowerCase();
    if(!tag || seen.has(key) || out.length>=24) return;
    seen.add(key); out.push(tag);
  });
  return out;
}
function normalizeAssetMetadata(a){
  if(!a || typeof a!=='object') return a;
  a.purposes=cleanAssetPurposes(a.purposes,a.kind);
  a.tags=cleanAssetTags(a.tags);
  return a;
}
function assetCore(a){
  normalizeAssetMetadata(a);
  const out = {id:a.id, kind:a.kind, name:a.name||'', use:a.use!==false,
    purposes:clone(a.purposes), tags:clone(a.tags)};
  if(a.kind==='character') out.fields = clone(a.fields||{});
  else if(a.kind==='lorebook') out.entries = clone(a.entries||[]);
  else out.body = a.body||'';
  if(a.from) out.from = a.from;
  if(a.favorite) out.favorite = true;
  if(a.favorite && a.folderId) out.folderId = a.folderId;
  return out;
}
function ensureAssetOriginal(a){
  normalizeAssetMetadata(a);
  if(!a.original) a.original = assetCore(a);
  else normalizeAssetMetadata(a.original);
  return a;
}
function normalizeAssetFolders(){
  const seen=new Set();
  S.assetFolders=(Array.isArray(S.assetFolders)?S.assetFolders:[]).filter(f=>{
    if(!f || !f.id || !String(f.name||'').trim() || seen.has(f.id)) return false;
    f.name=String(f.name).trim(); seen.add(f.id); return true;
  });
  const ids=new Set(S.assetFolders.map(f=>f.id));
  S.assets.forEach(a=>{
    normalizeAssetMetadata(a);
    a.favorite=!!a.favorite;
    if(!a.favorite || !ids.has(a.folderId)) delete a.folderId;
  });
}
function mergeAssetsWithFavorites(workAssets, favoriteAssets){
  const out=(Array.isArray(workAssets)?workAssets:[]).map(a=>ensureAssetOriginal(clone(a)));
  const byId=new Map(out.map((a,i)=>[a.id,i]));
  (Array.isArray(favoriteAssets)?favoriteAssets:[]).forEach(saved=>{
    const fav=ensureAssetOriginal(clone(saved)); fav.favorite=true;
    if(byId.has(fav.id)){
      const current=out[byId.get(fav.id)]; current.favorite=true;
      if(!current.folderId && fav.folderId) current.folderId=fav.folderId;
    }else{ byId.set(fav.id,out.length); out.push(fav); }
  });
  return out;
}
function mergeAssetsById(primaryAssets, fallbackAssets){
  const out=(Array.isArray(primaryAssets)?primaryAssets:[]).map(a=>ensureAssetOriginal(clone(a)));
  const byId=new Map(out.map((a,i)=>[a.id,i]));
  (Array.isArray(fallbackAssets)?fallbackAssets:[]).forEach(saved=>{
    const item=ensureAssetOriginal(clone(saved));
    if(byId.has(item.id)){
      const current=out[byId.get(item.id)];
      if(item.favorite){ current.favorite=true; if(!current.folderId&&item.folderId) current.folderId=item.folderId; }
    }else{ byId.set(item.id,out.length); out.push(item); }
  });
  return out;
}
function hasDraftWork(){
  const p=S.project||{};
  const extra=(S.opts.extraBy&&S.opts.extraBy[S.opts.group])||'';
  return !!((S.opts.brief||'').trim() || extra.trim() || p.digest || (p.seeds&&p.seeds.length) || p.card || (p.cast&&p.cast.length));
}
function saveDraftNow(){
  clearTimeout(DRAFT_TIMER); DRAFT_TIMER=null;
  if(!DRAFT_DIRTY) return;
  if(!hasDraftWork()){ clearDraft(); return; }
  const base = {version:1, at:Date.now(), activePreset:S.activePreset, opts:clone(S.opts), project:clone(S.project)};
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(base)); }
  catch(e){ log('마지막 작업 임시 저장에 실패했습니다.','err'); }
}
function touchDraft(){
  if(BOOTING) return;
  if(!hasDraftWork()){ clearDraft(); return; }
  DRAFT_DIRTY=true; clearTimeout(DRAFT_TIMER);
  DRAFT_TIMER=setTimeout(saveDraftNow,450);
}
function clearDraft(){
  clearTimeout(DRAFT_TIMER); DRAFT_TIMER=null; DRAFT_DIRTY=false;
  try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
}
function offerDraftRestore(){
  let d=null;
  try{ const raw=localStorage.getItem(DRAFT_KEY); if(raw) d=JSON.parse(raw); }catch(e){ clearDraft(); }
  if(!d || !d.project) return false;
  const when = d.at ? new Date(d.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '이전 방문';
  if(!confirm(`${when}에 저장하지 않고 끝낸 작업이 있습니다.\n이전 작업물을 불러올까요?`)){ clearDraft(); return false; }
  if(d.opts) Object.assign(S.opts,d.opts);
  if(d.activePreset) S.activePreset=d.activePreset;
  S.project=Object.assign(S.project,d.project||{});
  if(Array.isArray(d.assets)) S.assets=mergeAssetsById(d.assets,S.assets);
  normalizeAssetFolders();
  DRAFT_DIRTY=true;
  return true;
}

function save(){
  normalizeAssetFolders();
  try{ localStorage.setItem(KEY, JSON.stringify({
    connections:S.connections, activeConn:S.activeConn,
    presets:S.presets, activePreset:S.activePreset,
    opts:S.opts, library:S.library, chat:S.chat, customTalkPrompts:S.customTalkPrompts, logVerbose:S.logVerbose,
    assetFolders:S.assetFolders,
    assets:S.assets.map(a=>clone(ensureAssetOriginal(a)))
  })); }catch(e){ log('저장 실패 — 이 브라우저는 로컬 저장을 막고 있습니다. 설정을 파일로 내보내 두세요.','err'); }
}
function load(){
  try{
    let raw = localStorage.getItem(KEY);
    if(!raw) for(const k of OLDKEYS){ raw = localStorage.getItem(k); if(raw) break; }
    if(!raw) return false;
    const d = JSON.parse(raw);
    if(d.connections) S.connections = d.connections;
    if(d.activeConn)  S.activeConn  = d.activeConn;
    if(d.presets && d.presets.length) S.presets = d.presets;
    if(d.activePreset) S.activePreset = d.activePreset;
    if(d.opts) Object.assign(S.opts, d.opts);
    if(S.opts.mode==='c2p') S.opts.mode='foil';
    if(!S.opts.modeBy) S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'};
    if(d.library) S.library = d.library.map(r=>Object.assign({
      star:false, group:'character', presetName:'', updated:r.at||Date.now() }, r));
    if(d.chat) S.chat = Object.assign(S.chat, d.chat);
    if(d.customTalkPrompts) S.customTalkPrompts = d.customTalkPrompts;
    if(d.logVerbose) S.logVerbose = d.logVerbose;
    if(Array.isArray(d.assetFolders)) S.assetFolders=clone(d.assetFolders);
    if(Array.isArray(d.assets)) S.assets=d.assets.map(a=>ensureAssetOriginal(clone(a)));
    else if(Array.isArray(d.favoriteAssets)) S.assets=mergeAssetsWithFavorites(S.assets,d.favoriteAssets);
    normalizeAssetFolders();
    return true;
  }catch(e){ return false; }
}

function toast(msg, bad){
  const t = $('#toast'); t.textContent = msg;
  t.className = 'on' + (bad?' err':'');
  clearTimeout(t._h); t._h = setTimeout(()=>{ t.className=''; }, 3400);
}
function log(msg, kind){
  const ts = new Date().toTimeString().slice(0,8);
  LOG.push({ts, msg:String(msg), kind:kind||'i'});
  if(LOG.length>400) LOG.shift();
  const box = $('#logBox');
  if(box && $('#v-log').classList.contains('on')) renderLog();
}
function renderLog(){
  $('#logBox').innerHTML = LOG.map(l =>
    `<span class="l-t">${l.ts}</span> <span class="l-${l.kind}">${esc(l.msg)}</span>`
  ).join('\n') || '<span class="l-i">아직 기록이 없습니다.</span>';
  $('#logBox').scrollTop = $('#logBox').scrollHeight;
}
function responseUsage(j){
  const meta = j && j.meta || {};
  const u = (j && (j.usage || j.usageMetadata)) || meta.billed_units || meta.tokens || {};
  const numberFrom = (...values)=>{
    for(const value of values){
      if(value===undefined || value===null || value==='') continue;
      const n=Number(value); if(Number.isFinite(n)) return n;
    }
    return null;
  };
  const input = numberFrom(u.prompt_tokens, u.input_tokens, u.promptTokenCount, u.inputTokens);
  const output = numberFrom(u.completion_tokens, u.output_tokens, u.candidatesTokenCount, u.outputTokens);
  const total = numberFrom(u.total_tokens, u.totalTokenCount, u.totalTokens,
    input!=null && output!=null ? input+output : null);
  return input==null && output==null && total==null ? null : {input, output, total};
}
function usageLabel(u){
  if(!u) return '';
  const parts=[];
  if(u.input!=null) parts.push(`입력 ${u.input}`);
  if(u.output!=null) parts.push(`출력 ${u.output}`);
  if(u.total!=null && (!parts.length || u.input==null || u.output==null || u.total!==u.input+u.output)) parts.push(`합계 ${u.total}`);
  return parts.join(' · ')+' 토큰';
}
function dl(name, text, mime){
  const b = new Blob([text], {type: mime||'application/json;charset=utf-8'});
  const u = URL.createObjectURL(b);
  const a = document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u), 1500);
}
function dlBlob(name, blob){
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u), 1500);
}
async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast('복사했습니다'); }
  catch(e){
    const t=document.createElement('textarea'); t.value=text; document.body.appendChild(t);
    t.select(); try{document.execCommand('copy'); toast('복사했습니다');}catch(_){toast('복사 실패',1);}
    t.remove();
  }
}
function busy(btn, on, label){
  if(!btn) return;
  if(on){ btn._t = btn.innerHTML; btn.innerHTML = '<span class="busy"></span>'+(label||'하는 중'); btn.disabled = true; }
  else  { if(btn._t) btn.innerHTML = btn._t; btn.disabled = false; }
}

/* ==================================================================
   2. 프로바이더 — 텍스트 연결
   ================================================================== */
const OAI_LIKE = (base, keyHeader) => ({
  base,
  chat(c, msgs, o){
    const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
    const rest = msgs.filter(m=>m.role!=='system');
    const body = {
      model: c.model,
      messages: sys ? [{role:'system',content:sys}, ...rest] : rest,
      temperature: o.temperature ?? 0.9,
      max_tokens: o.maxTokens || 2400
    };
    if(o.topP != null) body.top_p = o.topP;
    return {
      url: (c.baseUrl || base).replace(/\/$/,'') + '/chat/completions',
      headers: Object.assign({'Content-Type':'application/json'},
        c.apiKey ? (keyHeader ? keyHeader(c) : {Authorization:'Bearer '+c.apiKey}) : {}),
      body
    };
  },
  parse(j){
    const ch = j.choices && j.choices[0];
    if(!ch) return '';
    return (ch.message && (ch.message.content ?? ch.message.reasoning_content)) || ch.text || '';
  },
  models(c){
    return { url:(c.baseUrl||base).replace(/\/$/,'')+'/models',
      headers: c.apiKey ? (keyHeader ? keyHeader(c) : {Authorization:'Bearer '+c.apiKey}) : {},
      parse: j => (j.data||j.models||[]).map(m=>m.id||m.name).filter(Boolean) };
  }
});

const PROV = {
  openai: { label:'OpenAI', base:'https://api.openai.com/v1',
    mlist:['gpt-4o','gpt-4o-mini','gpt-4.1','o3-mini'], ...OAI_LIKE('https://api.openai.com/v1') },

  anthropic: { label:'Anthropic (Claude)', base:'https://api.anthropic.com/v1',
    mlist:['claude-sonnet-4-5','claude-opus-4-1','claude-3-5-haiku-latest'],
    chat(c,msgs,o){
      const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
      const rest = msgs.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.content}));
      const body = { model:c.model, max_tokens:o.maxTokens||2400, temperature:o.temperature ?? 0.9,
                     messages: rest.length?rest:[{role:'user',content:' '}] };
      if(o.topP != null) body.top_p = o.topP;
      if(sys) body.system = sys;
      return { url:(c.baseUrl||'https://api.anthropic.com/v1').replace(/\/$/,'')+'/messages',
        headers:{'Content-Type':'application/json','x-api-key':c.apiKey,
                 'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body };
    },
    parse(j){ return (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''); },
    models(c){ return { url:(c.baseUrl||'https://api.anthropic.com/v1').replace(/\/$/,'')+'/models',
      headers:{'x-api-key':c.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      parse:j=>(j.data||[]).map(m=>m.id) }; } },

  gemini: { label:'Google Gemini', base:'https://generativelanguage.googleapis.com/v1beta',
    mlist:['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash'],
    chat(c,msgs,o){
      const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
      const contents = msgs.filter(m=>m.role!=='system')
        .map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
      const body = { contents: contents.length?contents:[{role:'user',parts:[{text:' '}]}],
        generationConfig:Object.assign({ temperature:o.temperature ?? 0.9, maxOutputTokens:o.maxTokens||2400 },
          o.topP!=null?{topP:o.topP}:{}),
        safetySettings:['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT']
          .map(x=>({category:x,threshold:'BLOCK_NONE'})) };
      if(sys) body.systemInstruction = {parts:[{text:sys}]};
      const b=(c.baseUrl||'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
      return { url:`${b}/models/${encodeURIComponent(c.model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`,
        headers:{'Content-Type':'application/json'}, body };
    },
    parse(j){ const cd=(j.candidates||[])[0]; if(!cd) return '';
      return ((cd.content&&cd.content.parts)||[]).map(p=>p.text||'').join(''); },
    models(c){ const b=(c.baseUrl||'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
      return { url:`${b}/models?key=${encodeURIComponent(c.apiKey)}`, headers:{},
        parse:j=>(j.models||[]).map(m=>String(m.name).replace(/^models\//,'')) }; } },

  vertex: { label:'Google Vertex AI', base:'', needs:['project','location','accessToken'],
    mlist:['gemini-2.5-pro','gemini-2.5-flash'],
    chat(c,msgs,o){
      const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
      const contents = msgs.filter(m=>m.role!=='system')
        .map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
      const body = { contents, generationConfig:{temperature:o.temperature ?? 0.9, maxOutputTokens:o.maxTokens||2400} };
      if(sys) body.systemInstruction = {parts:[{text:sys}]};
      const loc = c.location||'us-central1';
      return { url:`https://${loc}-aiplatform.googleapis.com/v1/projects/${c.project}/locations/${loc}/publishers/google/models/${c.model}:generateContent`,
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.apiKey}, body };
    },
    parse(j){ const cd=(j.candidates||[])[0]; if(!cd) return '';
      return ((cd.content&&cd.content.parts)||[]).map(p=>p.text||'').join(''); },
    models(){ return null; } },

  openrouter: { label:'OpenRouter', base:'https://openrouter.ai/api/v1',
    mlist:['anthropic/claude-sonnet-4.5','google/gemini-2.5-pro','openai/gpt-4o','deepseek/deepseek-chat'],
    ...OAI_LIKE('https://openrouter.ai/api/v1', c=>({Authorization:'Bearer '+c.apiKey,'X-Title':'Orrery'})) },

  nanogpt: { label:'NanoGPT', base:'https://nano-gpt.com/api/v1',
    mlist:['chatgpt-4o-latest','claude-sonnet-4-5','deepseek-chat'], ...OAI_LIKE('https://nano-gpt.com/api/v1') },

  mistral: { label:'Mistral', base:'https://api.mistral.ai/v1',
    mlist:['mistral-large-latest','mistral-medium-latest','open-mistral-nemo'], ...OAI_LIKE('https://api.mistral.ai/v1') },

  cohere: { label:'Cohere', base:'https://api.cohere.com/v2',
    mlist:['command-a-03-2025','command-r-plus'],
    chat(c,msgs,o){
      return { url:(c.baseUrl||'https://api.cohere.com/v2').replace(/\/$/,'')+'/chat',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.apiKey},
        body:Object.assign({ model:c.model, messages:msgs.map(m=>({role:m.role,content:m.content})),
               temperature:o.temperature ?? 0.9, max_tokens:o.maxTokens||2400 }, o.topP!=null?{p:o.topP}:{}) };
    },
    parse(j){ const m=j.message; if(!m) return j.text||'';
      return (m.content||[]).map(b=>b.text||'').join(''); },
    models(c){ return { url:'https://api.cohere.com/v1/models?endpoint=chat',
      headers:{Authorization:'Bearer '+c.apiKey}, parse:j=>(j.models||[]).map(m=>m.name) }; } },

  xai: { label:'xAI / Grok', base:'https://api.x.ai/v1',
    mlist:['grok-4','grok-3','grok-3-mini'], ...OAI_LIKE('https://api.x.ai/v1') },

  together: { label:'Together AI', base:'https://api.together.xyz/v1',
    mlist:['deepseek-ai/DeepSeek-V3','meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    ...OAI_LIKE('https://api.together.xyz/v1') },

  venice: { label:'Venice.ai', base:'https://api.venice.ai/api/v1',
    mlist:['llama-3.3-70b','venice-uncensored'], ...OAI_LIKE('https://api.venice.ai/api/v1') },

  pollinations: { label:'Pollinations (무료·키 없음)', base:'https://text.pollinations.ai/openai',
    mlist:['openai','openai-large','mistral'], noKey:true, ...OAI_LIKE('https://text.pollinations.ai/openai') },

  local: { label:'로컬 (Ollama · LM Studio · koboldcpp)', base:'http://localhost:11434/v1',
    mlist:[], noKey:true, ...OAI_LIKE('http://localhost:11434/v1') },

  custom: { label:'커스텀 (OpenAI 호환)', base:'', ...OAI_LIKE('') }
};
const PROV_ORDER = ['openai','anthropic','gemini','vertex','openrouter','nanogpt','mistral',
                    'cohere','xai','together','venice','pollinations','local','custom'];

/* --- 호출 --- */
async function callProvider(conn, messages, opts){
  const p = PROV[conn.provider];
  if(!p) throw new Error('알 수 없는 연결 종류: '+conn.provider);
  if(!conn.model) throw new Error('모델을 고르지 않았습니다.');
  if(!p.noKey && !conn.apiKey) throw new Error('API 키가 비어 있습니다.');
  const o = Object.assign({}, opts||{});
  if(conn.maxTokens)         o.maxTokens   = conn.maxTokens;
  if(conn.temperature!=null) o.temperature = conn.temperature;
  if(conn.topP!=null)        o.topP        = conn.topP;
  const est = messages.reduce((a,m)=>a+tok(m.content),0);
  if(conn.contextLimit){
    const room = conn.contextLimit - (o.maxTokens||2000);
    if(est > room){
      throw new Error(`보낼 분량이 컨텍스트 상한을 넘습니다 (보낼 것 ${est} + 응답 ${o.maxTokens||2000} > ${conn.contextLimit}). ` +
        '재료 탭에서 항목을 줄이거나, 세계 읽기를 먼저 해서 요약본으로 돌리세요.');
    }
    if(est > room*0.85) log(`컨텍스트 여유가 적습니다 — 보낼 것 ${est} / 상한 ${conn.contextLimit}`,'err');
  }
  const req = p.chat(conn, messages, o);
  LAST_USAGE = null;
  ABORT = new AbortController();
  const t0 = Date.now();
  log(`→ ${p.label} / ${conn.model} · 보낼 것 ${est} 토큰쯤 · 응답 상한 ${o.maxTokens||2000}`);
  if(S.logVerbose) log(messages.map(m=>`[${m.role}]\n${m.content}`).join('\n---\n'));
  let res;
  try{
    res = await fetch(req.url, { method:'POST', headers:req.headers,
      body: JSON.stringify(req.body), signal: ABORT.signal });
  }catch(e){
    if(e.name==='AbortError') throw new Error('__ABORT__');
    log('연결 실패: '+e.message,'err');
    throw new Error('서버에 닿지 못했습니다. 브라우저가 요청을 막았거나(CORS) 주소가 틀렸을 수 있습니다. 상단 ? 단추의 안내를 보세요.');
  }
  const txt = await res.text();
  if(!res.ok){
    log(`← ${res.status} ${txt.slice(0,600)}`,'err');
    let detail = txt.slice(0,300);
    try{ const j=JSON.parse(txt); detail = (j.error&&(j.error.message||j.error))||j.message||detail; }catch(_){}
    throw new Error(`${res.status} · ${detail}`);
  }
  let j; try{ j = JSON.parse(txt); }catch(e){ throw new Error('응답이 JSON이 아닙니다: '+txt.slice(0,200)); }
  LAST_USAGE = responseUsage(j);
  const out = p.parse(j) || '';
  log(`← ${out.length}자${LAST_USAGE?' · '+usageLabel(LAST_USAGE):''} · ${((Date.now()-t0)/1000).toFixed(1)}초`,'ok');
  if(S.logVerbose) log(out);
  if(!out.trim()) throw new Error('모델이 빈 응답을 돌려줬습니다. (필터에 걸렸거나 토큰이 모자랐을 수 있습니다)');
  LAST_RAW = out; LAST_RAW_AT = Date.now();
  return out;
}
async function fetchModels(conn){
  const p = PROV[conn.provider]; if(!p || !p.models) return null;
  const spec = p.models(conn); if(!spec) return null;
  const res = await fetch(spec.url, {headers:spec.headers});
  if(!res.ok) throw new Error(res.status+' '+(await res.text()).slice(0,200));
  return spec.parse(await res.json());
}

/* ==================================================================
   3. 재료 읽기 — PNG · CHARX · JSON · 텍스트
   ================================================================== */
function b64bytes(s){
  const bin = atob(String(s).replace(/[\s\n\r]/g,''));
  const u = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return u;
}
const utf8 = b => new TextDecoder('utf-8').decode(b);

async function inflate(bytes, raw){
  if(typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다.');
  const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
  const st = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(st).arrayBuffer());
}

/* --- PNG tEXt/zTXt/iTXt 읽기 --- */
async function pngChunks(buf){
  const out = {};
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  while(p + 8 <= buf.length){
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p+4],buf[p+5],buf[p+6],buf[p+7]);
    const ds = p+8, de = ds+len;
    if(de > buf.length) break;
    if(type==='tEXt' || type==='zTXt' || type==='iTXt'){
      let i = ds; while(i<de && buf[i]!==0) i++;
      const kw = utf8(buf.slice(ds,i));
      try{
        if(type==='tEXt')      out[kw] = utf8(buf.slice(i+1,de));
        else if(type==='zTXt') out[kw] = utf8(await inflate(buf.slice(i+2,de)));
        else {
          let q = i+1; q += 2;                       // compression flag + method
          while(q<de && buf[q]!==0) q++; q++;        // language tag
          while(q<de && buf[q]!==0) q++; q++;        // translated keyword
          out[kw] = buf[i+1]===1 ? utf8(await inflate(buf.slice(q,de))) : utf8(buf.slice(q,de));
        }
      }catch(e){ log('PNG 청크 '+kw+' 해석 실패: '+e.message,'err'); }
    }
    if(type==='IEND') break;
    p = de + 4;
  }
  return out;
}

/* --- ZIP(CHARX) 최소 읽기 --- */
async function zipEntries(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eo = -1;
  for(let i=buf.length-22;i>=0 && i>buf.length-70000;i--){
    if(dv.getUint32(i,true)===0x06054b50){ eo=i; break; }
  }
  if(eo<0) throw new Error('ZIP 구조를 찾지 못했습니다.');
  const n = dv.getUint16(eo+10,true);
  let p = dv.getUint32(eo+16,true);
  const list = [];
  for(let k=0;k<n;k++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method = dv.getUint16(p+10,true);
    const csize  = dv.getUint32(p+20,true);
    const nlen   = dv.getUint16(p+28,true);
    const elen   = dv.getUint16(p+30,true);
    const clen   = dv.getUint16(p+32,true);
    const lho    = dv.getUint32(p+42,true);
    const name   = utf8(buf.slice(p+46,p+46+nlen));
    list.push({name, method, csize, lho});
    p += 46+nlen+elen+clen;
  }
  for(const e of list){
    const ln = dv.getUint16(e.lho+26,true), le = dv.getUint16(e.lho+28,true);
    const start = e.lho+30+ln+le;
    const raw = buf.slice(start, start+e.csize);
    e.data = e.method===0 ? raw : await inflate(raw, true);
  }
  return list;
}

/* --- 로어북 엔트리 정규화 --- */
function normEntries(src){
  let arr = [];
  if(Array.isArray(src)) arr = src;
  else if(src && typeof src==='object') arr = Object.values(src);
  return arr.map((e,i)=>{
    if(!e || typeof e!=='object') return null;
    const keys = e.keys || e.key || e.keywords || [];
    const content = e.content || e.entry || e.text || '';
    if(!content) return null;
    return {
      id: 'e'+i+uid(),
      keys: Array.isArray(keys) ? keys : String(keys).split(',').map(s=>s.trim()).filter(Boolean),
      content: String(content),
      comment: e.comment || e.name || e.title || '',
      constant: !!(e.constant || e.alwaysActive),
      enabled: e.enabled !== false && e.disable !== true,
      order: e.insertion_order ?? e.order ?? i
    };
  }).filter(Boolean);
}
function looksLikeEntries(v){
  const a = Array.isArray(v) ? v : (v && typeof v==='object' ? Object.values(v) : []);
  if(!a.length) return false;
  const s = a.slice(0,5);
  return s.some(e => e && typeof e==='object' &&
    (('content' in e)||('entry' in e)) && (('keys' in e)||('key' in e)||('keywords' in e)||('constant' in e)));
}
/* 설정이 아니라 AI에게 내리는 명령으로 보이는 항목 */
const CMD_PAT = /(\bOOC\b|\[System|<system|당신은\s|너는\s+반드시|출력하라|출력할\s*것|절대\s|반드시\s|금지한다|응답은|assistant는|\{\{char\}\}는\s*반드시|Do not |You must |You are an? (AI|assistant)|NEVER |ALWAYS )/i;
function suspectEntry(e){
  if(!e.keys.length && !e.constant) return true;
  if(e.constant && e.content.length>320) return true;
  return CMD_PAT.test(e.content.slice(0,600));
}

/* --- 카드 정규화 --- */
function cardAsset(data, fallbackName){
  const d = (data && data.data && typeof data.data==='object') ? data.data : data;
  const out = [];
  const fields = {};
  ['description','personality','scenario','first_mes','mes_example','system_prompt','creator_notes']
    .forEach(k=>{ if(d[k]) fields[k]=String(d[k]); });
  if(Array.isArray(d.alternate_greetings) && d.alternate_greetings.length)
    fields.alternate_greetings = d.alternate_greetings.join('\n\n');
  out.push({ id:uid(), kind:'character', name: d.name || fallbackName || '이름 없는 카드',
             fields, use:true, raw:d });
  const book = d.character_book || d.characterBook;
  if(book && (book.entries)){
    const en = normEntries(book.entries);
    if(en.length) out.push({ id:uid(), kind:'lorebook',
      name:(d.name||fallbackName||'카드')+' 내장 로어북', from:'embedded',
      entries: en.map(e=>({...e, use: !suspectEntry(e)})), use:true });
  }
  return out;
}
function isCard(j){
  if(!j || typeof j!=='object') return false;
  if(j.spec && /chara_card/.test(j.spec)) return true;
  const d = j.data && typeof j.data==='object' ? j.data : j;
  return !!(d.name && (d.description || d.first_mes || d.personality));
}
function fromJson(j, fname){
  if(isCard(j)) return cardAsset(j, fname);
  if(j && j.entries && looksLikeEntries(j.entries)){
    const en = normEntries(j.entries);
    return [{ id:uid(), kind:'lorebook', name: j.name || fname || '로어북',
      entries: en.map(e=>({...e, use: !suspectEntry(e)})), use:true }];
  }
  if(looksLikeEntries(j)){
    const en = normEntries(j);
    return [{ id:uid(), kind:'lorebook', name: fname || '로어북',
      entries: en.map(e=>({...e, use: !suspectEntry(e)})), use:true }];
  }
  if(Array.isArray(j) && j.some(isCard)) {
    let out=[]; j.filter(isCard).forEach(c=>{ out = out.concat(cardAsset(c, fname)); }); return out;
  }
  return [{ id:uid(), kind:'text', name: fname||'텍스트', body: JSON.stringify(j,null,2), use:true }];
}

async function sniff(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  const base = file.name.replace(/\.[^.]+$/,'');
  if(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47){
    const ch = await pngChunks(buf);
    const key = ch.ccv3 ? 'ccv3' : (ch.chara ? 'chara' : Object.keys(ch)[0]);
    if(!key) throw new Error('이 PNG에는 카드 정보가 없습니다.');
    let txt;
    try{ txt = utf8(b64bytes(ch[key])); }catch(e){ txt = ch[key]; }
    return fromJson(JSON.parse(txt), base);
  }
  if(buf[0]===0x50 && buf[1]===0x4B){
    const es = await zipEntries(buf);
    const cj = es.find(e=>/(^|\/)card\.json$/i.test(e.name)) || es.find(e=>/\.json$/i.test(e.name));
    if(!cj) throw new Error('CHARX 안에서 card.json을 찾지 못했습니다.');
    return fromJson(JSON.parse(utf8(cj.data)), base);
  }
  const text = utf8(buf);
  try{ return fromJson(JSON.parse(text), base); }
  catch(e){ return [{ id:uid(), kind:'text', name:file.name, body:text, use:true }]; }
}

/* --- 재료 → 프롬프트용 텍스트 --- */
function sourceText(){
  const parts = [];
  if(S.opts.brief && S.opts.brief.trim()) parts.push('## 구상\n'+S.opts.brief.trim());
  for(const a of S.assets){
    if(!a.use) continue;
    if(a.kind==='character'){
      const f = a.fields;
      parts.push(`## 캐릭터: ${a.name}\n` +
        Object.keys(f).map(k=>`### ${k}\n${f[k]}`).join('\n\n'));
    }else if(a.kind==='lorebook'){
      const on = a.entries.filter(e=>e.use);
      if(!on.length) continue;
      parts.push(`## 설정집: ${a.name}\n` + on.map(e=>{
        const label = e.comment || (e.keys[0]||'항목');
        return `### ${label}${e.keys.length?` [${e.keys.join(', ')}]`:''}\n${e.content}`;
      }).join('\n\n'));
    }else{
      parts.push(`## 자료: ${a.name}\n${a.body}`);
    }
  }
  return parts.join('\n\n');
}
function activeMode(){
  const by = S.opts.modeBy || (S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'});
  return by[S.opts.group] || (S.opts.group==='character' ? 'w2c' : 'new');
}
function assetStats(){
  const t = sourceText();
  return { chars:t.length, tokens:tok(t),
    chars_n: S.assets.filter(a=>a.kind==='character'&&a.use).length,
    books_n: S.assets.filter(a=>a.kind==='lorebook'&&a.use).length };
}

/* ==================================================================
   4. 프리셋 · 프롬프트 · 공정
   ================================================================== */
function defaultPreset(){
  return {
  id:'default', name:'기본 카드', group:'character', kind:'character', needs:'optional',
  schema:[
    {key:'name',        label:'이름',     hint:'세계의 명명 규칙을 따를 것. 성씨·호칭 관습 포함'},
    {key:'appearance',  label:'외모',     hint:'3~4문장. 옷·몸·버릇에 신분과 직업이 드러날 것'},
    {key:'personality', label:'성격',     hint:'서로 어긋나는 면을 반드시 하나 포함'},
    {key:'speech',      label:'말투',     hint:'특징 설명 + 실제 대사 예시 2개'},
    {key:'background',  label:'배경',     hint:'세계의 사건·세력과 최소 하나 이상 맞물릴 것'},
    {key:'secret',      label:'비밀',     hint:'본인만 알고 있는 것. 언젠가 터질 것'},
    {key:'first_mes',   label:'첫 대사',  hint:'상대와 처음 마주치는 장면. 3~6문장'}
  ],
  stages:{
    digest:{ temperature:0.4, maxTokens:2000, blocks:[
      {role:'system', content:
`당신은 설정 자료를 구조화하는 분석가다. 창작하지 않는다.
자료에 없는 내용은 절대 지어내지 말고, 불확실하면 그 항목을 비운다.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
      {role:'user', content:
`다음 자료를 읽고 세계 요약을 만들어라.
{{modeNote}}

--- 자료 시작 ---
{{source}}
--- 자료 끝 ---

출력 형식:
{
  "title": "세계의 명칭 또는 추정",
  "tone": ["분위기 키워드 3~5개"],
  "era": "시대와 기술 수준",
  "rules": ["이 세계에서 반드시 성립하는 규칙과 금기 (최대 8개)"],
  "factions": [{"name":"","role":"","stance":"다른 세력과의 관계"}],
  "places": [{"name":"","note":""}],
  "lexicon": [{"term":"고유명사","meaning":""}],
  "hooks": ["아직 해결되지 않은 갈등·빈틈·긴장 (최대 8개)"]
}`}]},

    seed:{ temperature:1.0, maxTokens:1200, blocks:[
      {role:'system', content:
`당신은 {{lang}}로 작업하는 캐릭터 설계자다.{{toneRule}}
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
      {role:'user', content:
`세계 요약:
{{digest}}
{{castNote}}{{modeNote}}
위 세계의 hooks와 rules에 근거해 캐릭터 컨셉 씨앗을 {{seedCount}}개 만들어라.

조건:
- 각 씨앗은 서로 다른 hook에서 출발할 것
- 세계의 rules를 어기지 말 것
- 직업·계층·나이대·세계와의 거리를 서로 다르게
- 한 줄 안에 "어떤 사람인가"와 "지금 무엇에 쫓기는가"가 모두 담길 것
- 영웅적이거나 특별한 인물로만 채우지 말 것
{{extraRule}}
[{"id":"s1","line":"한 문장 요약","hook":"출발점이 된 hook","angle":"이 인물이 이야기에 가져오는 것"}]`}]},

    cross:{ temperature:1.0, maxTokens:600, blocks:[
      {role:'system', content:`당신은 {{lang}}로 작업하는 캐릭터 설계자다. 출력은 유효한 JSON 하나만.`},
      {role:'user', content:
`세계 요약:
{{digest}}

두 컨셉:
{{seed}}

이 둘을 하나의 인물로 합쳐라. 단순히 이어붙이지 말고, 두 조건을 동시에 짊어진 사람이 어떤 모순에 놓이는지를 중심에 둘 것.

{"id":"sx","line":"한 문장 요약","hook":"","angle":""}`}]},

    expand:{ temperature:0.95, maxTokens:2600, blocks:[
      {role:'system', content:
`당신은 {{lang}}로 작업하는 캐릭터 설계자다.{{toneRule}}
모든 값은 {{lang}}로 쓰되 고유명사는 자료의 표기를 그대로 따른다.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
      {role:'user', content:
`세계 요약:
{{digest}}

고른 컨셉:
{{seed}}
{{modeNote}}
이 컨셉을 다음 칸으로 펼쳐라.
{{schemaSpec}}

원칙:
- 세계 요약의 rules를 위반하지 말 것
- lexicon에 없는 고유명사를 새로 만들지 말 것
- 설정을 나열하지 말고, 이 사람이 무엇을 원하고 무엇을 두려워하는지가 드러날 것
- 모든 면이 매력적인 사람을 만들지 말 것. 치르는 대가와 결함을 반드시 포함
{{nsfwRule}}{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}]},

    patch:{ temperature:0.95, maxTokens:2200, blocks:[
      {role:'system', content:
`당신은 {{lang}}로 작업하는 캐릭터 설계자다.{{toneRule}}
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
      {role:'user', content:
`세계 요약:
{{digest}}

현재 카드:
{{card}}

건드리지 말 것: {{locked}}
다시 쓸 것: {{unlocked}}
추가 지시: {{instruction}}

고정된 칸과 모순되지 않게, 다시 쓸 칸만 새로 써라.
이미 나온 표현을 되풀이하지 말고 다른 각도에서 접근할 것.
{{nsfwRule}}
다시 쓴 칸만 {"칸이름":"내용"} 형태로 출력.`}]},

    check:{ temperature:0.3, maxTokens:1600, blocks:[
      {role:'system', content:
`당신은 설정 감수자다. 문장을 다시 쓰지 말고 어긋난 곳만 지적한다.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
      {role:'user', content:
`세계 규칙:
{{digest}}

검사 대상:
{{card}}

세계 설정과 모순되는 지점만 찾아라. 취향 문제나 문장력은 지적하지 않는다.
어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇과 어떻게 모순되는가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`}]},

    ask:{ temperature:0.8, maxTokens:1600, blocks:[
      {role:'system', content:
`당신은 만들어진 자료에 대해 답하는 사람이다.{{toneRule}}
{{askMode}}
답은 {{lang}}로. 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
      {role:'user', content:
`세계 요약:
{{digest}}

대상 자료:
{{card}}

질문:
{{question}}

{
  "answer": "질문에 대한 답",
  "changes": [{"field":"고칠 칸 이름","before":"지금 문장","after":"바꿀 문장"}],
  "note": "답을 내면서 걸리는 점이 있으면 한 줄. 없으면 빈 문자열"
}

changes 는 자료를 실제로 고쳐야 답이 성립할 때만 채운다. 고칠 필요가 없으면 빈 배열로 둔다.`}]},

    relate:{ temperature:0.9, maxTokens:2200, blocks:[
      {role:'system', content:`당신은 {{lang}}로 작업하는 이야기 설계자다. 출력은 유효한 JSON 하나만.`},
      {role:'user', content:
`세계 요약:
{{digest}}

등장인물:
{{cast}}

인물 간 관계를 짜라. 모두가 서로 아는 사이일 필요는 없다.
핵심: 관계는 비대칭이다. A가 B를 보는 시선과 B가 A를 보는 시선을 반드시 다르게 쓸 것.

{"edges":[{"a":"이름","b":"이름","type":"관계 유형","aToB":"A가 B를 어떻게 보는가","bToA":"B가 A를 어떻게 보는가","tension":"이 관계가 언제 터지는가"}]}`}]}
  }};
}

/* --- 내장 양식 2 · 설정집 프로필 (압축형 한국어 카드) --- */
function presetProfileKo(){
  const P = defaultPreset();
  P.id = 'profile-ko'; P.needs='optional';
  P.name = '설정집 프로필 (압축형)'; P.group = 'character'; P.kind = 'character';
  P.common = [];
  P.schema = [
    {key:'head',        label:'머리줄', hint:'이름/나이/직업 을 슬래시로 구분한 한 줄. 다른 말 붙이지 말 것'},
    {key:'status',      label:'특이 신분', hint:'등록번호·계급·낙인·소속처럼 한 줄로 못 박을 것이 있을 때만. 없으면 빈 문자열'},
    {key:'appearance',  label:'외형', hint:'체격·얼굴·자세·복장·장비·흉터·변이·움직임을 객관적으로. 은유 금지'},
    {key:'personality', label:'성격', hint:'반복되는 행동, 감정 처리 방식, 대인 거리, 선을 넘겼을 때 반응, 말버릇으로 서술'},
    {key:'ability',     label:'능력', hint:'초자연·예외적·설정으로 규정된 능력만. 발동 주체·수단·대상·효과·대가·한계·실패 상태를 적을 것. 평범한 전문성은 기타로 내릴 것. 해당 없으면 빈 문자열'},
    {key:'misc',        label:'기타', hint:'현재 일과·습관·거주·의존 관계·등록·소속, 그리고 {user}와 지금 엮이는 접점'}
  ];
  P.stages.expand.maxTokens = 2000;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 설정집을 읽고 그 안에서 살아갈 인물 한 명을 압축해 적는 사람이다.{{toneRule}}
출력은 {{lang}}로 쓰되 고유명사는 자료의 표기를 그대로 따른다.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`세계 요약:
{{digest}}

고른 컨셉:
{{seed}}
{{modeNote}}
이 컨셉을 아래 칸으로 적어라.
{{schemaSpec}}

설정 준수
- 자료에 있는 규칙·용어·직급·호칭·소유 관계를 그대로 쓸 것. 한 개념에 한 용어만 쓰고 자료가 구분한 것은 구분한 채 둘 것
- 세계 차원의 조직·분류 체계·수치 기준·역사적 사건·보편 규칙을 새로 만들지 말 것
- 이 인물이 맡은 자리가 주지 않는 지식·권한·접근·면제·능력을 주지 말 것
- 자료가 비워둔 곳은 비워둔 채로 두거나 인물 한 명 수준의 세부로만 채울 것

인물 설계
- 자료가 허용하는 자리를 먼저 정하고 그 다음에 외형과 능력을 맞출 것
- 한정된 유능함 + 구체적인 제약 + 사람으로서의 결핍 + 반복되는 반응, 이 네 가지가 서로 맞물릴 것
- 성격 형용사를 쓰지 말고 관찰 가능한 계기·행동·경계·말버릇으로 바꿔 쓸 것
- 능력은 속으로 다 설계하되 밖으로는 형태·행동·효과·주요 용도·결정적 한계만 내놓을 것
- 강점은 한 영역에 묶고 결함은 실제로 대가를 치르게 할 것
- 지난 일을 길게 적지 말고 지금의 일과·의존·목표로 대신할 것

{user} 처리
- 반드시 {user} 라고만 적을 것. 이름·사용자·다른 대체어로 바꾸지 말 것
- 지금 엮이는 접점만 줄 것. 신뢰·호감·복종·연애·갈등의 결말이나 앞으로의 전개를 정하지 말 것
- 업무 관계·상하 관계·경쟁·빚·의존을 연애로 몰아가지 말 것

문체
- 정보를 앞에 두고 짧게. 쉼표로 이어붙인 압축된 서술
- 서술하는 줄은 ~함, ~성, ~형, ~상태, ~습관, ~경향 같은 명사형으로 끝낼 것
- 문학적 은유, 감정적 평가, 형용사 나열, 불필요한 설정 강의 금지
- 예시 대사·상태창·분기·앞으로 밝혀질 것을 넣지 말 것
{{nsfwRule}}{{extraRule}}
{"칸이름":"내용"} 형태로만 출력. 해당 없는 칸은 빈 문자열.`}];
  P.stages.patch.blocks[1].content = P.stages.patch.blocks[1].content.replace(
    '고정된 칸과 모순되지 않게, 다시 쓸 칸만 새로 써라.',
    '고정된 칸과 모순되지 않게, 다시 쓸 칸만 새로 써라.\n같은 문체를 유지할 것 — 짧은 정보 우선 서술, 명사형 어미, 은유 금지, {user} 표기 유지.');
  return P;
}

/* --- 캐릭터 · 성향 프로토콜 (성인 전용) --- */
function presetDrives(){
  const P = defaultPreset();
  P.id = 'drives-adult'; P.name = '성향 프로토콜 (성인 · 18+)'; P.needs='required';
  P.group = 'character'; P.kind = 'character';
  P.schema = [
    {key:'style',   label:'행위 스타일', hint:'아키타입 키워드 3~5개(심리에서 도출된 것만) · 선호 체위 · 선호 플레이(각각이 성격이나 이력의 연장) · 비선호와 금지 · 시작과 동의 태도(누가 주도하고 거부를 어떻게 처리하는가)'},
    {key:'manner',  label:'성적 스타일', hint:'전반적 태도와 공기 · 지배나 복종이 구체적으로 어떤 형태로 나오는가 · 이 인물만의 반복 패턴이나 의식 · 사후 처리(없는 것 자체가 특성이면 그렇게)'},
    {key:'motive',  label:'심리적 동기', hint:'추동하는 근원 욕구 1~2가지 · 성격이나 배경의 어떤 요소가 이 패턴으로 변형되었는가 · 가장 취약해지는 순간'},
    {key:'talk',    label:'더티톡',     hint:'화법 특성(짧은가 장황한가, 명령·확인·비하·침묵) · 쓰는 호칭 목록 · 절대 쓰지 않는 표현 · 예시 대사 5~7개'},
    {key:'zones',   label:'성감대·취약성', hint:'신체적인 것과 심리적인 것 모두. 왜 거기인지가 앞의 서술과 이어질 것'}
  ];
  P.stages.digest.maxTokens = 1800;
  P.stages.digest.temperature = 0.5;
  P.stages.digest.blocks = [
    {role:'system', content:
`당신은 인물 자료에서 성적 기질을 도출하는 분석가다. 특성을 지어내지 않고 자료에서 읽어낸다.
이것은 창작이며 등장인물은 모두 성인이다.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`인물 자료:
{{source}}

아래 축을 검토하라. 각 답은 자료의 어느 부분에 근거하는지 밝힐 것.

통제 축 — 통제를 잡아야 하는가 내려놓아야 하는가. 주는 쪽인가 뺏는 쪽인가 오가는가. 삶의 어떤 경험이 통제를 충전시켰는가
취약성 축 — 심리적 가드가 내려가는 조건은 무엇인가. 그 조건이 무엇을 추구하고 무엇을 피하게 만드는가
언어 축 — 평상시 화법이 각성 상태에서 어떻게 변형되는가. 말이 늘어나는가 줄어드는가. 거칠어지는가 부드러워지는가. 서술하는가 명령하는가 확인하는가 침묵하는가
공격성 축 — 잠재된 공격성은 어디에 사는가. 성적으로 표면화되는가, 다정함으로 승화되는가, 절제로 표현되는가
애착 축 — 애착 상처는 무엇인가. 섹스가 그것을 봉합하는가 재개봉하는가. 절대 입 밖에 내지 않지만 필요로 하는 것은
신체 축 — 체격·훈련 이력·직업적 신체 습관이 공간 사용을 어떻게 결정하는가. 이미 움직이는 방식의 자연스러운 연장인 체위는

{
 "subject":"이름",
 "control":{"axis":"","evidence":""},
 "vulnerability":{"conditions":"","evidence":""},
 "verbal":{"baseline":"","aroused":"","register":"어휘 폭, 문장 길이, 욕설과 경어 수준, 외국어 혼용"},
 "aggression":{"location":"","expression":""},
 "attachment":{"wound":"","unspoken_need":""},
 "body":{"logic":"","spatial":""},
 "labels":["위 근거가 실제로 뒷받침하는 아키타입이나 킨크 이름"]
}`}];
  P.stages.seed.maxTokens = 900;
  P.stages.seed.blocks = [
    {role:'system', content:`당신은 인물 분석가다. 출력은 유효한 JSON 배열 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`축 분석:
{{digest}}

이 인물의 성향 전체를 조직할 수 있는 축을 {{seedCount}}개 제안하라.
각각은 위 분석에서 근거가 나와야 하고, 같은 말을 다르게 표현한 것이어서는 안 된다.

[{"id":"s1","line":"한 문장: 조직 축","hook":"어느 축에서 나왔는가","angle":"이 읽기라야 설명되는 것"}]`}];
  P.stages.expand.maxTokens = 3400;
  P.stages.expand.temperature = 0.9;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 인물 자료에서 성적 기질을 도출하는 분석가다. 이것은 창작이며 등장인물은 모두 성인이다.{{toneRule}}

도출의 원칙 — 배정이 아니라 추론
성적 행동은 심리의 변형된 출력이다. 킨크 목록에서 골라 배정하지 않는다.
모든 선호·회피·패턴은 다음 중 하나로 되짚어갈 수 있어야 한다.
- 성격 구조 (통제 욕구, 취약성 문턱, 애착 방식)
- 형성기 경험 (결핍, 과잉 노출, 관계의 원형)
- 대인 역학 (권력 위치, 소통 방식, 신뢰 용량)
- 신체 자기개념 (몸에 대한 인식, 접촉에 대한 편안함, 공격성 기저선)

출력은 {{lang}}로. 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`인물 자료:
{{source}}
{{card}}

축 분석:
{{digest}}

조직 축:
{{seed}}

아래 칸으로 프로토콜을 써라.
{{schemaSpec}}

비중
- 칸의 비중을 고르게 두지 마라. 이 인물에게 핵심인 것을 두껍게 쓴다
- 새디스트라면 에스컬레이션이 중요하고, 억압된 인물이라면 무엇이 뚫고 나오는지가 중요하다
- 중요하지 않은 칸은 한 줄로 끝내라. 채우려고 늘리지 마라

더티톡
- 예시 대사는 이 인물의 일상 말투와 정확히 같은 레지스터여야 한다
- 평소 군더더기 없이 짧게 말하면 여기서도 짧다. 평소 특정 언어의 욕을 쓰면 여기서도 나온다
- 일반적인 포르노 대사처럼 들리면 실패다

경계
- 하지 않는 것과 그 경계가 무엇을 드러내는지 쓸 것. 거부는 선호만큼 정보를 준다
- 동의를 어떻게 확인하고 거부를 어떻게 처리하는지, 멈추는 방식을 구체적으로 쓸 것
- 침묵·흥분·통증·위계·의존·과거의 관계를 동의로 취급하지 말 것

금지
- 일반적인 목록을 만들어놓고 항목을 무작위로 배정하는 것
- 크니까 지배적, 작으니까 순종적 같은 기본값
- 다른 인물에게 그대로 붙일 수 있는 구조
- "이것은 ~에 대한 욕구의 반영이다"식 해설. 행동 묘사 자체로 심리가 보일 것
- 인간의 행동으로 그럴듯하지 않은 과장
- 아키타입 이름을 먼저 붙이고 거기에 맞추는 것. 행동을 먼저 보이고 이름은 마지막에 확인용으로만
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`인물 자료:
{{source}}

축 분석:
{{digest}}

검사 대상:
{{card}}

네 가지만 검사하라. 문장을 다시 쓰지 말 것.

1 분화 — 이름을 지우면 다른 인물에게 그대로 붙일 수 있는 항목을 찾아라. 붙일 수 있으면 위반이다
2 인과 — 나열된 선호 중 심리적 기원이 추적되지 않는 것을 찾아라. "그냥 그렇다"로 남은 항목은 위반이다
3 음성 — 더티톡 예문이 이 인물의 일상 대사와 같은 사람에게서 나온 것처럼 들리는가. 일반 포르노 대사처럼 들리면 위반이다
4 경계 — 하지 않는 것 목록이 선호만큼 인물을 드러내는가. 동의 확인과 중단 방식이 구체적인가

어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"1~4 중 무엇을 어떻게 어겼는가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}

/* --- 내장 양식 4 · 캐릭터 프롬프트 작성 --- */
function presetPromptcraft(){
  const P = defaultPreset();
  P.id = 'promptcraft'; P.needs='required';
  P.name = '롤플레이 프롬프트'; P.group = 'prompt'; P.kind = 'prompt';
  P.schema = [
    {key:'title',   label:'제목',       hint:'이 프롬프트 묶음을 부를 이름 한 줄'},
    {key:'persona', label:'인물 지시문', hint:'모델이 이 인물을 연기할 때 지킬 규칙. 배경 설명이 아니라 행동 규칙으로 쓸 것'},
    {key:'voice',   label:'문체 규칙',   hint:'서술 시점·시제·분량·묘사 밀도·금지 표현. 이 인물의 대사 어투를 구체적으로'},
    {key:'opening', label:'첫 장면',     hint:'그대로 붙여넣어 대화를 시작할 수 있는 장면 지시문. 시간·장소·상황·인물의 현재 상태'},
    {key:'beats',   label:'상황 변주',   hint:'같은 인물로 굴릴 수 있는 다른 상황 4~6개. 한 줄에 하나씩, 줄바꿈으로 구분'},
    {key:'probes',  label:'물꼬',        hint:'{user}가 던질 만한 첫 마디 예시 3~4개. 한 줄에 하나씩'},
    {key:'avoid',   label:'피할 것',     hint:'이 인물에게서 나오면 안 되는 말투·행동·전개. 짧게'}
  ];
  P.stages.digest.blocks[1].content = P.stages.digest.blocks[1].content.replace(
    '다음 자료를 읽고 세계 요약을 만들어라.',
    '다음 자료를 읽고 요약을 만들어라. 이 요약은 이 인물·세계로 굴릴 프롬프트를 짜는 데 쓰인다.');
  P.stages.seed.maxTokens = 1100;
  P.stages.seed.blocks[1].content =
`요약:
{{digest}}
{{castNote}}
위 자료로 굴릴 수 있는 프롬프트 방향을 {{seedCount}}개 제안하라.

조건
- 각 방향은 장르·긴장의 종류·{user}가 놓이는 자리가 서로 달라야 한다
- 자료에 이미 있는 갈등에서 출발할 것. 없는 사건을 새로 만들지 말 것
- "잘 어울리는 상황"만 고르지 말 것. 인물이 불편해지는 배치도 섞을 것
- 한 줄 안에 "어떤 상황인가"와 "무엇이 걸려 있는가"가 모두 담길 것
{{extraRule}}
[{"id":"s1","line":"한 문장 요약","hook":"자료의 어느 부분에서 나왔는가","angle":"{user}가 놓이는 자리"}]`;
  P.stages.expand.maxTokens = 2800;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 롤플레이용 프롬프트를 짜는 사람이다.{{toneRule}}
결과물은 사람이 읽는 설명이 아니라 모델에게 바로 먹이는 지시문이다. 설명체로 쓰지 말고 지시체로 써라.
출력은 {{lang}}로 쓰되 고유명사는 자료의 표기를 그대로 따른다.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`자료 요약:
{{digest}}

고른 방향:
{{seed}}

원본 자료:
{{source}}

이 방향으로 굴릴 프롬프트 묶음을 아래 칸으로 짜라.
{{schemaSpec}}

작성 규칙
- 인물 지시문은 "무엇을 하는 사람이다"가 아니라 "언제 무엇을 한다"로 쓸 것. 판단 기준과 반응 규칙을 넣을 것
- 설정을 길게 늘어놓지 말 것. 대화 대여섯 번 안에서 드러날 것만 남길 것
- 자료에 없는 조직·사건·규칙을 새로 만들지 말 것
- 첫 장면은 상황 설명이 아니라 이미 굴러가고 있는 장면으로 시작할 것
- 상황 변주는 서로 다른 압력을 걸 것. 같은 상황의 변형을 나열하지 말 것
- {user}는 반드시 {user}라고만 적을 것. 이름이나 다른 말로 바꾸지 말 것
- {user}의 성격·과거·반응을 정하지 말 것. 자리와 상황만 줄 것
- 관계의 결말, 앞으로 밝혀질 것, 분기 구조를 미리 정하지 말 것
- 지킬 수 없는 요구 대신 검사할 수 있는 요구를 쓸 것. "자연스럽게", "몰입감 있게"는 아무것도 지시하지 않는다
- 하지 말라고만 하지 말고 대신 무엇을 할지 함께 적을 것
{{nsfwRule}}{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`자료 요약:
{{digest}}

검사 대상:
{{card}}

아래만 지적하라. 문장을 다시 쓰지 말 것.
- 자료에 없는 설정·조직·사건을 새로 만든 곳
- {user}의 성격·과거·반응을 멋대로 정한 곳, {user} 표기를 다른 말로 바꾼 곳
- 지시문이 아니라 설명문으로 쓰인 곳
- 판정할 수 없는 요구 ("자연스럽게", "몰입감 있게", "생동감 있게" 같은 것)
- 하지 말라고만 하고 대신 할 것을 주지 않은 곳
- 상황 변주가 서로 같은 압력을 반복하는 곳
- 대화 대여섯 번 안에 드러나지 않을 정보를 지시문에 넣은 곳

어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇이 문제인가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}


/* --- 내장 양식 5 · 세계관 설계 --- */
function presetWorld(){
  const P = defaultPreset();
  P.id = 'world'; P.name = '세계관 설계'; P.group = 'world'; P.kind = 'world'; P.needs='optional';
  P.schema = [
    {key:'title',   label:'이름',    hint:'이 세계 또는 무대의 이름 한 줄'},
    {key:'premise', label:'전제',    hint:'두세 문장. 무엇이 보통과 다른가, 그래서 사람들이 무엇을 하며 사는가'},
    {key:'rules',   label:'작동 규칙', hint:'반드시 성립하는 규칙과 금기. 어겼을 때 무슨 일이 벌어지는지까지. 한 줄에 하나씩'},
    {key:'factions',label:'세력',    hint:'이름 · 무엇으로 먹고사는가 · 무엇을 원하는가 · 다른 세력과의 관계. 한 줄에 하나씩'},
    {key:'places',  label:'장소',    hint:'이름 · 어떤 곳인가 · 여기서만 벌어지는 일. 한 줄에 하나씩'},
    {key:'lexicon', label:'용어',    hint:'이 세계에서만 쓰는 말. 용어 — 뜻. 한 줄에 하나씩'},
    {key:'daily',   label:'생활',    hint:'먹고 자고 이동하고 돈 버는 방식. 물가, 흔한 직업, 하루의 모양'},
    {key:'tension', label:'지금의 갈등', hint:'현재 진행 중인 문제. 누가 누구와 무엇 때문에'},
    {key:'hooks',   label:'이야기 걸이', hint:'인물을 놓으면 바로 굴러가는 상황 5~7개. 한 줄에 하나씩'}
  ];
  P.stages.digest.blocks[1].content =
`다음 자료를 읽고 재료 요약을 만들어라. 이 요약은 세계를 설계하는 출발점으로 쓰인다.
자료가 키워드 몇 개뿐이라면 그 키워드가 무엇을 함의하는지까지만 정리하고, 세계를 지어내지 마라.

--- 자료 시작 ---
{{source}}
--- 자료 끝 ---

출력 형식:
{
  "given": ["자료가 이미 정해놓은 것"],
  "implied": ["자료에서 자연히 따라오는 것"],
  "open": ["아직 비어 있어 정해야 하는 것"],
  "tone": ["분위기 키워드 3~5개"],
  "questions": ["설계하기 전에 답해야 할 질문 (최대 6개)"]
}`;
  P.stages.seed.blocks[1].content =
`재료 요약:
{{digest}}

위 재료로 갈 수 있는 세계의 방향을 {{seedCount}}개 제안하라.

조건
- 같은 소재를 쓰되 서로 다른 축이 세계를 굴러가게 할 것 (자원 / 신앙 / 기술 / 신분 / 지리 / 시간)
- 각 방향은 "무엇이 희소한가"와 "그래서 누가 힘을 갖는가"가 드러날 것
- 이미 흔한 배치를 그대로 가져오지 말 것
- 자료가 정해놓은 것을 뒤집지 말 것
{{extraRule}}
[{"id":"s1","line":"한 문장 요약","hook":"재료의 어느 부분에서 나왔는가","angle":"이 방향이라야 가능해지는 이야기"}]`;
  P.stages.expand.maxTokens = 3200;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 {{lang}}로 작업하는 세계 설계자다.{{toneRule}}
설정을 예쁘게 늘어놓지 말고, 사람이 그 안에서 어떻게 사는지가 드러나게 써라.
출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`재료 요약:
{{digest}}

고른 방향:
{{seed}}

이 방향으로 세계를 아래 칸으로 설계하라.
{{schemaSpec}}

원칙
- 규칙을 정했으면 그 규칙이 만들어내는 불편과 편법까지 적을 것
- 세력은 선악으로 나누지 말 것. 각자 무엇을 지키려다 부딪히는지로 쓸 것
- 용어를 남발하지 말 것. 그 말이 없으면 설명이 안 되는 것만 만들 것
- 생활 칸은 반드시 구체적인 숫자나 물건을 하나 이상 포함할 것
- 연표를 길게 쓰지 말 것. 지금 벌어지고 있는 일이 과거사보다 중요하다
- 세계를 완결시키지 말 것. 비어 있어야 인물이 들어갈 자리가 생긴다
{{nsfwRule}}{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`설계 재료:
{{digest}}

검사 대상:
{{card}}

아래만 지적하라. 문장을 다시 쓰지 말 것.
- 규칙끼리 서로 어긋나는 곳
- 세력의 동기와 행동이 맞지 않는 곳
- 용어를 만들어놓고 쓰지 않거나, 뜻이 흔들리는 곳
- 생활이 규칙과 따로 노는 곳 (규칙대로면 그렇게 살 수 없는 경우)
- 자료가 정해놓은 것을 뒤집은 곳

어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇과 어떻게 어긋나는가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  P.stages.entries = { temperature:0.4, maxTokens:3000, blocks:[
    {role:'system', content:
`당신은 세계 문서를 로어북 항목으로 쪼개는 사람이다. 내용을 새로 만들지 않는다.
출력은 유효한 JSON 배열 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`세계 문서:
{{card}}

이 문서를 로어북 항목으로 쪼개라.

규칙
- 한 항목은 한 가지만 다룰 것. 여러 개념을 한 항목에 묶지 말 것
- keys 에는 대화 중 실제로 등장할 말만 넣을 것. 지명·인명·조직명·용어. 흔한 일반명사는 넣지 말 것
- 한 항목당 keys 는 1~4개. 표기 변형이 있으면 함께 넣을 것
- content 는 원문 표현을 살리되 그 항목만 읽어도 뜻이 통하게 다듬을 것
- comment 는 목록에서 알아볼 짧은 제목
- 세계 전체를 요약하는 항목 하나를 맨 앞에 두고 keys 를 비울 것 (상시 주입용)
- 문서에 없는 내용을 보태지 말 것

[{"keys":["말"],"content":"내용","comment":"제목","constant":false}]`}]};
  return P;
}

/* --- 내장 양식 6 · 평가와 보강 제안 --- */
function presetAudit(){
  const P = defaultPreset();
  P.id = 'audit'; P.name = '평가 · 보강 제안'; P.group = 'all'; P.kind = 'report'; P.needs='required';
  P.skipSeed = true; P.skipCheck = true;
  P.schema = [
    {key:'verdict',       label:'한 줄 진단', hint:'이 자료가 지금 어떤 상태인지 한 문장'},
    {key:'working',       label:'살아 있는 곳', hint:'실제로 작동하는 부분과 그 이유. 칭찬이 아니라 진단'},
    {key:'gaps',          label:'비어 있는 곳', hint:'채워지지 않아 굴리기 어려운 지점. 왜 문제인지까지'},
    {key:'contradictions',label:'어긋나는 곳', hint:'서로 충돌하는 설정. 어느 쪽을 살릴지 선택지까지'},
    {key:'generic',       label:'흔한 곳',     hint:'다른 데서 본 배치. 어떤 클리셰인지 이름 붙일 것'},
    {key:'additions',     label:'채우면 좋을 것', hint:'구체적인 제안. "더 자세히" 같은 말 금지. 바로 붙여 쓸 수 있는 문안으로'},
    {key:'questions',     label:'정해야 할 질문', hint:'만든 사람만 답할 수 있는 것. 5~8개'}
  ];
  P.stages.digest.blocks[1].content =
`다음 자료를 읽고 무엇이 있는지 목록으로 정리하라. 평가하지 말고 훑기만 하라.

--- 자료 시작 ---
{{source}}
--- 자료 끝 ---

{
  "kind": "캐릭터 / 세계관 / 로어북 / 프롬프트 / 섞임 중 무엇인가",
  "covered": ["다뤄진 항목"],
  "absent": ["같은 종류의 자료라면 보통 있는데 여기엔 없는 것"],
  "volume": "분량과 밀도에 대한 사실 서술",
  "repeats": ["같은 말이 반복되는 지점"]
}`;
  P.stages.expand.maxTokens = 3200;
  P.stages.expand.temperature = 0.7;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 설정 자료를 봐주는 사람이다. 만든 사람 편에 서되 듣기 좋은 말을 하지 않는다.{{toneRule}}
막연한 조언을 금지한다. "더 구체적으로", "깊이를 더하면 좋겠다" 같은 말은 아무것도 알려주지 않는다.
지적할 때는 자료의 어느 부분인지 짚고, 제안할 때는 그대로 붙여 쓸 수 있는 문안을 내놓아라.
출력은 {{lang}}로. 출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`훑어본 결과:
{{digest}}

자료 원문:
{{source}}

이 자료를 아래 칸으로 봐주어라.
{{schemaSpec}}

원칙
- 취향으로 깎지 말 것. 만든 사람이 의도한 방향 안에서 볼 것
- 문제를 지적하면 반드시 그 자리에 넣을 대안을 함께 낼 것
- 없는 것을 다 채우라고 하지 말 것. 비어 있어도 되는 자리와 비면 안 되는 자리를 구분할 것
- 흔하다고 지적할 때는 어떤 클리셰인지 이름을 붙이고, 그것을 비트는 방법을 하나 낼 것
- 제안은 분량보다 개수를 줄이고 구체성을 높일 것
- 잘된 곳을 먼저 짚되 이유를 댈 수 없으면 적지 말 것
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  return P;
}


/* --- 캐릭터 · 창작 엔진 (인과율 중심 풀 시트) --- */
function presetCharEngine(){
  const P = defaultPreset();
  P.id = 'char-engine'; P.name = '창작 엔진 (풀 시트)'; P.group = 'character'; P.kind = 'character'; P.needs='optional';
  P.schema = [
    {key:'basics',     label:'기본 정보', hint:'사실 나열. 이름·나이·소속·계급·출신·신장 등 수치와 고유명사 위주. 산문 금지'},
    {key:'appearance', label:'외형',     hint:'사실 나열. 각 항목이 장면에서 무엇을 유발하는지까지 짧게 (예: 198cm — 좁은 통로에서 몸을 비트는 습관)'},
    {key:'identity',   label:'정체성',   hint:'압축 서술. 특성 + 원인 + 발현 조건을 한두 문장에'},
    {key:'background', label:'배경',     hint:'연표가 아니라 지금의 행동을 만든 사건만. 각 사건이 어떤 반응 패턴으로 남았는지'},
    {key:'personality',label:'성격',     hint:'[결과 + 원인]을 한 문장에 압축. 형용사만 적지 말 것. 모순이 있다면 그 경계를 명시'},
    {key:'speech',     label:'말투',     hint:'종결 패턴·호칭 체계·욕설/경어 레벨·외국어 혼용 빈도 + 예문 5개 이상'},
    {key:'relations',  label:'관계',     hint:'감정을 단어 하나로 끝내지 말 것. 구조·역학·호칭·그 관계에서만 나오는 행동 변화. 상대가 이 인물을 어떻게 보는지도'},
    {key:'habits',     label:'기호·습관', hint:'사실 나열. 소비·식습관·수면·소지품. 각각이 계급이나 이력을 드러낼 것'},
    {key:'hook',       label:'{user}와의 접점', hint:'지금 어떤 자리에서 마주치는가. 관계의 결말은 정하지 말 것'}
  ];
  P.stages.seed.blocks[1].content =
`재료 요약:
{{digest}}
{{castNote}}
브레인스토밍 단계다. 시트를 쓰지 말고 분기만 제안하라.

위 재료로 갈 수 있는 인물 방향을 {{seedCount}}개 내라.

조건
- 각 방향은 서로 다른 결핍에서 출발할 것
- 한 줄 안에 "무엇으로 유능한가"와 "무엇 때문에 그 유능함이 대가를 치르는가"가 담길 것
- 체격·성별·직업에서 자동으로 따라오는 배치를 쓰지 말 것
- 세계의 규칙을 어기지 말 것
{{extraRule}}
[{"id":"s1","line":"한 문장 요약","hook":"출발점이 된 결핍","angle":"이 인물이라야 가능해지는 장면"}]`;
  P.stages.expand.maxTokens = 3400;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 {{lang}}로 작업하는 캐릭터 설계자다.{{toneRule}}
문서화 단계다. 아래 원칙을 어기면 실패로 친다.

인과율
- 모든 성격·행동·기질·대인 방식은 원인을 가진다. 원인 없는 설정은 쓰지 않는다
- 한 문장 안에 [결과 + 원인]이 압축되어야 한다. 읽는 즉시 인과가 보일 것
- 나쁨: "성격: 차갑다" / 나쁨: "그는 차갑다. 과거에 상처받았기 때문이다"
- 좋음: "유년기 방치가 남긴 방어기제로서의 정서적 거리. 절대적 충성을 증명한 상대에게만 해제"

묘사는 행동의 결과
- 모든 외형·성격 항목은 "이 특성이 장면에서 무엇을 유발하는가"를 통과해야 한다
- "외향적이다"는 쓸모없다. "처음 보는 사람에게 3분 안에 농담을 건넨다"는 쓸모있다

분화
- 이름을 지우고 다른 이름을 넣어도 성립하는 시트는 실패다
- 모든 항목이 "이 인물만 이렇다" 수준의 특이성을 가질 것

모순의 공존
- 사람은 모순된다. 단 그 모순에는 구조가 있다
- 모순의 경계가 어디인지 명시할 것. 그 경계가 곧 정체성이다
  (예: 거친 사람이지만 연인에게는 특정 호칭을 절대 쓰지 않는 선)

출력은 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`세계 요약:
{{digest}}

고른 방향:
{{seed}}
{{modeNote}}
아래 칸으로 시트를 써라.
{{schemaSpec}}

형식
- 사실 섹션(기본 정보·외형·기호)은 키워드와 짧은 구절로. 수치와 고유명사 위주. 산문 금지
- 서술 섹션(정체성·배경·성격·관계)은 [특성 + 원인 + 발현 조건]을 한두 문장에. 해설조로 늘어놓지 말 것
- 말투 칸은 예문 5개 이상. 대사만 읽고도 누가 말하는지 알 수 있어야 한다

금지
- 체격이 크면 지배적, 작으면 순종적 같은 기본값
- 다른 인물에게 그대로 붙일 수 있는 구조
- 괄호 남용
- "이것은 ~의 반영이다"식 해설. 행동 묘사 자체로 심리가 보일 것
- 자료에 없는 조직·사건·규칙 신설
{{nsfwRule}}{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`세계 요약:
{{digest}}

검사 대상:
{{card}}

네 가지만 검사하라. 문장을 다시 쓰지 말 것.

1 분화 — 이름을 지우면 다른 인물에게 붙일 수 있는 항목을 찾아라. 붙일 수 있으면 위반이다
2 인과 — 원인이 추적되지 않는 특성을 찾아라. "그냥 그렇다"로 남은 항목은 위반이다
3 음성 — 말투 예문이 서로 다른 사람 말처럼 들리거나, 성격 서술과 어긋나는 곳
4 설정 — 세계의 규칙을 어기거나 자료에 없는 것을 새로 만든 곳

어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"1~4 중 무엇을 어떻게 어겼는가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}

/* --- 세계관 · 압축 소개본 --- */
function presetWorldBrief(){
  const P = presetWorld();
  P.id = 'world-brief'; P.name = '압축 소개본'; P.group = 'world'; P.kind = 'world'; P.needs='required';
  P.skipSeed = true;
  P.schema = [
    {key:'opening',  label:'첫 구획', hint:'이 세계에서 무엇이 가능하고 무엇이 불가능한가. 처음 읽는 사람이 여기만 읽어도 감이 잡힐 것'},
    {key:'sections', label:'본문',   hint:'이모지+제목 줄 다음에 정보 행들. 한 행에 하나의 사실·규칙·조건·인과. 마크다운 제목 기호와 번호 금지'},
    {key:'terms',    label:'헷갈리는 것', hint:'비슷해서 구분이 필요한 용어·역할·직위만. 없으면 빈 문자열'},
    {key:'states',   label:'확정되지 않은 것', hint:'공식 발표 / 통설 / 추론 / 소문 / 미해결 / 자료 안의 모순을 각각 표시해서. 없으면 빈 문자열'}
  ];
  P.stages.expand.maxTokens = 3200;
  P.stages.expand.temperature = 0.5;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 설정 자료를 처음 읽는 사람에게 소개하는 문서를 쓴다.{{toneRule}}
자료에 없는 사실·이름·분류·수치·원인·관계를 만들지 않는다.
고유명사·수치·조건·예외·인과는 자료의 표기 그대로 옮긴다.
확인된 사실, 공식 발표, 통설, 추론, 소문, 미해결을 한 목소리로 뭉개지 않는다.
자료 안의 모순은 고치지 말고 양쪽을 나란히 적는다.
출력은 {{lang}}로. 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`자료 요약:
{{digest}}

자료 원문:
{{source}}

압축 소개본을 아래 칸으로 써라.
{{schemaSpec}}

묶는 법
- 같은 주제·기능·구조·인과로 묶어 구획을 만들 것. 미리 정해진 목차에 자료를 끼워넣지 말 것
- 세계를 정의하거나 이야기의 결과를 바꾸는 것부터 앞에 둘 것
- 중복과 값싼 세부는 덜어내되 조건·대가·한계·실패 상태는 남길 것
- 구획 제목은 자료에 실제로 나오는 고유명사·기관·역할·종족·현상·공식 용어로 붙일 것
- 처음 읽는 사람이 따라갈 수 있는 인과 순서로 배열할 것
- 어떤 개념을 설명하려면 그것이 기대는 개념을 먼저 놓거나 → 로 흐름을 표시할 것

작동 설명
- 누가 · 무엇을 통해 · 어떤 조건에서 · 무엇을 대상으로 · 어떤 효과·범위·지속·단계·대가·한계·실패로
- 힘과 전투만이 아니라 정치·경제·종교·법·기술·생태·사회에도 같은 기준을 적용할 것
- 명문화된 발동 조건이 없는 관습·금기·위계는 "어기면 무슨 일이 벌어지는가"로 정의할 것. 분위기로 끝내지 말 것

형식
- 마크다운 제목 기호와 구획 번호를 쓰지 말 것
- 서문·목적·결론·창작 가이드·용어집을 넣지 말 것
- 한 행에 하나. 진짜 하위 구분에만 글머리표, 반복되는 항목 비교에만 표
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`자료 원문:
{{source}}

검사 대상:
{{card}}

아래만 지적하라. 문장을 다시 쓰지 말 것.
- 자료에 없는 사실·이름·수치·원인·관계를 지어낸 곳
- 확인된 사실과 소문·추론·통설을 한 목소리로 뭉갠 곳
- 자료 안의 모순을 임의로 봉합한 곳
- 비슷한 용어·역할이 뒤섞인 곳
- 어떤 문장이 기대는 개념이 그 뒤에 나오는 곳
- 조건·대가·한계·실패 상태가 사라진 곳
- 관습이나 위계가 "분위기"로만 서술되고 어겼을 때의 결과가 없는 곳

어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇이 문제인가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}

/* --- 세계관 · 상세 안내서 --- */
function presetWorldGuide(){
  const P = presetWorldBrief();
  P.id = 'world-guide'; P.name = '상세 안내서'; P.group = 'world'; P.kind = 'world'; P.needs='required';
  P.schema = [
    {key:'title',      label:'제목과 목적', hint:'누구를 위한 문서이고 어디까지 다루는가'},
    {key:'overview',   label:'개관과 기원', hint:'전제, 보통 세계와 갈라지는 지점, 그 원인'},
    {key:'terms',      label:'용어와 역할 구분', hint:'헷갈리는 것들을 나란히 놓고 구분. 처음 나오는 용어는 굵게 하고 뜻을 바로 옆에'},
    {key:'systems',    label:'체계 작동 원리', hint:'누가·무엇을 통해·어떤 조건에서·무엇에·어떤 효과로. 힘만이 아니라 정치·경제·종교·법·기술·생태도'},
    {key:'costs',      label:'대가·한계·실패', hint:'단계, 자원, 되돌릴 수 없는 결과, 실패 상태, 대응 수단'},
    {key:'society',    label:'제도·지리·생활', hint:'관계와 의존, 사는 방식, 하루의 모양, 돈과 신분'},
    {key:'cases',      label:'대표 사례',    hint:'체계가 실제로 굴러가는 장면 2~3개. 없어도 되면 빈 문자열'},
    {key:'rules',      label:'불변 규칙',    hint:'이 세계에서 절대 뒤집히지 않는 것'},
    {key:'unresolved', label:'미해결·모순',  hint:'공식 발표 / 통설 / 추론 / 소문 / 미해결 / 자료 안의 모순을 표시해서'}
  ];
  P.skipSeed = true;
  P.stages.expand.maxTokens = 4000;
  P.stages.expand.blocks[1].content =
`자료 요약:
{{digest}}

자료 원문:
{{source}}

상세 안내서를 아래 칸으로 써라.
{{schemaSpec}}

분량 배분
- 등장 요소가 10개 미만이면 각각에 작동 원리까지 배분할 것
- 10~25개면 핵심 5~7개만 작동 원리까지, 나머지는 역할과 위치만
- 25개를 넘으면 분류 체계를 먼저 세우고 → 대표 사례로 작동을 보인 뒤 → 나머지는 분류 안에 위치만 지정할 것

작동 설명
- 누가 · 무엇을 통해 · 어떤 조건에서 · 무엇을 대상으로 · 어떤 범위·지속·단계·대가·한계·실패·대응으로
- 정치·경제·종교·법·기술·생태·사회에도 같은 기준을 적용할 것
- 명문화되지 않은 관습·금기·위계는 어겼을 때의 결과로 정의하고, 예외가 허용되는 조건과 자격을 밝힐 것
- 분위기나 미감이 작동 설명을 대신하지 못한다

순서
- 어떤 개념이 다른 개념에 기대면 기대는 쪽을 먼저 놓을 것
- 서로 물고 도는 경우에는 한쪽을 짧게 선언하고 제자리에서 자세히 풀되 앞을 다시 가리킬 것

형식
- 구획 구분에 마크다운 제목(##, ###)을 쓸 것
- 처음 나오는 용어는 굵게 하고 뜻을 바로 옆에 둘 것
- 예시와 사례는 인용부호나 들여쓰기로 본문과 구분할 것
- 자료에 없는 것을 채워 넣지 말 것. 모순은 고치지 말고 나란히 적을 것

처음 읽는 사람 기준 (반드시 통과)
- 첫 구획만 읽어도 이 세계에서 무엇이 가능하고 불가능한지 알 수 있을 것
- 어떤 용어든 그것에 기대는 문장보다 먼저 정의될 것
- 이 문서 밖의 자료를 찾아보지 않아도 모든 문장이 이해될 것
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력. 필요 없는 칸은 빈 문자열.`;
  return P;
}

/* --- 프롬프트 · 생성기 --- */
function presetPromptForge(){
  const P = defaultPreset();
  P.id = 'prompt-forge'; P.name = '프롬프트 생성기'; P.group = 'prompt'; P.kind = 'prompt'; P.needs='optional';
  P.schema = [
    {key:'title',      label:'제목',      hint:'이 프롬프트가 하는 일 한 줄'},
    {key:'role',       label:'역할 정의', hint:'모델이 무엇이 되는가. 무엇을 하지 않는 사람인지까지'},
    {key:'principles', label:'작동 원칙', hint:'3~5개. 각 원칙에 나쁜 예와 좋은 예를 하나씩 붙일 것'},
    {key:'rules',      label:'항목별 규칙', hint:'출력의 각 부분을 어떻게 쓸지. 형식이 다른 부분은 다른 규칙을 줄 것'},
    {key:'format',     label:'출력 형식', hint:'그대로 따라 쓸 수 있는 골격. 예시 포함'},
    {key:'tests',      label:'자기 검증', hint:'모델이 출력 전에 스스로 돌릴 통과 기준. 실패했을 때 무엇을 하는지까지'},
    {key:'forbid',     label:'금지 사항', hint:'하지 말아야 할 것. 흔히 빠지는 함정 위주로 구체적으로'},
    {key:'usage',      label:'쓰는 법',   hint:'어디에 무엇을 채워 넣는가. 변수 자리와 예시'}
  ];
  P.stages.digest.blocks[1].content =
`다음은 사용자가 만들고 싶은 프롬프트에 대한 설명과 참고 자료다.

--- 자료 시작 ---
{{source}}
--- 자료 끝 ---

무엇을 만들어야 하는지 정리하라. 프롬프트를 아직 쓰지 마라.

{
  "goal": "이 프롬프트가 최종적으로 뭘 만들어내야 하는가",
  "output_shape": "결과물의 형태 (문서 / 시트 / 대화 / 목록 / 코드 등)",
  "reader": "그 결과물을 쓰는 사람",
  "given": ["사용자가 이미 정해놓은 요구"],
  "open": ["정해지지 않아 프롬프트가 결정해야 하는 것"],
  "failure_modes": ["이런 종류의 프롬프트가 흔히 실패하는 방식 (최대 6개)"]
}`;
  P.stages.seed.blocks[1].content =
`정리된 요구:
{{digest}}

이 프롬프트를 짜는 방향을 {{seedCount}}개 제안하라.

조건
- 각 방향은 통제의 세기가 다를 것 (빡빡한 규칙 / 원칙 중심 / 예시 중심 / 대화형 진행 등)
- 각 방향이 어떤 실패를 막고 대신 무엇을 포기하는지 드러날 것
- 한 줄 안에 "어떻게 통제하는가"와 "무엇을 얻는가"가 담길 것
{{extraRule}}
[{"id":"s1","line":"한 문장 요약","hook":"막으려는 실패","angle":"대신 포기하는 것"}]`;
  P.stages.expand.maxTokens = 3600;
  P.stages.expand.temperature = 0.75;
  P.stages.expand.blocks = [
    {role:'system', content:
`당신은 다른 모델에게 먹일 프롬프트를 쓰는 사람이다.{{toneRule}}
결과물은 사람이 읽는 설명서가 아니라 모델이 따르는 지시문이다.

원칙
- 추상적인 요구를 쓰지 마라. "구체적으로", "깊이 있게", "자연스럽게"는 아무것도 지시하지 않는다
- 지킬 수 없는 규칙보다 검사할 수 있는 규칙을 써라. 통과 여부를 판정할 수 있어야 한다
- 하지 말라는 말만으로는 부족하다. 대신 무엇을 할지 함께 적어라
- 나쁜 예와 좋은 예를 나란히 보이는 것이 설명 세 문장보다 강하다
- 규칙이 많을수록 좋은 게 아니다. 서로 겹치거나 충돌하는 규칙은 지시를 약하게 만든다
- 출력 형식을 못 박아라. 형식이 흔들리면 뒤에서 처리할 수 없다

출력은 {{lang}}로. 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`정리된 요구:
{{digest}}

고른 방향:
{{seed}}

참고 자료:
{{source}}

이 프롬프트를 아래 칸으로 완성하라.
{{schemaSpec}}

작성 규칙
- 작동 원칙은 3~5개로 줄이고 각각에 나쁜 예와 좋은 예를 하나씩 붙일 것. 예는 실제 문장이어야 한다
- 자기 검증 항목은 모델이 스스로 판정할 수 있는 질문 형태로 쓰고, 실패했을 때 무엇을 하는지까지 적을 것
- 금지 사항은 "흔히 이렇게 망한다"에서 출발할 것. 일반론 금지
- 출력 형식은 그대로 복사해 쓸 수 있는 골격으로 보일 것
- 사용자가 채워 넣을 자리는 대괄호 변수로 표시할 것 (예: [대상 자료])
- 프롬프트 안에서 다시 프롬프트를 설명하지 말 것. 지시만 남길 것
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`요구:
{{digest}}

검사 대상:
{{card}}

아래만 지적하라. 문장을 다시 쓰지 말 것.
- 판정할 수 없는 지시 ("구체적으로", "자연스럽게", "깊이 있게" 같은 것)
- 서로 충돌하거나 겹치는 규칙
- 하지 말라고만 하고 대신 할 것을 주지 않은 곳
- 예가 없어서 뜻이 갈릴 수 있는 원칙
- 출력 형식이 불분명해 뒤에서 처리하기 어려운 곳
- 처음 요구에서 벗어난 곳

어긋난 곳이 없으면 violations를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇이 문제인가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}


/* --- 점검 · 분류별 --- */
function auditBase(){
  const P = presetAudit();
  P.stages.expand.maxTokens = 3400;
  return P;
}
function presetWorldAudit(){
  const P = auditBase();
  P.id='world-audit'; P.name='세계 점검'; P.group='world'; P.kind='report'; P.needs='required';
  P.schema=[
    {key:'verdict',   label:'한 줄 진단', hint:'이 세계가 지금 어떤 상태인지 한 문장'},
    {key:'working',   label:'살아 있는 곳', hint:'실제로 작동하는 부분과 그 이유. 칭찬이 아니라 진단'},
    {key:'foundation',label:'토대',     hint:'전제와 규칙이 서로를 지탱하는가. 규칙 하나를 빼면 무너지는 곳은 어디인가'},
    {key:'gaps',      label:'비어 있는 곳', hint:'인물을 놓을 자리가 있는가. 다 정해져서 들어갈 틈이 없는 곳도 문제다'},
    {key:'contradictions',label:'어긋나는 곳', hint:'규칙끼리, 세력 동기와 행동이, 생활과 규칙이 충돌하는 지점. 어느 쪽을 살릴지 선택지까지'},
    {key:'texture',   label:'생활의 질감', hint:'사람이 여기서 어떻게 먹고 자고 버는지가 보이는가. 구체적인 숫자나 물건이 있는가'},
    {key:'generic',   label:'흔한 곳',   hint:'어떤 클리셰인지 이름을 붙이고, 비트는 방법을 하나씩'},
    {key:'additions', label:'채우면 좋을 것', hint:'바로 붙여 쓸 수 있는 문안으로. "더 자세히" 같은 말 금지'},
    {key:'questions', label:'정해야 할 질문', hint:'만든 사람만 답할 수 있는 것 5~8개'}
  ];
  P.stages.expand.blocks[1].content =
`훑어본 결과:
{{digest}}

자료 원문:
{{source}}

이 세계를 아래 칸으로 봐주어라.
{{schemaSpec}}

보는 기준
- 규칙이 만들어내는 불편과 편법이 적혀 있는가. 규칙만 있고 결과가 없으면 작동하지 않는 규칙이다
- 세력이 선악으로 갈려 있지 않은가. 각자 무엇을 지키려다 부딪히는지가 보이는가
- 용어를 만들어놓고 쓰지 않는 곳, 뜻이 흔들리는 곳
- 규칙대로면 그렇게 살 수 없는데 생활 묘사가 따로 노는 곳
- 연표가 길고 지금 벌어지는 일이 적은 곳
- 세계가 너무 완결되어 인물이 들어갈 자리가 없는 곳
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`;
  return P;
}
function presetCharAudit(){
  const P = auditBase();
  P.id='char-audit'; P.name='인물 점검'; P.group='character'; P.kind='report'; P.needs='required';
  P.schema=[
    {key:'verdict',       label:'한 줄 진단', hint:'이 인물이 지금 어떤 상태인지 한 문장'},
    {key:'working',       label:'살아 있는 곳', hint:'실제로 작동하는 부분과 그 이유. 칭찬이 아니라 진단'},
    {key:'differentiation',label:'분화',    hint:'이름을 지우면 다른 인물에게 그대로 붙는 문장을 찾아 인용할 것'},
    {key:'causality',     label:'인과',     hint:'원인이 추적되지 않는 특성. "그냥 그렇다"로 남은 것'},
    {key:'voice',         label:'목소리',   hint:'말투가 성격과 맞는가. 예문들이 같은 사람 말로 들리는가'},
    {key:'playable',      label:'굴러가는가', hint:'대화 대여섯 번 안에 이 인물이 무엇을 원하고 무엇을 두려워하는지 드러나는가'},
    {key:'agency',        label:'{user} 자리', hint:'{user}의 성격·반응·감정을 멋대로 정한 곳. 관계의 결말을 미리 못 박은 곳'},
    {key:'generic',       label:'흔한 곳',   hint:'어떤 클리셰인지 이름을 붙이고, 비트는 방법을 하나씩'},
    {key:'additions',     label:'채우면 좋을 것', hint:'바로 붙여 쓸 수 있는 문안으로'},
    {key:'questions',     label:'정해야 할 질문', hint:'만든 사람만 답할 수 있는 것 5~8개'}
  ];
  P.stages.expand.blocks[1].content =
`훑어본 결과:
{{digest}}

자료 원문:
{{source}}

이 인물을 아래 칸으로 봐주어라.
{{schemaSpec}}

보는 기준
- 강점이 한 영역에 묶여 있는가. 결함이 실제로 대가를 치르는가
- 형용사로만 적힌 성격이 있는가. 관찰 가능한 행동으로 바뀌어야 한다
- 배경이 길고 지금의 일과·의존·목표가 적은 곳
- 능력이 있다면 발동·대상·효과·대가·한계·실패가 갖춰져 있는가
- 모든 면이 매력적인 인물이 되어 있지 않은가
- 말투 예문이 없거나, 있어도 서로 다른 사람 말처럼 들리는 곳
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`;
  return P;
}
function presetPromptAudit(){
  const P = auditBase();
  P.id='prompt-audit'; P.name='프롬프트 점검'; P.group='prompt'; P.kind='report'; P.needs='required';
  P.schema=[
    {key:'verdict',  label:'한 줄 진단', hint:'이 프롬프트가 지금 어떤 상태인지 한 문장'},
    {key:'working',  label:'살아 있는 곳', hint:'실제로 작동하는 부분과 그 이유. 칭찬이 아니라 진단'},
    {key:'testable', label:'판정 가능성', hint:'"구체적으로", "자연스럽게" 같은 판정할 수 없는 지시를 찾아 인용하고 대체 문안을 낼 것'},
    {key:'conflicts',label:'충돌·중복',  hint:'서로 부딪히거나 겹쳐서 지시를 약하게 만드는 규칙'},
    {key:'coverage', label:'빠진 통제',  hint:'이런 종류의 프롬프트가 흔히 실패하는 방식 중 막지 못하고 있는 것'},
    {key:'format',   label:'출력 형식',  hint:'형식이 흔들려 뒤에서 처리하기 어려운 곳. 예시가 없어 뜻이 갈리는 곳'},
    {key:'weight',   label:'분량',      hint:'규칙이 너무 많아 묻히는 곳, 반대로 핵심인데 한 줄로 지나간 곳'},
    {key:'additions',label:'채우면 좋을 것', hint:'바로 붙여 쓸 수 있는 문안으로'},
    {key:'questions',label:'정해야 할 질문', hint:'만든 사람만 답할 수 있는 것 5~8개'}
  ];
  P.stages.expand.blocks[1].content =
`훑어본 결과:
{{digest}}

자료 원문:
{{source}}

이 프롬프트를 아래 칸으로 봐주어라.
{{schemaSpec}}

보는 기준
- 하지 말라고만 하고 대신 할 것을 주지 않은 곳
- 나쁜 예와 좋은 예가 없어 해석이 갈리는 원칙
- 모델이 스스로 판정할 수 있는 검증 항목이 있는가
- 프롬프트 안에서 프롬프트를 설명하고 있는 곳 (지시가 아니라 해설)
- 사용자가 채워 넣을 자리가 표시되어 있는가
- 롤플레이용이라면 {user}의 성격·반응을 프롬프트가 정하고 있지 않은가
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`;
  return P;
}

/* --- 프로필 양식 설계 (JSON 뽑기) --- */
function presetSchemaForge(){
  const P = defaultPreset();
  P.id='schema-forge'; P.name='프로필 양식 설계 (JSON)'; P.group='all'; P.kind='schema'; P.needs='required';
  P.skipSeed = true;
  P.schema=[
    {key:'form_name', label:'양식 이름', hint:'이 세계 전용 프로필 양식의 이름 한 줄'},
    {key:'why',       label:'왜 이 칸인가', hint:'이 세계라서 필요한 칸이 무엇이고 왜인지. 3~5줄'},
    {key:'schema_json', label:'칸 정의 (JSON)', hint:'[{"key":"영문키","label":"한글 이름","hint":"이 칸에 무엇을 어떻게 적을지"}] 형태의 JSON 배열만. 다른 말 금지'},
    {key:'rules',     label:'작성 규칙', hint:'이 양식으로 인물을 쓸 때 지킬 규칙. 한 줄에 하나씩'},
    {key:'checks',    label:'검사 항목', hint:'완성된 프로필을 검사할 기준. 한 줄에 하나씩'}
  ];
  P.stages.digest.blocks[1].content =
`다음 자료를 읽고 인물 프로필 양식을 설계하기 위한 재료를 정리하라.

--- 자료 시작 ---
{{source}}
--- 자료 끝 ---

{
  "roles": ["이 세계에 있을 수 있는 인물의 자리 (직능·계급·종별)"],
  "identifiers": ["번호·계급·호칭·코드명처럼 인물에게 붙는 식별자와 그것이 누구의 것인지"],
  "mechanics": ["초자연·기술·제도적 능력의 이름과 그것이 가진 조건·대가·한계"],
  "states": ["인물이 지속적으로 지니는 수치나 상태 (누적도·오염도·계약·등급 등)"],
  "dependencies": ["혼자서는 성립하지 않고 상대·도구·기관이 있어야 하는 관계"],
  "daily": ["생활·직업·거주·등록처럼 평상시를 규정하는 것"],
  "confusables": ["서로 헷갈리기 쉬워 반드시 구분해야 하는 용어 쌍"]
}`;
  P.stages.expand.maxTokens = 3000;
  P.stages.expand.temperature = 0.6;
  P.stages.expand.blocks=[
    {role:'system', content:
`당신은 특정 세계 전용 인물 프로필 양식을 설계하는 사람이다.{{toneRule}}
결과물은 사람이 읽는 설명이 아니라, 이 세계의 인물을 적을 때 그대로 쓰는 칸 정의다.
출력은 {{lang}}로. 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`세계 재료:
{{digest}}

자료 원문:
{{source}}

이 세계 전용 인물 프로필 양식을 아래 칸으로 설계하라.
{{schemaSpec}}

칸을 정하는 기준
- 자리(역할)를 먼저 정하게 하는 칸이 맨 앞에 올 것. 외형과 능력은 그 다음이다
- 이 세계에만 있는 것에 칸을 줄 것. 어느 세계에나 있는 항목만 나열하면 실패다
- 식별자가 있는 세계라면 그것이 누구의 것인지 틀리지 않게 하는 칸을 둘 것
- 능력 칸은 발동 · 대상 · 효과 · 범위 · 대가 · 한계 · 실패를 적게 할 것. 감정적 의미로 대신하지 못하게 할 것
- 지속 상태(누적도·오염도·계약 등)가 있으면 현재 값을 적는 칸을 둘 것
- 평상시 생활·소속·등록을 적는 칸을 하나 둘 것
- {user}와 지금 어떻게 엮이는지 적는 칸을 반드시 둘 것
- 칸은 6~10개로 줄일 것. 많을수록 좋은 게 아니다
- 능력이 없는 인물도 쓸 수 있도록, 비워도 되는 칸은 hint에 그렇게 적을 것

schema_json 규칙
- 반드시 JSON 배열 하나. key 는 영문 소문자와 밑줄만. label 은 한글
- hint 에는 그 칸에 무엇을 어떤 형식으로 적을지 구체적으로 적을 것

작성 규칙과 검사 항목
- 규칙은 지킬 수 있고 검사할 수 있는 형태로 쓸 것
- 이 세계에서 자주 나올 실수를 막는 규칙을 넣을 것 (용어 혼동, 식별자 오귀속, 자리에 없는 권한)
- {user}의 성격·반응·관계의 결말을 정하지 말라는 규칙을 반드시 포함할 것
{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`세계 재료:
{{digest}}

검사 대상:
{{card}}

아래만 지적하라.
- schema_json 이 유효한 JSON 배열이 아니거나 key/label/hint 가 빠진 항목
- 어느 세계에나 있는 일반적인 칸만 있고 이 세계 고유의 칸이 없는 경우
- 능력 칸에 대가·한계·실패가 빠진 경우
- 식별자가 누구의 것인지 헷갈리게 되어 있는 경우
- {user} 관련 규칙이 없는 경우
- 칸이 10개를 넘어 쓰기 어려운 경우

어긋난 곳이 없으면 violations 를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇이 문제인가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}

/* --- 첫 만남 (그리팅) --- */
function presetGreeting(){
  const P = defaultPreset();
  P.id='greeting'; P.name='첫 만남 (그리팅)'; P.group='character'; P.kind='character'; P.needs='required';
  P.schema=[
    {key:'title',     label:'장면 제목', hint:'한 줄'},
    {key:'tone',      label:'톤',       hint:'긴장 / 따뜻함 / 소란 / 쓸쓸함 / 불길함 중 하나와 짧은 설명'},
    {key:'first_mes', label:'첫 만남',  hint:'그대로 카드에 넣을 본문. 단순한 상황이면 2~4문단, 복잡하면 5~8문단'},
    {key:'opened',    label:'열어둔 것', hint:'{user}가 채워야 할 빈자리가 무엇인지 한두 줄. 본문에는 넣지 않는다'}
  ];
  P.stages.seed.maxTokens = 1300;
  P.stages.seed.blocks[1].content =
`인물 요약:
{{digest}}

이 인물로 열 수 있는 첫 장면을 {{seedCount}}개 제안하라.

각 제안은 서로 다른 긴장을 쓸 것. 같은 상황의 변형을 나열하지 말 것.
자료에 없는 사건을 새로 만들지 말고, 이미 있는 갈등이나 일과에서 출발할 것.
{{extraRule}}
[{"id":"s1","line":"한 줄 전제","hook":"어떤 긴장인가 · 무엇이 걸려 있는가","angle":"톤 (긴장/따뜻함/소란/쓸쓸함/불길함 중 하나)"}]`;
  P.stages.expand.maxTokens = 3000;
  P.stages.expand.temperature = 0.95;
  P.stages.expand.blocks=[
    {role:'system', content:
`당신은 캐릭터 카드의 첫 장면을 쓰는 사람이다.{{toneRule}}
읽는 사람이 곧바로 이어서 행동할 수 있는 장면을 만든다.

시점 — 자료에 정해진 시점을 따른다. 없으면 인물에 한정된 3인칭.

{user} 보호 — 절대 어기지 않는다
- {user}의 대사·행동·생각·외모·감정 상태를 쓰지 않는다
- {user}는 정의된 인물이 아니라 그 자리에 있는 존재다
- 인물이 {user}를 이미 깊이 안다고 전제하지 않는다 (전제가 그렇게 정해진 경우 제외)

출력은 {{lang}}로. 유효한 JSON 하나만. 코드펜스·설명·머리말 금지.`},
    {role:'user', content:
`세계 요약:
{{digest}}

고른 장면:
{{seed}}

인물 자료:
{{source}}
{{card}}

첫 장면을 아래 칸으로 써라.
{{schemaSpec}}

본문의 짜임
1 장면 진입 — 물리적 환경으로 심리적 온도를 암시할 것. 설명하지 말고 세부만 놓을 것
2 움직이는 인물 — 장면이 시작될 때 인물은 이미 무언가를 하고 있을 것. 대사보다 행동이 먼저 성격을 드러낼 것
3 접점 — 인물과 {user}의 공간이 겹치는 순간. 꼭 대화일 필요는 없다. 근접·인기척·우연도 된다
4 걸이 — 끝나지 않은 행동, 답이 없는 몸짓, 상황의 압력. {user}만 채울 수 있는 빈자리를 만들 것
5 유예 — 무언가 막 벌어지려는 지점에서 끊을 것. 팽팽하되 닫히지 않게

톤 맞추기
- 인물이 불안정하면 평범한 표면 아래 잠재된 긴장으로
- 인물이 따뜻하면 조용한 친밀함에 풀리지 않은 실 하나를 남겨서
- 인물이 소란스러우면 이미 조금 통제를 벗어난 상황 한복판에서
- 인물이 과묵하면 성기게, 말하지 않은 것의 무게로

금지
- 서술자가 독자에게 세계를 설명하는 것
- {user}의 외모·과거·감정 상태를 적는 것
- 이미 해결된 상황 ({user}가 반응할 것이 남아 있어야 한다)
- 서술자가 독자에게 질문을 던지며 끝내는 것
- "당신은 ~한 인물을 본다" 형태
- 자료에 없는 조직·사건·규칙을 새로 만드는 것
{{nsfwRule}}{{extraRule}}
{"칸이름":"내용"} 형태로만 출력.`}];
  P.stages.check.blocks[1].content =
`인물 자료:
{{source}}

검사 대상:
{{card}}

아래만 지적하라. 문장을 다시 쓰지 말 것.
- {user}의 대사·행동·생각·외모·감정을 쓴 곳
- 상황이 이미 해결되어 {user}가 반응할 것이 남지 않은 곳
- 서술자가 세계를 설명하거나 독자에게 질문하며 끝내는 곳
- 인물이 {user}를 이미 깊이 아는 것으로 되어 있는 곳 (전제에 없는데)
- 인물의 말투·성격이 자료와 어긋나는 곳
- 자료에 없는 조직·사건·규칙을 새로 만든 곳
- 장면이 닫혀서 이어갈 여지가 없는 곳

어긋난 곳이 없으면 violations 를 빈 배열로 둔다.

{
  "violations":[{"field":"칸이름","quote":"문제가 되는 부분","issue":"무엇이 문제인가","severity":"high 또는 low","fix":"대체 문안"}],
  "verdict":"pass 또는 warn 또는 fail"
}`;
  return P;
}

/* ============================================================
   [ 내가 만든 프리셋을 index.html에 아예 넣는 곳 ]

   여기 배열에 넣은 프리셋은 파일에 박혀서, 브라우저 저장을 지우거나
   다른 기기에서 열어도 항상 기본으로 다시 만들어집니다.
   (양식 탭에서 만든 것은 이 브라우저의 저장소에만 남습니다.)

   넣는 방법 — 둘 중 하나:

   (A) 손으로 프리셋 함수를 만들어 배열에 추가
       1) 위의 다른 preset...() 함수(예: defaultPreset)를 복사해
          함수 이름과 id·name을 바꾼다. id는 다른 프리셋과 겹치지 않게.
          - id  : 내부 식별자 (영문, 고유값)   예: 'my-hero'
          - name: 화면에 뜨는 이름              예: '내 주인공 양식'
          - group: 'world' | 'character' | 'prompt' | 'all'  (어느 탭에 뜰지)
          - schema: 출력 칸 목록  [{key,label,hint}, ...]
          - stages: 공정별 지시문 (digest/seed/expand/check ...)
       2) 그 함수 이름을 아래 배열에 한 줄 추가한다.  예: myHeroPreset(),

   (B) 양식 탭에서 만든 프리셋을 그대로 붙여넣기 (더 쉬움)
       1) 양식 탭에서 프리셋을 완성한 뒤 '내보내기'로 JSON을 받는다.
       2) 그 JSON을 아래처럼 함수로 감싸 이 파일 어딘가에 붙인다:
            function myHeroPreset(){ return (붙여넣은 JSON 객체); }
       3) 그 함수 이름을 아래 배열에 추가한다.

   ※ 껐다 켜기: 여기 넣어도 양식 탭의 눈 단추로 작업대 목록에서 숨길 수 있고,
      숨김 상태(off)는 이 브라우저에만 저장됩니다.
   ============================================================ */
function builtinPresets(){ return [
  presetPromptForge(), presetPromptcraft(), presetPromptAudit(),
  presetWorld(), presetWorldBrief(), presetWorldGuide(), presetWorldAudit(),
  defaultPreset(), presetCharEngine(), presetProfileKo(), presetGreeting(), presetDrives(), presetCharAudit(),
  presetSchemaForge()
  // , myHeroPreset()   ← 내가 만든 프리셋 함수를 이 줄처럼 추가
]; }

/* ============================================================
   [ 기본 공통 지시문 ]
   두 곳 중 '하나만' 쓰인다(합치지 않음 — 중복 방지):
   - 편집기 '앱에 반영'(localStorage)이 있으면 → 그게 앱의 현재값(대체)
   - 반영이 없으면(또는 '반영 해제') → prompts.js(window.BUILTIN_COMMON)
   즉 편집기에서 반영하면 그 내용이 곧 앱값이고, 반영 해제하면 prompts.js로 돌아간다.
   prompts.js 는 커밋되는 배포 기본값, 반영본은 이 브라우저에만 남는다.
   ============================================================ */
const COMMON_EXTRA_KEY = 'orrery.commonExtra.v1';
function normCommon(arr){
  const out = [];
  (Array.isArray(arr)?arr:[]).forEach(x=>{ if(x && typeof x.content==='string' && x.content.trim())
    out.push({ name:x.name||'', content:x.content,
      groups:(x.groups && x.groups!=='all' && x.groups.length)?x.groups:undefined, role:x.role||undefined }); });
  return out;
}
function builtinCommon(){
  // (1) 편집기 반영본이 있으면 그것만 사용 (키가 존재하면 우선 — 빈 배열이면 '아무것도 없음'을 뜻함)
  try{
    const raw = localStorage.getItem(COMMON_EXTRA_KEY);
    if(raw !== null){ return normCommon(JSON.parse(raw)); }
  }catch(_){ }
  // (2) 반영이 없으면 prompts.js (커밋되는 앱 기본값)
  try{ return normCommon(typeof window!=='undefined' ? window.BUILTIN_COMMON : []); }catch(_){ return []; }
}
// 지금 분류에 해당하는 기본 공통 지시문 — 모든 생성 앞에 자동으로 붙는다(딸깍 반영의 실제 적용부)
function activeBuiltinCommons(v){
  const g = S.opts.group || 'character';
  try{
    return builtinCommonItems()
      .filter(it => it.groups.includes(g))
      .map(it => ({ role: it.role, content: render(it.content, v) }));
  }catch(_){ return []; }
}

const MODE_NOTE = {
  digest:{
    'character:foil':`이 자료는 한 인물의 캐릭터 카드다. 위 형식에 더해 다음 두 키를 반드시 포함하라.
  "counterpartNeeds": ["이 인물이 상대에게 필요로 하는 것"],
  "frictionPoints": ["이 인물과 충돌하거나 긴장이 생길 지점"]`,
    'character:supplement':`자료 속 기존 인물을 새 인물의 참고 자료로 취급하지 말고, 보충할 원본으로 읽어라. 확정된 정체성·관계·사건·말투를 분리하고, 비어 있거나 얇거나 서로 연결되지 않은 부분을 찾아라.`,
    'world:supplement':`자료 속 기존 세계를 보충할 원본으로 읽어라. 확정 사실과 미정 영역을 구분하고, 기존 규칙을 바꾸지 않고도 채울 수 있는 빈틈을 찾아라.`,
    'prompt:supplement':`자료 속 기존 프롬프트를 보충할 원본으로 읽어라. 이미 작동하는 지시, 빠진 통제, 모호하거나 충돌하는 규칙을 구분하라.`,
    'prompt:adapt':`자료 속 기존 프롬프트의 핵심 목적과 작동 원리를 먼저 추출하고, 다른 용도에 옮길 때 유지할 것과 바꿀 것을 구분하라.`
  },
  seed:{
    'character:foil':`\n만들 대상은 위 인물의 상대역이다. counterpartNeeds와 frictionPoints를 출발점으로 삼되, 순순히 맞춰주는 인물은 만들지 마라.\n`,
    'character:supplement':`\n새 인물을 만들지 말고 기존 인물을 보충할 서로 다른 방향을 제안하라. 원본과 충돌하지 않으며, 단순 수식어 추가가 아니라 행동·관계·선택에 영향을 주는 보강이어야 한다.\n`,
    'world:supplement':`\n새 세계로 갈아엎지 말고 기존 세계의 빈틈을 보충할 서로 다른 방향을 제안하라. 생활, 제도, 자원, 갈등의 인과 중 실제 사용 가치가 큰 쪽을 우선하라.\n`,
    'prompt:supplement':`\n새 프롬프트를 처음부터 만들지 말고 기존 프롬프트의 빠진 통제나 모호한 작동 규칙을 보충할 방향을 제안하라.\n`,
    'prompt:adapt':`\n기존 프롬프트의 장점은 유지하면서 사용자가 적은 새 용도에 맞추는 변형 방향을 제안하라.\n`
  },
  expand:{
    'character:foil':`\n이 인물은 자료 속 캐릭터의 상대역이다. 두 사람이 마주쳤을 때 무엇이 어긋나는지가 드러나야 한다.\n`,
    'character:supplement':`\n자료 속 기존 인물의 완성본을 출력하라. 확정된 내용은 보존하고, 고른 보강 방향을 자연스럽게 통합하라. 새로 쓴 부분이 원본 설정인 것처럼 기존 사실을 몰래 바꾸지 마라.\n`,
    'world:supplement':`\n자료 속 기존 세계의 보충된 완성본을 출력하라. 기존 규칙과 고유명사는 보존하고, 고른 보강이 원인과 결과로 연결되게 하라.\n`,
    'prompt:supplement':`\n자료 속 기존 프롬프트의 보충된 완성본을 출력하라. 이미 작동하는 부분은 보존하고 빠진 통제·경계조건·출력 규칙만 명확히 통합하라.\n`,
    'prompt:adapt':`\n기존 프롬프트의 장점을 보존한 채 사용자가 적은 새 용도에 맞는 완성본을 출력하라. 원래 용도에만 해당하는 규칙은 무작정 남기지 마라.\n`
  }
};
function modeNote(stage){
  return (MODE_NOTE[stage] && MODE_NOTE[stage][S.opts.group+':'+activeMode()]) || '';
}

function curExtra(){
  const e = S.opts.extraBy || (S.opts.extraBy = {world:'',character:'',prompt:''});
  return (e[S.opts.group] || '').trim();
}
function activePreset(){
  return S.presets.find(p=>p.id===S.activePreset) || S.presets[0];
}
function render(tpl, vars){
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (m,k)=> (k in vars) ? String(vars[k]??'') : '');
}
function schemaSpec(){
  return activePreset().schema.map(f=>`- ${f.key} (${f.label})${f.hint?': '+f.hint:''}`).join('\n');
}
function baseVars(extra){
  const o = S.opts;
  return Object.assign({
    lang: o.lang || '한국어',
    tone: o.tone || '',
    toneRule: o.tone ? ` 전체 톤은 "${o.tone}"에 맞춘다.` : '',
    seedCount: o.seedCount || 5,
    extra: curExtra(),
    extraRule: curExtra() ? `- ${curExtra()}\n` : '',
    nsfwRule: o.nsfw ? '- 성인 요소를 허용한다.\n' : '- 성적인 묘사는 넣지 않는다.\n',
    schemaSpec: schemaSpec(),
    modeNote:'', castNote:'', digest:'', seed:'', card:'', cast:'',
    locked:'', unlocked:'', instruction:'', source:''
  }, extra||{});
}

/* --- JSON 뽑아내기 --- */
function extractJson(text){
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
  const s1 = t.indexOf('{'), s2 = t.indexOf('[');
  let s = (s1<0) ? s2 : (s2<0 ? s1 : Math.min(s1,s2));
  if(s<0) throw new Error('JSON을 찾지 못했습니다.');
  const openCh = t[s], closeCh = openCh==='{' ? '}' : ']';
  let depth=0, inStr=false, escq=false, end=-1;
  for(let i=s;i<t.length;i++){
    const c=t[i];
    if(inStr){ if(escq) escq=false; else if(c==='\\') escq=true; else if(c==='"') inStr=false; continue; }
    if(c==='"'){ inStr=true; continue; }
    if(c===openCh) depth++;
    else if(c===closeCh){ depth--; if(depth===0){ end=i; break; } }
  }
  if(end<0) throw new Error('JSON이 중간에 끊겼습니다.');
  return JSON.parse(t.slice(s,end+1));
}

function stripJsonFence(text){
  return String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
}
function joinResponseChunks(first, next){
  const a=String(first||''), b=stripJsonFence(next);
  if(!b) return a;
  if(b.startsWith(a.trim())) return b;
  const limit=Math.min(1200,a.length,b.length);
  for(let n=limit;n>=3;n--){ if(a.slice(-n)===b.slice(0,n)) return a+b.slice(n); }
  return a+b;
}
async function parseJsonReply(conn, msgs, opts, raw, retryOnce){
  try{ return {json:extractJson(raw), raw, continued:false}; }
  catch(firstErr){
    if(retryOnce===false){ const err=new Error('응답을 해석하지 못했습니다.'); err.raw=raw; throw err; }
    const cut=/중간에 끊겼/.test(firstErr.message||'');
    log(cut ? 'JSON 출력이 중간에 끊겨 이어받습니다.' : 'JSON 해석 실패 — 한 번 다시 시도합니다: '+firstErr.message,'err');
    const follow = cut
      ? msgs.concat([
          {role:'assistant', content:raw},
          {role:'user', content:'방금 출력이 응답 한도 때문에 중간에 끊겼다. 앞부분이나 JSON 시작을 반복하지 말고, 마지막 문자 바로 다음부터 남은 JSON만 이어서 끝내라. 코드펜스·설명은 쓰지 마라.'}
        ])
      : msgs.concat([
          {role:'assistant', content:raw.slice(0,1200)},
          {role:'user', content:'방금 출력이 JSON으로 해석되지 않았다. 설명·코드펜스 없이 유효한 JSON 하나만 다시 출력하라.'}
        ]);
    let raw2;
    try{ raw2=await callProvider(conn,follow,opts); }
    catch(callErr){ callErr.raw=raw; throw callErr; }
    const candidates=cut ? [joinResponseChunks(raw,raw2),raw2] : [raw2];
    for(const candidate of candidates){
      try{
        const json=extractJson(candidate);
        if(cut) log('끊긴 JSON을 이어받아 복구했습니다.','ok');
        return {json,raw:candidate,continued:cut};
      }catch(_){ }
    }
    const err=new Error(cut?'이어받은 응답도 JSON으로 끝나지 않았습니다.':'응답을 JSON으로 해석하지 못했습니다.');
    err.raw=candidates[0]||raw2||raw; throw err;
  }
}
function decodeJsonFragment(raw){
  let s=String(raw||'');
  if(/\\$/.test(s)) s=s.slice(0,-1);
  try{ return JSON.parse('"'+s+'"'); }
  catch(_){
    return s.replace(/\\u([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
      .replace(/\\n/g,'\n').replace(/\\r/g,'\r').replace(/\\t/g,'\t')
      .replace(/\\"/g,'"').replace(/\\\\/g,'\\');
  }
}
function readJsonStringFragment(text, start){
  let raw='', escaped=false, closed=false;
  for(let i=start;i<text.length;i++){
    const ch=text[i];
    if(!escaped && ch==='"'){ closed=true; break; }
    raw+=ch;
    if(escaped) escaped=false; else if(ch==='\\') escaped=true;
  }
  return {value:decodeJsonFragment(raw),closed};
}
function recoverPartialCard(raw, schema){
  const text=stripJsonFence(raw), fields={}; let incompleteKey='';
  (schema||[]).forEach(f=>{
    const key=String(f.key||''); if(!key) return;
    const safe=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const m=new RegExp('"'+safe+'"\\s*:\\s*"','g').exec(text); if(!m) return;
    const part=readJsonStringFragment(text,m.index+m[0].length);
    fields[key]=part.value; if(!part.closed) incompleteKey=key;
  });
  return Object.keys(fields).length ? {fields,incompleteKey} : null;
}

async function runStage(stageName, vars, retryOnce){
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) throw new Error('먼저 연결 탭에서 API 연결을 하나 만들어 주세요.');
  const P = activePreset(), st = P.stages[stageName];
  if(!st) throw new Error('공정 정의가 없습니다: '+stageName);
  const v = baseVars(Object.assign({ source: sourceText() }, vars||{}));
  const commons = activeBuiltinCommons(v).concat(
    (P.common||[]).filter(c=>c.enabled && (c.content||'').trim())
      .map(c=>({role:c.role||'system', content: render(c.content, v)})));
  const msgs = commons.concat(
    st.blocks.map(b=>({role:b.role, content: render(b.content, v)}))
             .filter(m=>m.content.trim()));
  const req = curExtra();
  if(req && !st.blocks.some(b=>/\{\{extra(Rule)?\}\}/.test(b.content))){
    msgs.push({role:'user', content:'추가 요청 — 아래를 반드시 지킬 것.\n'+req});
  }
  const opts = {temperature:st.temperature, maxTokens:st.maxTokens};
  const raw = await callProvider(conn, msgs, opts);
  return (await parseJsonReply(conn,msgs,opts,raw,retryOnce)).json;
}

/* --- 공정 실행 --- */
async function doDigest(){
  const src = sourceText();
  if(!src.trim()){
    throw new Error(activePreset().needs === 'required'
      ? '이 양식은 읽을 원본이 필요합니다. 재료를 넣거나 구상 칸에 원문을 붙여 주세요.'
      : '재료를 넣거나, 작업대의 구상 칸에 몇 마디만 적어 주세요.');
  }
  const d = await runStage('digest', { source: src, modeNote: modeNote('digest') });
  S.project.digest = d;
  S.project.digestSrc = src.slice(0,200);
  const P = activePreset();
  S.project.digestMeta = { presetId:P.id, presetName:P.name, tpl:digestTpl(P), source:src, at:Date.now() };
  stashDigest(S.opts.group);
  return d;
}
function digestStr(){ return JSON.stringify(S.project.digest, null, 1); }

async function doSeeds(){
  if(!S.project.digest) await doDigest();
  const castNote = S.project.cast.length
    ? `\n이미 만들어진 인물 (겹치지 않게):\n${S.project.cast.map(c=>'- '+(c.fields.name||'?')+': '+(c.seed?c.seed.line:'')).join('\n')}\n` : '';
  const j = await runStage('seed', { digest: digestStr(), castNote, modeNote: modeNote('seed') });
  const arr = Array.isArray(j) ? j : (j.seeds || j.items || []);
  S.project.seeds = arr.map((s,i)=>({ id:s.id||('s'+i), line:s.line||s.concept||'', hook:s.hook||'', angle:s.angle||'' }))
                       .filter(s=>s.line);
  S.project.sel = [];
  return S.project.seeds;
}
async function doCross(a,b){
  const j = await runStage('cross', {
    digest: digestStr(),
    seed: `A) ${a.line}\n   (${a.angle||''})\nB) ${b.line}\n   (${b.angle||''})`
  });
  const s = Array.isArray(j)?j[0]:j;
  const ns = { id:'x'+uid(), line:s.line||'', hook:s.hook||'', angle:s.angle||'', crossed:true };
  if(!ns.line) throw new Error('섞은 결과가 비었습니다.');
  S.project.seeds.push(ns);
  S.project.sel = [ns.id];
  return ns;
}
function seedStr(s){ if(!s) return '(따로 고른 방향 없음 — 자료 전체에서 판단할 것)'; return `${s.line}\n(출발점: ${s.hook||'-'} / 역할: ${s.angle||'-'})`; }

async function doExpand(seed){
  const P=activePreset(); let j, recovered=null;
  try{
    j = await runStage('expand', { digest: digestStr(), seed: seedStr(seed),
      modeNote: modeNote('expand') });
  }catch(err){
    recovered=err.raw && recoverPartialCard(err.raw,P.schema);
    if(!recovered) throw err;
    j=recovered.fields;
    log(`끊긴 카드에서 ${Object.keys(j).length}개 칸을 먼저 복구했습니다.`,'err');
  }
  const fields = {};
  P.schema.forEach(f=>{ if(j[f.key]!=null) fields[f.key] = String(j[f.key]); });
  Object.keys(j).forEach(k=>{ if(fields[k]==null && typeof j[k]==='string') fields[k]=j[k]; });
  return { fields, seed, truncated:!!recovered, truncatedField:recovered&&recovered.incompleteKey||'', continuations:[] };
}
async function doPatch(){
  const P = activePreset();
  const locked   = P.schema.filter(f=>S.project.locked[f.key]).map(f=>f.key);
  const unlocked = P.schema.filter(f=>!S.project.locked[f.key]).map(f=>f.key);
  if(!unlocked.length) throw new Error('전부 잠겨 있습니다. 다시 굴릴 칸을 열어 주세요.');
  const j = await runStage('patch', {
    digest: digestStr(),
    card: JSON.stringify(S.project.card.fields, null, 1),
    locked: locked.join(', ') || '(없음)',
    unlocked: unlocked.join(', '),
    instruction: ($('#rerollNote').value || '(없음)')
  });
  unlocked.forEach(k=>{ if(j[k]!=null) S.project.card.fields[k] = String(j[k]); });
  return j;
}
function mergeContinuationText(current, addition){
  const base=String(current||''), next=String(addition||'');
  if(!base) return next.trimStart();
  if(!next) return base;
  if(next.startsWith(base)) return next;
  const limit=Math.min(500,base.length,next.length);
  for(let n=limit;n>=3;n--){ if(base.slice(-n)===next.slice(0,n)) return base+next.slice(n); }
  if(/^\s/.test(next)) return base+next;
  const clean=base.trimEnd();
  const sep=/[.!?…。！？)”’"'\]}]$/.test(clean) ? '\n\n' : '';
  return base+sep+next;
}
async function doContinueCard(instruction){
  const card=S.project.card; if(!card) throw new Error('먼저 결과를 만들어 주세요.');
  const conn=S.connections.find(c=>c.id===S.activeConn);
  if(!conn) throw new Error('먼저 연결 탭에서 API 연결을 하나 만들어 주세요.');
  const P=activePreset(), st=P.stages.expand||{};
  const context=S.project.digest ? digestStr() : sourceText();
  const note=String(instruction||'').trim();
  const messages=[
    {role:'system',content:`당신은 이미 작성된 ${ASSET_PURPOSE_LABEL[S.opts.group]||'창작'} 결과를 끊긴 지점부터 잇는 편집자다. 기존 문장을 요약·반복·교체하지 않고 새 내용만 덧붙인다.`},
    {role:'user',content:`양식의 칸:\n${schemaSpec()}\n\n참고 맥락:\n${context||'(없음)'}\n\n현재 결과:\n${JSON.stringify(card.fields,null,1)}\n\n이어쓰기 지시:\n${note||'(별도 지시 없음 — 끝이 잘린 칸을 우선 찾고, 명확한 잘림이 없으면 마지막으로 내용이 있는 칸을 자연스럽게 확장)'}\n\n아래 형식의 유효한 JSON 하나만 출력하라.\n{"append":{"field_key":"기존 값 뒤에 붙일 새 문자열"}}\n- append에는 기존 양식에 있는 키만 넣어라.\n- 기존 내용을 다시 출력하지 말고 새로 붙일 부분만 써라.\n- 새 문자열 첫머리에 필요한 공백이나 줄바꿈을 포함하되, 잘린 단어를 잇는다면 공백 없이 시작하라.\n- 지시가 여러 칸을 요구하면 여러 키를 넣어도 된다.\n- 설명과 코드펜스는 쓰지 마라.`}
  ];
  const opts={temperature:st.temperature??0.75,maxTokens:Math.max(1200,st.maxTokens||2400)};
  const raw=await callProvider(conn,messages,opts);
  let j, recovered=null;
  try{ j=(await parseJsonReply(conn,messages,opts,raw,true)).json; }
  catch(err){
    recovered=err.raw&&recoverPartialCard(err.raw,P.schema);
    if(!recovered) throw err;
    j={append:recovered.fields};
    log('이어쓰기 응답도 끊겨 읽을 수 있는 부분까지만 붙였습니다.','err');
  }
  const source=(j&&typeof j==='object'&&(j.append||j.continuations||j.fields))||j||{};
  const allowed=new Set(P.schema.map(f=>f.key));
  const added={};
  Object.keys(source||{}).forEach(k=>{
    if(!allowed.has(k)||typeof source[k]!=='string'||!source[k]) return;
    const before=String(card.fields[k]||''), after=mergeContinuationText(before,source[k]);
    if(after===before) return;
    card.fields[k]=after; added[k]=source[k];
  });
  const keys=Object.keys(added); if(!keys.length) throw new Error('이어 붙일 내용을 찾지 못했습니다. 지시에 칸 이름을 적어 다시 해보세요.');
  card.continuations=Array.isArray(card.continuations)?card.continuations:[];
  card.continuations.push({at:Date.now(),instruction:note,added});
  if(card.continuations.length>20) card.continuations=card.continuations.slice(-20);
  card.truncated=!!recovered; card.truncatedField=recovered&&recovered.incompleteKey||'';
  return {keys,recovered:!!recovered};
}
// 대화에서 정해진 내용을 지금 카드에 반영 (잠근 칸은 건드리지 않음)
async function doChatToCard(){
  const card=S.project.card; if(!card) throw new Error('먼저 작업대에서 카드를 만들어 주세요.');
  if(!S.chat.msgs.length && !S.chat.summary) throw new Error('반영할 대화가 없습니다.');
  const conn=S.connections.find(c=>c.id===S.activeConn);
  if(!conn) throw new Error('먼저 연결을 만들어 주세요.');
  const P=activePreset();
  const locked = P.schema.filter(f=>S.project.locked[f.key]).map(f=>f.key);
  const editable = P.schema.filter(f=>!S.project.locked[f.key]).map(f=>f.key);
  if(!editable.length) throw new Error('모든 칸이 잠겨 있습니다. 반영할 칸을 열어 주세요.');
  const convo = (S.chat.summary?'[지금까지의 정리]\n'+S.chat.summary+'\n\n':'')
    + S.chat.msgs.map(m=>(m.role==='user'?'[나] ':'[상대] ')+m.content).join('\n\n');
  const messages=[
    {role:'system',content:`당신은 이미 작성된 카드를, 아래 대화에서 정해진 내용대로 고치는 편집자다. 대화에서 실제로 합의되거나 결정된 것만 반영하고, 언급되지 않은 칸은 절대 바꾸지 마라. 새 설정을 멋대로 지어내지 마라. ${(S.opts.lang||'한국어')} 로 쓴다.`},
    {role:'user',content:`카드의 칸:\n${schemaSpec()}\n\n지금 카드:\n${JSON.stringify(card.fields,null,1)}\n\n바꾸면 안 되는(잠긴) 칸: ${locked.join(', ')||'(없음)'}\n고칠 수 있는 칸: ${editable.join(', ')}\n\n대화:\n${convo}\n\n아래 형식의 유효한 JSON 하나만 출력하라.\n{"updates":{"칸_키":"그 칸의 새 전체 값"}}\n- updates에는 대화에서 실제로 바뀐 칸만, 고칠 수 있는 칸 중에서만 넣어라.\n- 값은 기존 값을 덮어쓸 전체 문장으로 써라(일부만 쓰지 마라).\n- 바뀐 칸이 없으면 {"updates":{}} 를 출력하라.\n- 설명·코드펜스는 쓰지 마라.`}
  ];
  const opts={temperature:0.5,maxTokens:Math.max(1600,(P.stages.expand&&P.stages.expand.maxTokens)||2400)};
  const raw=await callProvider(conn,messages,opts);
  let j;
  try{ j=(await parseJsonReply(conn,messages,opts,raw,true)).json; }
  catch(err){ const rec=err.raw&&recoverPartialCard(err.raw,P.schema); if(!rec) throw err; j={updates:rec.fields}; }
  const upd=(j&&typeof j==='object'&&(j.updates||j.fields))||{};
  const allowed=new Set(editable);
  const changed=[];
  Object.keys(upd||{}).forEach(k=>{
    if(!allowed.has(k)||typeof upd[k]!=='string') return;
    const v=String(upd[k]);
    if(!v.trim()||v===String(card.fields[k]||'')) return;
    card.fields[k]=v; changed.push(k);
  });
  if(!changed.length) throw new Error('대화에서 바꿀 내용을 찾지 못했습니다. 카드 칸에 대해 무엇을 바꿀지 대화에서 정해보세요.');
  return {keys:changed};
}
async function doCheck(){
  const j = await runStage('check', { digest: digestStr(),
    card: JSON.stringify(S.project.card.fields, null, 1) });
  S.project.violations = j.violations || [];
  S.project.verdict = j.verdict || (S.project.violations.length ? 'warn' : 'pass');
  return j;
}
async function doRelate(){
  const cast = S.project.cast.map(c=>
    `- ${c.fields.name||'?'}: ${(c.fields.background||c.seed&&c.seed.line||'').slice(0,220)}`).join('\n');
  const j = await runStage('relate', { digest: digestStr(), cast });
  S.project.relations = j.edges || [];
  return S.project.relations;
}

/* --- V2 카드로 조립 --- */
function guessName(fields){
  if(fields.name) return String(fields.name).trim();
  const keys = ['name','head','이름']
    .concat(activePreset().schema.map(f=>f.key), Object.keys(fields))
    .filter((k,i,a)=>a.indexOf(k)===i);
  for(const k of keys){
    const v = fields[k]; if(!v) continue;
    const first = String(v).split(/[\n]/)[0].trim();
    const m = first.match(/^([^/|,·\-–—(]{1,24})\s*[/|,·\-–—(]/);
    if(m) return m[1].trim();
    if(first.length<=24) return first;
  }
  return '이름 없음';
}
function toV2(fields){
  const P = activePreset();
  const special = ['name','first_mes','mes_example','scenario','personality','description'];
  const seen = {};
  const rows = [];
  P.schema.forEach(f=>{ seen[f.key]=1;
    if(!special.includes(f.key) && fields[f.key]) rows.push(`[${f.label}]\n${fields[f.key]}`); });
  Object.keys(fields).forEach(k=>{
    if(seen[k] || special.includes(k) || !fields[k]) return;
    rows.push(`[${k}]\n${fields[k]}`); });
  const body = rows.join('\n\n');
  const desc = [fields.description||'', body].filter(Boolean).join('\n\n');
  return {
    spec:'chara_card_v2', spec_version:'2.0',
    data:{
      name: guessName(fields),
      description: desc,
      personality: fields.personality || '',
      scenario: fields.scenario || '',
      first_mes: fields.first_mes || '',
      mes_example: fields.mes_example || '',
      creator_notes: 'Orrery로 생성',
      system_prompt:'', post_history_instructions:'',
      alternate_greetings:[], character_book:undefined,
      tags:[], creator:'Orrery', character_version:'1.0', extensions:{}
    }
  };
}

/* --- PNG 카드로 내보내기 --- */
function crc32(buf){
  let c, t = crc32.t;
  if(!t){ t = crc32.t = []; for(let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } }
  let crc = 0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) crc = t[(crc^buf[i])&0xFF] ^ (crc>>>8);
  return (crc^0xFFFFFFFF)>>>0;
}
function pngChunk(type, data){
  const t = new TextEncoder().encode(type);
  const out = new Uint8Array(12+data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(t,4); out.set(data,8);
  dv.setUint32(8+data.length, crc32(out.slice(4,8+data.length)));
  return out;
}
function bytesToB64(bytes){
  let s=''; const CH=0x8000;
  for(let i=0;i<bytes.length;i+=CH) s += String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  return btoa(s);
}
async function makeCardPng(fields){
  const cv = document.createElement('canvas'); cv.width=400; cv.height=600;
  const g = cv.getContext('2d');
  if(!g) throw new Error('이 브라우저에서 PNG를 만들지 못했습니다. JSON 내려받기를 쓰세요.');
  const grd = g.createLinearGradient(0,0,0,600);
  grd.addColorStop(0,'#1F2B38'); grd.addColorStop(1,'#101720');
  g.fillStyle=grd; g.fillRect(0,0,400,600);
  g.strokeStyle='#A97F37'; g.lineWidth=2; g.strokeRect(14,14,372,572);
  g.fillStyle='#D5A24E'; g.font='600 30px Georgia, serif'; g.textAlign='center';
  const nm = guessName(fields).slice(0,16);
  g.fillText(nm, 200, 300);
  g.fillStyle='#63768A'; g.font='11px monospace';
  g.fillText('ORRERY', 200, 330);
  const blob = await new Promise(r=>cv.toBlob(r,'image/png'));
  if(!blob) throw new Error('이 브라우저에서 PNG를 만들지 못했습니다. JSON 내려받기를 쓰세요.');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const json = JSON.stringify(toV2(fields));
  const b64 = bytesToB64(new TextEncoder().encode(json));
  const payload = new TextEncoder().encode('chara\0'+b64);
  const chunk = pngChunk('tEXt', payload);
  // IEND 앞에 삽입
  let p=8, iend=buf.length-12;
  const dv=new DataView(buf.buffer);
  while(p<buf.length-8){
    const len=dv.getUint32(p);
    const ty=String.fromCharCode(buf[p+4],buf[p+5],buf[p+6],buf[p+7]);
    if(ty==='IEND'){ iend=p; break; }
    p += len+12;
  }
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.slice(0,iend),0);
  out.set(chunk, iend);
  out.set(buf.slice(iend), iend+chunk.length);
  return new Blob([out], {type:'image/png'});
}

/* ==================================================================
   5. 화면 — 재료
   ================================================================== */

const MAT_HINT = {
  world: '설정집 · 로어북 · 캐릭터 카드',
  character: '세계 로어북 · 기존 캐릭터 카드',
  prompt: '캐릭터 카드 · 세계 설정 · 기존 프롬프트'
};
const STAR_SVG = on=>`<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 5.6 3 6.4 7 .9-5.1 4.9 1.3 7L16 21.4l-6.2 3.4 1.3-7L6 12.9l7-.9Z" ${on?'fill="currentColor"':'fill="none"'} stroke="currentColor"/></svg>`;
const FOLDER_ADD_SVG = '<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5.5 9.5h8l2.2 2.6h10.8v11.4a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M20 15.5v7M16.5 19h7" stroke="#e9b654"/></svg>';
const PENCIL_SVG = '<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7.5 24.5 1.2-5.2L20.5 7.5a2.4 2.4 0 0 1 3.4 0l.6.6a2.4 2.4 0 0 1 0 3.4L12.7 23.3Z"/><path d="m18.8 9.2 4 4M8.7 19.3l4 4" stroke="#e9b654"/></svg>';
const TRASH_SVG = '<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7.6 9.7h16.8"/><path d="M12.8 9.7V8.2a1.8 1.8 0 0 1 1.8-1.8h2.8a1.8 1.8 0 0 1 1.8 1.8v1.5"/><path d="m9.8 9.7.9 14.1a2.4 2.4 0 0 0 2.4 2.2h5.8a2.4 2.4 0 0 0 2.4-2.2l.9-14.1"/><path d="M13.7 13.7v8.1M18.3 13.7v8.1"/></svg>';
let ASSET_FOLDER_FILTER='all', ASSET_PURPOSE_FILTER='all', ASSET_FOLDER_SCROLL=0, ASSET_SEARCH='', EDITING_ASSET_FOLDER_ID=null, PENDING_ASSET_FOLDER_DELETE=null;

function folderById(id){ return S.assetFolders.find(f=>f.id===id); }
function assetMatchesFolder(a){
  if(ASSET_FOLDER_FILTER==='all') return true;
  if(ASSET_FOLDER_FILTER==='favorites') return !!a.favorite;
  if(ASSET_FOLDER_FILTER==='unfiled') return !!a.favorite && !a.folderId;
  return ASSET_FOLDER_FILTER.startsWith('folder:') && a.favorite && a.folderId===ASSET_FOLDER_FILTER.slice(7);
}
function assetMatchesSearch(a){
  const q=ASSET_SEARCH.trim().toLowerCase(); if(!q) return true;
  normalizeAssetMetadata(a);
  const parts=[a.name,a.kind,a.from,a.body,...a.purposes.map(x=>ASSET_PURPOSE_LABEL[x]||x),...a.tags,...a.tags.map(x=>'#'+x)];
  if(a.kind==='character') Object.entries(a.fields||{}).forEach(([k,v])=>parts.push(k,v));
  if(a.kind==='lorebook') (a.entries||[]).forEach(en=>parts.push(en.comment,(en.keys||[]).join(' '),en.content));
  return parts.filter(Boolean).join('\n').toLowerCase().includes(q);
}
function assetMatchesPurpose(a){
  normalizeAssetMetadata(a);
  return ASSET_PURPOSE_FILTER==='all' || a.purposes.includes(ASSET_PURPOSE_FILTER);
}
function folderOptions(a){
  return `<option value="" ${!a.folderId?'selected':''}>미분류</option>`+
    S.assetFolders.map(f=>`<option value="${f.id}" ${a.folderId===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
}
function renderAssetFolderBar(){
  const previousScroll=$('#assetFolderScroll');
  if(previousScroll) ASSET_FOLDER_SCROLL=previousScroll.scrollLeft;
  normalizeAssetFolders();
  if(ASSET_FOLDER_FILTER.startsWith('folder:') && !folderById(ASSET_FOLDER_FILTER.slice(7))) ASSET_FOLDER_FILTER='all';
  const fav=S.assets.filter(a=>a.favorite).length;
  const unfiled=S.assets.filter(a=>a.favorite&&!a.folderId).length;
  const chip=(id,label,count,on)=>`<button class="folder-chip ${on==null?(ASSET_FOLDER_FILTER===id?'on':''):(on?'on':'')}" data-folder-filter="${id}">${esc(label)}<span class="fc">${count}</span></button>`;
  const selectedId=ASSET_FOLDER_FILTER.startsWith('folder:')?ASSET_FOLDER_FILTER.slice(7):null;
  const insideFavorites=ASSET_FOLDER_FILTER!=='all';
  $('#assetFolderBar').innerHTML = `<div class="asset-folder-row asset-scope-row">${chip('all','전체 재료',S.assets.length,ASSET_FOLDER_FILTER==='all')}${chip('favorites','즐겨찾기',fav,insideFavorites)}`+
    `<select class="asset-purpose-filter" aria-label="쓰임새 필터"><option value="all">모든 쓰임새</option>${ASSET_PURPOSE_KEYS.map(k=>`<option value="${k}" ${ASSET_PURPOSE_FILTER===k?'selected':''}>${ASSET_PURPOSE_LABEL[k]}</option>`).join('')}</select>`+
    `<input type="search" class="asset-search" value="${esc(ASSET_SEARCH)}" placeholder="이름·내용·#태그 검색" aria-label="재료 검색">`+
    `<button class="iconbtn danger asset-clear-temp" title="즐겨찾기 외 전체 삭제" aria-label="즐겨찾기 외 전체 삭제">${TRASH_SVG}</button></div>`+
    (insideFavorites?`<div class="favorite-folder-row"><div class="folder-scroll" id="assetFolderScroll">${chip('favorites','모두',fav)}${chip('unfiled','미분류',unfiled)}`+
      S.assetFolders.map(f=>chip('folder:'+f.id,f.name,S.assets.filter(a=>a.favorite&&a.folderId===f.id).length)).join('')+'</div>'+
      `<span class="folder-tools"><button class="iconbtn folder-new" title="즐겨찾기 폴더 만들기" aria-label="즐겨찾기 폴더 만들기">${FOLDER_ADD_SVG}</button>`+
      (selectedId?`<button class="iconbtn folder-rename" title="폴더 이름 바꾸기" aria-label="폴더 이름 바꾸기">${PENCIL_SVG}</button><button class="iconbtn danger folder-del" title="폴더 삭제" aria-label="폴더 삭제">${TRASH_SVG}</button>`:'')+'</span></div>':'');
  const folderScroll=$('#assetFolderScroll');
  if(folderScroll){
    const forceEnd=ASSET_FOLDER_SCROLL===Number.MAX_SAFE_INTEGER;
    folderScroll.scrollLeft=ASSET_FOLDER_SCROLL;
    if(!forceEnd){
      const selected=folderScroll.querySelector('.folder-chip.on');
      if(selected){
        const left=selected.offsetLeft, right=left+selected.offsetWidth;
        if(left<folderScroll.scrollLeft) folderScroll.scrollLeft=left;
        else if(right>folderScroll.scrollLeft+folderScroll.clientWidth) folderScroll.scrollLeft=right-folderScroll.clientWidth;
      }
    }
    dragScroll(folderScroll);
  }
}
function closeAssetFolderModal(){
  $('#assetFolderModal').hidden=true; EDITING_ASSET_FOLDER_ID=null; $('#assetFolderName').value='';
}
function openAssetFolderModal(folder){
  EDITING_ASSET_FOLDER_ID=folder?folder.id:null;
  $('#assetFolderModalTitle').textContent=folder?'폴더 이름 바꾸기':'즐겨찾기 폴더 만들기';
  $('#assetFolderSave').textContent=folder?'바꾸기':'만들기';
  $('#assetFolderName').value=folder?folder.name:'';
  $('#assetFolderModal').hidden=false;
  setTimeout(()=>{ $('#assetFolderName').focus(); if(folder) $('#assetFolderName').select(); },0);
}
function renderMat(){
  const box = $('#matStatus'); if(!box) return;
  const P = activePreset(), st = assetStats(), brief = (S.opts.brief||'').trim();
  const selectedAssets=S.assets.filter(a=>a.use).length;
  const req = P.needs === 'required';
  let cls='matrow', html='';
  if(st.tokens > 0){
    cls += ' ok';
    html = selectedAssets
      ? `<span class="pip"></span>재료 ${selectedAssets}개${brief?' + 구상':''} · ${st.tokens} 토큰쯤 읽습니다`
      : `<span class="pip"></span>재료 없이 아래 구상만으로 시작합니다 · ${st.tokens} 토큰쯤`;
  } else if(req){
    cls += ' warn';
    html = `<span class="pip"></span>이 양식은 읽을 원본이 필요합니다 — 재료를 넣거나 구상 칸에 원문을 붙여 주세요`
         + ` <button class="mini ghost" id="matGo">재료 넣으러 가기</button>`;
  } else if(brief){
    cls += ' ok';
    html = `<span class="pip"></span>아래 구상만으로 시작합니다 · 재료를 더하면 함께 읽습니다`;
  } else {
    html = `<span class="pip"></span>재료 없이도 됩니다 — 아래 구상 칸에 몇 마디만 적으세요`;
  }
  box.className = cls; box.innerHTML = html;
  const go = $('#matGo'); if(go) go.addEventListener('click', ()=> tab('sources'));
  const mh = $('#matHint');
  if(mh) mh.textContent = MAT_HINT[S.opts.group] || '';
}

function renderAssets(keepFolderBar){
  const box = $('#assetList');
  $('#bAssets').textContent = S.assets.length;
  if(!keepFolderBar) renderAssetFolderBar();
  if(!S.assets.length){
    box.innerHTML = `<div class="empty"><b>재료 없이도 시작할 수 있습니다</b>구상만 적어 만들거나, 나중에 재료를 더해도 됩니다.
      <div class="empty-actions"><button class="mini ghost" data-group-start="world">세계 만들기</button><button class="mini ghost" data-group-start="character">인물 만들기</button><button class="mini ghost" data-group-start="prompt">프롬프트 만들기</button></div></div>`;
    renderMat(); renderNebulaPicker(); return;
  }
  renderMat();
  const shown=S.assets.filter(a=>assetMatchesFolder(a)&&assetMatchesPurpose(a)&&assetMatchesSearch(a)).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite));
  box.innerHTML = (shown.length ? shown.map(a=>{
    ensureAssetOriginal(a);
    const on = a.kind==='lorebook' ? a.entries.filter(e=>e.use).length : 0;
    const meta = a.kind==='lorebook' ? `${on}/${a.entries.length}개 · ${tok(a.entries.filter(e=>e.use).map(e=>e.content).join(''))} 토큰쯤`
      : a.kind==='character' ? `${Object.keys(a.fields).length}개 항목 · ${tok(Object.values(a.fields).join(''))} 토큰쯤`
      : `${tok(a.body)} 토큰쯤`;
    const kindLabel = {character:'캐릭터', lorebook:'로어북', text:'텍스트'}[a.kind];
    const purposeHtml=a.purposes.map(k=>`<span class="asset-purpose">${ASSET_PURPOSE_LABEL[k]}</span>`).join('');
    const tagHtml=a.tags.map(t=>`<button class="asset-tag" data-tag="${esc(t)}" title="이 태그로 검색">#${esc(t)}</button>`).join('');
    return `<div class="asset ${a.kind}" data-id="${a.id}">
      <div class="asset-head">
        <label style="flex:none;display:flex;align-items:center">
          <input type="checkbox" class="a-use" ${a.use?'checked':''} style="width:auto;accent-color:var(--brass)"></label>
        <span class="asset-kind">${kindLabel}</span>
        <span class="asset-name">${esc(a.name)}</span>
        <span class="asset-meta">${meta}</span>
        ${a.favorite?`<select class="asset-folder-select a-folder" aria-label="${esc(a.name)} 폴더">${folderOptions(a)}</select>`:''}
        ${a.kind==='lorebook' ? '<button class="mini ghost a-toggle">항목 고르기</button>':''}
        ${a.kind==='character' ? '<button class="mini ghost a-peek">내용</button>':''}
        <span class="asset-tools">
          <button class="iconbtn a-star ${a.favorite?'on':''}" title="${a.favorite?'즐겨찾기 해제':'즐겨찾기 · 삭제 보호와 폴더 분류'}" aria-label="${a.favorite?'즐겨찾기 해제':'즐겨찾기'}">${STAR_SVG(!!a.favorite)}</button>
          <button class="iconbtn a-edit" title="수정" aria-label="수정"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7.5 24.5 1.2-5.2L20.5 7.5a2.4 2.4 0 0 1 3.4 0l.6.6a2.4 2.4 0 0 1 0 3.4L12.7 23.3Z"/><path d="m18.8 9.2 4 4M8.7 19.3l4 4" stroke="#e9b654"/></svg></button>
          <button class="iconbtn a-copy" title="복제" aria-label="복제"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="11" y="7" width="14" height="14" rx="2.5"/><rect x="7" y="11" width="14" height="14" rx="2.5" stroke="#e9b654"/></svg></button>
          <button class="iconbtn danger a-del" title="삭제" aria-label="삭제">${TRASH_SVG}</button>
        </span>
      </div>
      ${purposeHtml||tagHtml?`<div class="asset-taxonomy">${purposeHtml}${tagHtml}</div>`:''}
      ${a.kind==='lorebook' ? entriesHtml(a) : ''}
      ${a.kind==='character' ? `<div class="entries"><pre style="white-space:pre-wrap;font-size:12px;color:var(--dim);margin:0;max-height:280px;overflow:auto">${esc(Object.keys(a.fields).map(k=>'['+k+']\n'+a.fields[k]).join('\n\n'))}</pre></div>`:''}
      ${assetEditorHtml(a)}
    </div>`;
  }).join('') : (ASSET_SEARCH.trim()||ASSET_PURPOSE_FILTER!=='all'?'<div class="empty"><b>검색 결과가 없습니다</b>검색어나 쓰임새 필터를 바꿔보세요.</div>':'<div class="empty"><b>이 폴더는 비어 있습니다</b>전체에서 재료를 즐겨찾기한 뒤 폴더를 골라 주세요.</div>'));
  renderNebulaPicker();
}
const EDIT_ASSETS = new Set();
function assetEditorHtml(a){
  let body = '';
  if(a.kind==='character') body = Object.keys(a.fields).map(k=>`
    <div class="editrow"><label class="fl">${esc(k)}</label><textarea class="ae-field" data-key="${esc(k)}" rows="3">${esc(a.fields[k])}</textarea></div>`).join('');
  else if(a.kind==='lorebook') body = a.entries.map(en=>`
    <div class="editrow edit-entry" data-eid="${en.id}">
      <div><input class="ae-comment" value="${esc(en.comment||'')}" placeholder="항목 이름"><input class="ae-keys" value="${esc((en.keys||[]).join(', '))}" placeholder="키워드, 쉼표로 구분" style="margin-top:6px"></div>
      <textarea class="ae-content" rows="4">${esc(en.content||'')}</textarea>
    </div>`).join('');
  else body = `<div class="editrow"><label class="fl">본문</label><textarea class="ae-body" rows="8">${esc(a.body||'')}</textarea></div>`;
  return `<div class="asset-editor ${EDIT_ASSETS.has(a.id)?'open':''}">
    <div class="asset-editor-head"><span>재료 수정</span><span class="sp"></span><button class="iconbtn a-edit-close" title="닫기 · 이번 수정은 적용하지 않음" aria-label="닫기"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8.5 8.5 15 15M23.5 8.5l-15 15"/></svg></button></div>
    <div class="editrow"><label class="fl">재료 이름</label><input class="ae-name" value="${esc(a.name||'')}"></div>
    <div class="editrow"><span class="fl">쓸 곳</span><div class="purpose-options" role="group" aria-label="${esc(a.name||'재료')} 쓸 곳">${ASSET_PURPOSE_KEYS.map(k=>`<label class="purpose-choice"><input type="checkbox" class="ae-purpose" value="${k}" ${a.purposes.includes(k)?'checked':''}><span>${ASSET_PURPOSE_LABEL[k]}</span></label>`).join('')}</div></div>
    <div class="editrow"><label class="fl">태그</label><input class="ae-tags" value="${esc(a.tags.join(', '))}" placeholder="예: 마법학교, 라이벌, 겨울 · 쉼표로 구분"></div>
    ${body}
    <div class="bar asset-editor-actions">
      <button class="mini ghost a-compare">원본과 비교</button><button class="mini ghost a-original">원본으로 되돌리기</button>
      <button class="mini primary a-edit-done">수정</button>
    </div>
  </div>`;
}
function entriesHtml(a){
  return `<div class="entries">
    <div class="entry-tools">
      <input type="search" class="e-search" placeholder="항목 검색">
      <button class="mini ghost e-all">전체 선택</button>
      <button class="mini ghost e-none">해제</button>
      <button class="mini ghost e-clean">설정 항목만</button>
    </div>
    <div class="elist">${a.entries.map(e=>{
      const label = e.comment || e.keys[0] || '(제목 없음)';
      const sus = suspectEntry(e);
      return `<label class="erow ${sus?'suspect':''}" data-eid="${e.id}" data-text="${esc((label+' '+e.keys.join(' ')+' '+e.content).toLowerCase())}">
        <input type="checkbox" class="e-use" ${e.use?'checked':''}>
        <div style="flex:1;min-width:0">
          <div class="ek">${esc(label)}${sus?'<span class="flag">지시문?</span>':''}</div>
          <div class="ep">${esc(e.content.slice(0,180))}</div>
        </div></label>`;
    }).join('')}</div></div>`;
}
function assetById(id){ return S.assets.find(a=>a.id===id); }
const EDIT_BASELINE = new Map(), EDIT_WAS_DIRTY = new Map();
function replaceAssetFrom(a, snap){
  const i=S.assets.findIndex(x=>x.id===a.id); if(i<0) return null;
  const keepOriginal=clone(ensureAssetOriginal(a).original), keepUse=a.use, keepFavorite=!!a.favorite, keepFolder=a.folderId;
  const next=clone(snap); next.id=a.id; next.use=keepUse; next.original=keepOriginal; next.favorite=keepFavorite;
  if(keepFavorite && keepFolder) next.folderId=keepFolder; else delete next.folderId;
  S.assets[i]=next; return next;
}
function duplicateAsset(a){
  const d=assetCore(a); d.id=uid(); d.name=(a.name||'재료')+' 복사본';
  d.favorite=false; delete d.folderId;
  if(d.kind==='lorebook') d.entries.forEach(en=>{ en.id=uid(); });
  d.original=assetCore(d); S.assets.push(d); return d;
}
function assetReadable(a){
  normalizeAssetMetadata(a);
  const head=`이름: ${a.name}\n쓸 곳: ${a.purposes.map(x=>ASSET_PURPOSE_LABEL[x]).join(', ')||'미분류'}\n태그: ${a.tags.join(', ')||'없음'}\n\n`;
  if(a.kind==='character') return head+Object.keys(a.fields||{}).map(k=>`[${k}]\n${a.fields[k]}`).join('\n\n');
  if(a.kind==='lorebook') return head+(a.entries||[]).map((en,i)=>`[${i+1}] ${en.comment||'(제목 없음)'}\n키워드: ${(en.keys||[]).join(', ')}\n${en.content||''}`).join('\n\n');
  return head+(a.body||'');
}
function showAssetCompare(a){
  ensureAssetOriginal(a);
  $('#assetCompareTitle').textContent=(a.name||'재료')+' · 원본과 수정본';
  $('#assetCompareOriginal').textContent=assetReadable(a.original);
  $('#assetCompareCurrent').textContent=assetReadable(a);
  $('#assetCompare').hidden=false;
}
function renderNebulaPicker(){
  const box = $('#nebulaList'), count = $('#nebulaCount'); if(!box || !count) return;
  const n = S.assets.filter(a=>a.use).length;
  count.textContent = `선택 ${n}/${S.assets.length}개`;
  const ordered=[...S.assets].map(normalizeAssetMetadata).sort((a,b)=>Number(b.purposes.includes(S.opts.group))-Number(a.purposes.includes(S.opts.group)));
  box.innerHTML = ordered.length ? ordered.map(a=>`
    <label class="nebula-row"><input type="checkbox" class="n-use" data-id="${a.id}" ${a.use?'checked':''}>
      <span>${esc(a.name)}</span><span class="sp"></span><span class="note">${a.purposes.includes(S.opts.group)?'추천 · ':''}${a.purposes.map(x=>ASSET_PURPOSE_LABEL[x]).join(' · ')||'미분류'} · ${{character:'캐릭터',lorebook:'로어북',text:'텍스트'}[a.kind]||a.kind}</span></label>`).join('')
    : '<div class="note">고를 재료가 없습니다 · 그대로 구상만으로 만들 수 있습니다.</div>';
}
function materialChanged(){ save(); renderDigest(); renderMat(); renderNebulaPicker(); renderOneshot(); touchDraft(); }
function deleteUnfavoriteAssets(){
  const removable=S.assets.filter(a=>!a.favorite);
  if(!removable.length) return toast(S.assets.length?'삭제할 일반 재료가 없습니다':'삭제할 재료가 없습니다');
  const kept=S.assets.length-removable.length;
  PENDING_ASSET_FOLDER_DELETE=null;
  $('#assetClearTitle').textContent='즐겨찾기 외 전체 삭제';
  $('#assetClearDesc').textContent=`즐겨찾기하지 않은 재료 ${removable.length}개를 모두 삭제합니다.${kept?` 즐겨찾기 ${kept}개는 남습니다.`:''}`;
  $('#assetClearConfirm').textContent='삭제';
  $('#assetClearModal').hidden=false;
}
function openAssetFolderDelete(folder){
  PENDING_ASSET_FOLDER_DELETE=folder.id;
  $('#assetClearTitle').textContent='폴더 삭제';
  $('#assetClearDesc').textContent=`“${folder.name}” 폴더만 삭제합니다. 안의 재료는 즐겨찾기 미분류로 남습니다.`;
  $('#assetClearConfirm').textContent='폴더 삭제';
  $('#assetClearModal').hidden=false;
}
function closeAssetClearModal(){ $('#assetClearModal').hidden=true; PENDING_ASSET_FOLDER_DELETE=null; }
function confirmDeleteUnfavoriteAssets(){
  if(PENDING_ASSET_FOLDER_DELETE){
    const folder=folderById(PENDING_ASSET_FOLDER_DELETE); if(!folder) return closeAssetClearModal();
    S.assets.forEach(a=>{ if(a.folderId===folder.id) delete a.folderId; });
    S.assetFolders=S.assetFolders.filter(f=>f.id!==folder.id); ASSET_FOLDER_FILTER='unfiled';
    closeAssetClearModal(); save(); renderAssets(); toast('폴더만 삭제했습니다 · 재료는 미분류에 남았습니다'); return;
  }
  const removable=S.assets.filter(a=>!a.favorite);
  const ids=new Set(removable.map(a=>a.id));
  S.assets=S.assets.filter(a=>a.favorite);
  ids.forEach(id=>{ EDIT_ASSETS.delete(id); EDIT_BASELINE.delete(id); EDIT_WAS_DIRTY.delete(id); });
  closeAssetClearModal(); renderAssets(); materialChanged(); toast('즐겨찾기하지 않은 재료를 삭제했습니다');
}

$('#assetFolderBar').addEventListener('click', e=>{
  if(e.target.closest('.asset-clear-temp')){ deleteUnfavoriteAssets(); return; }
  const filter=e.target.closest('[data-folder-filter]');
  if(filter){ ASSET_FOLDER_FILTER=filter.dataset.folderFilter; renderAssets(); return; }
  if(e.target.closest('.folder-new')){
    openAssetFolderModal(null); return;
  }
  const id=ASSET_FOLDER_FILTER.startsWith('folder:')?ASSET_FOLDER_FILTER.slice(7):null;
  const folder=folderById(id); if(!folder) return;
  if(e.target.closest('.folder-rename')){
    openAssetFolderModal(folder); return;
  }
  if(e.target.closest('.folder-del')){
    openAssetFolderDelete(folder);
  }
});
$('#assetFolderBar').addEventListener('input', e=>{
  if(!e.target.classList.contains('asset-search')) return;
  ASSET_SEARCH=e.target.value; renderAssets(true);
});
$('#assetFolderBar').addEventListener('change', e=>{
  if(!e.target.classList.contains('asset-purpose-filter')) return;
  ASSET_PURPOSE_FILTER=e.target.value; renderAssets();
});
$('#assetFolderBar').addEventListener('keydown', e=>{
  if(e.target.classList.contains('asset-search')&&e.key==='Escape'){
    e.preventDefault(); ASSET_SEARCH=''; e.target.value=''; renderAssets(true);
  }
});
$('#assetFolderSave').addEventListener('click', ()=>{
  const clean=$('#assetFolderName').value.trim();
  if(!clean) return toast('폴더 이름을 적어 주세요',1);
  if(S.assetFolders.some(f=>f.id!==EDITING_ASSET_FOLDER_ID&&f.name.toLowerCase()===clean.toLowerCase())) return toast('같은 이름의 폴더가 있습니다',1);
  const folder=folderById(EDITING_ASSET_FOLDER_ID);
  if(folder){ folder.name=clean; toast('폴더 이름을 바꿨습니다'); }
  else{ S.assetFolders.push({id:uid(),name:clean}); ASSET_FOLDER_SCROLL=Number.MAX_SAFE_INTEGER; toast(`“${clean}” 폴더를 만들었습니다`); }
  save(); closeAssetFolderModal(); renderAssets();
});
$('#assetFolderName').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#assetFolderSave').click(); } });
$('#assetFolderClose').addEventListener('click', closeAssetFolderModal);
$('#assetFolderCancel').addEventListener('click', closeAssetFolderModal);
$('#assetFolderModal').addEventListener('click', e=>{ if(e.target.id==='assetFolderModal') closeAssetFolderModal(); });
$('#assetClearConfirm').addEventListener('click', confirmDeleteUnfavoriteAssets);
$('#assetClearClose').addEventListener('click', closeAssetClearModal);
$('#assetClearCancel').addEventListener('click', closeAssetClearModal);
$('#assetClearModal').addEventListener('click', e=>{ if(e.target.id==='assetClearModal') closeAssetClearModal(); });

$('#assetList').addEventListener('click', e=>{
  const start=e.target.closest('[data-group-start]');
  if(start){ applyGroup(start.dataset.groupStart); tab('studio'); return; }
  const wrap = e.target.closest('.asset'); if(!wrap) return;
  const a = assetById(wrap.dataset.id); if(!a) return;
  const tag=e.target.closest('.asset-tag');
  if(tag){ ASSET_FOLDER_FILTER='all'; ASSET_PURPOSE_FILTER='all'; ASSET_SEARCH='#'+tag.dataset.tag; renderAssets(); return; }
  if(e.target.closest('.a-star')){ a.favorite=!a.favorite; if(!a.favorite) delete a.folderId; save(); renderAssets(); touchDraft(); toast(a.favorite?'즐겨찾기에 고정했습니다':'즐겨찾기에서 해제했습니다'); return; }
  if(e.target.closest('.a-del')){ if(!confirm(a.favorite?`“${a.name}” 즐겨찾기 재료를 영구 삭제할까요?`:`“${a.name}” 재료를 삭제할까요?`)) return; S.assets = S.assets.filter(x=>x.id!==a.id); EDIT_ASSETS.delete(a.id); EDIT_BASELINE.delete(a.id); EDIT_WAS_DIRTY.delete(a.id); renderAssets(); materialChanged(); return; }
  if(e.target.closest('.a-copy')){ const d=duplicateAsset(a); renderAssets(); materialChanged(); toast(`“${d.name}”을 만들었습니다`); return; }
  if(e.target.closest('.a-edit')){ if(!EDIT_BASELINE.has(a.id)){ EDIT_BASELINE.set(a.id,assetCore(a)); EDIT_WAS_DIRTY.set(a.id,DRAFT_DIRTY); } EDIT_ASSETS.add(a.id); renderAssets(); $(`.asset[data-id="${a.id}"] .asset-editor`).scrollIntoView({behavior:'smooth',block:'nearest'}); return; }
  if(e.target.closest('.a-edit-close')){ const base=EDIT_BASELINE.get(a.id), wasDirty=EDIT_WAS_DIRTY.get(a.id); if(base) replaceAssetFrom(a,base); EDIT_BASELINE.delete(a.id); EDIT_WAS_DIRTY.delete(a.id); EDIT_ASSETS.delete(a.id); renderAssets(); renderDigest(); renderMat(); renderNebulaPicker(); if(wasDirty){ DRAFT_DIRTY=true; touchDraft(); }else clearDraft(); return; }
  if(e.target.closest('.a-original')){ if(!confirm('처음 불러온 내용으로 되돌릴까요?')) return; replaceAssetFrom(a,ensureAssetOriginal(a).original); renderAssets(); materialChanged(); toast('처음 불러온 내용으로 되돌렸습니다'); return; }
  if(e.target.closest('.a-compare')){ showAssetCompare(a); return; }
  if(e.target.closest('.a-edit-done')){ EDIT_BASELINE.delete(a.id); EDIT_WAS_DIRTY.delete(a.id); EDIT_ASSETS.delete(a.id); renderAssets(); materialChanged(); toast('재료 수정을 반영했습니다'); return; }
  if(e.target.closest('.a-toggle')||e.target.closest('.a-peek')){ $('.entries',wrap).classList.toggle('open'); return; }
  if(e.target.closest('.e-all')||e.target.closest('.e-none')||e.target.closest('.e-clean')){
    const mode = e.target.closest('.e-all')?'all':e.target.closest('.e-none')?'none':'clean';
    a.entries.forEach(en=>{ en.use = mode==='all' ? true : mode==='none' ? false : !suspectEntry(en); });
    const open = $('.entries',wrap).classList.contains('open');
    renderAssets();
    materialChanged();
    if(open) $(`.asset[data-id="${a.id}"] .entries`).classList.add('open');
    return;
  }
});
$('#assetList').addEventListener('change', e=>{
  const wrap = e.target.closest('.asset'); if(!wrap) return;
  const a = assetById(wrap.dataset.id); if(!a) return;
  if(e.target.classList.contains('a-folder')){ if(e.target.value) a.folderId=e.target.value; else delete a.folderId; save(); renderAssets(); return; }
  if(e.target.classList.contains('a-use')){ a.use = e.target.checked; renderAssets(); materialChanged(); return; }
  if(e.target.classList.contains('ae-purpose')){
    a.purposes=$$('.ae-purpose',wrap).filter(x=>x.checked).map(x=>x.value);
    touchDraft(); return;
  }
  if(e.target.classList.contains('e-use')){
    const row = e.target.closest('.erow');
    const en = a.entries.find(x=>x.id===row.dataset.eid);
    if(en) en.use = e.target.checked;
    materialChanged();
    return;
  }
});
$('#assetList').addEventListener('input', e=>{
  const wrap = e.target.closest('.asset');
  if(e.target.classList.contains('e-search')){
    const q = e.target.value.toLowerCase().trim();
    $$('.erow', wrap).forEach(r=>{ r.style.display = (!q || r.dataset.text.includes(q)) ? '' : 'none'; });
    return;
  }
  if(!wrap) return;
  const a = assetById(wrap.dataset.id); if(!a) return;
  if(e.target.classList.contains('ae-name')) a.name = e.target.value;
  else if(e.target.classList.contains('ae-tags')) a.tags=cleanAssetTags(e.target.value);
  else if(e.target.classList.contains('ae-body')) a.body = e.target.value;
  else if(e.target.classList.contains('ae-field')) a.fields[e.target.dataset.key] = e.target.value;
  else {
    const row = e.target.closest('.edit-entry'); if(!row) return;
    const en = a.entries.find(x=>x.id===row.dataset.eid); if(!en) return;
    if(e.target.classList.contains('ae-comment')) en.comment = e.target.value;
    if(e.target.classList.contains('ae-keys')) en.keys = e.target.value.split(',').map(x=>x.trim()).filter(Boolean);
    if(e.target.classList.contains('ae-content')) en.content = e.target.value;
  }
  touchDraft();
});

$('#nebulaList').addEventListener('change', e=>{
  if(!e.target.classList.contains('n-use')) return;
  const a = assetById(e.target.dataset.id); if(!a) return;
  a.use = e.target.checked; renderAssets(); materialChanged();
});

$('#assetCompareClose').addEventListener('click', ()=>{ $('#assetCompare').hidden=true; });
$('#assetCompare').addEventListener('click', e=>{ if(e.target.id==='assetCompare') $('#assetCompare').hidden=true; });

async function addFiles(files){
  for(const f of files){
    try{
      const got = await sniff(f);
      S.assets.push(...got);
      log(`재료 추가: ${f.name} → ${got.map(g=>g.kind).join(', ')}`,'ok');
    }catch(err){
      log(`${f.name} 읽기 실패: ${err.message}`,'err');
      toast(`${f.name}: ${err.message}`, 1);
    }
  }
  renderAssets();
  materialChanged();
}
const drop = $('#drop');
drop.addEventListener('click', ()=>$('#fileIn').click());
drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', ()=>drop.classList.remove('over'));
drop.addEventListener('drop', e=>{ e.preventDefault(); drop.classList.remove('over');
  addFiles(Array.from(e.dataTransfer.files)); });
$('#fileIn').addEventListener('change', e=>{ addFiles(Array.from(e.target.files)); e.target.value=''; });
$('#btnPaste').addEventListener('click', ()=>{
  const box = $('#pasteBox');
  box.hidden = !box.hidden;
  if(!box.hidden){ $('#pasteName').focus(); if(box.scrollIntoView) box.scrollIntoView({behavior:'smooth', block:'nearest'}); }
});
$('#pasteIn').addEventListener('input', e=>{
  const n = e.target.value.length;
  $('#pasteInfo').textContent = n ? `${n}자 · ${tok(e.target.value)} 토큰쯤` : '0자';
});
function resetPasteForm(){
  $('#pasteName').value=''; $('#pasteTags').value=''; $('#pasteIn').value=''; $('#pasteInfo').textContent='0자';
  $$('#pastePurposes input').forEach(x=>{ x.checked=false; });
}
$('#btnPasteCancel').addEventListener('click', ()=>{
  resetPasteForm(); $('#pasteBox').hidden = true;
});
$('#btnPasteAdd').addEventListener('click', ()=>{
  const t = $('#pasteIn').value;
  if(!t.trim()) return toast('내용이 비어 있습니다', 1);
  const first = t.trim().split(/\n/)[0].slice(0, 24);
  const typedName = $('#pasteName').value.trim();
  const purposes=$$('#pastePurposes input').filter(x=>x.checked).map(x=>x.value);
  const tags=cleanAssetTags($('#pasteTags').value);
  S.assets.push({ id:uid(), kind:'text',
    name: typedName || (first ? first + (t.length>24?'…':'') : '붙여넣은 텍스트'), body:t, purposes, tags, use:true });
  resetPasteForm(); $('#pasteBox').hidden = true;
  renderAssets(); materialChanged(); toast('재료에 넣었습니다');
});
$('#pasteIn').addEventListener('keydown', e=>{
  if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); $('#btnPasteAdd').click(); }
});
/* ==================================================================
   6. 화면 — 작업대
   ================================================================== */
function setSpine(){
  const p = S.project;
  const P = activePreset();
  const done = { digest: !!p.digest, seed: P.skipSeed || p.seeds.length>0, expand: !!p.card, check: P.skipCheck || !!p.verdict };
  const order = ['digest','seed','expand','check'];
  $$('#spine li').forEach(li=>{
    const k=li.dataset.st;
    li.style.display = ((k==='seed'&&P.skipSeed)||(k==='check'&&P.skipCheck)) ? 'none' : '';
  });
  let cur = order.find(k=>!done[k]) || 'check';
  $$('#spine li').forEach(li=>{
    const k = li.dataset.st;
    li.classList.toggle('done', done[k]);
    li.classList.toggle('now', k===cur && !done[k]);
  });
}
function renderDigest(){
  const d = S.project.digest, box = $('#digestOut');
  const stale = digestStale();
  $('#digestTok').innerHTML = d
    ? `요약 ${tok(digestStr())} 토큰쯤 (재료 원본 ${assetStats().tokens})`
      + (stale ? ` · <span style="color:var(--brass)">${esc(stale)} — 다시 읽는 것을 권합니다</span>` : '')
    : '';
  if(!d){ box.innerHTML = '<div class="empty"><b>아직 읽지 않았습니다</b>재료를 넣거나 구상만 적고 위 단추를 누르세요.</div>'; setSpine(); return; }
  const list = (arr, f) => (arr||[]).length ? '<ul>'+arr.map(x=>`<li>${esc(f?f(x):x)}</li>`).join('')+'</ul>' : '<div class="note">—</div>';
  box.innerHTML = `
    <div style="margin-bottom:13px">
      <div style="font-family:var(--body);font-size:19px">${esc(d.title||'제목 없음')}</div>
      <div class="note">${esc(d.era||'')}</div>
      <div class="chips" style="margin-top:8px">${(d.tone||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>
    <div class="digest-grid">
      <div class="dcard"><h4>규칙 · 금기</h4>${list(d.rules)}</div>
      <div class="dcard"><h4>세력</h4>${list(d.factions, f=>`${f.name} — ${f.role||''}`)}</div>
      <div class="dcard"><h4>장소</h4>${list(d.places, p=>`${p.name}${p.note?' — '+p.note:''}`)}</div>
      <div class="dcard"><h4>고유명사</h4>${list(d.lexicon, l=>`${l.term}${l.meaning?': '+l.meaning:''}`)}</div>
      <div class="dcard" style="grid-column:1/-1"><h4>빈틈 · 긴장 (씨앗의 출발점)</h4>${list(d.hooks)}</div>
      ${d.counterpartNeeds?`<div class="dcard"><h4>상대에게 필요한 것</h4>${list(d.counterpartNeeds)}</div>`:''}
      ${d.frictionPoints?`<div class="dcard"><h4>부딪힐 지점</h4>${list(d.frictionPoints)}</div>`:''}
    </div>`;
  setSpine();
}
function renderSeeds(){
  const p = S.project, box = $('#seedOut'), P = activePreset();
  const skip = !!P.skipSeed;
  $('#seedPanel').style.display = skip ? 'none' : '';
  $('#modePanel').style.display = P.kind==='schema' ? 'none' : '';
  $('#checkPanel').style.display = P.skipCheck ? 'none' : '';
  $('#castPanel').style.display = (activeMode()==='cast' && S.opts.group==='character') ? '' : 'none';
  $('#btnDlBook').style.display = P.stages.entries ? '' : 'none';
  $('#btnDlPng').style.display = (P.kind && P.kind!=='character') ? 'none' : '';
  $('#btnMakePreset').style.display = P.kind==='schema' ? '' : 'none';
  if(skip){ $('#btnExpand').disabled = !p.digest; box.innerHTML=''; setSpine(); return; }
  $('#btnCross').disabled = p.sel.length!==2;
  $('#btnExpand').disabled = p.sel.length!==1;
  $('#seedHint').textContent = !p.seeds.length ? '' :
    p.sel.length===1 ? '하나 골랐습니다 — 3단계로 펼치세요' :
    p.sel.length===2 ? '둘 골랐습니다 — 섞을 수 있습니다' : '하나를 고르면 펼치고, 둘을 고르면 섞습니다';
  if(!p.seeds.length){
    box.innerHTML = '<div class="empty"><b>아직 빈 하늘입니다</b>먼저 읽기를 마치고 씨앗을 뽑으세요.</div>';
    setSpine(); return;
  }
  box.innerHTML = `<div class="seeds">${p.seeds.map((s,i)=>{
    const idx = p.sel.indexOf(s.id);
    return `<div class="seed ${idx===0?'on':idx===1?'mate':''}" data-sid="${s.id}">
      <span class="idx">${s.crossed?'✶ 합성':'✦ '+String(i+1).padStart(2,'0')}${idx>=0?' · 고름':''}</span>
      <div class="line">${esc(s.line)}</div>
      <div class="hook"><b>출발점</b> ${esc(s.hook||'-')}<br><b>역할</b> ${esc(s.angle||'-')}</div>
    </div>`;
  }).join('')}</div>`;
  setSpine();
}
$('#seedOut').addEventListener('click', e=>{
  const el = e.target.closest('.seed'); if(!el) return;
  const id = el.dataset.sid, sel = S.project.sel;
  const i = sel.indexOf(id);
  if(i>=0) sel.splice(i,1);
  else { if(sel.length>=2) sel.shift(); sel.push(id); }
  renderSeeds(); touchDraft();
});

function renderContinue(){
  const card=S.project.card, box=$('#continueBox'); if(!box) return;
  box.hidden=!card; if(!card) return;
  const count=Array.isArray(card.continuations)?card.continuations.length:0;
  box.classList.toggle('cut',!!card.truncated);
  $('#continueTitle').textContent=card.truncated?'출력이 중간에 끊겼습니다':'이어서 만들기';
  $('#continueHint').textContent=card.truncated
    ? `${card.truncatedField?card.truncatedField+' 칸부터 ':''}복구한 결과입니다 · 이어서 만들면 남은 내용을 붙입니다`
    : '현재 결과는 그대로 두고 새 내용만 뒤에 붙입니다';
  $('#continueMeta').textContent=count?`이어 쓴 기록 ${count}회 · 결과와 함께 임시 저장·백업됩니다`:'빈 지시로 눌러도 됩니다';
  $('#btnContinue').disabled=false;
}
function renderCard(){
  const p = S.project, box = $('#cardOut'), P = activePreset();
  $('#btnReroll').disabled = !p.card;
  $('#btnCheck').disabled = !p.card || !!p.card.truncated;
  $('#cardBar').style.display = p.card ? 'flex' : 'none';
  if(!p.card){
    box.innerHTML = '<div class="empty"><b>아직 카드가 없습니다</b>씨앗을 하나 고르고 펼치세요.</div>';
    renderContinue(); setSpine(); return;
  }
  box.innerHTML = P.schema.map(f=>{
    const v = p.card.fields[f.key]||'';
    const lk = !!p.locked[f.key];
    return `<div class="fld ${lk?'locked':''}" data-k="${f.key}">
      <div class="fld-h">
        <span class="fn">${esc(f.label)} · ${esc(f.key)}</span>
        <button class="lockbtn f-lock">${lk
          ?'<svg class="lic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="7" y="14" width="18" height="12.5" rx="2.2"/><path d="M11 14v-3.5a5 5 0 0 1 10 0V14"/></svg>잠김'
          :'<svg class="lic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="7" y="14" width="18" height="12.5" rx="2.2"/><path d="M11 14v-3.5a5 5 0 0 1 9.6-1.9"/></svg>열림'}</button>
        <button class="lockbtn f-one">이 칸만 다시</button>
      </div>
      <textarea rows="${Math.min(10, Math.max(2, Math.ceil(v.length/62)))}">${esc(v)}</textarea>
    </div>`;
  }).join('');
  renderContinue(); setSpine(); renderQA();
}
$('#cardOut').addEventListener('click', async e=>{
  const fld = e.target.closest('.fld'); if(!fld) return;
  const k = fld.dataset.k;
  if(e.target.closest('.f-lock')){ S.project.locked[k] = !S.project.locked[k]; renderCard(); touchDraft(); return; }
  if(e.target.closest('.f-one')){
    const keep = clone(S.project.locked);
    activePreset().schema.forEach(f=>{ S.project.locked[f.key] = f.key!==k; });
    const btn = e.target.closest('.f-one');
    busy(btn,true,'…');
    try{ await doPatch(); renderCard(); toast(k+' 칸을 다시 썼습니다'); }
    catch(err){ showErr(err); }
    finally{ S.project.locked = keep; busy(btn,false); renderCard(); saveRecord(); }
  }
});
$('#cardOut').addEventListener('input', e=>{
  if(e.target.tagName!=='TEXTAREA') return;
  const k = e.target.closest('.fld').dataset.k;
  S.project.card.fields[k] = e.target.value;
  touchDraft();
  clearTimeout(window.__saveT);
  window.__saveT = setTimeout(()=>{ saveRecord(); }, 1200);
});

function renderCheck(){
  const p = S.project, box = $('#checkOut');
  $('#verdictBox').innerHTML = p.verdict
    ? `<span class="verdict ${p.verdict}">${{pass:'문제 없음',warn:'확인 필요',fail:'고쳐야 함'}[p.verdict]||p.verdict}</span>` : '';
  if(!p.violations){ box.innerHTML=''; setSpine(); return; }
  if(!p.violations.length){
    box.innerHTML = '<div class="empty"><b>어긋난 곳이 없습니다</b>세계 설정과 모순되는 부분을 찾지 못했습니다.</div>';
    setSpine(); return;
  }
  box.innerHTML = p.violations.map((v,i)=>`
    <div class="viol ${v.severity==='low'?'low':''}" data-vi="${i}">
      <div class="vf">${esc(v.field||'?')} · ${v.severity==='low'?'가벼움':'중요'}</div>
      ${v.quote?`<div class="vq">${esc(v.quote)}</div>`:''}
      <div class="vi">${esc(v.issue||'')}</div>
      ${v.fix?`<div class="vx">${esc(v.fix)}</div>`:''}
      <div class="bar" style="margin-top:2px">
        ${v.fix?'<button class="mini ghost v-apply">이 문안으로 바꾸기</button>':''}
        <button class="mini ghost v-ask">이 문제 어떻게 할까?</button>
      </div>
    </div>`).join('');
  setSpine();
}
$('#checkOut').addEventListener('click', e=>{
  const ask = e.target.closest('.v-ask');
  if(ask){
    const v = S.project.violations[+ask.closest('.viol').dataset.vi];
    askNow(`[${v.field}] 칸에 이런 지적이 있습니다: ${v.issue}\n해당 부분: ${v.quote||'(전체)'}\n어떻게 하면 좋을까요? 선택지를 두세 개 주고 각각 무엇을 잃는지도 알려주세요.`, 'design');
    tab('studio'); setTimeout(()=>$('#qaPanel').scrollIntoView({behavior:'smooth',block:'center'}),100);
    return;
  }
  if(!e.target.closest('.v-apply')) return;
  const i = +e.target.closest('.viol').dataset.vi;
  const v = S.project.violations[i];
  if(!v || !v.field || !S.project.card) return;
  const cur = S.project.card.fields[v.field]||'';
  S.project.card.fields[v.field] = (v.quote && cur.includes(v.quote)) ? cur.replace(v.quote, v.fix) : v.fix;
  S.project.violations.splice(i,1);
  renderCard(); renderCheck(); saveRecord(); toast('바꿨습니다');
});

function renderCast(){
  const p = S.project, box = $('#castOut');
  $('#btnRelate').disabled = p.cast.length<2;
  $('#btnCastSave').disabled = !p.cast.length;
  if(!p.cast.length){
    box.innerHTML = '<div class="empty"><b>아직 인원이 없습니다</b>세계를 읽고 인원을 뽑으세요.</div>'; return;
  }
  let h = `<div class="roster">${p.cast.map((c,i)=>`<div class="rmem">
      <div class="rn">${esc(c.fields.name||'이름 없음')}</div>
      <div class="rl">${esc(c.seed?c.seed.line:'')}</div>
      <div class="bar" style="margin-top:9px">
        <button class="mini ghost c-open" data-i="${i}">작업대로</button>
        <button class="iconbtn danger c-del" data-i="${i}" title="인물 삭제" aria-label="인물 삭제">${TRASH_SVG}</button>
      </div></div>`).join('')}</div>`;
  if(p.relations && p.relations.length){
    h += `<div class="sect-label">관계</div>` + p.relations.map(e=>`
      <div class="edge">
        <div class="ep2">${esc(e.a)} ⟷ ${esc(e.b)} · ${esc(e.type||'')}</div>
        <div class="dir"><b>${esc(e.a)}</b>: ${esc(e.aToB||'')}</div>
        <div class="dir"><b>${esc(e.b)}</b>: ${esc(e.bToA||'')}</div>
        ${e.tension?`<div class="ten">터지는 지점 — ${esc(e.tension)}</div>`:''}
      </div>`).join('');
  }
  box.innerHTML = h;
}
$('#castOut').addEventListener('click', e=>{
  const o = e.target.closest('.c-open'), d = e.target.closest('.c-del');
  if(o){ const c = S.project.cast[+o.dataset.i];
    S.project.card = {fields:clone(c.fields), seed:c.seed, truncated:!!c.truncated,
      truncatedField:c.truncatedField||'', continuations:clone(c.continuations||[])}; S.project.locked={};
    $('#continueNote').value='';
    S.project.violations=null; S.project.verdict=null;
    renderCard(); renderCheck(); toast('작업대로 옮겼습니다');
    $('#cardOut').scrollIntoView({behavior:'smooth',block:'center'}); }
  if(d){ const c=S.project.cast[+d.dataset.i]; if(!confirm(`“${c&&c.fields&&c.fields.name||'이 인물'}”을 캐스트에서 삭제할까요?`)) return; S.project.cast.splice(+d.dataset.i,1); S.project.relations=null; renderCast(); touchDraft(); }
});


const ASK_MODE = {
  design: `당신은 이 자료를 만든 사람의 상담역이다. 자료 바깥에서 설계자의 눈으로 답한다.
문제를 지적하면 반드시 그 자리에 넣을 대안을 함께 낸다. 막연한 조언을 하지 않는다.
자료에 없는 설정을 새로 만들지 말고, 만들어야 한다면 그렇다고 밝힌다.`,
  voice: `당신은 이 자료의 당사자다. 인물이라면 그 인물로서, 세계라면 그 세계 안에 사는 사람으로서 답한다.
자료에 적힌 말투와 태도를 그대로 쓴다. 자료가 모르는 것은 모른다고 답한다.
설계 용어로 답하지 말고, 그 인물이 실제로 할 법한 말로 답한다.`
};
async function doAsk(question, mode){
  const j = await runStage('ask', {
    digest: S.project.digest ? digestStr() : '(없음)',
    card: JSON.stringify(S.project.card.fields, null, 1),
    question,
    askMode: ASK_MODE[mode] || ASK_MODE.design
  });
  const rec = { q:question, mode, a:j.answer||'', changes:j.changes||[], note:j.note||'', at:Date.now() };
  S.project.qa.push(rec);
  return rec;
}
function renderQA(){
  const box = $('#qaOut'), p = S.project;
  $('#qaPanel').style.display = p.card ? '' : 'none';
  if(!p.qa.length){ box.innerHTML = ''; return; }
  box.innerHTML = p.qa.map((r,i)=>`
    <div class="qa" data-qi="${i}">
      <div class="qq">${esc(r.q)}</div>
      <div class="qa-body">${esc(r.a)}</div>
      ${r.note?`<div class="qnote">${esc(r.note)}</div>`:''}
      ${(r.changes||[]).map((c,ci)=>`
        <div class="qfix">
          <div class="qf-h">${esc(c.field)}</div>
          <div class="qf-b">${esc(c.after)}</div>
          <button class="mini ghost q-apply" data-ci="${ci}">이 문안으로 바꾸기</button>
        </div>`).join('')}
    </div>`).join('');
}
async function askNow(q, mode){
  if(!q.trim()) return;
  if(!S.project.card) return toast('먼저 무언가를 만들어 주세요',1);
  const btn = $('#btnAsk');
  await guard(btn, '묻는 중', async()=>{ await doAsk(q.trim(), mode); renderQA(); });
}
$('#btnAsk').addEventListener('click', ()=>{
  const q = $('#askIn').value; $('#askIn').value = '';
  askNow(q, $('#askMode').value);
});
$('#askIn').addEventListener('keydown', e=>{
  if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); $('#btnAsk').click(); }
});
$('#btnQaClear').addEventListener('click', ()=>{ S.project.qa=[]; renderQA(); });
$('#qaOut').addEventListener('click', e=>{
  const b = e.target.closest('.q-apply'); if(!b) return;
  const qi = +e.target.closest('.qa').dataset.qi, ci = +b.dataset.ci;
  const c = S.project.qa[qi].changes[ci];
  if(!c || !S.project.card) return;
  const cur = S.project.card.fields[c.field] || '';
  S.project.card.fields[c.field] = (c.before && cur.includes(c.before)) ? cur.replace(c.before, c.after) : c.after;
  renderCard(); saveRecord(); toast(c.field+' 칸을 바꿨습니다');
});

function showErr(err){
  if(err && err.message==='__ABORT__'){ toast('멈췄습니다'); return; }
  const m = (err && err.message) || String(err);
  toast(m, 1); log('오류: '+m, 'err');
  if(err && err.raw){
    log('해석 못한 응답 전문:\n'+err.raw, 'err');
    showRaw(err.raw, '해석하지 못한 응답');
  }
}
function showRaw(text, label){
  $('#rawText').value = text || '';
  $('#rawMeta').textContent = (label || '마지막 응답')
    + (LAST_RAW_AT ? ' · ' + new Date(LAST_RAW_AT).toLocaleTimeString('ko-KR') : '');
  $('#rawModal').hidden = false;
}
$('#rawClose').addEventListener('click', ()=>{ $('#rawModal').hidden = true; });
$('#rawModal').addEventListener('click', e=>{ if(e.target.id==='rawModal') $('#rawModal').hidden = true; });
$('#rawCopy').addEventListener('click', ()=> copy($('#rawText').value));
$('#btnRawView').addEventListener('click', ()=>{
  if(!LAST_RAW) return toast('아직 받은 응답이 없습니다',1);
  showRaw(LAST_RAW);
});
async function guard(btn, label, fn){
  busy(btn, true, label);
  try{ await fn(); }
  catch(e){ showErr(e); }
  finally{ busy(btn, false); }
}

$('#btnDigest').addEventListener('click', e=> guard(e.target,'읽는 중', async()=>{
  await doDigest(); renderDigest(); touchDraft(); toast('세계를 읽었습니다');
}));
$('#btnDigestClear').addEventListener('click', ()=>{
  S.project.digest=null; S.project.digestMeta=null; stashDigest(S.opts.group); renderDigest(); touchDraft(); toast('요약을 지웠습니다');
});
$('#btnSeeds').addEventListener('click', e=> guard(e.target,'뽑는 중', async()=>{
  await doSeeds(); renderDigest(); renderSeeds(); touchDraft(); toast(S.project.seeds.length+'개 뽑았습니다');
}));
$('#btnCross').addEventListener('click', e=> guard(e.target,'섞는 중', async()=>{
  const [a,b] = S.project.sel.map(id=>S.project.seeds.find(s=>s.id===id));
  await doCross(a,b); renderSeeds(); touchDraft(); toast('섞은 씨앗을 만들었습니다');
}));
$('#btnExpand').addEventListener('click', e=> guard(e.target,'펼치는 중', async()=>{
  const P = activePreset();
  const seed = P.skipSeed ? null : S.project.seeds.find(s=>s.id===S.project.sel[0]);
  S.project.card = await doExpand(seed);
  $('#continueNote').value='';
  S.project.locked={}; S.project.violations=null; S.project.verdict=null; S.project.qa=[];
  S.project.libId = null;
  renderCard(); renderCheck(); saveRecord();
  if(S.opts.check && !activePreset().skipCheck && !S.project.card.truncated){ try{ await doCheck(); renderCheck(); }catch(err){ log('검증 건너뜀: '+err.message,'err'); } }
  toast(S.project.card.truncated?'출력이 잘린 곳까지 복구했습니다 · 이어서 만들기를 눌러주세요':'카드를 펼쳤습니다');
}));
$('#btnReroll').addEventListener('click', e=> guard(e.target,'다시 쓰는 중', async()=>{
  await doPatch(); renderCard(); saveRecord(); toast('안 잠근 칸을 다시 썼습니다');
}));
$('#btnContinue').addEventListener('click', e=> guard(e.currentTarget,'잇는 중', async()=>{
  const result=await doContinueCard($('#continueNote').value);
  S.project.violations=null; S.project.verdict=null; S.project.qa=[];
  renderCard(); renderCheck(); saveRecord(); touchDraft();
  toast(`${result.keys.length}개 칸에 이어 붙였습니다${result.recovered?' · 응답이 다시 잘려 읽힌 부분까지 반영했습니다':''}`);
}));
$('#continueNote').addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); $('#btnContinue').click(); }
});
$('#btnLockAll').addEventListener('click', ()=>{ activePreset().schema.forEach(f=>S.project.locked[f.key]=true); renderCard(); touchDraft(); });
$('#btnUnlockAll').addEventListener('click', ()=>{ S.project.locked={}; renderCard(); touchDraft(); });
$('#btnCheck').addEventListener('click', e=> guard(e.target,'대조 중', async()=>{
  await doCheck(); renderCheck(); touchDraft();
}));
$('#btnCast').addEventListener('click', e=> guard(e.target,'뽑는 중', async()=>{
  const n = S.opts.castCount;
  S.project.cast = []; S.project.relations = null; renderCast();
  if(!S.project.digest){ await doDigest(); renderDigest(); }
  for(let i=0;i<n;i++){
    busy(e.target, true, `${i+1}/${n} 만드는 중`);
    await doSeeds();
    const seed = S.project.seeds[0];
    S.project.sel = [seed.id];
    const c = await doExpand(seed);
    S.project.cast.push(c); renderCast(); renderSeeds();
  }
  touchDraft(); toast(n+'명 뽑았습니다');
}));
$('#btnRelate').addEventListener('click', e=> guard(e.target,'짜는 중', async()=>{
  await doRelate(); renderCast(); touchDraft(); toast('관계를 짰습니다');
}));
$('#btnCastSave').addEventListener('click', ()=>{
  const P = activePreset();
  S.project.cast.forEach(c=> S.library.push({
    id:uid(), star:true, at:Date.now(), updated:Date.now(),
    name:guessName(c.fields), fields:clone(c.fields),
    presetId:P.id, presetName:P.name, group:P.group||'character',
    world:(S.project.digest&&S.project.digest.title)||'',
    seedLine: c.seed?c.seed.line:'' }));
  pruneLib(); save(); renderLib(); clearDraft(); toast(S.project.cast.length+'명을 기록에 넣었습니다');
});


/* --- 한 번에 만들기 : API 1회 --- */
async function doOneShot(){
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) throw new Error('먼저 연결 탭에서 API 연결을 하나 만들어 주세요.');
  const P = activePreset();
  const src = sourceText();
  if(!src.trim()){
    throw new Error(P.needs === 'required'
      ? '이 양식은 읽을 원본이 필요합니다. 재료를 넣거나 구상 칸에 원문을 붙여 주세요.'
      : '재료를 넣거나, 작업대의 구상 칸에 몇 마디만 적어 주세요.');
  }
  const st = P.stages.expand;
  const v = baseVars({
    source: src,
    digest: '(요약 단계를 건너뛰었다. 아래 자료 원문을 직접 읽고 판단할 것.)',
    seed:   '(후보를 따로 고르지 않았다. 자료에서 가장 설득력 있는 방향을 스스로 정할 것.)',
    card:   '', cast:'', modeNote: modeNote('expand')
  });
  const commons = activeBuiltinCommons(v).concat(
    (P.common||[]).filter(c=>c.enabled && (c.content||'').trim())
      .map(c=>({role:c.role||'system', content: render(c.content, v)})));
  const msgs = commons.concat(
    st.blocks.map(b=>({role:b.role, content: render(b.content, v)}))
             .filter(m=>m.content.trim()));
  if(!msgs.some(m=>m.content.includes(src.slice(0, Math.min(60, src.length))))){
    msgs.push({role:'user', content:'자료 원문:\n'+src});
  }
  const req = curExtra();
  if(req && !st.blocks.some(b=>/\{\{extra(Rule)?\}\}/.test(b.content))){
    msgs.push({role:'user', content:'추가 요청 — 아래를 반드시 지킬 것.\n'+req});
  }
  const opts = { temperature: st.temperature, maxTokens: Math.max(st.maxTokens||2400, 2400) };
  const raw = await callProvider(conn, msgs, opts);
  let j, recovered=null;
  try{ j=(await parseJsonReply(conn,msgs,opts,raw,true)).json; }
  catch(err){
    recovered=err.raw && recoverPartialCard(err.raw,P.schema);
    if(!recovered) throw err;
    j=recovered.fields;
    log(`끊긴 한 번에 만들기 결과에서 ${Object.keys(j).length}개 칸을 먼저 복구했습니다.`,'err');
  }
  const fields = {};
  P.schema.forEach(f=>{ if(j[f.key]!=null) fields[f.key] = String(j[f.key]); });
  Object.keys(j).forEach(k=>{ if(fields[k]==null && typeof j[k]==='string') fields[k]=j[k]; });
  if(!Object.keys(fields).length) throw new Error('결과에서 칸을 찾지 못했습니다. 단계별로 해보세요.');
  return { fields, seed:null, truncated:!!recovered, truncatedField:recovered&&recovered.incompleteKey||'', continuations:[] };
}
function renderOneshot(){
  const P = activePreset(), el = $('#oneshotNote'); if(!el) return;
  const stages = 1 + (P.skipSeed?0:1) + 1 + ((S.opts.check && !P.skipCheck)?1:0);
  const selected = S.assets.filter(a=>a.use).length;
  el.innerHTML = `${selected?`성운에서 고른 재료 ${selected}개와 구상`:'구상'}을 사용해 API 호출 <b>1회</b>로 끝냅니다. 단계별로 하면 ${stages}회.`
    + ` 씨앗 고르기와 자동 검증은 건너뛰고${selected?', 재료를 요약 없이 통째로 보냅니다.':'.'}`;
  renderBuildMode();
}
function renderBuildMode(){
  const mode = S.opts.buildMode==='oneshot' ? 'oneshot' : 'staged';
  $$('#buildModeBox .build-mode').forEach(b=>{
    const on=b.dataset.build===mode;
    b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on));
  });
  $('#oneshotBox').hidden = mode!=='oneshot';
  $('#buildGuide').textContent = mode==='oneshot'
    ? '한 번에 만들기 — 구상을 적고 단추 하나로 끝냅니다'
    : '단계별 만들기 — 아래 1단계부터 하나씩';
  // 한 번에 모드에서는 단계별 전용 요소(스파인·읽기·별씨앗·펼치기)를 숨긴다
  $('#v-studio').classList.toggle('os-mode', mode==='oneshot');
  const u = GROUP_UI[S.opts.group] || GROUP_UI.world;
  $('#s1Title').textContent = mode==='oneshot' ? '구상' : u.s1;
  $('#s1Hint').textContent = mode==='oneshot'
    ? '구상을 적고 아래 단추 하나로 끝냅니다. 성운에서 고른 재료는 요약 없이 통째로 함께 보냅니다.'
    : u.hint;
  $('#s3Hint').textContent = mode==='oneshot'
    ? '만들어진 카드입니다. 마음에 드는 칸은 잠그고 나머지만 다시 굴릴 수 있습니다.'
    : '고른 별씨앗을 카드로 펼칩니다. 마음에 드는 칸은 잠그고 나머지만 다시 굴릴 수 있습니다.';
}
$('#buildModeBox').addEventListener('click', e=>{
  const b=e.target.closest('.build-mode'); if(!b) return;
  S.opts.buildMode=b.dataset.build; save(); renderBuildMode();
});
$('#btnOneShot').addEventListener('click', e=> guard(e.target,'만드는 중', async()=>{
  S.project.card = await doOneShot();
  $('#continueNote').value='';
  S.project.locked={}; S.project.violations=null; S.project.verdict=null; S.project.qa=[];
  S.project.libId = null;
  renderCard(); renderCheck(); saveRecord();
  toast(S.project.card.truncated?'출력이 잘린 곳까지 복구했습니다 · 이어서 만들기를 눌러주세요':'한 번에 만들었습니다 — 마음에 안 드는 칸만 다시 굴리세요');
  $('#cardOut').scrollIntoView({behavior:'smooth', block:'start'});
}));

/* 모드 · 옵션 */
$('#modeBox').addEventListener('click', e=>{
  const m = e.target.closest('.mode'); if(!m) return;
  if(!S.opts.modeBy) S.opts.modeBy = {};
  S.opts.modeBy[S.opts.group] = m.dataset.mode;
  S.opts.mode = m.dataset.mode;
  $$('.mode').forEach(x=>x.classList.toggle('on', x===m));
  $('#castPanel').style.display = activeMode()==='cast' ? '' : 'none';
  save(); touchDraft();
});
function bindOpt(sel, key, cast){
  const el = $(sel);
  el.addEventListener('change', ()=>{ S.opts[key] = cast ? cast(el.value) : el.value; save(); touchDraft(); });
}
$('#optExtra').addEventListener('input', e=>{
  if(!S.opts.extraBy) S.opts.extraBy = {world:'',character:'',prompt:''};
  S.opts.extraBy[S.opts.group] = e.target.value;
  renderReq(); save(); touchDraft();
});
function renderReq(){
  const n = (curExtra()||'').length;
  const g = GROUP_LABEL[S.opts.group] || '';
  $('#reqNote').textContent = n
    ? `${g} 작업의 모든 단계에 전달됩니다 · ${n}자`
    : `${g} 작업의 모든 단계에 전달됩니다 · 분류마다 따로 기억합니다`;
}
$('#optBrief').addEventListener('input', e=>{ S.opts.brief=e.target.value; renderMat(); save(); touchDraft(); });
bindOpt('#optBrief','brief');
bindOpt('#optLang','lang'); bindOpt('#optTone','tone'); bindOpt('#optExtra','extra');
bindOpt('#optSeedN','seedCount',Number); bindOpt('#optCastN','castCount',Number);
bindOpt('#optNsfw','nsfw',v=>v==='1'); bindOpt('#optCheck','check',v=>v==='1');
$('#optCheck').addEventListener('change', ()=> renderOneshot());

/* 카드 내보내기 */
$('#btnSaveLib').addEventListener('click', ()=>{
  const rec = saveRecord();
  if(!rec) return;
  rec.star = true; save(); renderLib(); clearDraft();
  toast('고정했습니다 — 기록 탭에서 볼 수 있습니다');
});
$('#btnCopyText').addEventListener('click', ()=> copy(fieldsToText(S.project.card.fields)));

/* --- 설계된 양식을 실제 양식으로 등록 --- */
function parseSchemaJson(text){
  let t = String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
  let arr;
  try{ arr = extractJson(t); }catch(e){ throw new Error('칸 정의가 JSON으로 읽히지 않습니다. 해당 칸을 직접 고쳐 주세요.'); }
  if(!Array.isArray(arr)) arr = arr.schema || arr.fields || arr.칸 || [];
  if(!Array.isArray(arr) || !arr.length) throw new Error('칸 정의가 배열이 아닙니다.');
  const seen = {};
  const out = arr.map((f,i)=>{
    let key = String(f.key || f.name || ('field'+(i+1))).trim()
      .replace(/[^a-zA-Z0-9_]/g,'_').replace(/^_+|_+$/g,'').toLowerCase() || ('field'+(i+1));
    while(seen[key]) key += '_2';
    seen[key] = 1;
    return { key, label: String(f.label || f.이름 || key), hint: String(f.hint || f.설명 || '') };
  });
  if(out.length > 14) throw new Error(`칸이 ${out.length}개입니다. 14개 이하로 줄여 주세요.`);
  return out;
}
$('#btnMakePreset').addEventListener('click', ()=>{
  const f = S.project.card && S.project.card.fields;
  if(!f) return;
  let schema;
  try{ schema = parseSchemaJson(f.schema_json); }
  catch(err){ return toast(err.message, 1); }
  const P = defaultPreset();
  P.id = uid();
  P.name = (f.form_name || '새 양식').trim().slice(0,40);
  P.group = 'character'; P.kind = 'character';
  P.schema = schema;
  const rules = (f.rules||'').trim();
  const checks = (f.checks||'').trim();
  if(rules){
    P.stages.expand.blocks[1].content = P.stages.expand.blocks[1].content.replace(
      '원칙:', '이 세계 전용 규칙:\n'+rules+'\n\n원칙:');
  }
  if(checks){
    P.stages.check.blocks[1].content = P.stages.check.blocks[1].content.replace(
      '세계 설정과 모순되는 지점만 찾아라.',
      '아래 기준으로 검사하라.\n'+checks+'\n\n그리고 세계 설정과 모순되는 지점을 찾아라.');
  }
  S.presets.push(P);
  PRESET_NOTE[P.id] = '설계해서 등록한 양식 · 칸 '+schema.length+'개';
  save();
  switchPreset(P.id);
  toast(`"${P.name}" 양식을 등록했습니다 — 인물 분류에서 바로 쓸 수 있습니다`);
});

$('#btnToAsset').addEventListener('click', ()=>{
  const P = activePreset();
  S.assets.push({ id:uid(), kind:'text',
    name: guessName(S.project.card.fields) + ' (' + P.name + ')',
    body: fieldsToText(S.project.card.fields), purposes:[S.opts.group], tags:[], use:true });
  renderAssets(); toast('재료에 넣었습니다 — 다른 양식에서 이어서 쓸 수 있습니다');
});
$('#btnDlText').addEventListener('click', ()=>
  dl(guessName(S.project.card.fields).replace(/[\\/:*?"<>|]/g,'_')+'.md',
     fieldsToText(S.project.card.fields), 'text/markdown;charset=utf-8'));
$('#btnCopyCard').addEventListener('click', ()=> copy(JSON.stringify(toV2(S.project.card.fields),null,2)));
$('#btnDlCard').addEventListener('click', ()=>{
  const f = S.project.card.fields;
  dl((guessName(f)||'card').replace(/[\\/:*?"<>|]/g,'_')+'.json', JSON.stringify(toV2(f),null,2));
});
$('#btnDlPng').addEventListener('click', async e=>{
  await guard(e.target,'만드는 중', async()=>{
    const f = S.project.card.fields;
    const blob = await makeCardPng(f);
    dlBlob((guessName(f)||'card').replace(/[\\/:*?"<>|]/g,'_')+'.png', blob);
  });
});


/* --- 세계 문서 → 로어북 --- */
async function doEntries(){
  const j = await runStage('entries', { card: JSON.stringify(S.project.card.fields, null, 1) });
  const arr = Array.isArray(j) ? j : (j.entries || []);
  return arr.map((e,i)=>({
    keys: Array.isArray(e.keys) ? e.keys : (e.keys?[String(e.keys)]:[]),
    content: String(e.content||''),
    comment: e.comment || '',
    constant: !!e.constant,
    order: i
  })).filter(e=>e.content);
}
function toWorldInfo(entries){
  const out = {};
  entries.forEach((e,i)=>{ out[String(i)] = {
    uid:i, key:e.keys, keysecondary:[], comment:e.comment, content:e.content,
    constant:e.constant, selective:true, order:i, position:0, disable:false,
    addMemo:!!e.comment, excludeRecursion:false, probability:100, useProbability:true
  }; });
  return { entries: out };
}
$('#btnDlBook').addEventListener('click', e=> guard(e.target,'쪼개는 중', async()=>{
  const entries = await doEntries();
  if(!entries.length) throw new Error('항목을 만들지 못했습니다.');
  const nm = (S.project.card.fields.title || '세계').replace(/[\\/:*?"<>|]/g,'_');
  dl(nm+'-lorebook.json', JSON.stringify(toWorldInfo(entries),null,2));
  S.assets.push({ id:uid(), kind:'lorebook', name:nm+' (여기서 만든 것)',
    entries: entries.map((x,i)=>({...x, id:'e'+i+uid(), enabled:true, use:true})), purposes:['world'], tags:[], use:true });
  renderAssets();
  toast(entries.length+'개 항목 — 내려받고 재료에도 넣었습니다');
}));

/* ==================================================================
   9. 대화
   ================================================================== */
const TALK_ROLE = {
  world: `당신은 세계관을 함께 다듬는 상담역이다.
상대가 만든 것을 존중하되 듣기 좋은 말을 하지 않는다. 문제를 짚을 때는 자료의 어느 부분인지 대고, 제안할 때는 바로 쓸 수 있는 문안을 낸다.
"더 구체적으로", "깊이를 더하면" 같은 막연한 말을 하지 않는다.
설정을 대신 다 채워주려 들지 말고, 정해야 할 것을 짚어 상대가 고르게 한다. 한 번에 질문은 두 개까지.`,
  char: `당신은 인물을 함께 다듬는 상담역이다.
설정 나열보다 이 인물이 무엇을 원하고 무엇을 두려워하는지, 대화 대여섯 번 안에 그게 드러나는지를 본다.
매력적이기만 한 인물을 경계하고, 결함이 실제로 대가를 치르는지 확인한다.
막연한 칭찬과 막연한 조언을 하지 않는다. 한 번에 질문은 두 개까지.`,
  prompt: `당신은 롤플레이 프롬프트를 함께 짜는 상담역이다.
지시문이 설명문으로 흘렀는지, 모델이 실제로 따를 수 있는 형태인지, 대화 대여섯 번 안에서 효과가 나타나는지를 본다.
{user}의 성격이나 반응을 프롬프트가 멋대로 정하고 있으면 짚는다.
고칠 때는 고친 문장을 그대로 내놓는다. 한 번에 질문은 두 개까지.`,
  critic: `당신은 냉정한 평가자다. 위로하지 않는다.
잘된 곳은 이유를 댈 수 있을 때만 말한다. 문제는 우선순위를 매겨 큰 것부터 짚는다.
어디가 흔한지 클리셰 이름을 붙여 말하고, 비트는 방법을 하나 낸다.
다만 상대의 의도 자체를 취향으로 깎지는 않는다. 그 의도 안에서 무엇이 안 되고 있는지를 본다.`,
  free: ``
};
function talkContext(){
  const c = S.chat.ctx, parts = [];
  if(c.assets){ const t = sourceText(); if(t.trim()) parts.push('[재료]\n'+t); }
  if(c.digest && S.project.digest) parts.push('[세계 요약]\n'+JSON.stringify(S.project.digest,null,1));
  if(c.card && S.project.card) parts.push('[지금 만든 것]\n'+JSON.stringify(S.project.card.fields,null,1));
  return parts.join('\n\n');
}
function renderChat(){
  const box = $('#chatLog');
  const wrapHtml = S.chat.summary
    ? `<div class="msg bot wrap"><span class="who">지금까지의 정리</span>${esc(S.chat.summary)}</div>` : '';
  if(!S.chat.msgs.length && !wrapHtml){
    box.innerHTML = '<div class="empty"><b>아직 아무 말도 안 했습니다</b>만든 것을 보여주고 물어보세요.</div>';
  } else {
    box.innerHTML = wrapHtml + S.chat.msgs.map(m=>
      `<div class="msg ${m.role==='user'?'user':'bot'}"><span class="who">${m.role==='user'?'나':'상대'}</span>${esc(m.content)}</div>`
    ).join('');
  }
  box.scrollTop = box.scrollHeight;
  const t = tok(talkContext());
  const ct = tok((S.chat.summary||'')+S.chat.msgs.map(m=>m.content).join('\n'));
  $('#ctxTok').textContent = (t ? `함께 보낼 분량 ${t} 토큰쯤` : '함께 보낼 것 없음')
    + (ct ? ` · 대화 ${ct} 토큰쯤` : '');
  renderTalkAssets();
  renderWrapNudge(ct);
  const toCard = $('#btnTalkToCard');
  if(toCard) toCard.disabled = !(S.project.card && (S.chat.msgs.length || S.chat.summary));
}
const WRAP_NUDGE_AT = 2500;
function renderWrapNudge(convoTok){
  const el = $('#wrapNudge'); if(!el) return;
  const ct = convoTok!=null ? convoTok : tok((S.chat.summary||'')+S.chat.msgs.map(m=>m.content).join('\n'));
  const show = ct >= WRAP_NUDGE_AT && S.chat.msgs.length >= 4 && !S.chat.nudgeOff;
  el.hidden = !show;
  if(show) $('#wrapNudgeText').textContent = `대화가 ${ct} 토큰쯤으로 길어졌습니다. 마무리하면 다음 입력부터 가벼워집니다.`;
}
$('#btnTalkToCard').addEventListener('click', e=> guard(e.currentTarget,'반영 중', async()=>{
  const P=activePreset();
  if(!confirm(`이 대화의 결론을 “${P.name}” 카드에 반영합니다. 잠근 칸은 그대로 두고 바뀐 칸만 덮어씁니다. 계속할까요?`)) return;
  const r=await doChatToCard();
  S.project.violations=null; S.project.verdict=null; S.project.qa=[];
  renderCard(); renderCheck(); saveRecord(); touchDraft();
  toast(`${r.keys.length}개 칸에 반영했습니다 — 작업대에서 확인하세요`);
}));
$('#btnWrapNudge').addEventListener('click', ()=>{ $('#wrapNudge').hidden=true; wrapTalk(); });
$('#btnWrapNudgeDismiss').addEventListener('click', ()=>{
  S.chat.nudgeOff=true; save(); $('#wrapNudge').hidden=true;
});
function assetTok(a){
  if(a.kind==='lorebook') return tok((a.entries||[]).filter(e=>e.use).map(e=>e.content).join(''));
  if(a.kind==='character') return tok(Object.values(a.fields||{}).join(''));
  return tok(a.body||'');
}
const TALK_LB_OPEN = new Set();
function talkAssetRow(a){
  const kindLabel = {character:'캐릭터',lorebook:'로어북',text:'텍스트'}[a.kind]||a.kind;
  // 로어북은 항목 단위로 펼쳐 개별 선택
  if(a.kind==='lorebook' && (a.entries||[]).length){
    const on = a.entries.filter(e=>e.use).length, open = TALK_LB_OPEN.has(a.id);
    const head = `<label class="nebula-row"><input type="checkbox" class="t-use" data-id="${a.id}" ${a.use?'checked':''}>
      <span>${esc(a.name)}</span><span class="sp"></span>
      <button type="button" class="lb-toggle" data-id="${a.id}">${on}/${a.entries.length} 항목 ${open?'▴':'▾'}</button></label>`;
    const entries = a.entries.map((en,i)=>`
      <label class="nebula-row lb-entry"><input type="checkbox" class="t-entry" data-id="${a.id}" data-ei="${i}" ${en.use?'checked':''} ${a.use?'':'disabled'}>
        <span>${esc(en.comment||en.key||(en.keys&&en.keys.join(', '))||'항목 '+(i+1))}</span><span class="sp"></span><span class="note">${tok(en.content||'')} 토큰쯤</span></label>`).join('');
    return `<div class="lb-pick" data-id="${a.id}">${head}<div class="lb-entries" ${open?'':'hidden'}>${entries}</div></div>`;
  }
  return `<label class="nebula-row"><input type="checkbox" class="t-use" data-id="${a.id}" ${a.use?'checked':''}>
      <span>${esc(a.name)}</span><span class="sp"></span><span class="note">${kindLabel} · ${assetTok(a)} 토큰쯤</span></label>`;
}
function renderTalkAssets(){
  const box = $('#talkAssetList'), count = $('#talkPickCount'); if(!box) return;
  const n = S.assets.filter(a=>a.use).length;
  count.textContent = S.assets.length ? `선택 ${n}/${S.assets.length}개` : '성운이 비어 있습니다';
  box.innerHTML = S.assets.length ? S.assets.map(talkAssetRow).join('')
    : '<div class="note">재료 탭에서 파일이나 글을 먼저 넣어 주세요.</div>';
}
$('#talkAssetList').addEventListener('change', e=>{
  if(e.target.classList.contains('t-use')){
    const a = assetById(e.target.dataset.id); if(!a) return;
    a.use = e.target.checked;
    renderAssets(); materialChanged(); renderChat();
  } else if(e.target.classList.contains('t-entry')){
    const a = assetById(e.target.dataset.id); if(!a || !a.entries) return;
    const en = a.entries[+e.target.dataset.ei]; if(!en) return;
    en.use = e.target.checked;
    renderAssets(); materialChanged(); renderChat();
  }
});
$('#talkAssetList').addEventListener('click', e=>{
  const t = e.target.closest('.lb-toggle'); if(!t) return;
  const id = t.dataset.id;
  if(TALK_LB_OPEN.has(id)) TALK_LB_OPEN.delete(id); else TALK_LB_OPEN.add(id);
  renderTalkAssets();
});
async function wrapTalk(){
  if(S.chat.msgs.length < 2) return toast('마무리할 대화가 아직 없습니다',1);
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  if(!confirm('지금까지의 대화를 요약 하나로 압축합니다.\n원문이 필요하면 먼저 복사하거나 재료로 남겨 두세요. 계속할까요?')) return;
  const btn = $('#btnTalkWrap');
  busy(btn, true, '정리 중');
  try{
    const convo = (S.chat.summary ? '[이전 정리]\n'+S.chat.summary+'\n\n' : '')
      + S.chat.msgs.map(m=>(m.role==='user'?'[나] ':'[상대] ')+m.content).join('\n\n');
    const before = tok(convo);
    const out = await callProvider(conn, [
      {role:'system', content:'너는 진행 중인 창작 상담 대화를 이어가기 위한 압축 정리를 만든다. 새 의견이나 제안을 덧붙이지 않는다. '+(S.opts.lang||'한국어')+' 로 쓴다.'},
      {role:'user', content:'아래 대화를 다음 항목으로 정리하라. 각 항목은 짧은 개조식으로, 없는 항목은 빼라.\n- 다룬 주제\n- 정해진 것·합의\n- 검토했지만 접은 것\n- 아직 열린 질문\n\n대화:\n'+convo}
    ], {temperature:0.3, maxTokens:1000});
    S.chat.summary = out.trim();
    S.chat.msgs = [];
    S.chat.nudgeOff = false;
    save(); renderChat();
    toast(`대화를 정리했습니다 — ${before} 토큰 → ${tok(out)} 토큰`);
  }catch(err){ showErr(err); }
  finally{ busy(btn, false); }
}
$('#btnTalkWrap').addEventListener('click', wrapTalk);
async function sendChat(){
  const inp = $('#chatIn'), text = inp.value.trim();
  if(!text) return;
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  S.chat.msgs.push({role:'user', content:text});
  inp.value=''; renderChat(); save();
  const sys = [];
  const roleKey = S.chat.role;
  const customPrompt = S.customTalkPrompts && S.customTalkPrompts[roleKey];
  if(customPrompt && customPrompt.trim()){
    sys.push(customPrompt.trim());
  } else if(TALK_ROLE[roleKey]){
    sys.push(TALK_ROLE[roleKey]);
  }
  sys.push(`{{lang}} 로 답한다.`.replace('{{lang}}', S.opts.lang||'한국어'));
  if(S.chat.summary) sys.push('아래는 지금까지 나눈 대화를 압축한 정리다. 이 맥락 위에서 이어서 대화한다.\n\n'+S.chat.summary);
  const ctx = talkContext();
  if(ctx) sys.push('아래는 상대가 지금 다루고 있는 자료다. 묻지 않은 것까지 통째로 다시 써주지 마라.\n\n'+ctx);
  const msgs = [{role:'system', content: sys.join('\n\n')}].concat(
    S.chat.msgs.slice(-24).map(m=>({role:m.role, content:m.content})));
  const btn = $('#btnSend');
  busy(btn, true, '…');
  try{
    const out = await callProvider(conn, msgs, {temperature:0.85, maxTokens:2200});
    S.chat.msgs.push({role:'assistant', content: out.trim()});
    if(S.chat.msgs.length>60) S.chat.msgs = S.chat.msgs.slice(-60);
    save(); renderChat();
  }catch(err){ S.chat.msgs.pop(); renderChat(); showErr(err); }
  finally{ busy(btn,false); }
}
$('#btnSend').addEventListener('click', sendChat);
$('#chatIn').addEventListener('keydown', e=>{
  if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); sendChat(); }
});
$('#talkRole').addEventListener('change', e=>{
  S.chat.role = e.target.value;
  updateTalkRoleUI();
  save();
});
function updateTalkRoleUI(){
  const role = $('#talkRole').value;
  const def = TALK_ROLE[role] || '';
  $('#talkDefaultPrompt').value = def;
  const custom = (S.customTalkPrompts && S.customTalkPrompts[role]) || '';
  $('#talkCustomPrompt').value = custom;
}
$('#talkCustomPrompt').addEventListener('input', e=>{
  const role = $('#talkRole').value;
  if(!S.customTalkPrompts) S.customTalkPrompts = {};
  S.customTalkPrompts[role] = e.target.value;
  save();
});
$('#btnTalkResetRole').addEventListener('click', ()=>{
  const role = $('#talkRole').value;
  if(S.customTalkPrompts) delete S.customTalkPrompts[role];
  updateTalkRoleUI();
  save();
  toast('기본 프롬프트로 되돌렸습니다');
});
['ctxAssets','ctxDigest','ctxCard'].forEach(id=>{
  $('#'+id).addEventListener('change', e=>{
    S.chat.ctx[id.replace('ctx','').toLowerCase()] = e.target.checked; save(); renderChat();
  });
});
$('#btnTalkClear').addEventListener('click', ()=>{
  if((!S.chat.msgs.length && !S.chat.summary) || confirm('대화와 정리를 모두 비울까요?')){
    S.chat.msgs=[]; S.chat.summary=''; S.chat.nudgeOff=false; save(); renderChat();
  }
});
function talkTranscript(marks){
  const parts=[];
  if(S.chat.summary) parts.push((marks?'[지금까지의 정리]\n':'지금까지의 정리:\n')+S.chat.summary);
  parts.push(...S.chat.msgs.map(m=>(m.role==='user'?(marks?'[나] ':'나: '):(marks?'[상대] ':'상대: '))+m.content));
  return parts.join('\n\n');
}
$('#btnTalkCopy').addEventListener('click', ()=> copy(talkTranscript(false)));
$('#btnTalkToAsset').addEventListener('click', ()=>{
  if(!S.chat.msgs.length && !S.chat.summary) return toast('대화가 없습니다',1);
  const purpose={world:'world',char:'character',prompt:'prompt'}[S.chat.role];
  S.assets.push({ id:uid(), kind:'text', name:'대화 기록 '+new Date().toLocaleTimeString('ko-KR'),
    body: talkTranscript(true), purposes:purpose?[purpose]:[], tags:[], use:true });
  renderAssets(); toast('재료에 넣었습니다');
});

/* ==================================================================
   7. 화면 — 보관함 · 프롬프트 · 연결 · 기록
   ================================================================== */
function fieldsToText(fields, preset){
  const P = preset || activePreset();
  const rows = [];
  const seen = {};
  P.schema.forEach(f=>{ seen[f.key]=1;
    if(fields[f.key]) rows.push('## '+f.label+'\n\n'+fields[f.key]); });
  Object.keys(fields).forEach(k=>{ if(!seen[k] && fields[k]) rows.push('## '+k+'\n\n'+fields[k]); });
  return '# '+guessName(fields)+'\n\n'+rows.join('\n\n');
}
function saveRecord(){
  if(!S.project.card) return null;
  const P = activePreset();
  const f = S.project.card.fields;
  const seedLine = S.project.card.seed ? S.project.card.seed.line : '';
  let rec = S.project.libId && S.library.find(r=>r.id===S.project.libId);
  if(!rec){
    rec = { id:uid(), star:false, at:Date.now() };
    S.library.push(rec);
    S.project.libId = rec.id;
  }
  Object.assign(rec, {
    name: guessName(f), fields: clone(f),
    presetId: P.id, presetName: P.name, group: P.group || 'character',
    world: (S.project.digest && (S.project.digest.title || S.project.digest.subject)) || '',
    seedLine, truncated:!!S.project.card.truncated,
    truncatedField:S.project.card.truncatedField||'',
    continuations:clone(S.project.card.continuations||[]), updated: Date.now()
  });
  pruneLib(); save(); renderLib(); touchDraft();
  return rec;
}
function pruneLib(){
  const LIMIT = 200;
  if(S.library.length <= LIMIT) return;
  const drop = S.library.filter(r=>!r.star).sort((a,b)=>(a.updated||a.at)-(b.updated||b.at));
  const n = S.library.length - LIMIT;
  const ids = new Set(drop.slice(0,n).map(r=>r.id));
  if(ids.size) log(`기록이 ${LIMIT}개를 넘어 고정하지 않은 오래된 항목 ${ids.size}개를 지웠습니다.`);
  S.library = S.library.filter(r=>!ids.has(r.id));
}
let libQuery = '', libFilter = '';
function syncLibFilter(){ libFilter = S.opts.group || ''; const el=$('#libFilter'); if(el) el.value = libFilter; }
function libMatches(r){
  if(libFilter==='star' && !r.star) return false;
  if(libFilter && libFilter!=='star' && (r.group||'character')!==libFilter) return false;
  if(!libQuery) return true;
  const hay = (r.name+' '+(r.world||'')+' '+(r.presetName||'')+' '+Object.values(r.fields||{}).join(' ')).toLowerCase();
  return hay.includes(libQuery);
}
function renderLib(){
  $('#bLib').textContent = S.library.length;
  const box = $('#libList');
  const list = S.library.filter(libMatches).sort((a,b)=>(b.updated||b.at)-(a.updated||a.at));
  $('#libStat').textContent = `전체 ${S.library.length}개 · 보이는 것 ${list.length}개 · 고정 ${S.library.filter(r=>r.star).length}개`;
  if(!S.library.length){
    box.innerHTML = '<div class="empty"><b>아직 아무것도 없습니다</b>작업대에서 무언가 만들면 자동으로 여기 쌓입니다.</div>'; return;
  }
  if(!list.length){ box.innerHTML = '<div class="empty"><b>맞는 것이 없습니다</b>검색어나 분류를 바꿔보세요.</div>'; return; }
  box.innerHTML = list.map(r=>`
    <div class="libitem" data-id="${r.id}">
      <button class="mini ghost l-star" style="flex:none;border:none;font-size:15px;padding:2px 6px;color:${r.star?'var(--brass)':'var(--dim2)'}">${r.star?'★':'☆'}</button>
      <span class="ln l-name" title="눌러서 이름 바꾸기">${esc(r.name||'이름 없음')}</span>
      <span class="lm">${esc(GROUP_LABEL[r.group]||'')} · ${esc(r.presetName||'')}${r.world?' · '+esc(r.world):''} · ${new Date(r.updated||r.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
      <button class="mini ghost l-open">불러오기</button>
      <button class="mini ghost l-md">글</button>
      <button class="mini ghost l-json">JSON</button>
      <button class="mini ghost l-png">PNG</button>
      <button class="iconbtn danger l-del" title="삭제" aria-label="삭제">${TRASH_SVG}</button>
    </div>`).join('');
}
$('#libSearch').addEventListener('input', e=>{ libQuery = e.target.value.toLowerCase().trim(); renderLib(); });
$('#libFilter').addEventListener('change', e=>{ libFilter = e.target.value; renderLib(); });
$('#libList').addEventListener('click', async e=>{
  const it = e.target.closest('.libitem'); if(!it) return;
  const rec = S.library.find(x=>x.id===it.dataset.id); if(!rec) return;
  const P = S.presets.find(x=>x.id===rec.presetId) || activePreset();
  if(e.target.closest('.l-star')){ rec.star = !rec.star; save(); renderLib(); return; }
  if(e.target.closest('.l-name')){
    const n = prompt('이름 바꾸기', rec.name);
    if(n && n.trim()){ rec.name = n.trim(); rec.fields.name = rec.fields.name ? n.trim() : rec.fields.name; save(); renderLib(); }
    return;
  }
  if(e.target.closest('.l-del')){
    if(rec.star && !confirm('고정해둔 항목입니다. 지울까요?')) return;
    S.library = S.library.filter(x=>x.id!==rec.id);
    if(S.project.libId===rec.id) S.project.libId = null;
    save(); renderLib(); return;
  }
  const fn = (rec.name||'record').replace(/[\\/:*?"<>|]/g,'_');
  if(e.target.closest('.l-md')){ dl(fn+'.md', fieldsToText(rec.fields, P), 'text/markdown;charset=utf-8'); return; }
  if(e.target.closest('.l-json')){ dl(fn+'.json', JSON.stringify(toV2(rec.fields),null,2)); return; }
  if(e.target.closest('.l-png')){
    try{ dlBlob(fn+'.png', await makeCardPng(rec.fields)); }catch(err){ toast(err.message,1); } return; }
  if(e.target.closest('.l-open')){
    if(rec.presetId && S.presets.find(x=>x.id===rec.presetId)) switchPreset(rec.presetId);
    S.project.card = {fields:clone(rec.fields), seed:null, truncated:!!rec.truncated,
      truncatedField:rec.truncatedField||'', continuations:clone(rec.continuations||[])};
    $('#continueNote').value='';
    S.project.libId = rec.id; S.project.locked={};
    S.project.violations=null; S.project.verdict=null; S.project.qa=[];
    renderCard(); renderCheck(); renderQA(); tab('studio'); toast('작업대로 불러왔습니다');
  }
});
$('#btnLibExport').addEventListener('click', ()=>{
  if(!S.library.length) return toast('기록이 비어 있습니다',1);
  dl('orrery-records.json', JSON.stringify(S.library,null,2));
});
$('#btnLibClear').addEventListener('click', ()=>{
  const keep = S.library.filter(r=>r.star);
  const n = S.library.length - keep.length;
  if(!n) return toast('지울 것이 없습니다');
  if(confirm(`고정하지 않은 ${n}개를 지울까요? 되돌릴 수 없습니다.`)){
    S.library = keep; S.project.libId = null; save(); renderLib();
  }
});

/* --- 프롬프트 --- */
const PRESET_NOTE = {
  'prompt-forge': '만들고 싶은 프롬프트를 설명하면 완성된 프롬프트를 짜줍니다. 역할·작동 원칙·출력 형식·자기 검증·금지 사항까지.',
  'promptcraft':  '인물 하나로 굴릴 롤플레이 프롬프트 묶음. 인물 지시문·문체 규칙·첫 장면·상황 변주·물꼬.',
  'world':        '키워드 몇 개나 반쯤 만든 설정에서 세계를 설계합니다. 다 만든 뒤 로어북으로 뽑아 재료에 되돌리면 그 세계에서 바로 인물을 뽑을 수 있습니다.',
  'world-brief':  '이미 있는 설정을 처음 읽는 사람에게 소개하는 압축본. 이모지 구획과 정보 행. 확인된 사실과 소문·추론을 구분해 적습니다.',
  'world-guide':  '설정집 형태의 상세 안내서. 작동 원리·대가·한계·실패까지 다루고, 요소 개수에 따라 깊이를 자동으로 배분합니다.',
  'default':      '무난한 카드. 이름·외모·성격·말투·배경·비밀·첫 대사.',
  'char-engine':  '풀 시트. 모든 설정에 원인을 요구하고, 이름을 지우면 다른 인물에게 붙는 문장을 걸러냅니다. 말투는 예문 5개 이상.',
  'profile-ko':   '설정집에 그대로 얹는 압축형. 명사형 어미, 은유 없음, 예시 대사 없음.',
  'drives-adult': '성인 전용. 인물 자료에서 심리 여섯 축을 읽고 성적 기질을 도출합니다. 재료 탭에 대상 카드를 넣고 쓰세요.',
  'world-audit':  '만든 세계를 넣으면 봐줍니다. 토대·빈틈·모순·생활의 질감·흔한 배치를 짚고 붙여 쓸 문안을 제안합니다.',
  'char-audit':   '만든 인물을 넣으면 봐줍니다. 분화·인과·목소리·굴러가는가·{user} 자리를 짚습니다.',
  'prompt-audit': '만든 프롬프트를 넣으면 봐줍니다. 판정 가능성·규칙 충돌·빠진 통제·출력 형식을 짚습니다.',
  'schema-forge': '이 세계 전용 인물 프로필 양식을 설계해 JSON으로 뽑습니다. 결과 아래 "이 양식 등록하기"를 누르면 바로 쓸 수 있는 양식이 됩니다.',
  'greeting':     '카드에 넣을 첫 만남 장면을 씁니다. 장면 후보를 먼저 뽑고 고른 것만 본문으로 펼칩니다. {user}의 말과 행동은 쓰지 않습니다.',
  'audit':        '만든 것을 넣으면 봐줍니다. 비어 있는 곳·어긋나는 곳·흔한 곳을 짚고 붙여 쓸 문안을 제안합니다.'
};

const MODE_UI = {
  world: {
    title:'세계를 어떻게 만들까요',
    hint:'성운의 재료를 새 세계의 씨앗으로 쓸지, 기존 세계의 빈틈을 보충할지 고릅니다.',
    items:[
      ['new','새 세계 만들기','키워드와 설정 조각을 바탕으로 새로운 세계를 설계합니다.'],
      ['supplement','기존 세계 보충하기','확정된 규칙과 고유명사는 지키고 생활·제도·갈등의 빈 곳을 채웁니다.']
    ]
  },
  character: {
    title:'인물을 어떻게 뽑을까요',
    hint:'세계에서 새로 뽑거나, 기존 인물을 보충하거나, 함께 얽힐 상대와 관계망을 만듭니다.',
    items:[
      ['w2c','세계에서 사람 뽑기','로어북·설정을 읽고 그 세계에 실제로 살고 있을 법한 인물을 만듭니다.'],
      ['supplement','기존 인물 보충하기','기존 인물의 정체성과 확정 설정은 지키고, 비어 있거나 얇은 부분을 보강합니다.'],
      ['foil','맞부딪힐 상대','기존 인물을 읽고 그와 어긋나고 얽힐 다른 인물을 만듭니다.'],
      ['cast','여러 명 + 관계망','같은 세계에서 여러 명을 뽑고 서로를 어떻게 보는지까지 짭니다.']
    ]
  },
  prompt: {
    title:'프롬프트를 어떻게 만들까요',
    hint:'새로 설계하거나, 이미 쓰는 프롬프트의 빠진 부분을 채우거나, 다른 용도로 변형합니다.',
    items:[
      ['new','새 프롬프트 만들기','목적과 재료에서 역할·작동 원칙·출력 형식을 새로 설계합니다.'],
      ['supplement','기존 프롬프트 보충하기','잘 작동하는 부분은 두고 빠진 통제·경계조건·출력 규칙을 채웁니다.'],
      ['adapt','기존 프롬프트 변형하기','핵심 작동 원리는 살리면서 구상 칸에 적은 새 용도에 맞춥니다.']
    ]
  }
};
function renderModeChooser(){
  const u = MODE_UI[S.opts.group] || MODE_UI.character, cur = activeMode();
  $('#modeTitle').textContent = u.title;
  $('#modeHint').textContent = u.hint;
  $('#modeBox').innerHTML = u.items.map(([id,name,note])=>`
    <div class="mode ${id===cur?'on':''}" data-mode="${id}"><div class="mn">${esc(name)}</div><div class="md">${esc(note)}</div></div>`).join('');
}


const GROUP_UI = {
  world: {
    s1:'세계 읽기', spine1:'세계 읽기', btn:'세계 읽기',
    hint:'재료를 한 번 압축해 규칙·세력·용어·빈틈을 뽑습니다. 한 번 만들면 계속 재사용합니다.',
    brief:'구상', briefNote:'재료가 없어도 이것만으로 시작할 수 있습니다',
    ph:'예: 바다가 말라붙은 뒤의 항구도시, 소금 채굴, 물을 파는 길드'
  },
  character: {
    s1:'재료 읽기', spine1:'재료 읽기', btn:'재료 읽기',
    hint:'재료 탭에 넣은 세계와 인물을 압축해 읽습니다. 인물을 놓을 자리와 빈틈을 뽑아 다음 단계로 넘깁니다.',
    brief:'구상', briefNote:'원하는 방향이 있으면 적으세요',
    ph:'예: 항해길드에서 쫓겨난 사람. 30대. 말수가 적고 빚이 있음'
  },
  prompt: {
    s1:'요구 정리', spine1:'요구 정리', btn:'요구 정리',
    hint:'무엇을 만들어야 하는지, 무엇이 정해졌고 무엇이 비었는지 먼저 정리합니다.',
    brief:'구상', briefNote:'여기가 주 입력입니다 — 무엇을 만들 프롬프트인지 적으세요',
    ph:'예: 설정집을 읽고 그 세계의 사건 사고를 뉴스 형식으로 뽑는 프롬프트'
  }
};
function digestTpl(P){ return (P.stages.digest.blocks||[]).map(b=>b.content).join('|'); }
function stashDigest(g){
  if(!S.project.digestBy) S.project.digestBy = {};
  S.project.digestBy[g] = S.project.digest
    ? { data:S.project.digest, meta:S.project.digestMeta } : null;
}
function loadDigest(g){
  const d = (S.project.digestBy||{})[g];
  S.project.digest = d ? d.data : null;
  S.project.digestMeta = d ? d.meta : null;
}
function digestStale(){
  const m = S.project.digestMeta;
  if(!S.project.digest || !m) return null;
  if(m.source != null && m.source !== sourceText()) return '재료가 바뀌었습니다';
  return m.tpl === digestTpl(activePreset()) ? null : `읽기 양식이 “${m.presetName}”에서 바뀌었습니다`;
}
function applyGroupUi(){
  const u = GROUP_UI[S.opts.group] || GROUP_UI.world;
  const set = (sel,v)=>{ const el=$(sel); if(el) el.textContent = v; };
  set('#studioTitle', (GROUP_LABEL[S.opts.group]||'') + ' 작업대');
  set('#s1Title', u.s1); set('#spine1', u.spine1); set('#s1Hint', u.hint);
  set('#briefLabel', u.brief); set('#briefNote', u.briefNote || '');
  const bd = $('#btnDigest');
  if(bd && !bd._t){
    // 아이콘(svg)은 남기고 텍스트 노드만 바꾼다
    const txt = Array.from(bd.childNodes).find(n=>n.nodeType===3 && n.textContent.trim());
    if(txt) txt.textContent = u.btn; else bd.append(u.btn);
  }
  const ob = $('#optBrief'); if(ob) ob.placeholder = u.ph;
  renderModeChooser(); renderNebulaPicker();
}

const GROUP_LABEL = { world:'세계', character:'인물', prompt:'프롬프트' };
// includeOff=true 면 꺼둔 프리셋까지 포함 (양식 탭 관리용). 기본은 켜진 것만.
function presetsInGroup(g, includeOff){
  return S.presets.filter(p=>{
    const pg = p.group || 'character';
    return (pg===g || pg==='all') && (includeOff || !p.off);
  });
}
function markNav(){
  const g = S.opts.group || 'character';
  $$('#groupBox button').forEach(b=>{
    b.classList.toggle('on',
      b.dataset.group ? (curTab==='studio' && b.dataset.group===g)
                      : (b.dataset.tab===curTab));
    // 작업대 밖에 있어도 어느 분류로 돌아갈지 흐리게 표시
    b.classList.toggle('pending', !!b.dataset.group && curTab!=='studio' && b.dataset.group===g);
  });
}
function renderGroup(){
  const g = S.opts.group || 'character';
  markNav();
  const list = presetsInGroup(g);
  $('#studioPreset').innerHTML = list.map(p=>
    `<option value="${p.id}" ${p.id===S.activePreset?'selected':''}>${esc(p.name)}</option>`).join('')
    || '<option value="">이 분류에 양식이 없습니다</option>';
  $('#studioNote').textContent = PRESET_NOTE[S.activePreset] || '';
}
function switchPreset(id){
  if(!id) return;
  const prevGroup = S.opts.group;
  S.activePreset = id;
  const p = activePreset();
  const pg = p.group || 'character';
  if(pg!=='all' && pg!==prevGroup){
    // 분류가 바뀌면 읽은 요약도 그 분류 것으로 갈아끼운다
    stashDigest(prevGroup);
    S.opts.group = pg;
    loadDigest(pg);
    syncLibFilter(); renderLib();
  }
  S.project.card = null; S.project.locked = {}; S.project.qa = [];
  if($('#continueNote')) $('#continueNote').value='';
  S.project.violations = null; S.project.verdict = null;
  S.project.libId = null;
  save();
  renderGroup(); renderPresetSel(); renderSchema(); renderStages();
  renderDigest(); renderSeeds(); renderCard(); renderCheck(); renderQA();
  renderMat(); applyGroupUi(); renderOneshot();
}
function applyGroup(g){
  stashDigest(S.opts.group);
  S.opts.group = g;
  loadDigest(g);
  const list = presetsInGroup(g);
  if(list.length && !list.find(p=>p.id===S.activePreset)) S.activePreset = list[0].id;
  // 작업 중이던 것은 분류마다 따로 둔다
  S.project.card = null; S.project.locked = {}; S.project.qa = [];
  if($('#continueNote')) $('#continueNote').value='';
  S.project.violations = null; S.project.verdict = null;
  S.project.seeds = []; S.project.sel = []; S.project.libId = null;
  renderDigest();
  // 기록과 대화도 지금 분류에 맞춘다
  libFilter = g; if($('#libFilter')) $('#libFilter').value = g;
  const roleFor = { world:'world', character:'char', prompt:'prompt' };
  if(S.chat.role !== 'critic' && S.chat.role !== 'free'){
    S.chat.role = roleFor[g] || 'world';
    if($('#talkRole')) $('#talkRole').value = S.chat.role;
  }
  save();
  $('#optExtra').value = curExtra(); renderReq();
  renderGroup(); renderPresetSel(); renderSchema(); renderStages();
  renderSeeds(); renderCard(); renderCheck(); renderQA(); renderLib(); renderMat(); applyGroupUi(); renderOneshot();
}
$('#groupBox').addEventListener('click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.tab){ tab(b.dataset.tab); return; }
  const g = b.dataset.group;
  if(g === S.opts.group){ tab('studio'); return; }
  applyGroup(g);
  tab('studio');
});
$('#studioPreset').addEventListener('change', e=> switchPreset(e.target.value));

function renderPresetSel(){
  $('#presetSel').innerHTML = S.presets.map(p=>
    `<option value="${p.id}" ${p.id===S.activePreset?'selected':''}>${p.off?'🚫 ':''}${esc(p.name)}${p.off?' (숨김)':''}</option>`).join('');
  const n = PRESET_NOTE[S.activePreset];
  $('#stNote').innerHTML = n ? esc(n) : '';
  if($('#studioNote')) $('#studioNote').textContent = n || '';
  $('#stNote').style.color = S.activePreset==='drives-adult' ? 'var(--brass)' : '';
  const off = !!(activePreset() && activePreset().off), b = $('#btnPresetOff');
  if(b){
    b.classList.toggle('is-off', off);
    b.title = off ? '작업대에 다시 표시' : '작업대에서 숨기기';
    b.setAttribute('aria-label', b.title);
  }
}
// 프리셋을 작업대 목록에서 숨기거나 다시 표시 (양식 탭에는 그대로 남음)
$('#btnPresetOff').addEventListener('click', ()=>{
  const p = activePreset(); if(!p) return;
  if(!p.off){
    // 켜진 마지막 프리셋을 숨기면 그 분류가 빈다 — 막는다
    const groups = (p.group||'character')==='all' ? ['world','character','prompt'] : [p.group||'character'];
    const wouldEmpty = groups.find(g=> presetsInGroup(g).filter(x=>x.id!==p.id).length===0);
    if(wouldEmpty) return toast(`${GROUP_LABEL[wouldEmpty]||wouldEmpty} 분류에 켜진 양식이 이것뿐입니다 — 숨기려면 다른 양식을 먼저 켜세요`,1);
  }
  p.off = !p.off;
  // 작업대에서 쓰던 프리셋을 숨겼으면, 그 분류의 다른 켜진 것으로 옮긴다
  if(p.off && S.activePreset===p.id){
    const alt = presetsInGroup(S.opts.group)[0];
    if(alt) S.activePreset = alt.id;
  }
  save();
  renderPresetSel(); renderGroup(); renderSchema(); renderStages();
  renderMat(); applyGroupUi(); renderOneshot();
  toast(p.off ? `“${p.name}”을 작업대에서 숨겼습니다` : `“${p.name}”을 작업대에 다시 표시합니다`);
});
function renderSchema(){
  const P = activePreset();
  const openSet = window.__schemaOpen || (window.__schemaOpen = new Set());
  $('#schemaBox').innerHTML = P.schema.map((f,i)=>`
    <details class="stitem" data-i="${i}" ${openSet.has(i)?'open':''}>
      <summary>
        <span class="chev">▶</span>
        <span class="nm">${esc(f.label||'(이름 없음)')}</span>
        <span class="rolechip">${esc(f.key)}</span>
        <span class="rowtools">
          <button class="s-up" title="위로" aria-label="위로"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 25.5V6.5M8 14.5l8-8 8 8"/></svg></button>
          <button class="s-dn" title="아래로" aria-label="아래로"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 6.5v19M8 17.5l8 8 8-8"/></svg></button>
          <button class="s-del danger" title="칸 삭제" aria-label="칸 삭제">${TRASH_SVG}</button>
        </span>
      </summary>
      <div class="stbody">
        <div class="row" style="margin-bottom:8px">
          <div class="field" style="flex:0 0 150px;margin:0"><label class="fl">키</label>
            <input class="s-key" value="${esc(f.key)}"></div>
          <div class="field" style="flex:1;min-width:140px;margin:0"><label class="fl">이름</label>
            <input class="s-label" value="${esc(f.label)}"></div>
        </div>
        <div class="field" style="margin:0"><label class="fl">지시</label>
          <input class="s-hint" value="${esc(f.hint||'')}"></div>
      </div>
    </details>`).join('')
    || '<div class="empty" style="padding:20px"><b>칸이 없습니다</b>위 + 로 추가하세요.</div>';
  $('#schemaBox').querySelectorAll('.stitem').forEach(el=>{
    el.addEventListener('toggle', ()=>{
      const i = +el.dataset.i;
      if(el.open) openSet.add(i); else openSet.delete(i);
    });
  });
}
$('#schemaBox').addEventListener('input', e=>{
  const row = e.target.closest('[data-i]'); if(!row) return;
  const f = activePreset().schema[+row.dataset.i];
  if(e.target.classList.contains('s-key'))   f.key   = e.target.value.trim();
  if(e.target.classList.contains('s-label')) f.label = e.target.value;
  if(e.target.classList.contains('s-hint'))  f.hint  = e.target.value;
  const it = e.target.closest('.stitem');
  if(it){
    if(e.target.classList.contains('s-label')) it.querySelector('.nm').textContent = e.target.value || '(이름 없음)';
    if(e.target.classList.contains('s-key'))   it.querySelector('.rolechip').textContent = e.target.value;
  }
  save();
});
$('#schemaBox').addEventListener('click', e=>{
  const it = e.target.closest('.stitem'); if(!it) return;
  const P = activePreset(), i = +it.dataset.i;
  if(e.target.closest('.s-del')){
    e.preventDefault();
    if(P.schema.length<=1) return toast('칸이 최소 하나는 있어야 합니다',1);
    P.schema.splice(i,1); save(); renderSchema(); renderCard(); return;
  }
  if(e.target.closest('.s-up') || e.target.closest('.s-dn')){
    e.preventDefault();
    const j = e.target.closest('.s-up') ? i-1 : i+1;
    if(j<0 || j>=P.schema.length) return;
    [P.schema[i], P.schema[j]] = [P.schema[j], P.schema[i]];
    save(); renderSchema(); renderCard();
  }
});
$('#btnAddField').addEventListener('click', ()=>{
  activePreset().schema.push({key:'field'+(activePreset().schema.length+1),label:'새 칸',hint:''});
  save(); renderSchema();
});

const STAGE_LABEL = { digest:'1 · 세계 읽기', seed:'2 · 씨앗 뽑기', cross:'2b · 씨앗 섞기',
  expand:'3 · 카드로 펼치기', patch:'3b · 칸 다시 쓰기', check:'4 · 설정 대조', relate:'캐스트 · 관계 짜기' };

/* --- 공통 지시문 (모든 공정 앞) --- */
function renderCommon(){
  const P = activePreset();
  if(!P.common) P.common = [];
  const openSet = window.__commonOpen || (window.__commonOpen = new Set());
  $('#commonBox').innerHTML = P.common.map((c,i)=>`
    <details class="stitem ${c.enabled?'':'off'}" data-ci="${i}" ${openSet.has(c.id)?'open':''}>
      <summary>
        <span class="chev">▶</span>
        <label class="sw" title="${c.enabled?'끄기':'켜기'}">
          <input type="checkbox" class="c-on" ${c.enabled?'checked':''}><i></i>
        </label>
        <span class="nm">${esc(c.name||'(이름 없음)')}</span>
        ${c.role && c.role!=='system' ? `<span class="rolechip">${esc(c.role)}</span>` : ''}
        <span class="meta">${tok(c.content||'')}tk</span>
        <span class="rowtools">
          <button class="c-up" title="위로" aria-label="위로"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 25.5V6.5M8 14.5l8-8 8 8"/></svg></button>
          <button class="c-dn" title="아래로" aria-label="아래로"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 6.5v19M8 17.5l8 8 8-8"/></svg></button>
          <button class="c-del danger" title="구획 삭제" aria-label="구획 삭제">${TRASH_SVG}</button>
        </span>
      </summary>
      <div class="stbody">
        <div class="field" style="margin:0 0 8px"><label class="fl">이름</label>
          <input class="c-name" value="${esc(c.name||'')}"></div>
        <div class="field" style="margin:0"><label class="fl">내용</label>
          <textarea class="c-body" rows="${Math.min(14, Math.max(3, (c.content||'').split('\n').length))}">${esc(c.content||'')}</textarea></div>
        <details class="role-adv" ${c.role && c.role!=='system' ? 'open' : ''}>
          <summary>고급 · 역할: <b class="role-now">${esc(c.role||'system')}</b></summary>
          <div style="margin-top:8px;max-width:230px">
            <select class="c-role">
              <option value="system" ${(c.role||'system')==='system'?'selected':''}>system (기본 · 규칙/문체)</option>
              <option value="user" ${c.role==='user'?'selected':''}>user (가져온 예시용)</option>
              <option value="assistant" ${c.role==='assistant'?'selected':''}>assistant (가져온 예시용)</option>
            </select>
            <p class="note" style="margin-top:6px">손으로 쓰는 지시문은 <b>system</b>이면 됩니다. user·assistant는 주로 가져온 프리셋의 예시 대화용이고, Claude에선 순서 규칙 때문에 문제가 될 수 있습니다.</p>
          </div>
        </details>
      </div>
    </details>`).join('')
    || '<div class="empty" style="padding:18px"><b>아직 없습니다</b>+ 로 추가하거나, ST 프리셋을 가져오면 여기로 들어옵니다.</div>';
  $('#commonBox').querySelectorAll('.stitem').forEach(el=>{
    el.addEventListener('toggle', ()=>{
      const c = activePreset().common[+el.dataset.ci]; if(!c) return;
      if(el.open) openSet.add(c.id); else openSet.delete(c.id);
    });
  });
}
$('#btnAddCommon').addEventListener('click', ()=>{
  const P = activePreset(); if(!P.common) P.common=[];
  const c = { id:uid(), name:'새 구획', role:'system', content:'', enabled:true };
  P.common.push(c);
  (window.__commonOpen || (window.__commonOpen=new Set())).add(c.id);
  save(); renderCommon();
});

// 파일(builtinCommon)에 넣어둔 앱 기본 공통 지시문을 골라 넣기
const ALL_GROUPS = ['world','character','prompt'];
function normalizeGroups(g){
  if(!g || g==='all') return ALL_GROUPS.slice();
  const arr = (Array.isArray(g)?g:[g]).filter(x=>ALL_GROUPS.includes(x));
  return arr.length ? arr : ALL_GROUPS.slice();
}
function builtinCommonItems(){
  let list = [];
  try{ list = builtinCommon() || []; }catch(_){ list = []; }
  return list.filter(x=>x && typeof x.content==='string' && x.content.trim())
    .map((x,i)=>({ name:String(x.name||('지시문 '+(i+1))), content:String(x.content),
      role:(x.role==='user'||x.role==='assistant')?x.role:'system',
      groups:normalizeGroups(x.groups) }));
}
function commonExistsIn(P, item){
  return (P.common||[]).some(c=>(c.content||'').trim()===item.content.trim());
}
function groupBadges(groups){
  return groups.length===3 ? '전체'
    : groups.map(g=>GROUP_LABEL[g]||g).join('·');
}
function renderCommonLibList(){
  const items = builtinCommonItems(), P = activePreset(), box = $('#commonLibList');
  box.innerHTML = items.length ? items.map((it,i)=>{
    const have = commonExistsIn(P, it);
    return `<label class="nebula-row"><input type="checkbox" class="cl-add" data-i="${i}" ${have?'':'checked'} ${have?'disabled':''}>
      <span>${esc(it.name)}</span><span class="gbadge">${groupBadges(it.groups)}</span><span class="sp"></span><span class="note">${it.role} · ${tok(it.content)} 토큰쯤${have?' · 이미 있음':''}</span></label>`;
  }).join('')
    : '<div class="note">파일의 <code>builtinCommon</code>가 비어 있습니다. 앱 기본으로 둘 지시문을 그 배열에 { name, content } 로 넣고 새로고침하세요.</div>';
  $('#commonLibConfirm').disabled = !items.some((it)=>!commonExistsIn(P, it));
}
$('#btnLoadCommon').addEventListener('click', ()=>{
  $('#commonLibAllPresets').checked = false;
  renderCommonLibList(); $('#commonLibModal').hidden = false;
});
$('#commonLibClose').addEventListener('click', ()=>{ $('#commonLibModal').hidden = true; });
$('#commonLibCancel').addEventListener('click', ()=>{ $('#commonLibModal').hidden = true; });
$('#commonLibModal').addEventListener('click', e=>{ if(e.target.id==='commonLibModal') $('#commonLibModal').hidden = true; });
$('#commonLibAll').addEventListener('click', ()=> $$('#commonLibList .cl-add:not(:disabled)').forEach(c=>c.checked=true));
$('#commonLibNone').addEventListener('click', ()=> $$('#commonLibList .cl-add').forEach(c=>c.checked=false));
$('#commonLibConfirm').addEventListener('click', ()=>{
  const items = builtinCommonItems();
  const pick = $$('#commonLibList .cl-add').filter(c=>c.checked && !c.disabled).map(c=>items[+c.dataset.i]).filter(Boolean);
  if(!pick.length){ $('#commonLibModal').hidden = true; return; }
  const byGroup = $('#commonLibAllPresets').checked;
  let added = 0, touched = new Set();
  const insertInto = (P, it)=>{
    if(!P) return;
    if(!P.common) P.common = [];
    if(commonExistsIn(P, it)) return;
    P.common.push({ id:uid(), name:it.name, role:it.role, content:it.content, enabled:true });
    added++; touched.add(P.id);
  };
  pick.forEach(it=>{
    if(byGroup){
      // 항목의 groups 에 해당하는 분류의 양식들에만 넣는다
      S.presets.filter(P=>{ const pg=P.group||'character'; return pg==='all' || it.groups.includes(pg); })
        .forEach(P=>insertInto(P, it));
    } else {
      insertInto(activePreset(), it);
    }
  });
  save(); renderCommon();
  $('#commonLibModal').hidden = true;
  toast(added ? `공통 지시문 ${pick.length}개를 ${byGroup?`분류에 맞는 양식 ${touched.size}개에 `:''}넣었습니다` : '넣을 것이 없습니다');
});
$('#commonBox').addEventListener('click', e=>{
  const it = e.target.closest('.stitem'); if(!it) return;
  const P = activePreset(), i = +it.dataset.ci, c = P.common[i];
  if(e.target.closest('.c-del')){
    e.preventDefault();
    P.common.splice(i,1); save(); renderCommon(); return;
  }
  if(e.target.closest('.c-up') || e.target.closest('.c-dn')){
    e.preventDefault();
    const j = e.target.closest('.c-up') ? i-1 : i+1;
    if(j<0 || j>=P.common.length) return;
    [P.common[i], P.common[j]] = [P.common[j], P.common[i]];
    save(); renderCommon(); return;
  }
});
$('#commonBox').addEventListener('change', e=>{
  const it = e.target.closest('.stitem'); if(!it) return;
  const c = activePreset().common[+it.dataset.ci]; if(!c) return;
  if(e.target.classList.contains('c-on')){
    c.enabled = e.target.checked;
    it.classList.toggle('off', !c.enabled);
    save(); return;
  }
  if(e.target.classList.contains('c-role')){
    c.role = e.target.value; save();
    const now = it.querySelector('.role-now'); if(now) now.textContent = c.role;
    renderCommon(); // 요약의 역할 배지(system이면 숨김)를 갱신
  }
});
$('#commonBox').addEventListener('input', e=>{
  const it = e.target.closest('.stitem'); if(!it) return;
  const c = activePreset().common[+it.dataset.ci]; if(!c) return;
  if(e.target.classList.contains('c-name')){
    c.name = e.target.value;
    it.querySelector('.nm').textContent = c.name || '(이름 없음)';
  }
  if(e.target.classList.contains('c-body')){
    c.content = e.target.value;
    it.querySelector('.meta').textContent = tok(c.content)+'tk';
  }
  save();
});

function renderStages(){
  const P = activePreset();
  renderCommon();
  const openSet = window.__stageOpen || (window.__stageOpen = new Set());
  $('#stageBox').innerHTML = Object.keys(P.stages).map(k=>{
    const st = P.stages[k];
    const tkSum = st.blocks.reduce((a,b)=>a+tok(b.content),0);
    return `<details class="stitem" data-st="${k}" ${openSet.has(k)?'open':''}>
      <summary>
        <span class="chev">▶</span>
        <span class="nm">${esc(STAGE_LABEL[k]||k)}</span>
        <span class="rolechip">${st.blocks.length}블록</span>
        <span class="meta">${tkSum}tk · t${st.temperature ?? 0.9}</span>
      </summary>
      <div class="stbody">
        <div class="row" style="margin-bottom:8px">
          <div class="field" style="margin:0;flex:0 0 130px"><label class="fl">temperature</label>
            <input class="st-temp" type="number" step="0.05" min="0" max="2" value="${st.temperature ?? 0.9}"></div>
          <div class="field" style="margin:0;flex:0 0 130px"><label class="fl">max tokens</label>
            <input class="st-max" type="number" step="100" min="200" value="${st.maxTokens ?? 2000}"></div>
        </div>
        ${st.blocks.map((b,bi)=>`
          <div class="field" data-bi="${bi}">
            <label class="fl">${b.role}</label>
            <textarea class="st-body" rows="${Math.min(16, Math.max(3, b.content.split('\n').length))}">${esc(b.content)}</textarea>
          </div>`).join('')}
      </div>
    </details>`;
  }).join('');
  $('#stageBox').querySelectorAll('.stitem').forEach(el=>{
    el.addEventListener('toggle', ()=>{
      if(el.open) openSet.add(el.dataset.st); else openSet.delete(el.dataset.st);
    });
  });
}
$('#stageBox').addEventListener('input', e=>{
  const sec = e.target.closest('[data-st]'); if(!sec) return;
  const st = activePreset().stages[sec.dataset.st];
  if(e.target.classList.contains('st-temp')) st.temperature = parseFloat(e.target.value);
  if(e.target.classList.contains('st-max'))  st.maxTokens   = parseInt(e.target.value,10);
  if(e.target.classList.contains('st-body')) st.blocks[+e.target.closest('[data-bi]').dataset.bi].content = e.target.value;
  save();
});
$('#presetSel').addEventListener('change', e=> switchPreset(e.target.value));
$('#btnPresetNew').addEventListener('click', ()=>{
  const p = clone(activePreset()); p.id = uid(); p.name = activePreset().name+' 복사본';
  S.presets.push(p); S.activePreset = p.id; save(); renderPresetSel(); renderSchema(); renderStages();
});
$('#btnPresetBlank').addEventListener('click', ()=>{
  const name = prompt('새 양식 이름', '내 양식');
  if(!name) return;
  const p = defaultPreset();
  p.id = uid(); p.name = name;
  p.schema = [{key:'body', label:'본문', hint:'여기에 원하는 지시를 적으세요'}];
  p.group = S.opts.group; S.presets.push(p); switchPreset(p.id);
  toast('만들었습니다 — 아래에서 칸과 지시문을 고치세요');
});
$('#btnPresetRename').addEventListener('click', ()=>{
  const n = prompt('프리셋 이름', activePreset().name);
  if(n){ activePreset().name = n; save(); renderPresetSel(); }
});
$('#btnPresetDel').addEventListener('click', ()=>{
  if(S.presets.length<2) return toast('마지막 프리셋은 지울 수 없습니다',1);
  if(!confirm('이 프리셋을 지울까요?')) return;
  S.presets = S.presets.filter(p=>p.id!==S.activePreset);
  S.activePreset = S.presets[0].id; save(); renderPresetSel(); renderSchema(); renderStages();
});
$('#btnPresetExport').addEventListener('click', ()=>
  dl('orrery-preset-'+activePreset().name.replace(/\s+/g,'_')+'.json', JSON.stringify(activePreset(),null,2)));

// 기본 양식 불러오기 — 지금 목록에 없는 내장 기본 양식을 골라 다시 추가
function missingBuiltins(){
  const have = new Set(S.presets.map(p=>p.id));
  return builtinPresets().filter(b=>!have.has(b.id));
}
function renderRestoreList(){
  const miss = missingBuiltins(), box = $('#restoreList');
  box.innerHTML = miss.length ? miss.map(b=>`
    <label class="nebula-row"><input type="checkbox" class="r-add" data-id="${b.id}" checked>
      <span>${esc(b.name)}</span><span class="sp"></span><span class="note">${GROUP_LABEL[b.group]||b.group||'인물'}</span></label>`).join('')
    : '<div class="note">빠진 기본 양식이 없습니다 — 이미 모두 있습니다.</div>';
  $('#restoreConfirm').disabled = !miss.length;
}
$('#btnPresetRestore').addEventListener('click', ()=>{
  renderRestoreList(); $('#restoreModal').hidden = false;
});
$('#restoreClose').addEventListener('click', ()=>{ $('#restoreModal').hidden = true; });
$('#restoreCancel').addEventListener('click', ()=>{ $('#restoreModal').hidden = true; });
$('#restoreModal').addEventListener('click', e=>{ if(e.target.id==='restoreModal') $('#restoreModal').hidden = true; });
$('#restoreAll').addEventListener('click', ()=> $$('#restoreList .r-add').forEach(c=>c.checked=true));
$('#restoreNone').addEventListener('click', ()=> $$('#restoreList .r-add').forEach(c=>c.checked=false));
$('#restoreConfirm').addEventListener('click', ()=>{
  const pick = new Set($$('#restoreList .r-add').filter(c=>c.checked).map(c=>c.dataset.id));
  if(!pick.size){ $('#restoreModal').hidden = true; return; }
  const add = builtinPresets().filter(b=>pick.has(b.id));
  add.forEach(b=>{ if(!b.common) b.common=[]; S.presets.push(b); });
  // 원래 내장 순서를 최대한 유지
  const order = builtinPresets().map(b=>b.id);
  S.presets.sort((x,y)=>{ const ix=order.indexOf(x.id), iy=order.indexOf(y.id); return (ix<0?99:ix)-(iy<0?99:iy); });
  save(); renderPresetSel(); renderGroup(); renderSchema(); renderStages(); applyGroupUi(); renderOneshot();
  $('#restoreModal').hidden = true;
  toast(`기본 양식 ${add.length}개를 추가했습니다`);
});
$('#btnResetStages').addEventListener('click', ()=>{
  const p = activePreset();
  const d = builtinPresets().find(b=>b.id===p.id);
  if(!d) return toast('직접 만든 양식이라 되돌릴 기본값이 없습니다', 1);
  if(!confirm(`「${d.name}」의 지시문을 내장 기본값으로 되돌릴까요?`)) return;
  p.stages = d.stages; save(); renderStages(); toast('되돌렸습니다');
});

$('#btnPresetImport').addEventListener('click', ()=> $('#presetFile').click());

$('#presetFile').addEventListener('change', async e=>{
  const f = e.target.files[0]; e.target.value='';
  if(!f) return;
  try{
    const j = JSON.parse(await f.text());
    if(j.stages){                          // Orrery 프리셋
      j.id = uid(); if(!j.common) j.common = [];
      S.presets.push(j); switchPreset(j.id);
      toast('프리셋을 가져왔습니다');
    } else if(j.prompts || j.prompt_order){ // 외부 프리셋 — 자동 판별
      const n = importST(j);
      save(); renderCommon();
      toast(n ? `ST 프리셋에서 ${n}개 구획을 공통 지시문으로 가져왔습니다` : 'ST 프리셋에서 가져올 사용자 구획이 없습니다');
    } else throw new Error('Orrery 프리셋도 ST 프리셋도 아닙니다.');
  }catch(err){ toast('가져오기 실패: '+err.message, 1); log('가져오기 실패: '+err.message,'err'); }
});
const ST_BUILTIN = /^(main|nsfw|jailbreak|chatHistory|charDescription|charPersonality|scenario|personaDescription|worldInfo(Before|After)|dialogueExamples|enhanceDefinitions)$/i;
function importST(j){
  const P = activePreset();
  if(!P.common) P.common = [];
  const prompts = j.prompts || [];
  const byId = {}; prompts.forEach(p=>{ if(p.identifier) byId[p.identifier]=p; });
  const orderList = (j.prompt_order && j.prompt_order.length)
    ? (j.prompt_order[j.prompt_order.length-1].order || [])
    : prompts.map(p=>({identifier:p.identifier, enabled:!p.system_prompt}));
  let n = 0;
  orderList.forEach(o=>{
    const p = byId[o.identifier]; if(!p) return;
    if(ST_BUILTIN.test(p.identifier||'')) return;
    if(p.marker) return;
    const content = (p.content||'').trim(); if(!content) return;
    P.common.push({ id:uid(), name:p.name || p.identifier || '가져온 구획',
      role:(p.role==='assistant'||p.role==='user')?p.role:'system',
      content, enabled: o.enabled !== false });
    n++;
  });
  return n;
}

/* --- 연결 --- */
function renderConnSel(){
  const sel = $('#connSel');
  sel.innerHTML = S.connections.length
    ? S.connections.map(c=>`<option value="${c.id}" ${c.id===S.activeConn?'selected':''}>${esc(c.name)}</option>`).join('')
    : '<option value="">연결 없음</option>';
  const active=connById(S.activeConn);
  $('#connDot').className = 'dot '+(active&&active._ok===true?'ok':active&&active._ok===false?'no':'');
}
function connCheckHtml(c){
  const last=c._lastTest; if(!last) return '';
  const at=new Date(last.at||Date.now()).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  const detail=last.ok
    ? (last.usage ? usageLabel(last.usage) : '토큰 사용량 미제공')
    : '연결 실패 · 로그에서 원인을 확인하세요';
  return `<div class="conn-check ${last.ok?'ok':'no'}"><span>${last.ok?'확인됨':'확인 실패'}</span><span>·</span><span>${esc(at)}</span><span>·</span><span>${esc(detail)}</span></div>`;
}
function renderConns(){
  const box = $('#connList');
  if(!S.connections.length){
    box.innerHTML = '<div class="empty"><b>연결이 없습니다</b>위의 연결 추가를 눌러 API 키를 넣으세요.</div>';
    return;
  }
  box.innerHTML = S.connections.map(c=>{
    const p = PROV[c.provider] || {};
    const needsKey = !p.noKey;
    const vertex = c.provider==='vertex';
    return `<div class="conn ${c.id===S.activeConn?'on':''}" data-id="${c.id}">
      <div class="conn-h">
        <span class="dot ${c._ok===true?'ok':c._ok===false?'no':''}"></span>
        <span class="cn">${esc(c.name)}</span>
        ${c.id===S.activeConn ? '<span class="c-use-state" title="현재 생성 작업에 사용하는 연결">쓰는 중</span>' : '<button class="mini ghost c-use">이걸로 쓰기</button>'}
        <button class="mini ghost c-test" title="실제 API를 1회 호출합니다 · 짧은 입력 · 응답 최대 24토큰 · 업체가 알려준 실제 사용량 표시">확인</button>
        <button class="iconbtn danger c-del" title="연결 삭제" aria-label="연결 삭제">${TRASH_SVG}</button>
      </div>
      ${connCheckHtml(c)}
      <div class="row">
        <div class="field"><label class="fl">이름</label><input class="c-name" value="${esc(c.name)}"></div>
        <div class="field"><label class="fl">종류</label><select class="c-prov">${
          PROV_ORDER.map(k=>`<option value="${k}" ${k===c.provider?'selected':''}>${esc(PROV[k].label)}</option>`).join('')
        }</select></div>
      </div>
      ${vertex?`<div class="row">
        <div class="field"><label class="fl">project</label><input class="c-project" value="${esc(c.project||'')}"></div>
        <div class="field"><label class="fl">location</label><input class="c-location" value="${esc(c.location||'us-central1')}"></div>
      </div>`:''}
      <div class="row">
        ${needsKey?`<div class="field"><label class="fl">${vertex?'액세스 토큰':'API 키'}</label>
          <input class="c-key" type="password" value="${esc(c.apiKey||'')}" placeholder="${vertex?'gcloud auth print-access-token':'sk-...'}"></div>`:''}
        <div class="field"><label class="fl">주소 (비우면 기본값)</label>
          <input class="c-url" value="${esc(c.baseUrl||'')}" placeholder="${esc(p.base||'')}"></div>
      </div>
      <div class="row">
        <div class="field"><label class="fl">응답 토큰 상한</label>
          <input class="c-maxtok" type="number" min="128" step="128" value="${c.maxTokens||''}" placeholder="양식 값 사용"></div>
        <div class="field"><label class="fl">컨텍스트 상한</label>
          <input class="c-ctx" type="number" min="1024" step="1024" value="${c.contextLimit||''}" placeholder="예: 128000"></div>
        <div class="field"><label class="fl">temperature</label>
          <input class="c-temp" type="number" min="0" max="2" step="0.05" value="${c.temperature ?? ''}" placeholder="양식 값 사용"></div>
        <div class="field"><label class="fl">top_p</label>
          <input class="c-topp" type="number" min="0" max="1" step="0.05" value="${c.topP ?? ''}" placeholder="안 보냄"></div>
      </div>
      <div class="row">
        <div class="field"><label class="fl">모델</label>
          <input class="c-model" value="${esc(c.model||'')}" list="ml-${c.id}" placeholder="모델 이름">
          <datalist id="ml-${c.id}">${(c._models||p.mlist||[]).map(m=>`<option value="${esc(m)}">`).join('')}</datalist>
        </div>
        <div class="field" style="flex:0 0 150px"><label class="fl">&nbsp;</label>
          <button class="ghost c-models" style="width:100%">모델 목록 받기</button></div>
      </div>
    </div>`;
  }).join('');
}
function connById(id){ return S.connections.find(c=>c.id===id); }
function invalidateConnTest(c, wrap){
  c._ok=null; delete c._lastTest;
  if(wrap){ const result=$('.conn-check',wrap); if(result) result.remove(); const dot=$('.dot',wrap); if(dot) dot.className='dot'; }
  if(c.id===S.activeConn) $('#connDot').className='dot';
}
$('#btnConnNew').addEventListener('click', ()=>{
  const c = { id:uid(), name:'새 연결', provider:'openai', apiKey:'', baseUrl:'', model:'gpt-4o' };
  S.connections.push(c); if(!S.activeConn) S.activeConn = c.id;
  save(); renderConns(); renderConnSel();
});
$('#connList').addEventListener('input', e=>{
  const w = e.target.closest('.conn'); if(!w) return;
  const c = connById(w.dataset.id); if(!c) return;
  const m = {'c-name':'name','c-key':'apiKey','c-url':'baseUrl','c-model':'model','c-project':'project','c-location':'location'};
  for(const cls in m) if(e.target.classList.contains(cls)){ c[m[cls]] = e.target.value; if(cls!=='c-name') invalidateConnTest(c,w); save(); if(cls==='c-name') renderConnSel(); }
  const num = {'c-maxtok':'maxTokens','c-ctx':'contextLimit','c-temp':'temperature','c-topp':'topP'};
  for(const cls in num) if(e.target.classList.contains(cls)){
    const v = e.target.value.trim();
    if(v==='') delete c[num[cls]]; else c[num[cls]] = parseFloat(v);
    invalidateConnTest(c,w);
    save();
  }
});
$('#connList').addEventListener('change', e=>{
  const w = e.target.closest('.conn'); if(!w) return;
  const c = connById(w.dataset.id); if(!c) return;
  if(e.target.classList.contains('c-prov')){
    c.provider = e.target.value;
    c.baseUrl = ''; c._models = null; invalidateConnTest(c,w);
    c.model = (PROV[c.provider].mlist||[])[0] || '';
    save(); renderConns();
  }
});
$('#connList').addEventListener('click', async e=>{
  const w = e.target.closest('.conn'); if(!w) return;
  const c = connById(w.dataset.id); if(!c) return;
  if(e.target.closest('.c-del')){
    if(!confirm(`“${c.name}” 연결을 삭제할까요?`)) return;
    S.connections = S.connections.filter(x=>x.id!==c.id);
    if(S.activeConn===c.id) S.activeConn = S.connections[0] ? S.connections[0].id : null;
    save(); renderConns(); renderConnSel(); return;
  }
  if(e.target.closest('.c-use')){ S.activeConn = c.id; save(); renderConns(); renderConnSel(); return; }
  if(e.target.closest('.c-test')){ await testConn(c, e.target.closest('.c-test')); return; }
  if(e.target.closest('.c-models')){
    const btn = e.target.closest('.c-models');
    busy(btn, true, '받는 중');
    try{
      const ms = await fetchModels(c);
      if(!ms || !ms.length) throw new Error('목록을 받지 못했습니다. 모델 이름을 직접 적어 주세요.');
      c._models = ms.sort(); save(); renderConns(); toast(ms.length+'개 받았습니다');
    }catch(err){ toast('목록 실패: '+err.message, 1); log('모델 목록 실패: '+err.message,'err'); }
    finally{ busy(btn,false); }
  }
});
async function testConn(c, btn){
  busy(btn, true, '확인 중');
  try{
    const out = await callProvider(c, [{role:'user',content:'"확인"이라고만 답하라.'}], {maxTokens:24, temperature:0});
    c._ok = true;
    c._lastTest = {at:Date.now(), ok:true, usage:LAST_USAGE ? clone(LAST_USAGE) : null};
    toast(LAST_USAGE ? '연결됐습니다 · '+usageLabel(LAST_USAGE) : '연결됐습니다 — '+out.trim().slice(0,30));
  }catch(err){ c._ok = false; c._lastTest={at:Date.now(),ok:false,usage:null}; showErr(err); }
  finally{ busy(btn,false); save(); renderConns(); renderConnSel(); }
}

$('#btnConnHelp').addEventListener('click', ()=>{ $('#connHelp').hidden = false; });
$('#connHelpClose').addEventListener('click', ()=>{ $('#connHelp').hidden = true; });
$('#connHelp').addEventListener('click', e=>{ if(e.target.id==='connHelp') $('#connHelp').hidden = true; });
$('#btnCopyCmd').addEventListener('click', ()=> copy($('#serveCmd').textContent));
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ if(!$('#connHelp').hidden) $('#connHelp').hidden=true; if(!$('#assetCompare').hidden) $('#assetCompare').hidden=true; if(!$('#assetFolderModal').hidden) closeAssetFolderModal(); if(!$('#assetClearModal').hidden) closeAssetClearModal(); if(!$('#backupModal').hidden) $('#backupModal').hidden=true; } });

$('#btnTest').addEventListener('click', async e=>{
  const c = connById(S.activeConn);
  if(!c) return toast('먼저 연결을 만들어 주세요',1);
  await testConn(c, e.currentTarget);
  $('#connDot').className = 'dot '+(c._ok?'ok':'no');
});
$('#connSel').addEventListener('change', e=>{ S.activeConn = e.target.value; save(); renderConns(); });

function backupConnections(includeKeys){
  return S.connections.map(c=>{
    const out=clone(c);
    delete out._ok; delete out._lastTest; delete out._models;
    if(!includeKeys) delete out.apiKey;
    return out;
  });
}
function makeBackup(options){
  const o=Object.assign({assets:true,project:true,chat:true,apiKeys:true},options||{});
  const out={
    app:'Orrery', backupVersion:2, exportedAt:new Date().toISOString(),
    includes:{assets:!!o.assets,project:!!o.project,chat:!!o.chat,apiKeys:!!o.apiKeys,logs:false},
    connections:backupConnections(o.apiKeys), activeConn:S.activeConn,
    presets:clone(S.presets), activePreset:S.activePreset, opts:clone(S.opts), library:clone(S.library)
  };
  if(o.assets){
    out.assets=S.assets.map(a=>clone(ensureAssetOriginal(a)));
    out.assetFolders=clone(S.assetFolders||[]);
  }
  if(o.project) out.project=clone(S.project);
  if(o.chat){ out.chat=clone(S.chat); out.customTalkPrompts=clone(S.customTalkPrompts||{}); }
  return out;
}
$('#btnDataExport').addEventListener('click', ()=>{ $('#backupModal').hidden=false; });
$('#backupClose').addEventListener('click', ()=>{ $('#backupModal').hidden=true; });
$('#backupModal').addEventListener('click', e=>{ if(e.target.id==='backupModal') $('#backupModal').hidden=true; });
$('#backupDownload').addEventListener('click', ()=>{
  const data=makeBackup({
    assets:$('#backupAssets').checked, project:$('#backupProject').checked,
    chat:$('#backupChat').checked, apiKeys:$('#backupKeys').checked
  });
  const day=new Date().toISOString().slice(0,10);
  dl(`orrery-backup-${day}.json`,JSON.stringify(data,null,2));
  $('#backupModal').hidden=true;
  toast('백업 파일을 만들었습니다 · 실행 로그는 제외했습니다');
});
$('#btnDataImport').addEventListener('click', ()=> $('#dataFile').click());
$('#dataFile').addEventListener('change', async e=>{
  const f = e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    const d = JSON.parse(await f.text());
    if(!d || typeof d!=='object' || !(d.connections || d.presets || d.library || d.assets || d.favoriteAssets || d.project || d.chat))
      throw new Error('Orrery 백업 파일이 아닙니다.');
    if(!confirm('백업에 포함된 항목을 현재 데이터에 덮어쓸까요?\n백업에서 제외된 항목은 현재 상태를 유지합니다.')) return;
    if(d.connections) S.connections = d.connections.map(c=>{
      const out=clone(c); delete out._ok; delete out._lastTest; delete out._models;
      if(out.apiKey==null) out.apiKey=''; return out;
    });
    if(d.presets && d.presets.length) S.presets = d.presets;
    if(d.opts) Object.assign(S.opts, d.opts);
    if(S.opts.mode==='c2p') S.opts.mode='foil';
    if(!S.opts.modeBy) S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'};
    if(d.library) S.library = d.library.map(r=>Object.assign({
      star:false, group:'character', presetName:'', updated:r.at||Date.now() }, r));
    if(Array.isArray(d.assets)){
      S.assets=d.assets.map(a=>ensureAssetOriginal(clone(a)));
      S.assetFolders=Array.isArray(d.assetFolders)?clone(d.assetFolders):[];
      EDIT_ASSETS.clear(); EDIT_BASELINE.clear(); EDIT_WAS_DIRTY.clear();
    }else if(Array.isArray(d.favoriteAssets)){
      S.assets=mergeAssetsWithFavorites(S.assets,d.favoriteAssets);
      if(Array.isArray(d.assetFolders)) S.assetFolders=clone(d.assetFolders);
    }
    normalizeAssetFolders();
    if(d.project) S.project=Object.assign({
      digest:null,digestSrc:'',seeds:[],sel:[],card:null,locked:{},violations:null,verdict:null,
      cast:[],relations:null,qa:[],libId:null,digestBy:{},digestMeta:null
    },clone(d.project));
    if(d.chat){
      S.chat=Object.assign({role:'world',msgs:[],ctx:{assets:true,digest:true,card:false}},clone(d.chat));
      S.chat.ctx=Object.assign({assets:true,digest:true,card:false},S.chat.ctx||{});
    }
    if(d.customTalkPrompts) S.customTalkPrompts=clone(d.customTalkPrompts);
    S.activeConn = d.activeConn || (S.connections[0]&&S.connections[0].id) || null;
    S.activePreset = d.activePreset || S.presets[0].id;
    save(); bootUI();
    if(Array.isArray(d.assets) || d.project) touchDraft();
    toast('백업을 불러왔습니다');
  }catch(err){ toast('가져오기 실패: '+err.message,1); }
});

/* --- 기록 --- */
$('#btnLogCopy').addEventListener('click', ()=> copy(LOG.map(l=>`[${l.ts}] ${l.msg}`).join('\n')));
$('#btnLogClear').addEventListener('click', ()=>{ LOG=[]; renderLog(); });
$('#logVerbose').addEventListener('change', e=>{ S.logVerbose = e.target.checked; save(); });

/* ==================================================================
   8. 탭 · 시작
   ================================================================== */
let curTab = 'sources';
function tab(name){
  curTab = name;
  $$('.topctl button[data-tab]').forEach(b=>b.classList.toggle('on', b.dataset.tab===name));
  markNav();
  $$('.view').forEach(v=>v.classList.toggle('on', v.id==='v-'+name));
  if(name==='log') renderLog();
  if(name==='talk') renderChat();
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('.topctl button[data-tab]').forEach(b=> b.addEventListener('click', ()=>tab(b.dataset.tab)));

function bootUI(){
  $('#optLang').value = S.opts.lang;
  $('#optTone').value = S.opts.tone;
  $('#optSeedN').value = S.opts.seedCount;
  $('#optCastN').value = S.opts.castCount;
  $('#optNsfw').value = S.opts.nsfw ? '1':'0';
  $('#optCheck').value = S.opts.check ? '1':'0';
  $('#logVerbose').checked = !!S.logVerbose;
  if(!S.opts.extraBy) S.opts.extraBy = {world:'',character:'',prompt:''};
  if(S.opts.extra && !S.opts.extraBy[S.opts.group]){ S.opts.extraBy[S.opts.group] = S.opts.extra; S.opts.extra=''; }
  $('#optExtra').value = curExtra();
  renderReq();
  $('#optBrief').value = S.opts.brief || '';
  $('#talkRole').value = S.chat.role;
  $('#ctxAssets').checked = !!S.chat.ctx.assets;
  $('#ctxDigest').checked = !!S.chat.ctx.digest;
  $('#ctxCard').checked   = !!S.chat.ctx.card;
  renderModeChooser();
  $('#castPanel').style.display = activeMode()==='cast' ? '' : 'none';
  syncLibFilter();
  renderConnSel(); renderConns(); renderGroup(); renderPresetSel(); renderSchema(); renderStages();
  renderAssets(); renderDigest(); renderSeeds(); renderCard(); renderCheck(); renderCast(); renderQA(); renderLib(); renderChat(); renderMat(); applyGroupUi(); renderOneshot();
  updateTalkRoleUI();
}

(function init(){
  const had = load();
  if(!S.presets.length){ S.presets = builtinPresets(); S.activePreset = 'default'; }
  else {
    const b = builtinPresets();
    b.forEach(bp=>{ const ex = S.presets.find(p=>p.id===bp.id);
      if(!ex) S.presets.push(bp); else { if(!ex.group) ex.group = bp.group; if(!ex.common) ex.common = []; } });
    S.presets.sort((x,y)=>{
      const ix=b.findIndex(p=>p.id===x.id), iy=b.findIndex(p=>p.id===y.id);
      return (ix<0?99:ix)-(iy<0?99:iy); });
    // 2026-08: 점검 3종에 '살아 있는 곳' 칸 추가 — 이미 저장된 양식에도 이관
    ['world-audit','char-audit','prompt-audit'].forEach(id=>{
      const p = S.presets.find(x=>x.id===id);
      if(p && Array.isArray(p.schema) && !p.schema.some(f=>f.key==='working')){
        const vi = p.schema.findIndex(f=>f.key==='verdict');
        p.schema.splice(vi<0?0:vi+1, 0,
          {key:'working', label:'살아 있는 곳', hint:'실제로 작동하는 부분과 그 이유. 칭찬이 아니라 진단'});
      }
    });
  }
  S.presets.forEach(p=>{ if(!p.common) p.common = []; });
  const restoredDraft = offerDraftRestore();
  if(!S.presets.find(p=>p.id===S.activePreset)) S.activePreset = S.presets[0].id;
  // 저장된 양식과 분류가 어긋나면 양식 쪽을 기준으로 맞춘다
  {
    const cur = S.presets.find(p=>p.id===S.activePreset);
    const pg = (cur && cur.group) || 'character';
    if(pg==='all'){
      const inG = presetsInGroup(S.opts.group);
      if(!inG.find(p=>p.id===S.activePreset) && inG.length) S.activePreset = inG[0].id;
    } else if(pg !== S.opts.group){
      const inG = presetsInGroup(S.opts.group);
      if(inG.length) S.activePreset = inG[0].id; else S.opts.group = pg;
    }
    // 시작 프리셋이 숨김 상태면 그 분류의 켜진 것으로 옮긴다
    if(cur && cur.off){
      const inG = presetsInGroup(S.opts.group);
      if(inG.length) S.activePreset = inG[0].id;
    }
  }
  if(S.connections.length && !S.connections.find(c=>c.id===S.activeConn)) S.activeConn = S.connections[0].id;
  bootUI();
  BOOTING=false;
  if(restoredDraft) setTimeout(()=>toast('이전 작업물을 불러왔습니다'),250);
  setTimeout(()=>document.body.classList.remove('boot'), 900);
log('Orrery 궤도 진입. ' + (location.protocol==='file:'
    ? '파일에서 직접 열었습니다.'
    : '주소: '+location.origin));
  if(!had && !S.connections.length){
    setTimeout(()=>{ tab('settings'); toast('먼저 연결을 하나 만들어 주세요'); }, 500);
  }
  window.addEventListener('keydown', e=>{
    if(e.key==='Escape' && ABORT){ ABORT.abort(); toast('멈췄습니다'); }
  });
  window.addEventListener('beforeunload', ()=>{ if(DRAFT_DIRTY) saveDraftNow(); });
})();

/* 가로 드래그 스크롤 (탭바) */
function dragScroll(el){
  if(!el) return;
  let down=false, moved=false, sx=0, sl=0;
  el.addEventListener('pointerdown', e=>{
    down=true; moved=false; sx=e.clientX; sl=el.scrollLeft;
  });
  el.addEventListener('pointermove', e=>{
    if(!down) return;
    const dx = e.clientX - sx;
    if(Math.abs(dx)>6){
      // 캡처를 여기서 걸어야 함 — pointerdown에서 걸면 최신 크롬이
      // click 대상을 컨테이너로 바꿔 버튼 클릭이 전부 먹히지 않는다
      if(!moved && el.setPointerCapture){ try{ el.setPointerCapture(e.pointerId); }catch(_){} }
      moved=true; el.scrollLeft = sl - dx; e.preventDefault();
    }
  });
  const stop=()=>{ down=false; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
  el.addEventListener('click', e=>{ if(moved){ e.stopPropagation(); e.preventDefault(); moved=false; } }, true);
}
dragScroll(document.querySelector('.ctxbar2'));

/* 용어 도움말 툴팁 — 데스크톱은 hover, 모바일은 탭으로 여닫기 */
(function(){
  const tip = document.createElement('div'); tip.id = 'tipbox';
  document.body.appendChild(tip);
  let cur = null;
  function place(){
    if(!cur) return;
    const r = cur.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width/2 - tw/2;
    x = Math.max(12, Math.min(x, innerWidth - tw - 12));
    let y = r.bottom + 8;
    if(y + th > innerHeight - 12) y = r.top - th - 8;
    tip.style.left = x+'px'; tip.style.top = y+'px';
  }
  function show(btn){
    if(cur) cur.classList.remove('on');
    cur = btn; btn.classList.add('on');
    tip.textContent = btn.dataset.tip || '';
    tip.classList.add('on');
    place();
  }
  function hide(){
    if(cur) cur.classList.remove('on');
    cur = null; tip.classList.remove('on');
  }
  // 마우스만 hover로 — 터치는 pointerover가 탭 직전에 와서 click 토글과 겹친다
  document.addEventListener('pointerover', e=>{
    if(e.pointerType!=='mouse') return;
    const b = e.target.closest('.qhelp'); if(b && cur!==b) show(b);
  });
  document.addEventListener('pointerout', e=>{
    if(e.pointerType!=='mouse') return;
    const b = e.target.closest('.qhelp'); if(b && cur===b) hide();
  });
  document.addEventListener('click', e=>{
    const b = e.target.closest('.qhelp');
    if(b){
      e.preventDefault();
      // 마우스는 hover로 이미 떠 있으니 클릭으로 닫지 않는다 — 토글은 터치용
      if(cur===b){ if(e.pointerType!=='mouse') hide(); }
      else show(b);
      return;
    }
    if(cur) hide();
  });
  window.addEventListener('keydown', e=>{ if(e.key==='Escape') hide(); });
  // 스크롤 중에는 닫지 않고 앵커를 따라간다 — 화면 밖으로 나가면 닫기
  window.addEventListener('scroll', ()=>{
    if(!cur) return;
    const r = cur.getBoundingClientRect();
    if(r.bottom < 0 || r.top > innerHeight) hide(); else place();
  }, true);
  window.addEventListener('resize', place);
})();

/* 모바일 햄버거 메뉴 */
(function(){
  const btn = $('#btnMore'), menu = $('#topMore');
  if(!btn || !menu) return;
  btn.addEventListener('click', e=>{
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });
  menu.addEventListener('click', ()=>{ menu.classList.remove('open'); btn.setAttribute('aria-expanded','false'); });
  document.addEventListener('click', e=>{
    if(menu.classList.contains('open') && !menu.contains(e.target) && e.target!==btn)
      { menu.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  });
})();
