/* Named work sessions and isolated, page-lifetime generation jobs. */
const WORKSPACE_JOBS=new Map();
let WORKER_PORT=null, WORKSPACE_RESTORING=false;
const WORKSPACE_PREFIX='orrery.work.v1.';
const OWNED_WORKSPACES=new Set(), WORKSPACE_LOCKS=new Map();
const RECORD_PREFIX='orrery.record.v1.', RECORD_BASELINE=new Map();
function loadSharedRecords(){
  if(WORKER_WINDOW)return;
  const all=new Map(S.library.map(r=>[r.id,r]));
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key?.startsWith(RECORD_PREFIX))continue;
    try{const r=JSON.parse(localStorage.getItem(key));if(r?.deleted)all.delete(r.id);else if(r?.id&&r.fields)all.set(r.id,r);}catch(_){}
  }
  S.library=[...all.values()];RECORD_BASELINE.clear();
  for(const r of S.library)RECORD_BASELINE.set(r.id,JSON.stringify(r));
}
function persistSharedRecords(){
  if(WORKER_WINDOW)return;
  const current=new Map(S.library.map(r=>[r.id,JSON.stringify(r)]));
  for(const [id,text] of current){
    if(RECORD_BASELINE.get(id)!==text||localStorage.getItem(RECORD_PREFIX+id)===null)localStorage.setItem(RECORD_PREFIX+id,text);
  }
  for(const id of RECORD_BASELINE.keys())if(!current.has(id))localStorage.setItem(RECORD_PREFIX+id,JSON.stringify({id,deleted:true}));
  RECORD_BASELINE.clear();for(const [id,text] of current)RECORD_BASELINE.set(id,text);
}
function holdNewWorkspace(w){
  OWNED_WORKSPACES.add(w.id);
  if(navigator.locks?.request) navigator.locks.request('orrery-work-'+w.id,lock=>new Promise(release=>WORKSPACE_LOCKS.set(w.id,release))).catch(()=>{});
}
function loadSharedWorkspaces(){
  if(WORKER_WINDOW) return;
  const all=new Map(S.workspaces.map(w=>[w.id,w]));
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key?.startsWith(WORKSPACE_PREFIX)) continue;
    // 창별 사본이 앱 저장본보다 오래됐으면 쓰지 않는다(옛 사본이 최신 작업을 덮어써 지운 구상·재료가 되살아나던 문제)
    try{const w=JSON.parse(localStorage.getItem(key));if(w?.deleted)all.delete(w.id);else if(w?.snapshot?.project&&w.snapshot.opts&&!((all.get(w.id)?.updated||0)>(w.updated||0)))all.set(w.id,w);}catch(_){}
  }
  S.workspaces=[...all.values()];
}
function persistOwnedWorkspaces(){
  if(WORKER_WINDOW) return;
  for(const w of S.workspaces) if(OWNED_WORKSPACES.has(w.id)) localStorage.setItem(WORKSPACE_PREFIX+w.id,JSON.stringify(w));
}
async function claimWorkspace(w){
  if(OWNED_WORKSPACES.has(w.id)) return w;
  let acquired=false;
  if(navigator.locks?.request){
    acquired=await new Promise(resolve=>{
      navigator.locks.request('orrery-work-'+w.id,{ifAvailable:true},lock=>{
        if(!lock){resolve(false);return;}
        OWNED_WORKSPACES.add(w.id);resolve(true);
        return new Promise(release=>WORKSPACE_LOCKS.set(w.id,release));
      }).catch(()=>resolve(false));
    });
  }else if(typeof MessageChannel!=='function'){
    // Non-browser test runtimes have neither inter-window execution nor locks.
    OWNED_WORKSPACES.add(w.id);acquired=true;
  }
  if(acquired){
    if(w.status==='running'&&!WORKSPACE_JOBS.has(w.id)){w.status='interrupted';w.message='페이지가 닫혀 완료 여부를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다.';}
    return w;
  }
  const copy=clone(w);copy.id=uid();copy.name+=' · 복사본';copy.status='saved';delete copy.pendingApply;
  copy.snapshot.project.libId=null;
  for(const item of Object.values(copy.snapshot.project.workBy||{}))if(item.project)item.project.libId=null;
  copy.updated=Date.now();S.workspaces.push(copy);holdNewWorkspace(copy);
  toast('다른 창의 작업을 덮어쓰지 않도록 복사본으로 열었습니다');return copy;
}
function claimInitialWorkspace(){
  const id=S.activeWorkspaceId,w=workspaceById(id);if(!w)return;
  claimWorkspace(w).then(owned=>{if(S.activeWorkspaceId===id){S.activeWorkspaceId=owned.id;syncActiveWorkspace();save();renderWorkspaces();}});
}
window.addEventListener('storage',e=>{
  if(WORKER_WINDOW)return;
  if(e.key?.startsWith(RECORD_PREFIX)){
    try{
      const r=JSON.parse(e.newValue);if(!r?.id)return;
      const at=S.library.findIndex(x=>x.id===r.id);
      if(r.deleted){if(at>=0)S.library.splice(at,1);RECORD_BASELINE.delete(r.id);}
      else if(r.fields){if(at>=0)S.library[at]=r;else S.library.push(r);RECORD_BASELINE.set(r.id,JSON.stringify(r));}
      renderLib();
    }catch(_){}return;
  }
  if(!e.key?.startsWith(WORKSPACE_PREFIX))return;
  try{
    const w=JSON.parse(e.newValue);if(!w||OWNED_WORKSPACES.has(w.id))return;
    const at=S.workspaces.findIndex(x=>x.id===w.id);
    if(w.deleted){if(at>=0)S.workspaces.splice(at,1);}
    else if(w.snapshot?.project&&w.snapshot.opts){if(at>=0)S.workspaces[at]=w;else S.workspaces.push(w);}
    renderWorkspaces();
  }catch(_){}
});
const BACKGROUND_ACTIONS=new Set(['btnDigest','btnSeeds','btnCross','btnExpand','btnOneShot','btnReroll','btnContinue','btnCheck','btnCast','btnRelate','btnConvert']);
function workspaceById(id){ return S.workspaces.find(w=>w.id===id); }
function currentWorkspaceJob(){ return WORKER_WINDOW?null:WORKSPACE_JOBS.get(S.activeWorkspaceId)||null; }
function captureWorkspace(){
  const ids=new Set([S.activePreset,...Object.values(S.project.workBy||{}).map(w=>w.presetId)]);
  return {version:1,opts:clone(S.opts),project:clone(S.project),activePreset:S.activePreset,
    presets:clone(S.presets.filter(p=>ids.has(p.id))),materials:clone(S.assets.filter(a=>a.use)),
    chats:clone(chatList()),chatId:S.chatId,continueNote:$('#continueNote').value,rerollNote:$('#rerollNote').value};
}
function syncActiveWorkspace(){
  if(WORKER_WINDOW || WORKSPACE_RESTORING) return;
  const w=workspaceById(S.activeWorkspaceId); if(!w) return;
  const snapshot=captureWorkspace();
  if(w.pendingApply){snapshot.project=w.snapshot.project;snapshot.continueNote=w.snapshot.continueNote;snapshot.rerollNote=w.snapshot.rerollNote;}
  w.snapshot=snapshot; w.updated=Date.now();
}
function ensureWorkspace(){
  let w=workspaceById(S.activeWorkspaceId);
  if(!w){
    w={id:uid(),name:(curBrief().trim().slice(0,32)||(GROUP_LABEL[S.opts.group]||'새')+' 작업'),updated:Date.now(),snapshot:captureWorkspace(),status:'saved'};
    S.workspaces.push(w);S.activeWorkspaceId=w.id;holdNewWorkspace(w);
  }
  return w;
}
function installWorkspace(snapshot){
  WORKSPACE_RESTORING=true;
  try{
    S.opts=clone(snapshot.opts);S.project=Object.assign({},emptyWork(),{digestBy:{},workBy:{}},clone(snapshot.project));
    S.activePreset=snapshot.activePreset;
    for(const p of snapshot.presets||[]){
      const at=S.presets.findIndex(x=>x.id===p.id);
      if(at<0) S.presets.push(clone(p));else S.presets[at]=clone(p);
    }
    const materials=new Map((snapshot.materials||[]).map(a=>[a.id,clone(a)]));
    // 저장 작업 뒤에 지운 재료는 되살리지 않는다(지운 재료가 다시 켜져 요청에 섞이던 문제)
    S.assets=S.assets.map(a=>materials.get(a.id)||{...a,use:false});
    if(Array.isArray(snapshot.chats)&&snapshot.chats.length){
      S.chats=snapshot.chats.map(c=>normalizeChat(clone(c),S.opts.group));
      S.chatId=S.chats.some(c=>c.id===snapshot.chatId)?snapshot.chatId:S.chats[0].id;
    } else if(snapshot.chat){ S.chats=[normalizeChat(clone(snapshot.chat),S.opts.group)]; S.chatId=S.chats[0].id; }
    $('#continueNote').value=snapshot.continueNote||'';$('#rerollNote').value=snapshot.rerollNote||'';
    OPEN_DONE_STAGE=null;CLOSED_DONE_STAGE=null;
  }finally{WORKSPACE_RESTORING=false;}
}
function restoreActiveWorkspace(){
  const w=workspaceById(S.activeWorkspaceId);if(w){installWorkspace(w.snapshot);delete w.pendingApply;}
}
function checkpointWorkspace(name){
  flushCardEdits();const w=ensureWorkspace();
  if(typeof name==='string'&&name.trim()) w.name=name.trim().slice(0,100);
  syncActiveWorkspace();return save();
}
async function openWorkspace(id){
  if(!canChangeWork(true)) return false;
  let next=workspaceById(id);if(!next) return false;
  if(!checkpointWorkspace()) return false;
  next=await claimWorkspace(next);
  if(!canChangeWork(true)) return false;
  S.activeWorkspaceId=next.id;installWorkspace(next.snapshot);delete next.pendingApply;bootUI();save();touchDraft();saveDraftNow();
  $('#workspaceModal').hidden=true;tab('studio');return true;
}
function createWorkspace(){
  if(!canChangeWork(true)) return false;
  if((hasDraftWork()||S.activeWorkspaceId)&&!checkpointWorkspace())return false;
  const g=S.opts.group;
  S.activeWorkspaceId=null;
  S.opts.briefBy[g]='';S.opts.extraBy[g]='';convertPrefs().extraBy[g]='';
  S.project.digestBy[g]=null;delete S.project.workBy[g];
  Object.assign(S.project,emptyWork(),{screen:'input'});
  S.assets.forEach(a=>{ a.use=false; }); S.library.forEach(r=>{ r.use=false; });
  $('#optBrief').value='';$('#continueNote').value='';$('#rerollNote').value='';
  // Each work owns its conversations. Other group work is retained in the saved prior session.
  S.chats=[emptyChat(g)]; S.chatId=S.chats[0].id;
  OPEN_DONE_STAGE=null;CLOSED_DONE_STAGE=null;
  const w=ensureWorkspace();w.name=(GROUP_LABEL[g]||'새')+' 작업 '+S.workspaces.length;
  bootUI();save();touchDraft();saveDraftNow();$('#workspaceModal').hidden=true;tab('studio');return true;
}
function renderWorkspaces(){
  const active=workspaceById(S.activeWorkspaceId);
  if(document.activeElement!==$('#workspaceName')) $('#workspaceName').value=active?.name||'';
  const labels={running:'생성 중',complete:'완료',failed:'실패 · 다시 열기',interrupted:'중단됨',saved:'저장됨'};
  for(const id of [...WORK_PICKED]) if(!workspaceById(id)||WORKSPACE_JOBS.has(id)) WORK_PICKED.delete(id);
  $('#workspaceBulk').hidden=!WORK_PICKED.size; $('#workspaceBulkCount').textContent=`선택 ${WORK_PICKED.size}개`;
  $('#workspaceList').innerHTML=workspaceOrder().map(w=>
    `<div class="workspace-row${WORK_PICKED.has(w.id)?' picked':''}">${WORKSPACE_JOBS.has(w.id)?'<span class="work-pick-gap"></span>':`<input type="checkbox" class="work-pick" data-work-pick="${esc(w.id)}" ${WORK_PICKED.has(w.id)?'checked':''} aria-label="${esc(w.name)} 고르기">`}<div><b>${esc(w.name)}</b><span class="note">${w.id===S.activeWorkspaceId?'현재 작업 · ':''}${esc(labels[w.status]||'저장됨')} · ${esc(new Date(w.updated).toLocaleString('ko-KR'))}</span>${w.message?`<span class="note">${esc(w.message)}</span>`:''}</div><div class="bar"><button class="mini" data-work-open="${esc(w.id)}">열기</button>${WORKSPACE_JOBS.has(w.id)?`<button class="mini" data-work-stop="${esc(w.id)}">중지</button>`:`<button class="mini ghost" data-work-delete="${esc(w.id)}">삭제</button>`}</div></div>`).join('');
}
$('#btnWorkspaces').addEventListener('click',()=>{checkpointWorkspace();renderWorkspaces();$('#workspaceModal').hidden=false;});
$('#workspaceClose').addEventListener('click',()=>$('#workspaceModal').hidden=true);
$('#workspaceModal').addEventListener('click',e=>{if(e.target.id==='workspaceModal') e.target.hidden=true;});
$('#workspaceSave').addEventListener('click',()=>{if(checkpointWorkspace($('#workspaceName').value)){renderWorkspaces();toast('작업 과정을 저장했습니다');}});
$('#workspaceNew').addEventListener('click',createWorkspace);
/* 여러 개 골라 지우기 — 체크(클릭) · Shift+클릭 범위 · 완료·저장된 것 한 번에 고르기 · Delete 키 */
const WORK_PICKED=new Set(); let WORK_PICK_LAST=null;
function workspaceOrder(){ return [...S.workspaces].sort((a,b)=>b.updated-a.updated); }
$('#workspaceList').addEventListener('click',e=>{
  const pick=e.target.closest('.work-pick');
  if(pick){
    const id=pick.dataset.workPick, list=workspaceOrder().filter(w=>!WORKSPACE_JOBS.has(w.id)).map(w=>w.id);
    if(e.shiftKey&&WORK_PICK_LAST&&list.includes(WORK_PICK_LAST)){
      const [a,b]=[list.indexOf(WORK_PICK_LAST),list.indexOf(id)].sort((x,y)=>x-y);
      list.slice(a,b+1).forEach(x=>pick.checked?WORK_PICKED.add(x):WORK_PICKED.delete(x));
    } else pick.checked?WORK_PICKED.add(id):WORK_PICKED.delete(id);
    WORK_PICK_LAST=id; renderWorkspaces(); return;
  }
  const button=e.target.closest('button');if(!button) return;
  if(button.dataset.workOpen) openWorkspace(button.dataset.workOpen);
  if(button.dataset.workStop) stopWorkspaceJob(button.dataset.workStop);
  const id=button.dataset.workDelete;
  if(id&&!WORKSPACE_JOBS.has(id)) deleteWorkspaces([id]);
});
$('#workspacePickDone').addEventListener('click',()=>{
  // 끝난 작업만: 완료·저장됨·중단됨. 지금 작업과 생성 중인 것은 빼고
  S.workspaces.filter(w=>w.id!==S.activeWorkspaceId&&!WORKSPACE_JOBS.has(w.id)&&['complete','saved','interrupted','failed',undefined].includes(w.status)).forEach(w=>WORK_PICKED.add(w.id));
  renderWorkspaces();
});
$('#workspacePickNone').addEventListener('click',()=>{ WORK_PICKED.clear(); renderWorkspaces(); });
$('#workspaceBulkDelete').addEventListener('click',()=>deleteWorkspaces([...WORK_PICKED]));
$('#workspaceModal').addEventListener('keydown',e=>{
  if(e.key!=='Delete'||!WORK_PICKED.size||e.target.closest('input:not([type=checkbox]),textarea,select')) return;
  e.preventDefault(); deleteWorkspaces([...WORK_PICKED]);
});
// 다른 창이 실제로 열어 둔 작업만 막는다. 안 열려 있으면(대부분) 바로 지운다
async function lockForDelete(id){
  if(OWNED_WORKSPACES.has(id)||!navigator.locks?.request) return true;
  return new Promise(resolve=>{
    navigator.locks.request('orrery-work-'+id,{ifAvailable:true},lock=>{
      if(!lock){resolve(false);return;}
      OWNED_WORKSPACES.add(id);resolve(true);
      return new Promise(release=>WORKSPACE_LOCKS.set(id,release));
    }).catch(()=>resolve(true));
  });
}
// 작업만 지운다. 만든 결과(성도 기록)는 남는다. 다른 창이 열어 둔 작업은 건너뛴다
async function deleteWorkspaces(ids){
  ids=ids.filter(id=>workspaceById(id)&&!WORKSPACE_JOBS.has(id)); if(!ids.length) return;
  const what=ids.length===1?`“${workspaceById(ids[0]).name}” 작업을`:`고른 작업 ${ids.length}개를`;
  if(!confirm(`${what} 삭제할까요? 그 작업의 구상·정리·후보·대화창이 지워집니다. 만든 결과(성도 기록)는 남습니다.`)) return;
  let done=0, locked=0;
  for(const id of ids){
    if(!await lockForDelete(id)){ locked++; continue; }
    WORKSPACE_LOCKS.get(id)?.();WORKSPACE_LOCKS.delete(id);OWNED_WORKSPACES.delete(id);
    try{localStorage.setItem(WORKSPACE_PREFIX+id,JSON.stringify({id,deleted:true}));}catch(_){toast('삭제 내용을 저장하지 못했습니다',1);break;}
    S.workspaces=S.workspaces.filter(w=>w.id!==id);if(S.activeWorkspaceId===id) S.activeWorkspaceId=null;
    WORK_PICKED.delete(id); done++;
  }
  save();touchDraft();renderWorkspaces();
  if(locked) toast(`${done}개를 지웠습니다 · ${locked}개는 다른 창에서 열려 있어 남겼습니다`,1);
  else if(done) toast(`${done}개 작업을 지웠습니다`);
}
function canRunInBackground(button){
  return !WORKER_WINDOW && typeof MessageChannel==='function' && BACKGROUND_ACTIONS.has(button?.id);
}
async function startWorkspaceJob(button,label){
  if(!canChangeWork(true)) return false;
  const before=workspaceById(S.activeWorkspaceId);
  let w=ensureWorkspace();if(WORKSPACE_JOBS.has(w.id)){toast('이 작업은 이미 생성 중입니다.',1);return false;}
  if(!OWNED_WORKSPACES.has(w.id)){w=await claimWorkspace(w);S.activeWorkspaceId=w.id;}
  if(WORKSPACE_JOBS.has(w.id))return false;
  if(!checkpointWorkspace()) return false;
  const state=clone(S);state.workspaces=[];state.activeWorkspaceId=null;
  state.runtimeCommons=clone(builtinCommon());
  const notes={continueNote:$('#continueNote').value,rerollNote:$('#rerollNote').value};
  const iframe=document.createElement('iframe');iframe.hidden=true;iframe.title='작업 실행';iframe.setAttribute('aria-hidden','true');
  const url=new URL(location.href);url.hash='orrery-worker';iframe.src=url.href;
  // created: 이 요청 때문에 목록에 새로 생긴 작업 · prevStatus: 실패하면 되돌릴 원래 상태
  const job={id:w.id,iframe,label,calls:0,cancelled:false,created:!before||before.id!==w.id,prevStatus:before&&before.id===w.id?before.status:'saved'};WORKSPACE_JOBS.set(w.id,job);
  w.status='running';w.message='';save();renderWorkspaces();renderStudioScreen();
  job.timer=setTimeout(()=>finishWorkspaceJob(job,{error:'작업 실행 화면을 열지 못했습니다.'}),15000);
  iframe.addEventListener('load',()=>{
    if(!WORKSPACE_JOBS.has(job.id)) return;
    const channel=new MessageChannel();job.port=channel.port1;
    job.port.onmessage=({data})=>{
      if(data.type==='started'){clearTimeout(job.timer);}
      else if(data.type==='progress'){job.label=data.label;job.calls=data.calls;if(S.activeWorkspaceId===job.id) renderStudioScreen();}
      else if(data.type==='finished') finishWorkspaceJob(job,data);
    };
    iframe.contentWindow.postMessage({type:'orrery-work-start',state,action:button.id,...notes},'*',[channel.port2]);
  },{once:true});
  document.body.append(iframe);return true;
}
function finishWorkspaceJob(job,data){
  if(WORKSPACE_JOBS.get(job.id)!==job) return;
  clearTimeout(job.timer);job.port?.close();job.iframe.remove();WORKSPACE_JOBS.delete(job.id);
  const w=workspaceById(job.id);if(!w) return;
  // Capture any chat progress in the parent before merging only the studio result.
  if(S.activeWorkspaceId===w.id) syncActiveWorkspace();
  if(data.snapshot){
    w.snapshot.project=data.snapshot.project;
    w.snapshot.continueNote=data.snapshot.continueNote;w.snapshot.rerollNote=data.snapshot.rerollNote;
  }
  for(const record of data.records||[]){const at=S.library.findIndex(r=>r.id===record.id);if(at<0)S.library.push(record);else S.library[at]=record;}
  const failed=job.cancelled||!!data.error, reason=data.error&&data.error!=='__ABORT__'?data.error:'';
  // 실패·중지는 목록에 남기지 않는다: 새로 생긴 작업은 지우고, 있던 작업은 원래 상태로 되돌린다
  w.status=failed?job.prevStatus:'complete';w.message='';w.updated=Date.now();
  w.pendingApply=S.activeWorkspaceId===w.id;
  // Do not replace a project object which an in-flight foreground chat is using.
  if(!ACTIVE_TASK) applyCompletedWorkspace();
  WORKSPACE_RESTORING=true;try{save();}finally{WORKSPACE_RESTORING=false;}
  if(failed&&job.created&&!w.pendingApply) dropFailedWorkspace(w);
  renderWorkspaces();toast(w.name+' · '+(!failed?'생성 완료':job.cancelled?'중지됨':'요청 실패'+(reason?' — '+reason:'')),failed&&!job.cancelled);
}
function dropFailedWorkspace(w){
  S.workspaces=S.workspaces.filter(x=>x.id!==w.id);
  if(S.activeWorkspaceId===w.id) S.activeWorkspaceId=null;
  OWNED_WORKSPACES.delete(w.id);WORKSPACE_LOCKS.get(w.id)?.();WORKSPACE_LOCKS.delete(w.id);
  try{localStorage.setItem(WORKSPACE_PREFIX+w.id,JSON.stringify({id:w.id,deleted:true}));}catch(_){}
  save();touchDraft();
}
function applyCompletedWorkspace(){
  const w=workspaceById(S.activeWorkspaceId);if(!w?.pendingApply) return;
  Object.assign(S.project,clone(w.snapshot.project));
  $('#continueNote').value=w.snapshot.continueNote||'';$('#rerollNote').value=w.snapshot.rerollNote||'';
  delete w.pendingApply;bootUI();touchDraft();saveDraftNow();
}
function stopWorkspaceJob(id){
  const job=WORKSPACE_JOBS.get(id);if(!job) return;
  job.cancelled=true;
  if(job.port) job.port.postMessage({type:'cancel'});else finishWorkspaceJob(job,{error:'__ABORT__'});
  if(id===S.activeWorkspaceId) renderStudioScreen();
}
$('#btnStopWorkspace').addEventListener('click',()=>stopWorkspaceJob(S.activeWorkspaceId));
function reportWorkspaceProgress(){
  if(WORKER_PORT&&ACTIVE_TASK) WORKER_PORT.postMessage({type:'progress',label:ACTIVE_TASK.label||'생성 중',calls:ACTIVE_TASK.calls||0});
}
function reportWorkspaceResult(task){
  if(!WORKER_PORT) return;
  WORKER_PORT.postMessage({type:'finished',snapshot:captureWorkspace(),records:S.library.filter(r=>task.initialRecords?.get(r.id)!==JSON.stringify(r)),error:task.error||''});
  WORKER_PORT=null;
}
if(WORKER_WINDOW) window.addEventListener('message',e=>{
  if(e.source!==parent || e.data?.type!=='orrery-work-start' || !e.ports[0] || WORKER_PORT) return;
  WORKER_PORT=e.ports[0];WORKER_PORT.onmessage=({data})=>{if(data.type==='cancel')abortCurrentCall();};
  try{
    // S 를 갈아끼우면 S.chat(지금 대화창을 가리키는 접근자)이 사라져 bootUI 가 죽는다. 값만 덮어쓴다
    Object.assign(S,e.data.state);$('#continueNote').value=e.data.continueNote||'';$('#rerollNote').value=e.data.rerollNote||'';
    bootUI();BOOTING=false;tab('studio');WORKER_PORT.postMessage({type:'started'});
    const button=$('#'+e.data.action);
    if(!button || button.disabled) throw new Error('이 단계는 실행할 수 없습니다.');
    button.click();
    if(!ACTIVE_TASK&&WORKER_PORT) throw new Error('요청을 시작하지 못했습니다. 연결과 입력을 확인해 주세요.');
  }catch(err){if(WORKER_PORT) WORKER_PORT.postMessage({type:'finished',error:err.message});}
});
window.addEventListener('beforeunload',e=>{
  if(WORKER_WINDOW) return;
  if(S.activeWorkspaceId){syncActiveWorkspace();save();}
  if(WORKSPACE_JOBS.size){e.preventDefault();e.returnValue='';}
});
