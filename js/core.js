"use strict";
/* Orrery · 기반 · 저장 · API 연결 */
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
const RECOVERY_KEY = 'orrery.recovery.v1';
const OLDKEYS = ['vivarium.v1','terrarium.v1','casting.v1'];
let S = {
  connections: [], activeConn: null,
  assets: [], assetFolders: [],
  presets: [], activePreset: null,
  opts: { mode:'w2c', modeBy:{world:'new',character:'w2c',prompt:'new'}, refineBy:{world:'balanced',character:'balanced',prompt:'balanced'}, buildMode:'oneshot', lang:'한국어', tone:'', seedCount:5, castCount:3, nsfw:false, easy:false, extra:'', extraBy:{world:'',character:'',prompt:''}, check:true, brief:'', briefBy:{world:'',character:'',prompt:''}, group:'world', convert:{translate:true,optimize:true,yaml:false,summarize:false,maxChars:1200,meaning:true,sourceLang:'한국어',targetLang:'English',extraBy:{world:'',character:'',prompt:''}} },
  project: { digest:null, digestSrc:'', seeds:[], sel:[], card:null, locked:{}, violations:null, verdict:null, cast:[], relations:null, qa:[], libId:null, digestBy:{}, digestMeta:null, workBy:{}, screen:null },
  library: [],
  chat: { role:'world', msgs:[], ctx:{assets:true, digest:true, card:false} },
  customTalkPrompts: {},
  logVerbose: false
};
let LOG = [];
let ABORT = null;
let ACTIVE_TASK = null;
let LAST_USAGE = null;
let LAST_RAW = '', LAST_RAW_AT = 0;
let DRAFT_DIRTY = false, DRAFT_TIMER = null, BOOTING = true;
let SAVE_FAILED = false, SAVE_STATE_TIMER = null, LOAD_ERROR = null;

const CONVERT_DEFAULTS = {
  translate:true,optimize:true,yaml:false,summarize:false,maxChars:1200,meaning:true,
  sourceLang:'한국어',targetLang:'English'
};
function convertPrefs(){
  S.opts.convert=Object.assign({},CONVERT_DEFAULTS,S.opts.convert||{});
  if(!S.opts.convert.extraBy) S.opts.convert.extraBy={world:'',character:'',prompt:''};
  if(S.opts.convert.extra && !S.opts.convert.extraBy[S.opts.group]) S.opts.convert.extraBy[S.opts.group]=S.opts.convert.extra;
  delete S.opts.convert.extra;
  if(!S.opts.extraBy) S.opts.extraBy={world:'',character:'',prompt:''};
  if(S.opts.extra && !S.opts.extraBy[S.opts.group]) S.opts.extraBy[S.opts.group]=S.opts.extra;
  S.opts.extra='';
  if(!S.opts.briefBy) S.opts.briefBy={world:'',character:'',prompt:''};
  if(S.opts.brief && !S.opts.briefBy[S.opts.group]) S.opts.briefBy[S.opts.group]=S.opts.brief;
  S.opts.brief='';
  return S.opts.convert;
}
function curConvertExtra(){
  const p=convertPrefs();
  return String(p.extraBy[S.opts.group]||'');
}
function curBrief(){
  const by=S.opts.briefBy||(S.opts.briefBy={world:'',character:'',prompt:''});
  return by[S.opts.group]||'';
}

