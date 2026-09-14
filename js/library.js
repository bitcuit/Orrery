"use strict";
/* Orrery · 성도 기록 · 양식 관리 */
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
    continuations:clone(S.project.card.continuations||[]),
    conversion:S.project.card.conversion?clone(S.project.card.conversion):null, updated: Date.now()
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
  if(ids.size){
    log(`기록이 ${LIMIT}개를 넘어 고정하지 않은 오래된 항목 ${ids.size}개를 지웠습니다.`);
    setTimeout(()=>toast(`기록이 ${LIMIT}개를 넘어 오래된 항목 ${ids.size}개를 정리했습니다`),900);
  }
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
  box.innerHTML = list.map(r=>{
    const preset=S.presets.find(p=>p.id===r.presetId);
    const cardExport=(preset&&preset.kind==='character')||(!preset&&r.group==='character');
    return `
    <div class="libitem" data-id="${r.id}">
      <button class="mini ghost l-star" style="flex:none;border:none;font-size:15px;padding:2px 6px;color:${r.star?'var(--brass)':'var(--dim2)'}">${r.star?'★':'☆'}</button>
      <span class="ln l-name" title="눌러서 이름 바꾸기">${esc(r.name||'이름 없음')}</span>
      <span class="lm">${esc(GROUP_LABEL[r.group]||'')} · ${esc(r.presetName||'')}${r.world?' · '+esc(r.world):''} · ${new Date(r.updated||r.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
      <button class="mini ghost l-open">불러오기</button>
      <button class="mini ghost l-md">글</button>
      ${cardExport?'<button class="mini ghost l-json">카드 JSON</button><button class="mini ghost l-png">PNG 카드</button>':''}
      <button class="iconbtn danger l-del" title="삭제" aria-label="삭제">${TRASH_SVG}</button>
    </div>`;
  }).join('');
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
      truncatedField:rec.truncatedField||'', continuations:clone(rec.continuations||[]),
      conversion:rec.conversion?clone(rec.conversion):null};
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
    hint:'성운의 재료로 새 세계를 만들지, 기존 세계를 덜고 보완해 다시 다듬을지 고릅니다.',
    items:[
      ['new','새 세계 만들기','키워드와 설정 조각을 바탕으로 새로운 세계를 설계합니다.'],
      ['supplement','기존 세계 다듬기','핵심 설정은 지키면서 불필요한 것은 덜고, 필요한 것은 보완하거나 다시 설계합니다.']
    ]
  },
  character: {
    title:'인물을 어떻게 뽑을까요',
    hint:'세계에서 새로 뽑거나, 기존 인물을 다듬거나, 함께 얽힐 상대와 관계망을 만듭니다.',
    items:[
      ['w2c','세계에서 사람 뽑기','로어북·설정을 읽고 그 세계에 실제로 살고 있을 법한 인물을 만듭니다.'],
      ['supplement','기존 인물 다듬기','인물의 정체성은 지키면서 중복은 덜고, 필요한 부분은 보완하거나 다시 설계합니다.'],
      ['foil','맞부딪힐 상대','기존 인물을 읽고 그와 어긋나고 얽힐 다른 인물을 만듭니다.'],
      ['cast','여러 명 + 관계망','같은 세계에서 여러 명을 뽑고 서로를 어떻게 보는지까지 짭니다.']
    ]
  },
  prompt: {
    title:'프롬프트를 어떻게 만들까요',
    hint:'새로 설계하거나, 이미 쓰는 프롬프트를 덜고 보완해 다듬거나, 다른 용도로 변형합니다.',
    items:[
      ['new','새 프롬프트 만들기','목적과 재료에서 역할·작동 원칙·출력 형식을 새로 설계합니다.'],
      ['supplement','기존 프롬프트 다듬기','잘 작동하는 부분은 두고 중복을 덜거나 빠진 통제·출력 규칙을 보완합니다.'],
      ['adapt','기존 프롬프트 변형하기','핵심 작동 원리는 살리면서 구상 칸에 적은 새 용도에 맞춥니다.']
    ]
  }
};
function renderModeChooser(){
  const u = MODE_UI[S.opts.group] || MODE_UI.character, cur = activeMode();
  const curName = (u.items.find(x=>x[0]===cur) || u.items[0])[1];
  const nameEl = $('#modeCurName'); if(nameEl) nameEl.textContent = curName;
  $('#modeBox').innerHTML = u.items.map(([id,name,note])=>`
    <div class="mode ${id===cur?'on':''}" data-mode="${id}"><div class="mn">${esc(name)}</div><div class="md">${esc(note)}</div></div>`).join('');
  renderRefineChooser();
}

