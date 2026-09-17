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
  renderConnectionAction();
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
  $('#btnConnExport').disabled=!S.connections.length;
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
      </div>
      <div class="row">
        <div class="field"><label class="fl">모델</label>
          <input class="c-model" value="${esc(c.model||'')}" list="ml-${c.id}" placeholder="모델 이름">
          <datalist id="ml-${c.id}">${(c._models||p.mlist||[]).map(m=>`<option value="${esc(m)}">`).join('')}</datalist>
        </div>
        <div class="field" style="flex:0 0 150px"><label class="fl">&nbsp;</label>
          <button class="ghost c-models" style="width:100%">모델 목록 받기</button></div>
      </div>
      <details class="adv conn-advanced" ${c.provider==='custom'||c.provider==='local'?'open':''}>
      <summary>세부 연결 설정 · 주소와 응답 길이</summary>
      <div class="field"><label class="fl">주소 (비우면 기본값)</label>
        <input class="c-url" value="${esc(c.baseUrl||'')}" placeholder="${esc(p.base||'')}"></div>
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
      </details>
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
  const task=beginTask(); if(!task) return;
  busy(btn, true, '확인 중');
  try{
    const out = await callProvider(c, [{role:'user',content:'"확인"이라고만 답하라.'}], {maxTokens:24, temperature:0, connectionOverrides:false});
    c._ok = true;
    c._lastTest = {at:Date.now(), ok:true, usage:LAST_USAGE ? clone(LAST_USAGE) : null};
    toast(LAST_USAGE ? '연결됐습니다 · '+usageLabel(LAST_USAGE) : '연결됐습니다 — '+out.trim().slice(0,30));
  }catch(err){ c._ok = false; c._lastTest={at:Date.now(),ok:false,usage:null}; showErr(err); }
  finally{ busy(btn,false); endTask(task); save(); renderConns(); renderConnSel(); }
}

$('#btnConnHelp').addEventListener('click', ()=>{ $('#connHelp').hidden = false; });
$('#connHelpClose').addEventListener('click', ()=>{ $('#connHelp').hidden = true; });
$('#connHelp').addEventListener('click', e=>{ if(e.target.id==='connHelp') $('#connHelp').hidden = true; });
$('#btnCopyCmd').addEventListener('click', ()=> copy($('#serveCmd').textContent));
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ if(!$('#welcomeModal').hidden){ $('#welcomeModal').hidden=true; } if(!$('#libViewModal').hidden){ $('#libViewModal').hidden=true; } if(!$('#connHelp').hidden) $('#connHelp').hidden=true; if(!$('#assetCompare').hidden) $('#assetCompare').hidden=true; if(!$('#assetFolderModal').hidden) closeAssetFolderModal(); if(!$('#assetClearModal').hidden) closeAssetClearModal(); if(!$('#backupModal').hidden) $('#backupModal').hidden=true; } });

$('#btnTest').addEventListener('click', async e=>{
  const c = connById(S.activeConn);
  if(!c) return toast('먼저 연결을 만들어 주세요',1);
  await testConn(c, e.currentTarget);
  $('#connDot').className = 'dot '+(c._ok?'ok':'no');
});
$('#connSel').addEventListener('change', e=>{ S.activeConn = e.target.value; save(); renderConns(); renderConnSel(); });