function mergeLegacyRequests(){
  convertPrefs();
  let changed=false;
  for(const g of ['world','character','prompt']){
    const extra=String(S.opts.extraBy[g]||'').trim();
    if(!extra) continue;
    S.opts.briefBy[g]=[String(S.opts.briefBy[g]||'').trim(),'추가 조건:\n'+extra].filter(Boolean).join('\n\n');
    S.opts.extraBy[g]=''; changed=true;
  }
  return changed;
}

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
  // 카드 원문은 정규화 뒤 쓰이지 않으며 큰 재료를 중복 저장하므로 버린다.
  delete a.raw;
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
  const out=(Array.isArray(workAssets)?workAssets:[]).map(a=>normalizeAssetMetadata(clone(a)));
  const byId=new Map(out.map((a,i)=>[a.id,i]));
  (Array.isArray(favoriteAssets)?favoriteAssets:[]).forEach(saved=>{
    const fav=normalizeAssetMetadata(clone(saved)); fav.favorite=true;
    if(byId.has(fav.id)){
      const current=out[byId.get(fav.id)]; current.favorite=true;
      if(!current.folderId && fav.folderId) current.folderId=fav.folderId;
    }else{ byId.set(fav.id,out.length); out.push(fav); }
  });
  return out;
}
function mergeAssetsById(primaryAssets, fallbackAssets){
  const out=(Array.isArray(primaryAssets)?primaryAssets:[]).map(a=>normalizeAssetMetadata(clone(a)));
  const byId=new Map(out.map((a,i)=>[a.id,i]));
  (Array.isArray(fallbackAssets)?fallbackAssets:[]).forEach(saved=>{
    const item=normalizeAssetMetadata(clone(saved));
    if(byId.has(item.id)){
      const current=out[byId.get(item.id)];
      if(item.favorite){ current.favorite=true; if(!current.folderId&&item.folderId) current.folderId=item.folderId; }
    }else{ byId.set(item.id,out.length); out.push(item); }
  });
  return out;
}
function hasDraftWork(){
  const p=S.project||{};
  const extras=Object.values(S.opts.extraBy||{}).some(v=>String(v||'').trim());
  const briefs=Object.values(S.opts.briefBy||{}).some(v=>String(v||'').trim());
  const digests=Object.values(p.digestBy||{}).some(Boolean);
  const otherWork=Object.values(p.workBy||{}).some(w=>w && w.project &&
    (w.project.digest || w.project.card || w.project.seeds?.length || w.project.cast?.length));
  return !!(briefs || extras || digests || otherWork || p.digest || (p.seeds&&p.seeds.length) || p.card || (p.cast&&p.cast.length));
}
function saveDraftNow(){
  clearTimeout(DRAFT_TIMER); DRAFT_TIMER=null;
  if(!DRAFT_DIRTY) return;
  if(!hasDraftWork()){ clearDraft(); return; }
  const base = {version:1, at:Date.now(), activePreset:S.activePreset, opts:clone(S.opts), project:clone(S.project),
    continueNote:$('#continueNote').value, rerollNote:$('#rerollNote').value};
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(base)); }
  catch(e){
    log('마지막 작업 임시 저장에 실패했습니다.','err');
    setSaveState('저장 실패 · 백업 필요','err',true);
    if(!SAVE_FAILED) toast('마지막 작업을 저장하지 못했습니다. 전체 백업을 만들어 주세요.',1);
    SAVE_FAILED=true;
  }
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
  if(!confirm(`${when}에 진행하던 작업이 있습니다.\n이전 작업물을 불러올까요?`)){ clearDraft(); return false; }
  if(d.opts) Object.assign(S.opts,d.opts);
  convertPrefs();
  if(d.activePreset) S.activePreset=d.activePreset;
  S.project=Object.assign(S.project,d.project||{});
  $('#continueNote').value=d.continueNote||'';
  $('#rerollNote').value=d.rerollNote||'';
  if(Array.isArray(d.assets)) S.assets=mergeAssetsById(d.assets,S.assets);
  normalizeAssetFolders();
  DRAFT_DIRTY=true;
  return true;
}