const REFINE_UI=[
  ['balanced','균형 있게','중복과 장식은 덜고, 실제로 필요한 빈틈만 보완합니다.'],
  ['simplify','단순하게','핵심 규칙과 정체성은 남기고 반복·미사용 요소·과한 설명을 줄입니다.'],
  ['detail','자세하게','기존 내용을 유지하며 작동 조건·인과·대가·사례를 필요한 만큼 구체화합니다.'],
  ['redesign','다시 설계','핵심 의도는 지키되 약한 요소를 빼고 묶음과 순서를 새로 짭니다.']
];
function renderRefineChooser(){
  const panel=$('#refinePanel'), box=$('#refineBox'); if(!panel||!box) return;
  const show=modeUsesRefine(); panel.hidden=!show;
  if(!show){ box.innerHTML=''; return; }
  const cur=activeRefine();
  box.innerHTML=REFINE_UI.map(([id,name,note])=>`
    <button type="button" class="refine-mode ${id===cur?'on':''}" data-refine="${id}" aria-pressed="${id===cur}">
      <span class="rn">${esc(name)}</span><span class="rd">${esc(note)}</span>
    </button>`).join('');
}


const GROUP_UI = {
  world: {
    s1:'설계 준비', spine1:'설계 준비', btn:'재료 정리하기', combinedBtn:'정리하고 결과 만들기',
    hint:'구상과 선택한 재료에서 이미 정해진 것·자연히 따라오는 것·빈틈·먼저 정할 질문을 보여줍니다.',
    brief:'구상', briefNote:'재료가 없어도 이것만으로 시작할 수 있습니다',
    ph:'예: 바다가 말라붙은 뒤의 항구도시, 소금 채굴, 물을 파는 길드',
    extraPh:'예: 생활과 제도를 중심으로 · 고유명사는 짧게 · 마법의 대가는 분명하게',
    rerollPh:'예: 생활 칸에 물가와 이동 수단을 더 구체적으로',
    continuePh:'비우면 잘린 곳이나 마지막 칸부터 잇습니다 · 예: 세력 칸에 이해관계 변화를 더 써줘',
    askPh:'예: 이 규칙 때문에 가장 손해 보는 사람은 누구인가요? · Ctrl+Enter',
    readDone:'설계 재료를 정리했습니다'
  },
  character: {
    s1:'재료 정리', spine1:'재료 정리', btn:'재료 정리하기', combinedBtn:'정리하고 결과 만들기',
    hint:'구상과 선택한 세계·인물을 정리해 인물을 놓을 자리와 빈틈을 보여줍니다.',
    brief:'구상', briefNote:'원하는 방향이 있으면 적으세요',
    ph:'예: 항해길드에서 쫓겨난 사람. 30대. 말수가 적고 빚이 있음',
    extraPh:'예: 30대 이상 · 말수가 적게 · 기존 인물과 역할이 겹치지 않게',
    rerollPh:'예: 말투를 더 절제하고 행동으로 드러나게',
    continuePh:'비우면 잘린 곳이나 마지막 칸부터 잇습니다 · 예: 배경 칸에 관계가 틀어진 계기까지 써줘',
    askPh:'예: 배신당하면 어떻게 반응하나요? · Ctrl+Enter',
    readDone:'인물 재료를 정리했습니다'
  },
  prompt: {
    s1:'요구 정리', spine1:'요구 정리', btn:'요구 정리하기', combinedBtn:'정리하고 결과 만들기',
    hint:'무엇을 만들어야 하는지, 무엇이 정해졌고 무엇이 비었는지 먼저 정리합니다.',
    brief:'구상', briefNote:'여기가 주 입력입니다 — 무엇을 만들 프롬프트인지 적으세요',
    ph:'예: 설정집을 읽고 그 세계의 사건 사고를 뉴스 형식으로 뽑는 프롬프트',
    extraPh:'예: 입력이 부족하면 질문부터 · 금지 사항은 판정 가능하게 · 바로 복사해 쓸 수 있게',
    rerollPh:'예: 출력 형식을 더 엄격하고 간단하게',
    continuePh:'비우면 잘린 곳이나 마지막 칸부터 잇습니다 · 예: 실패 처리와 자기 검증 규칙까지 써줘',
    askPh:'예: 입력이 비었을 때 이 프롬프트는 어떻게 작동하나요? · Ctrl+Enter',
    readDone:'요구를 정리했습니다'
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
  if(m.mode && m.mode!==activeMode()) return '만드는 방식이 바뀌었습니다';
  if(modeUsesRefine() && m.refine!==activeRefine()) return '다듬는 방향이 바뀌었습니다';
  return m.tpl === digestTpl(activePreset()) ? null : `정리 양식이 “${m.presetName}”에서 바뀌었습니다`;
}
function applyGroupUi(){
  const u = GROUP_UI[S.opts.group] || GROUP_UI.world;
  const set = (sel,v)=>{ const el=$(sel); if(el) el.textContent = v; };
  set('#studioTitle', (GROUP_LABEL[S.opts.group]||'') + ' 작업대');
  set('#s1Title', u.s1); set('#spine1', u.spine1); set('#s1Hint', u.hint);
  set('#briefLabel', u.brief); set('#briefNote', u.briefNote || '');
  const bd = $('#btnDigest');
  if(bd && !bd.querySelector('.busy')){
    // 아이콘(svg)은 남기고 텍스트 노드만 바꾼다
    const txt = Array.from(bd.childNodes).find(n=>n.nodeType===3 && n.textContent.trim());
    const label=activePreset().skipSeed?(u.combinedBtn||'정리하고 결과 만들기'):u.btn;
    if(txt) txt.textContent = label; else bd.append(label);
  }
  const setPh=(sel,v)=>{ const el=$(sel); if(el) el.placeholder=v||''; };
  setPh('#optBrief',u.ph); setPh('#optExtra',u.extraPh); setPh('#rerollNote',u.rerollPh);
  setPh('#continueNote',u.continuePh); setPh('#askIn',u.askPh);
  const castField=$('#castCountField'); if(castField) castField.hidden=S.opts.group!=='character';
  renderModeChooser(); renderNebulaPicker();
}

const GROUP_LABEL = { world:'세계', character:'인물', prompt:'프롬프트' };
// 분류의 항성계 이름 — 뱃지·목록 표시용
const GROUP_STAR = { world:'항성', character:'행성', prompt:'궤도', all:'공용' };
function presetGroupKey(p){ const g = (p && p.group) || 'character'; return g==='all' ? 'all' : g; }
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
  OPEN_DONE_STAGE=null; CLOSED_DONE_STAGE=null;
  const prevGroup = S.opts.group;
  S.activePreset = id;
  const p = activePreset();
  const pg = p.group || 'character';
  if(pg!=='all' && pg!==prevGroup){
    // 분류가 바뀌면 읽은 요약도 그 분류 것으로 갈아끼운다
    stashDigest(prevGroup);
    S.opts.group = pg;
    loadDigest(pg);
    $('#optBrief').value=curBrief();
    $('#optExtra').value=curExtra();
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
  OPEN_DONE_STAGE=null; CLOSED_DONE_STAGE=null;
  stashDigest(S.opts.group);
  S.opts.group = g;
  loadDigest(g);
  $('#optBrief').value=curBrief();
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
  $('#presetSel').innerHTML = S.presets.map(p=>{
    const gk = presetGroupKey(p);
    return `<option value="${p.id}" ${p.id===S.activePreset?'selected':''}>${p.off?'🚫 ':''}[${GROUP_STAR[gk]}] ${esc(p.name)}${p.off?' (숨김)':''}</option>`;
  }).join('');
  const n = PRESET_NOTE[S.activePreset];
  $('#stNote').innerHTML = n ? esc(n) : '';
  if($('#studioNote')) $('#studioNote').textContent = n || '';
  $('#stNote').style.color = S.activePreset==='drives-adult' ? 'var(--brass)' : '';
  const P = activePreset();
  const off = !!(P && P.off), b = $('#btnPresetOff');
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

const STAGE_LABEL = { digest:'1 · 읽기', seed:'2 · 씨앗 뽑기', cross:'2b · 씨앗 섞기',
  expand:'3 · 결과 만들기', patch:'3b · 칸 다시 쓰기', check:'4 · 결과 검증', relate:'캐스트 · 관계 짜기' };

/* --- 공통 지시문 (모든 공정 앞) --- */
// prompts.js/편집기 반영에서 온 '기본' 공통 지시문을 현재 양식 분류에 맞게 읽기전용으로 보여준다
function inheritedCommonHtml(){
  const g = S.opts.group || 'character';
  let items = [];
  try{ items = builtinCommonItems().filter(it => it.groups.includes(g)); }catch(_){ items = []; }
  if(!items.length) return '';
  const rows = items.map(it=>`
    <details class="stitem inherited">
      <summary>
        <span class="chev">▶</span>
        <span class="inh-badge" title="prompts.js 또는 편집기 '앱에 반영'에서 온 기본 공통 지시문입니다. 이 분류의 모든 양식에 자동으로 들어갑니다. 여기선 못 고치고 prompts.js/편집기에서 관리합니다.">기본</span>
        <span class="nm">${esc(it.name||'(이름 없음)')}</span>
        ${it.role!=='system' ? `<span class="rolechip">${esc(it.role)}</span>` : ''}
        <span class="meta">${tok(it.content)}tk</span>
      </summary>
      <div class="stbody">
        <div class="field" style="margin:0"><label class="fl">내용 · 읽기 전용 (prompts.js / 편집기에서 관리)</label>
          <textarea rows="${Math.min(14, Math.max(3, it.content.split('\n').length))}" readonly>${esc(it.content)}</textarea></div>
      </div>
    </details>`).join('');
  return `<p class="note" style="margin:0 0 8px">아래 <b>기본</b> 항목은 prompts.js(또는 편집기 반영)에서 이 양식에 자동으로 들어갑니다. 여기 목록엔 안 보여도 생성에는 늘 반영됩니다.</p>${rows}`;
}
function renderCommon(){
  const P = activePreset();
  if(!P.common) P.common = [];
  const openSet = window.__commonOpen || (window.__commonOpen = new Set());
  const inherited = inheritedCommonHtml();
  const ownHtml = P.common.map((c,i)=>`
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
    </details>`).join('');
  const emptyMsg = (!ownHtml && !inherited)
    ? '<div class="empty" style="padding:18px"><b>아직 없습니다</b>+ 로 추가하거나, ST 프리셋을 가져오면 여기로 들어옵니다.</div>'
    : (!ownHtml ? '<p class="note" style="margin:8px 0 0">이 양식만의 공통 지시문은 아직 없습니다. + 로 추가할 수 있어요.</p>' : '');
  $('#commonBox').innerHTML = inherited + ownHtml + emptyMsg;
  $('#commonBox').querySelectorAll('.stitem:not(.inherited)').forEach(el=>{
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