function backupConnections(includeKeys){
  return S.connections.map(c=>{
    const out=clone(c);
    delete out._ok; delete out._lastTest; delete out._models;
    if(!includeKeys) delete out.apiKey;
    return out;
  });
}
function readConnectionBackup(data){
  if(!data || data.app!=='Orrery' || !Array.isArray(data.connections) || !data.connections.length)
    throw new Error('API 연결이 포함된 Orrery 백업 파일을 골라 주세요.');
  const seen=new Set();
  return data.connections.map(c=>{
    if(!c || typeof c!=='object' || Array.isArray(c) || typeof c.id!=='string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(c.id) || seen.has(c.id)
      || !PROV_ORDER.includes(c.provider)) throw new Error('연결 형식이나 종류가 올바르지 않습니다.');
    seen.add(c.id);
    const out={id:c.id,provider:c.provider};
    for(const key of ['name','model','baseUrl','apiKey','project','location']){
      if(c[key]==null) continue;
      if(typeof c[key]!=='string') throw new Error('연결 설정의 문자열 형식이 올바르지 않습니다.');
      out[key]=c[key];
    }
    out.name=out.name||PROV[c.provider].label; out.model=out.model||'';
    for(const key of ['maxTokens','contextLimit','temperature','topP']){
      if(c[key]==null) continue;
      if(typeof c[key]!=='number' || !Number.isFinite(c[key]) || c[key]<0)
        throw new Error('연결 설정의 숫자 형식이 올바르지 않습니다.');
      out[key]=c[key];
    }
    return out;
  });
}
function makeConnectionBackup(){
  return {app:'Orrery',type:'connections',backupVersion:1,exportedAt:new Date().toISOString(),
    includes:{apiKeys:true},connections:backupConnections(true),activeConn:S.activeConn};
}
function importConnectionBackup(data){
  if(!canChangeWork()) return false;
  const incoming=readConnectionBackup(data);
  const existing=new Map(S.connections.map(c=>[c.id,c]));
  const updated=incoming.filter(c=>existing.has(c.id)).length, added=incoming.length-updated;
  if(updated && !confirm(`연결 ${added}개 추가, ${updated}개 갱신\n같은 연결의 설정과 포함된 API 키를 바꿀까요?`)) return false;
  const next=S.connections.map(c=>clone(c)), indexes=new Map(next.map((c,i)=>[c.id,i]));
  for(const c of incoming){
    const old=existing.get(c.id);
    if(!Object.prototype.hasOwnProperty.call(c,'apiKey') || data.includes?.apiKeys===false) c.apiKey=old?.apiKey||'';
    if(indexes.has(c.id)) next[indexes.get(c.id)]=c; else next.push(c);
  }
  S.connections=next;
  if(!next.some(c=>c.id===S.activeConn)) S.activeConn=incoming.find(c=>c.id===data.activeConn)?.id||incoming[0].id;
  const saved=save(); renderConns(); renderConnSel();
  if(saved) toast(`API 연결 ${added}개 추가 · ${updated}개 갱신`);
  return true;
}
$('#btnConnExport').addEventListener('click',()=>{
  if(!S.connections.length) return toast('백업할 API 연결이 없습니다',1);
  dl(`orrery-connections-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(makeConnectionBackup(),null,2));
  toast('API 키를 포함한 연결 백업을 만들었습니다');
});
$('#btnConnImport').addEventListener('click',()=>{ if(canChangeWork()) $('#connBackupFile').click(); });
$('#connBackupFile').addEventListener('change',async e=>{
  const file=e.target.files[0]; e.target.value='';
  if(!file || !canChangeWork()) return;
  try{
    const data=JSON.parse(await file.text());
    importConnectionBackup(data);
  }catch(err){ toast('연결 불러오기 실패: '+(err instanceof SyntaxError?'올바른 JSON 파일이 아닙니다.':err.message),1); }
});
function makeBackup(options){
  flushCardEdits();
  syncActiveWorkspace();
  const o=Object.assign({assets:true,project:true,chat:true,apiKeys:false,connections:true,presets:true,settings:true,library:true},options||{});
  const out={
    app:'Orrery', backupVersion:2, exportedAt:new Date().toISOString(),
    includes:{...o,logs:false}
  };
  if(o.connections||o.apiKeys){out.connections=backupConnections(o.apiKeys);out.activeConn=S.activeConn;}
  if(o.presets){out.presets=clone(S.presets);out.activePreset=S.activePreset;out.commonPrompts=clone(builtinCommon());}
  if(o.settings){out.opts=clone(S.opts);out.customTalkPrompts=clone(S.customTalkPrompts||{});}
  if(o.library)out.library=clone(S.library);
  if(o.assets){
    out.assets=S.assets.map(a=>clone(normalizeAssetMetadata(a)));
    out.assetFolders=clone(S.assetFolders||[]);
  }
  if(o.project){
    out.project=clone(S.project);
    out.workspaces=clone(S.workspaces);out.activeWorkspaceId=S.activeWorkspaceId;
    for(const w of out.workspaces){
      if(!o.chat)delete w.snapshot.chat;
      if(!o.assets)delete w.snapshot.materials;
      if(!o.presets)delete w.snapshot.presets;
    }
    // Work options are required to restore its inputs and generation mode.
    if(!out.opts)out.workOpts=clone(S.opts);
    out.continueNote=$('#continueNote').value; out.rerollNote=$('#rerollNote').value;
  }
  if(o.chat)out.chat=clone(S.chat);
  return out;
}
$('#btnDataExport').addEventListener('click', ()=>{ $('#backupModal').hidden=false; });
$('#btnBackup').addEventListener('click',()=>$('#backupModal').hidden=false);
$('#backupImport').addEventListener('click',()=>{ $('#backupModal').hidden=true;$('#dataFile').click(); });
$('#backupClose').addEventListener('click', ()=>{ $('#backupModal').hidden=true; });
$('#backupModal').addEventListener('click', e=>{ if(e.target.id==='backupModal') $('#backupModal').hidden=true; });
$('#backupDownload').addEventListener('click', ()=>{
  const data=makeBackup({
    assets:$('#backupAssets').checked, project:$('#backupProject').checked,
    chat:$('#backupChat').checked, apiKeys:$('#backupKeys').checked,
    connections:$('#backupConnections').checked,presets:$('#backupPresets').checked,
    settings:$('#backupSettings').checked,library:$('#backupLibrary').checked
  });
  const day=new Date().toISOString().slice(0,10);
  dl(`orrery-backup-${day}.json`,JSON.stringify(data,null,2));
  $('#backupModal').hidden=true;
  toast('백업 파일을 만들었습니다 · 실행 로그는 제외했습니다');
});
$('#btnDataImport').addEventListener('click', ()=> $('#dataFile').click());
$('#dataFile').addEventListener('change', async e=>{
  const f = e.target.files[0]; e.target.value=''; if(!f) return;
  if(!canChangeWork()) return;
  let previous=null;
  try{
    const d = JSON.parse(await f.text());
    if(!canChangeWork()) return;
    if(d?.type==='connections'){ importConnectionBackup(d); return; }
    flushCardEdits();
    if(!d || typeof d!=='object' || !(d.connections || d.presets || d.library || d.assets || d.favoriteAssets || d.project || d.chat || (d.app==='Orrery'&&(d.opts||d.customTalkPrompts))))
      throw new Error('Orrery 백업 파일이 아닙니다.');
    for(const key of ['connections','presets','library','assets','favoriteAssets','assetFolders','workspaces']){
      if(d[key]!=null && (!Array.isArray(d[key]) || d[key].some(v=>!v || typeof v!=='object' || Array.isArray(v))))
        throw new Error('백업의 목록 형식이 올바르지 않습니다.');
    }
    for(const key of ['opts','workOpts','project','chat','customTalkPrompts']){
      if(d[key]!=null && (typeof d[key]!=='object' || Array.isArray(d[key])))
        throw new Error('백업의 설정 형식이 올바르지 않습니다.');
    }
    if(d.connections?.length) d.connections=readConnectionBackup({app:'Orrery',connections:d.connections});
    if(d.commonPrompts!=null&&(!Array.isArray(d.commonPrompts)||d.commonPrompts.some(p=>!p||typeof p.content!=='string')))throw new Error('공통 지시문 형식이 올바르지 않습니다.');
    if(d.workspaces?.some(w=>typeof w.id!=='string'||!w.snapshot?.project||!w.snapshot?.opts||!w.snapshot?.activePreset)) throw new Error('저장 작업의 형식이 올바르지 않습니다.');
    if(WORKSPACE_JOBS.size) throw new Error('생성 중인 작업을 마치거나 중지한 뒤 백업을 불러와 주세요.');
    if(!confirm('백업에 포함된 항목을 현재 데이터에 덮어쓸까요?\n백업에서 제외된 항목은 현재 상태를 유지합니다.')) return;
    previous={state:clone(S),continueNote:$('#continueNote').value,rerollNote:$('#rerollNote').value,common:localStorage.getItem(COMMON_EXTRA_KEY)};
    const currentKeys=new Map(S.connections.map(c=>[c.id,c.apiKey||'']));
    const backupHasKeys=d.includes
      ? !!d.includes.apiKeys
      : !!(d.connections&&d.connections.some(c=>Object.prototype.hasOwnProperty.call(c,'apiKey')));
    if(d.connections) S.connections = d.connections.map(c=>{
      const out=clone(c); delete out._ok; delete out._lastTest; delete out._models;
      if(!backupHasKeys || out.apiKey==null) out.apiKey=currentKeys.get(out.id)||'';
      return out;
    });
    const preserveWork=!d.project && hasDraftWork();
    const protectedPresetIds=new Set(preserveWork
      ? [S.activePreset,...Object.values(S.project.workBy||{}).map(w=>w.presetId)] : []);
    const protectedPresets=S.presets.filter(p=>protectedPresetIds.has(p.id));
    if(d.presets && d.presets.length){
      S.presets=clone(d.presets).filter(p=>!protectedPresetIds.has(p.id)).concat(protectedPresets);
    }
    if(d.opts && !preserveWork) Object.assign(S.opts, d.opts);
    if(d.project&&d.workOpts)Object.assign(S.opts,d.workOpts);
    convertPrefs();
    if(S.opts.mode==='c2p') S.opts.mode='foil';
    if(!S.opts.modeBy) S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'};
    if(d.library) S.library = d.library.map(r=>Object.assign({
      star:false, group:'character', presetName:'', updated:r.at||Date.now() }, r));
    if(Array.isArray(d.assets)){
      S.assets=d.assets.map(a=>normalizeAssetMetadata(clone(a)));
      S.assetFolders=Array.isArray(d.assetFolders)?clone(d.assetFolders):[];
      EDIT_ASSETS.clear(); EDIT_BASELINE.clear(); EDIT_WAS_DIRTY.clear();
    }else if(Array.isArray(d.favoriteAssets)){
      S.assets=mergeAssetsWithFavorites(S.assets,d.favoriteAssets);
      if(Array.isArray(d.assetFolders)) S.assetFolders=clone(d.assetFolders);
    }
    normalizeAssetFolders();
    if(d.project){ S.project=Object.assign({
      digest:null,digestSrc:'',seeds:[],sel:[],card:null,locked:{},violations:null,verdict:null,
      cast:[],relations:null,qa:[],libId:null,digestBy:{},digestMeta:null,workBy:{}
    },clone(d.project));
      $('#continueNote').value=typeof d.continueNote==='string'?d.continueNote:'';
      $('#rerollNote').value=typeof d.rerollNote==='string'?d.rerollNote:'';
      if(d.workspaces){
        const imported=clone(d.workspaces);S.activeWorkspaceId=null;
        for(const w of imported){
          const wasActive=w.id===d.activeWorkspaceId;w.id=uid();delete w.pendingApply;
          if(w.status==='running')w.status='interrupted';
          if(wasActive)S.activeWorkspaceId=w.id;
          holdNewWorkspace(w);
        }
        S.workspaces.push(...imported);
      }
      else S.activeWorkspaceId=null;
    }
    if(d.chat){
      S.chat=Object.assign({role:'world',msgs:[],ctx:{assets:true,digest:true,card:false}},clone(d.chat));
      S.chat.ctx=Object.assign({assets:true,digest:true,card:false},S.chat.ctx||{});
    }
    if(d.customTalkPrompts) S.customTalkPrompts=clone(d.customTalkPrompts);
    if(d.commonPrompts)localStorage.setItem(COMMON_EXTRA_KEY,JSON.stringify(normCommon(d.commonPrompts)));
    if(S.connections.some(c=>c.id===d.activeConn)) S.activeConn=d.activeConn;
    else if(!S.connections.some(c=>c.id===S.activeConn)) S.activeConn=S.connections[0]?.id||null;
    if(!preserveWork) S.activePreset = d.activePreset || S.presets[0].id;
    if(!S.presets.some(p=>p.id===S.activePreset)) S.activePreset=(presetsInGroup(S.opts.group)[0]||S.presets[0]).id;
    bootUI(); const saved=save();
    if(Array.isArray(d.assets) || d.project) touchDraft();
    if(saved) toast('백업을 불러왔습니다');
  }catch(err){
    if(previous){
      S=previous.state;
      if(previous.common===null)localStorage.removeItem(COMMON_EXTRA_KEY);else localStorage.setItem(COMMON_EXTRA_KEY,previous.common);
      $('#continueNote').value=previous.continueNote; $('#rerollNote').value=previous.rerollNote;
      bootUI(); save(); touchDraft();
    }
    toast('가져오기 실패: '+(err instanceof SyntaxError?'올바른 JSON 파일이 아닙니다.':err.message),1);
  }
});

/* --- 기록 --- */
$('#btnLogCopy').addEventListener('click', ()=> copy(LOG.map(l=>`[${l.ts}] ${l.msg}`).join('\n')));
$('#btnLogClear').addEventListener('click', ()=>{ LOG=[]; renderLog(); });
$('#logVerbose').addEventListener('change', e=>{ S.logVerbose = e.target.checked; save(); });

