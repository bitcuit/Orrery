"use strict";
/* Orrery · 연결 · 백업 · 실행 기록 */
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
const CONN_OPEN = new Set();
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
    const open = CONN_OPEN.has(c.id);
    return `<div class="conn ${c.id===S.activeConn?'on':''} ${open?'open':''}" data-id="${c.id}">
      <div class="conn-h">
        <button class="c-chev" aria-label="펼치기/접기">▶</button>
        <span class="dot ${c._ok===true?'ok':c._ok===false?'no':''}"></span>
        <span class="cn">${esc(c.name)}</span>
        <span class="c-sum">${esc(p.label||c.provider||'')}${c.model?' · '+esc(c.model):''}</span>
        ${c.id===S.activeConn ? '<span class="c-use-state" title="현재 생성 작업에 사용하는 연결">쓰는 중</span>' : '<button class="mini ghost c-use">이걸로 쓰기</button>'}
        <button class="mini ghost c-test" title="실제 API를 1회 호출합니다 · 짧은 입력 · 응답 최대 24토큰 · 업체가 알려준 실제 사용량 표시">확인</button>
        <button class="iconbtn danger c-del" title="연결 삭제" aria-label="연결 삭제">${TRASH_SVG}</button>
      </div>
      <div class="conn-body">
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
  CONN_OPEN.add(c.id); // 새로 만든 연결은 바로 펼쳐서 입력하게
  save(); renderConns(); renderConnSel();
});
// 연결 카드 접기/펼치기 (헤더의 화살표·이름·요약 클릭)
$('#connList').addEventListener('click', e=>{
  if(e.target.closest('button:not(.c-chev)') || e.target.closest('select')) return;
  if(!e.target.closest('.c-chev') && !e.target.closest('.cn') && !e.target.closest('.c-sum')) return;
  const w = e.target.closest('.conn'); if(!w) return;
  const id = w.dataset.id;
  if(CONN_OPEN.has(id)) CONN_OPEN.delete(id); else CONN_OPEN.add(id);
  w.classList.toggle('open');
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
    convertPrefs();
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