function setSaveState(msg, kind, persist){
  const el=$('#saveState'); if(!el) return;
  clearTimeout(SAVE_STATE_TIMER);
  el.textContent=msg||''; el.className='save-state '+(kind||''); el.hidden=!msg;
  if(msg&&!persist) SAVE_STATE_TIMER=setTimeout(()=>{ el.hidden=true; },1400);
}
function save(){
  normalizeAssetFolders();
  try{ localStorage.setItem(KEY, JSON.stringify({
    connections:S.connections, activeConn:S.activeConn,
    presets:S.presets, activePreset:S.activePreset,
    opts:S.opts, library:S.library, chat:S.chat, customTalkPrompts:S.customTalkPrompts, logVerbose:S.logVerbose,
    assetFolders:S.assetFolders,
    assets:S.assets.map(a=>clone(normalizeAssetMetadata(a)))
  }));
    SAVE_FAILED=false; setSaveState('자동 저장됨','ok'); return true;
  }catch(e){
    log('저장 실패 — 브라우저 저장 공간이 부족하거나 로컬 저장이 막혔습니다. 전체 백업을 만들어 두세요.','err');
    setSaveState('저장 실패 · 백업 필요','err',true);
    if(!SAVE_FAILED) toast('저장하지 못했습니다. 전체 백업을 만들어 주세요.',1);
    SAVE_FAILED=true; return false;
  }
}
function load(){
  let raw='';
  try{
    raw = localStorage.getItem(KEY);
    if(!raw) for(const k of OLDKEYS){ raw = localStorage.getItem(k); if(raw) break; }
    if(!raw) return false;
    const d = JSON.parse(raw);
    if(d.connections) S.connections = d.connections;
    if(d.activeConn)  S.activeConn  = d.activeConn;
    if(d.presets && d.presets.length) S.presets = d.presets;
    if(d.activePreset) S.activePreset = d.activePreset;
    if(d.opts) Object.assign(S.opts, d.opts);
    convertPrefs();
    if(S.opts.mode==='c2p') S.opts.mode='foil';
    if(!S.opts.modeBy) S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'};
    if(d.library) S.library = d.library.map(r=>Object.assign({
      star:false, group:'character', presetName:'', updated:r.at||Date.now() }, r));
    if(d.chat) S.chat = Object.assign(S.chat, d.chat);
    if(d.customTalkPrompts) S.customTalkPrompts = d.customTalkPrompts;
    if(d.logVerbose) S.logVerbose = d.logVerbose;
    if(Array.isArray(d.assetFolders)) S.assetFolders=clone(d.assetFolders);
    if(Array.isArray(d.assets)) S.assets=d.assets.map(a=>normalizeAssetMetadata(clone(a)));
    else if(Array.isArray(d.favoriteAssets)) S.assets=mergeAssetsWithFavorites(S.assets,d.favoriteAssets);
    normalizeAssetFolders();
    return true;
  }catch(e){
    LOAD_ERROR=e;
    if(raw) try{ localStorage.setItem(RECOVERY_KEY,raw); }catch(_){}
    log('저장된 데이터를 읽지 못했습니다. 원문은 복구용 저장소에 보존했습니다.','err');
    return false;
  }
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
  if(on){ if(btn._t==null) btn._t = btn.innerHTML; btn.innerHTML = '<span class="busy"></span>'+(label||'하는 중'); btn.disabled = true; }
  else  { if(btn._t!=null) btn.innerHTML = btn._t; delete btn._t; btn.disabled = false; }
  if(on&&ACTIVE_TASK?.studio){ ACTIVE_TASK.label=label||'만드는 중입니다'; renderStudioScreen(); }
}
function workIsBusy(){ return !!(ACTIVE_TASK || ABORT); }
function canChangeWork(){
  if(!workIsBusy()) return true;
  toast('요청이 끝난 뒤 변경할 수 있습니다. 먼저 요청 중지를 눌러 주세요.',1);
  return false;
}
function beginTask(){
  if(!canChangeWork()) return null;
  const task={project:S.project, group:S.opts.group, preset:S.activePreset, cancelled:false};
  ACTIVE_TASK=task;
  document.body.classList.add('working');
  return task;
}
function endTask(task){
  if(ACTIVE_TASK!==task) return;
  ACTIVE_TASK=null;
  document.body.classList.remove('working');
  if(task.studio){
    const stop=$('#btnAbortCall'); stop.hidden=true; document.body.append(stop); stop.classList.remove('inline');
    renderStudioScreen();
  }
}
function assertTask(task){
  if(task && (task.cancelled || task.project!==S.project || task.group!==S.opts.group || task.preset!==S.activePreset))
    throw new Error('__ABORT__');
}
function abortCurrentCall(){
  if(!workIsBusy()) return false;
  if(ACTIVE_TASK) ACTIVE_TASK.cancelled=true;
  if(ABORT) ABORT.abort();
  if(ACTIVE_TASK?.studio) renderStudioScreen();
  return true;
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
  const task=ACTIVE_TASK;
  assertTask(task);
  if(ABORT) throw new Error('다른 요청이 진행 중입니다. 완료 후 다시 시도해 주세요.');
  const p = PROV[conn.provider];
  if(!p) throw new Error('알 수 없는 연결 종류: '+conn.provider);
  if(!conn.model) throw new Error('모델을 고르지 않았습니다.');
  if(!p.noKey && !conn.apiKey) throw new Error('API 키가 비어 있습니다.');
  const o = Object.assign({}, opts||{});
  if(o.connectionOverrides!==false){
    if(conn.maxTokens)         o.maxTokens   = conn.maxTokens;
    if(conn.temperature!=null) o.temperature = conn.temperature;
    if(conn.topP!=null)        o.topP        = conn.topP;
  }
  delete o.connectionOverrides;
  const est = messages.reduce((a,m)=>a+tok(m.content),0);
  if(conn.contextLimit){
    const room = conn.contextLimit - (o.maxTokens||2000);
    if(est > room){
      throw new Error(`보낼 분량이 컨텍스트 상한을 넘습니다 (보낼 것 ${est} + 응답 ${o.maxTokens||2000} > ${conn.contextLimit}). ` +
        '재료 탭에서 항목을 줄이거나, 단계별 만들기의 재료 정리를 먼저 거쳐 요약본으로 돌리세요.');
    }
    if(est > room*0.85) log(`컨텍스트 여유가 적습니다 — 보낼 것 ${est} / 상한 ${conn.contextLimit}`,'err');
  }
  const req = p.chat(conn, messages, o);
  LAST_USAGE = null;
  const controller = new AbortController();
  ABORT = controller;
  if(task?.studio){ task.calls=(task.calls||0)+1; renderStudioScreen(); }
  const stop=$('#btnAbortCall');
  if(stop){
    const activeBtn=document.querySelector('button .busy')?.closest('button');
    if(task?.studio){ $('#studioStopSlot').append(stop); stop.classList.add('inline'); }
    else if(activeBtn && activeBtn.isConnected){ activeBtn.insertAdjacentElement('afterend',stop); stop.classList.add('inline'); }
    else { document.body.append(stop); stop.classList.remove('inline'); }
    stop.hidden=false;
  }
  const t0 = Date.now();
  log(`→ ${p.label} / ${conn.model} · 보낼 것 ${est} 토큰쯤 · 응답 상한 ${o.maxTokens||2000}`);
  if(S.logVerbose) log(messages.map(m=>`[${m.role}]\n${m.content}`).join('\n---\n'));
  let res, txt;
  try{
    res = await fetch(req.url, { method:'POST', headers:req.headers,
      body: JSON.stringify(req.body), signal: controller.signal });
    txt = await res.text();
  }catch(e){
    if(e.name==='AbortError') throw new Error('__ABORT__');
    log('연결 실패: '+e.message,'err');
    throw new Error('서버에 닿지 못했습니다. 브라우저가 요청을 막았거나(CORS) 주소가 틀렸을 수 있습니다. 상단 ? 단추의 안내를 보세요.');
  }finally{
    if(ABORT===controller){
      ABORT=null;
      if(stop&&!task?.studio){ stop.hidden=true; document.body.append(stop); stop.classList.remove('inline'); }
    }
  }
  assertTask(task);
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
  // 실제 생성이 성공하면 그 자체가 연결 확인 — '확인' 안 눌러도 초록불로
  if(conn._ok!==true){
    conn._ok = true; conn._lastTest = {at:Date.now(), ok:true, usage:LAST_USAGE, auto:true};
    try{ renderConnSel(); renderConns(); }catch(_){ }
  }
  return out;
}
async function fetchModels(conn){
  const p = PROV[conn.provider]; if(!p || !p.models) return null;
  const spec = p.models(conn); if(!spec) return null;
  const res = await fetch(spec.url, {headers:spec.headers});
  if(!res.ok) throw new Error(res.status+' '+(await res.text()).slice(0,200));
  return spec.parse(await res.json());
}

