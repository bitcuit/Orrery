"use strict";
/* Orrery · 기반 · 저장 · API 연결 */
/* ==================================================================
   1. 기반 — 상태 · 저장 · 유틸
   ================================================================== */
const $  = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 대화 답변의 마크다운을 화면용으로만 그린다. 먼저 전부 이스케이프하므로 원문 HTML은 끼어들지 못한다.
// 줄바꿈은 .msg-md 의 pre-wrap 이 살리므로 블록 요소 앞뒤에는 줄바꿈을 붙이지 않는다.
function mdInline(s){
  const codes=[];
  s=s.replace(/`([^`\n]+)`/g,(_,c)=>`\u0000${codes.push(c)-1}\u0000`);
  s=s.replace(/\*\*\*(?!\s)([^\n]+?)(?<!\s)\*\*\*/g,'<strong><em>$1</em></strong>')
     .replace(/\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g,'<strong>$1</strong>')
     .replace(/__(?!\s)([^\n]+?)(?<!\s)__/g,'<strong>$1</strong>')
     .replace(/(^|[^*\w])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?!\*)/g,'$1<em>$2</em>')
     .replace(/~~(?!\s)([^\n]+?)(?<!\s)~~/g,'<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>`<code>${codes[i]}</code>`);
}
function mdHtml(src){
  const lines=esc(src).replace(/\r\n?/g,'\n').split('\n'), out=[];
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>mdInline(c.trim()));
  let text=[];
  const flush=()=>{ if(text.length) out.push({t:text.join('\n')}); text=[]; };
  const block=h=>{ flush(); out.push({b:h}); };
  for(let i=0;i<lines.length;i++){
    const l=lines[i]; let m;
    if(/^\s*```/.test(l)){
      const body=[]; while(++i<lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
      block(`<pre><code>${body.join('\n')}</code></pre>`);
    } else if((m=l.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/))){
      block(`<b class="md-h md-h${m[1].length}">${mdInline(m[2])}</b>`);
    } else if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){
      block('<hr>');
    } else if(/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i+1]||'')){
      const head=cells(l), rows=[]; i++;
      while(i+1<lines.length && /^\s*\|.*\|\s*$/.test(lines[i+1])) rows.push(cells(lines[++i]));
      block(`<table><thead><tr>${head.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if(/^\s*&gt;/.test(l)){
      const q=[l]; while(i+1<lines.length && /^\s*&gt;/.test(lines[i+1])) q.push(lines[++i]);
      block(`<blockquote>${q.map(x=>mdInline(x.replace(/^\s*&gt;\s?/,''))).join('\n')}</blockquote>`);
    } else if((m=l.match(/^\s*([-*+]|\d+[.)])\s+/))){
      const ordered=/\d/.test(m[1]), re=ordered?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/, items=[l.replace(re,'')];
      while(i+1<lines.length && re.test(lines[i+1])) items.push(lines[++i].replace(re,''));
      const tag=ordered?'ol':'ul', start=ordered&&parseInt(m[1])!==1?` start="${parseInt(m[1])}"`:'';
      block(`<${tag}${start}>${items.map(x=>`<li>${mdInline(x)}</li>`).join('')}</${tag}>`);
    } else text.push(mdInline(l));
  }
  flush();
  // 블록 사이 간격은 CSS 여백이 맡으므로 텍스트 조각 가장자리의 빈 줄은 뺀다.
  return out.map(p=>p.b||p.t.replace(/^\n+|\n+$/g,'')).join('');
}
const uid = () => Math.random().toString(36).slice(2,10);
// 토큰 어림. 한국어·일본어·한자는 글자 하나가 한 토큰 가까이 되므로 따로 센다
// (예전 '글자 ÷ 3'은 한국어를 크게 적게 세서 긴 대화가 모델 한도를 넘을 수 있었다).
// 모델마다 다르니 넉넉하게(많게) 잡는다 — 적게 세면 한도 초과 오류가 난다.
const CJK_RE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/g;
const tok = s => { s = String(s||''); const cjk = (s.match(CJK_RE)||[]).length; return Math.ceil(cjk + (s.length-cjk)/3.5); };
const clone = o => JSON.parse(JSON.stringify(o));

const KEY = 'orrery.v1';
const DRAFT_KEY = 'orrery.draft.v1';
const RECOVERY_KEY = 'orrery.recovery.v1';
const OLDKEYS = ['vivarium.v1','terrarium.v1','casting.v1'];
const WORKER_WINDOW=window.parent!==window && location.hash==='#orrery-worker';
let S = {
  connections: [], activeConn: null,
  assets: [], assetFolders: [],
  presets: [], activePreset: null,
  opts: { mode:'w2c', modeBy:{world:'new',character:'w2c',prompt:'new'}, refineBy:{world:'balanced',character:'balanced',prompt:'balanced'}, buildMode:'oneshot', lang:'한국어', tone:'', seedCount:5, castCount:3, nsfw:false, easy:false, extra:'', extraBy:{world:'',character:'',prompt:''}, check:true, brief:'', briefBy:{world:'',character:'',prompt:''}, group:'world', convert:{translate:true,optimize:true,yaml:false,summarize:false,maxChars:1200,meaning:true,sourceLang:'한국어',targetLang:'English',extraBy:{world:'',character:'',prompt:''}} },
  project: { digest:null, digestSrc:'', seeds:[], sel:[], seedNote:'', card:null, locked:{}, violations:null, verdict:null, cast:[], relations:null, qa:[], libId:null, digestBy:{}, digestMeta:null, workBy:{}, screen:null },
  library: [],
  workspaces: [], activeWorkspaceId:null,
  chats: [], chatId: null,
  customTalkPrompts: {},
  commonPrefs: {},
  talkAutoCompact: true,   // 대화가 길어지면 앞부분 자동 정리 · 앱 전체   // 기본 공통 지시문 이름 → {off, tags} · 모든 양식 공통
  logVerbose: false
};
/* 대화창은 여러 개가 나란히 있고 서로 참조하지 않는다.
   S.chat 은 그중 '지금 보고 있는 것' 하나를 가리키는 이름일 뿐이다. */
function emptyChat(group, name){
  return { id:uid(), name:name||'', updated:Date.now(), role:group==='character'?'char':(group||'world'),
    msgs:[], ctx:{assets:true, digest:true, card:false}, picks:{assets:[], records:[]},
    summary:'', summaryHistory:[], summaryIncluded:true, inputDraft:'', nudgeOff:false };
}
function normalizeChat(c, group){
  const base=emptyChat(group);
  if(!c || typeof c!=='object') return base;
  const out=Object.assign(base, c);
  out.id=typeof c.id==='string'&&c.id?c.id:base.id;
  out.ctx=Object.assign({assets:true,digest:true,card:false}, c.ctx||{});
  // 대화창별 재료가 없던 예전 대화창은 처음 열 때 지금 켜 둔 재료를 이어받는다(chatPicks)
  if(!c.picks) delete out.picks;
  out.msgs=Array.isArray(c.msgs)?c.msgs:[];
  out.summaryHistory=Array.isArray(c.summaryHistory)?c.summaryHistory:[];
  return out;
}
function chatList(){
  if(!Array.isArray(S.chats)) S.chats=[];
  if(!S.chats.length) S.chats.push(emptyChat(S.opts&&S.opts.group));
  if(!S.chats.some(c=>c.id===S.chatId)) S.chatId=S.chats[0].id;
  return S.chats;
}
function chatIndex(){ const list=chatList(); return list.findIndex(c=>c.id===S.chatId); }
function chatLabel(c, i){
  if(c.name&&c.name.trim()) return c.name.trim();
  const first=(c.msgs||[]).find(m=>m.role==='user'&&m.content&&m.content.trim());
  if(first) return first.content.trim().replace(/\s+/g,' ').slice(0,18);
  return '대화 '+(i+1);
}
Object.defineProperty(S, 'chat', {
  configurable:true, enumerable:false,
  get(){ return chatList()[chatIndex()]; },
  set(v){
    const list=chatList(), at=chatIndex(), keep=list[at];
    const next=normalizeChat(v, S.opts&&S.opts.group);
    // 대입은 '지금 대화의 내용을 갈아끼운다'는 뜻이므로 자리와 id 를 지킨다.
    next.id=keep.id; list[at]=next; S.chatId=next.id; return next;
  }
});
let LOG = [];
let ABORT = null;            /* 작업대 요청 — 한 번에 하나, 상단 중지 버튼과 짝 */
const INFLIGHT = new Set();  /* 동시에 나가도 되는 요청(대화) 의 중지 손잡이 */
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
  if(WORKER_WINDOW) return;
  clearTimeout(DRAFT_TIMER); DRAFT_TIMER=null;
  if(!DRAFT_DIRTY) return;
  if(!hasDraftWork()){ clearDraft(); return; }
  const base = {version:1, at:Date.now(), activeWorkspaceId:S.activeWorkspaceId, activePreset:S.activePreset, opts:clone(S.opts), project:clone(S.project),
    continueNote:$('#continueNote').value, rerollNote:$('#rerollNote').value};
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(base)); }
  catch(e){
    log('마지막 작업 임시 저장에 실패했습니다.','err');
    setSaveState('저장 실패 · 백업 필요','err',true);
    if(!SAVE_FAILED) toast('마지막 작업을 저장하지 못했습니다. 전체 백업을 만들어 주세요.',1);
    SAVE_FAILED=true;
  }
  if(S.activeWorkspaceId) save();
}
function touchDraft(){
  if(WORKER_WINDOW) return;
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
  S.activeWorkspaceId=S.workspaces.some(w=>w.id===d.activeWorkspaceId)?d.activeWorkspaceId:null;
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
/* --- 저장 공간 ---
   크롬 기준 이 앱이 쓸 수 있는 localStorage 는 약 520만 글자(2026-10 크롬에서 직접 채워 잼).
   80%를 넘으면 한 번 알린다. 다른 키들은 무거우니 1분에 한 번만 다시 센다. */
const STORAGE_ROOM = 5200000, STORAGE_WARN_AT = 0.8;
let STORAGE_OTHERS = null, STORAGE_OTHERS_AT = 0, STORAGE_WARNED = false;
function storageUsed(mainLen){
  if(STORAGE_OTHERS===null || Date.now()-STORAGE_OTHERS_AT > 60000){
    let n=0;
    try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k!==KEY) n+=k.length+(localStorage.getItem(k)||'').length; } }catch(_){}
    STORAGE_OTHERS=n; STORAGE_OTHERS_AT=Date.now();
  }
  return STORAGE_OTHERS + KEY.length + mainLen;
}
function checkStorageRoom(mainLen){
  const used = storageUsed(mainLen), share = used/STORAGE_ROOM;
  if(share < STORAGE_WARN_AT){ STORAGE_WARNED=false; return share; }
  if(!STORAGE_WARNED){
    STORAGE_WARNED=true;
    log(`브라우저 저장 공간 ${Math.round(share*100)}% 사용 (${used.toLocaleString()} / 약 ${STORAGE_ROOM.toLocaleString()}자)`,'err');
    toast(`저장 공간을 ${Math.round(share*100)}% 썼습니다 · 전체 백업을 만들고, 다 쓴 대화창이나 재료를 지워 주세요`,1);
  }
  return share;
}
function save(){
  if(WORKER_WINDOW) return true;
  if(typeof syncActiveWorkspace==='function') syncActiveWorkspace();
  normalizeAssetFolders();
  try{ if(typeof persistOwnedWorkspaces==='function') persistOwnedWorkspaces();
    if(typeof persistSharedRecords==='function') persistSharedRecords();
    const payload = JSON.stringify({
    connections:S.connections, activeConn:S.activeConn,
    presets:S.presets, activePreset:S.activePreset,
    opts:S.opts, library:S.library, chats:chatList(), chatId:S.chatId, customTalkPrompts:S.customTalkPrompts, commonPrefs:S.commonPrefs, talkAutoCompact:S.talkAutoCompact, logVerbose:S.logVerbose,
    workspaces:S.workspaces, activeWorkspaceId:S.activeWorkspaceId,
    assetFolders:S.assetFolders,
    assets:S.assets.map(a=>clone(normalizeAssetMetadata(a)))
  });
    localStorage.setItem(KEY, payload);
    SAVE_FAILED=false; setSaveState('자동 저장됨','ok'); checkStorageRoom(payload.length); return true;
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
    if(Array.isArray(d.workspaces)) S.workspaces=d.workspaces.filter(w=>w&&typeof w.id==='string'&&w.snapshot?.project&&w.snapshot?.opts);
    if(typeof loadSharedWorkspaces==='function') loadSharedWorkspaces();
    if(S.workspaces.some(w=>w.id===d.activeWorkspaceId)) S.activeWorkspaceId=d.activeWorkspaceId;
    convertPrefs();
    if(S.opts.mode==='c2p') S.opts.mode='foil';
    if(!S.opts.modeBy) S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'};
    if(d.library) S.library = d.library.map(r=>Object.assign({
      star:false, group:'character', presetName:'', updated:r.at||Date.now() }, r));
    if(typeof loadSharedRecords==='function')loadSharedRecords();
    if(Array.isArray(d.chats)&&d.chats.length){
      S.chats=d.chats.map(c=>normalizeChat(c, S.opts.group));
      S.chatId=S.chats.some(c=>c.id===d.chatId)?d.chatId:S.chats[0].id;
    } else if(d.chat){ S.chats=[normalizeChat(d.chat, S.opts.group)]; S.chatId=S.chats[0].id; }
    if(d.customTalkPrompts) S.customTalkPrompts = d.customTalkPrompts;
    if(d.commonPrefs && typeof d.commonPrefs==='object' && !Array.isArray(d.commonPrefs)) S.commonPrefs = d.commonPrefs;
    if(typeof d.talkAutoCompact==='boolean') S.talkAutoCompact = d.talkAutoCompact;
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
function canChangeWork(allowBackground=false){
  if(!allowBackground && typeof currentWorkspaceJob==='function' && currentWorkspaceJob()){
    toast('이 작업은 생성 중입니다. 작업 목록에서 다른 작업을 열 수 있습니다.',1); return false;
  }
  if(!workIsBusy()) return true;
  toast('요청이 끝난 뒤 변경할 수 있습니다. 먼저 요청 중지를 눌러 주세요.',1);
  return false;
}
function beginTask(){
  if(!canChangeWork(true)) return null;
  const task={project:S.project, group:S.opts.group, preset:S.activePreset, cancelled:false};
  ACTIVE_TASK=task;
  document.body.classList.add('working');
  return task;
}
function endTask(task){
  if(ACTIVE_TASK!==task) return;
  ACTIVE_TASK=null;
  if(typeof applyCompletedWorkspace==='function') applyCompletedWorkspace();
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
// 대화에 붙인 이미지는 m.images=[{mime,data(base64)}]로 온다. 없으면 지금처럼 글만 보낸다.
const dataUrl = i => `data:${i.mime};base64,${i.data}`;
const oaiContent = m => m.images&&m.images.length
  ? [...(m.content?[{type:'text',text:m.content}]:[]), ...m.images.map(i=>({type:'image_url',image_url:{url:dataUrl(i)}}))]
  : m.content;
const geminiParts = m => [...(m.content?[{text:m.content}]:[]), ...(m.images||[]).map(i=>({inline_data:{mime_type:i.mime,data:i.data}}))];
const OAI_LIKE = (base, keyHeader) => ({
  base,
  chat(c, msgs, o){
    const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
    const rest = msgs.filter(m=>m.role!=='system').map(m=>({role:m.role, content:oaiContent(m)}));
    const body = {
      model: c.model,
      messages: sys ? [{role:'system',content:sys}, ...rest] : rest,
      temperature: o.temperature ?? 0.9,
      max_tokens: o.maxTokens || 2400
    };
    if(o.topP != null) body.top_p = o.topP;
    if(o.stream) body.stream = true;
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
  // 길이 제한으로 잘렸는가 · 스트리밍 조각 하나
  finish(j){ const ch = j.choices && j.choices[0]; return !!ch && ch.finish_reason==='length'; },
  delta(ev){ const ch = ev.choices && ev.choices[0]; if(!ch) return {};
    return { text:(ch.delta && ch.delta.content) || '', cut:ch.finish_reason==='length' }; },
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
    mlist:['claude-opus-5','claude-sonnet-5','claude-haiku-4-5'],
    // Opus 4.6 이후 모델(Opus 5 / Sonnet 5 / Opus 4.7~4.8 / Fable)은 temperature가 1.0만 허용되고
    // 그 외 값은 400. 추론이 상시 켜져 있어 샘플링 조절이 불가능해졌다. 아예 보내지 않는다(= 1.0과 동일).
    nosample:/^claude-(fable|mythos)-|^claude-opus-(5|4-7|4-8)|^claude-sonnet-5/,
    chat(c,msgs,o){
      const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
      const rest = msgs.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'assistant':'user',
        content:m.images&&m.images.length
          ? [...m.images.map(i=>({type:'image',source:{type:'base64',media_type:i.mime,data:i.data}})), ...(m.content?[{type:'text',text:m.content}]:[])]
          : m.content}));
      const body = { model:c.model, max_tokens:o.maxTokens||2400,
                     messages: rest.length?rest:[{role:'user',content:' '}] };
      const sampling = !PROV.anthropic.nosample.test(String(c.model||''));
      if(sampling){
        body.temperature = o.temperature ?? 0.9;
        if(o.topP != null) body.top_p = o.topP;
      }
      if(sys) body.system = sys;
      if(o.stream) body.stream = true;
      return { url:(c.baseUrl||'https://api.anthropic.com/v1').replace(/\/$/,'')+'/messages',
        headers:{'Content-Type':'application/json','x-api-key':c.apiKey,
                 'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body };
    },
    parse(j){ return (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''); },
    finish(j){ return j.stop_reason==='max_tokens'; },
    delta(ev){
      if(ev.type==='content_block_delta' && ev.delta && ev.delta.type==='text_delta') return {text:ev.delta.text};
      if(ev.type==='message_delta') return {cut: !!(ev.delta && ev.delta.stop_reason==='max_tokens')};
      if(ev.type==='error') return {error:(ev.error && ev.error.message) || '응답 도중 오류'};
      return {};
    },
    models(c){ return { url:(c.baseUrl||'https://api.anthropic.com/v1').replace(/\/$/,'')+'/models',
      headers:{'x-api-key':c.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      parse:j=>(j.data||[]).map(m=>m.id) }; } },

  gemini: { label:'Google Gemini', base:'https://generativelanguage.googleapis.com/v1beta',
    mlist:['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash'],
    chat(c,msgs,o){
      const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
      const contents = msgs.filter(m=>m.role!=='system')
        .map(m=>({role:m.role==='assistant'?'model':'user',parts:geminiParts(m)}));
      const body = { contents: contents.length?contents:[{role:'user',parts:[{text:' '}]}],
        generationConfig:Object.assign({ temperature:o.temperature ?? 0.9, maxOutputTokens:o.maxTokens||2400 },
          o.topP!=null?{topP:o.topP}:{}),
        safetySettings:['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT']
          .map(x=>({category:x,threshold:'BLOCK_NONE'})) };
      if(sys) body.systemInstruction = {parts:[{text:sys}]};
      const b=(c.baseUrl||'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
      return { url:`${b}/models/${encodeURIComponent(c.model)}:${o.stream?'streamGenerateContent?alt=sse&':'generateContent?'}key=${encodeURIComponent(c.apiKey)}`,
        headers:{'Content-Type':'application/json'}, body };
    },
    parse(j){ const cd=(j.candidates||[])[0]; if(!cd) return '';
      return ((cd.content&&cd.content.parts)||[]).map(p=>p.text||'').join(''); },
    finish(j){ const cd=(j.candidates||[])[0]; return !!cd && cd.finishReason==='MAX_TOKENS'; },
    delta(ev){ const cd=(ev.candidates||[])[0]; if(!cd) return {};
      return { text:((cd.content&&cd.content.parts)||[]).map(p=>p.text||'').join(''), cut:cd.finishReason==='MAX_TOKENS' }; },
    models(c){ const b=(c.baseUrl||'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
      return { url:`${b}/models?key=${encodeURIComponent(c.apiKey)}`, headers:{},
        parse:j=>(j.models||[]).map(m=>String(m.name).replace(/^models\//,'')) }; } },

  vertex: { label:'Google Vertex AI', base:'', needs:['project','location','accessToken'],
    mlist:['gemini-2.5-pro','gemini-2.5-flash'],
    chat(c,msgs,o){
      const sys = msgs.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
      const contents = msgs.filter(m=>m.role!=='system')
        .map(m=>({role:m.role==='assistant'?'model':'user',parts:geminiParts(m)}));
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
        body:Object.assign({ model:c.model, messages:msgs.map(m=>({role:m.role,content:oaiContent(m)})),
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

/* --- 스트리밍 응답 읽기 (SSE: "data: {…}" 줄) ---
   조각마다 공급자의 delta() 로 글을 뽑아 누적하고 onDelta 로 알린다.
   중지하거나 끊기면 받은 데까지(partial)를 오류에 실어 보낸다. */
function sseLine(line, p, st){
  line = line.replace(/\r$/,'');
  if(!line.startsWith('data:')) return;
  const data = line.slice(5).trim(); if(!data || data==='[DONE]') return;
  let ev; try{ ev = JSON.parse(data); }catch(_){ return; }
  const d = p.delta(ev) || {};
  if(d.error) throw new Error(d.error);
  if(d.cut) st.onCut();
  const u = responseUsage(ev); if(u) st.onUsage(u);
  if(d.text){ st.out += d.text; if(st.onDelta) st.onDelta(st.out); }
}
async function readSSE(body, p, onDelta, onUsage, onCut){
  const reader = body.getReader(), dec = new TextDecoder(), st = {out:'', onDelta, onUsage, onCut};
  let buf = '';
  try{
    for(;;){
      const {value, done} = await reader.read(); if(done) break;
      buf += dec.decode(value, {stream:true});
      let i; while((i = buf.indexOf('\n')) >= 0){ sseLine(buf.slice(0,i), p, st); buf = buf.slice(i+1); }
    }
    if(buf) sseLine(buf, p, st);
  }catch(e){
    if(e.name==='AbortError') throw Object.assign(new Error('__ABORT__'), {partial:st.out});
    throw Object.assign(e, {partial:st.out});
  }
  return st.out;
}
function sseText(text, p, onUsage, onCut){
  const st = {out:'', onDelta:null, onUsage, onCut};
  text.split('\n').forEach(line=>sseLine(line, p, st));
  return st.out;
}

/* --- 다시 시도 ---
   429(요청 과다)·5xx·529(과부하)와 네트워크 끊김만. 서버가 Retry-After 를 주면 따르되 20초까지. */
const RETRY_STATUS = new Set([408,425,429,500,502,503,504,529]);
let RETRY_DELAYS = [1500, 4000];
function retryWait(res, attempt){
  const ra = res && res.headers && res.headers.get && Number(res.headers.get('retry-after'));
  return Math.min(20000, ra>0 ? ra*1000 : RETRY_DELAYS[attempt]);
}
function abortableSleep(ms, signal){
  return new Promise((resolve,reject)=>{
    if(signal && signal.aborted) return reject(Object.assign(new Error('aborted'),{name:'AbortError'}));
    const t = setTimeout(resolve, ms);
    if(signal) signal.addEventListener('abort', ()=>{ clearTimeout(t); reject(Object.assign(new Error('aborted'),{name:'AbortError'})); }, {once:true});
  });
}
// 모델 입력 한도를 넘었다는 오류인지 (공급자마다 문구가 다르다)
const CONTEXT_OVERFLOW_RE = /context.?length|maximum context|context window|prompt is too long|too many tokens|input token count|exceeds? the (?:model'?s? )?(?:context|maximum)|context_length_exceeded|컨텍스트 상한을 넘습니다/i;

/* --- 호출 --- */
async function callProvider(conn, messages, opts){
  // concurrent 요청은 전역 한 자리를 쓰지 않는다 — 대화창마다 따로 오갈 수 있게.
  const solo = !(opts && opts.concurrent);
  const task = solo ? ACTIVE_TASK : null;
  if(solo){
    assertTask(task);
    if(ABORT) throw new Error('다른 요청이 진행 중입니다. 완료 후 다시 시도해 주세요.');
  }
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
  delete o.connectionOverrides; delete o.concurrent; delete o.onStart;
  // 스트리밍: 부르는 쪽이 onDelta 를 주고 공급자가 조각 읽기를 지원할 때만. 아니면 지금처럼 한 번에 받는다
  const onDelta = typeof o.onDelta==='function' && typeof p.delta==='function' ? o.onDelta : null;
  const onMeta = typeof o.onMeta==='function' ? o.onMeta : null;
  delete o.onDelta; delete o.onMeta;
  if(onDelta) o.stream = true;
  // 이미지 한 장은 대략 1,000토큰으로 어림한다(공급자·크기마다 다름).
  const est = messages.reduce((a,m)=>a+tok(m.content)+(m.images?m.images.length*1000:0),0);
  if(conn.contextLimit){
    const room = conn.contextLimit - (o.maxTokens||2000);
    if(est > room){
      throw new Error(`보낼 분량이 컨텍스트 상한을 넘습니다 (보낼 것 ${est} + 응답 ${o.maxTokens||2000} > ${conn.contextLimit}). ` +
        '재료 탭에서 항목을 줄이거나, 단계별 만들기의 재료 정리를 먼저 거쳐 요약본으로 돌리세요.');
    }
    if(est > room*0.85) log(`컨텍스트 여유가 적습니다 — 보낼 것 ${est} / 상한 ${conn.contextLimit}`,'err');
  }
  const req = p.chat(conn, messages, o);
  let usage = null;
  if(solo) LAST_USAGE = null;
  const controller = new AbortController();
  if(solo) ABORT = controller; else INFLIGHT.add(controller);
  if(typeof opts?.onStart==='function') opts.onStart(controller);
  if(task?.studio){ task.calls=(task.calls||0)+1; renderStudioScreen(); }
  const stop = solo ? $('#btnAbortCall') : null;
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
    // 일시적 오류(요청 과다·서버 오류·네트워크 끊김)는 잠깐 기다렸다 두 번까지 다시 시도한다
    for(let attempt=0;;attempt++){
      let netErr=null;
      try{
        res = await fetch(req.url, { method:'POST', headers:req.headers,
          body: JSON.stringify(req.body), signal: controller.signal });
        // 스트리밍이면 본문은 아래에서 조각으로 읽는다
        txt = (onDelta && res.ok && res.body && res.body.getReader) ? undefined : await res.text();
      }catch(e){ if(e.name==='AbortError') throw e; netErr=e; }
      if(!(netErr || RETRY_STATUS.has(res.status)) || attempt>=RETRY_DELAYS.length){ if(netErr) throw netErr; break; }
      const wait = retryWait(netErr?null:res, attempt);
      log(`${netErr?'연결 끊김':res.status} · ${Math.round(wait/1000)}초 뒤 다시 시도 (${attempt+1}/${RETRY_DELAYS.length})`,'err');
      await abortableSleep(wait, controller.signal);
    }
  }catch(e){
    if(e.name==='AbortError') throw new Error('__ABORT__');
    log('연결 실패: '+e.message,'err');
    throw new Error('서버에 닿지 못했습니다. 브라우저가 요청을 막았거나(CORS) 주소가 틀렸을 수 있습니다. 상단 ? 단추의 안내를 보세요.');
  }finally{
    INFLIGHT.delete(controller);
    if(ABORT===controller){
      ABORT=null;
      if(stop&&!task?.studio){ stop.hidden=true; document.body.append(stop); stop.classList.remove('inline'); }
    }
  }
  if(solo) assertTask(task);
  if(!res.ok){
    log(`← ${res.status} ${txt.slice(0,600)}`,'err');
    let detail = txt.slice(0,300);
    try{ const j=JSON.parse(txt); detail = (j.error&&(j.error.message||j.error))||j.message||detail; }catch(_){}
    throw new Error(`${res.status} · ${detail}`);
  }
  let out = '', cut = false;
  if(txt===undefined){
    out = await readSSE(res.body, p, onDelta, u=>{ usage=u; }, ()=>{ cut=true; });
  } else {
    let j=null; try{ j = JSON.parse(txt); }catch(_){}
    if(j){ usage = responseUsage(j); out = p.parse(j) || ''; cut = !!(p.finish && p.finish(j)); }
    else if(onDelta && /^\s*data:/m.test(txt)) out = sseText(txt, p, u=>{ usage=u; }, ()=>{ cut=true; });   // 스트림을 통째로 받은 경우
    else throw new Error('응답이 JSON이 아닙니다: '+txt.slice(0,200));
    if(onDelta && out) onDelta(out);
  }
  if(solo) LAST_USAGE = usage;
  if(onMeta) onMeta({truncated:cut});
  if(cut) log('응답이 길이 제한에 걸려 잘렸습니다','err');
  log(`← ${out.length}자${usage?' · '+usageLabel(usage):''} · ${((Date.now()-t0)/1000).toFixed(1)}초`,'ok');
  if(S.logVerbose) log(out);
  if(!out.trim()) throw new Error('모델이 빈 응답을 돌려줬습니다. (필터에 걸렸거나 토큰이 모자랐을 수 있습니다)');
  // 동시 요청이 작업대의 '마지막 API 응답' 을 덮어쓰지 않게 한다.
  if(solo){ LAST_RAW = out; LAST_RAW_AT = Date.now(); }
  // 실제 생성이 성공하면 그 자체가 연결 확인 — '확인' 안 눌러도 초록불로
  if(conn._ok!==true){
    conn._ok = true; conn._lastTest = {at:Date.now(), ok:true, usage, auto:true};
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

