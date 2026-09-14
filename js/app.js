"use strict";
/* Orrery · 화면 시작 · 공통 상호작용 */
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
  if(name==='library'){ // 기록은 열 때마다 분류 '전부'·검색 초기화
    libFilter=''; libQuery='';
    if($('#libFilter')) $('#libFilter').value='';
    if($('#libSearch')) $('#libSearch').value='';
    renderLib();
  }
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('.topctl button[data-tab]').forEach(b=> b.addEventListener('click', ()=>tab(b.dataset.tab)));

/* 쉬운 모드 */
function applyEasy(){
  const on = !!S.opts.easy;
  document.body.classList.toggle('easy', on);
  const btn = $('#btnEasy');
  if(btn){ btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); }
  if(on && S.opts.buildMode!=='oneshot'){ S.opts.buildMode='oneshot'; if(typeof renderBuildMode==='function') renderBuildMode(); }
}
function setEasy(on){
  S.opts.easy = !!on;
  if(on) S.opts.buildMode='oneshot';
  applyEasy();
  if(typeof renderBuildMode==='function') renderBuildMode();
  if(typeof renderOneshot==='function') renderOneshot();
  save();
  toast(on ? '쉬운 모드 — 복잡한 기능을 감췄어요' : '쉬운 모드를 껐어요');
}
$('#btnEasy').addEventListener('click', ()=> setEasy(!S.opts.easy));

/* 첫 진입 온보딩 */
function openWelcome(){ $('#welcomeConnNote').hidden = !!S.connections.length; $('#welcomeModal').hidden = false; }
function closeWelcome(){ $('#welcomeModal').hidden = true; }
$('#welcomeClose').addEventListener('click', closeWelcome);
$('#welcomeModal').addEventListener('click', e=>{ if(e.target.id==='welcomeModal') closeWelcome(); });
$('#welcomeModal').addEventListener('click', e=>{
  const c = e.target.closest('.welcome-card'); if(!c) return;
  const g = c.dataset.group;
  if($('#welcomeEasy').checked){ S.opts.easy = true; }
  else { S.opts.easy = false; }
  S.opts.buildMode = S.opts.easy ? 'oneshot' : S.opts.buildMode;
  applyEasy();
  closeWelcome();
  if(g && g!==S.opts.group) applyGroup(g); else renderBuildMode();
  save();
  tab('studio');
  setTimeout(()=>{ const bf=$('#optBrief'); if(bf) bf.focus(); }, 200);
});

function bootUI(){
  convertPrefs();
  $('#optLang').value = S.opts.lang;
  $('#optTone').value = S.opts.tone;
  $('#optSeedN').value = S.opts.seedCount;
  $('#optCastN').value = S.opts.castCount;
  $('#optNsfw').value = S.opts.nsfw ? '1':'0';
  $('#optCheck').value = S.opts.check ? '1':'0';
  $('#logVerbose').checked = !!S.logVerbose;
  $('#optExtra').value = curExtra();
  renderReq();
  $('#optBrief').value = curBrief();
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
  applyEasy();
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
  if(LOAD_ERROR){
    setSaveState('저장 데이터 읽기 실패 · 복구본 보존됨','err',true);
    setTimeout(()=>toast('저장된 데이터를 읽지 못했습니다. 새 작업 전에 백업 상태를 확인해 주세요.',1),300);
  }
  setTimeout(()=>document.body.classList.remove('boot'), 900);
log('Orrery 궤도 진입. ' + (location.protocol==='file:'
    ? '파일에서 직접 열었습니다.'
    : '주소: '+location.origin));
  if(!had && !LOAD_ERROR){
    setTimeout(openWelcome, 500);
  }
  window.addEventListener('keydown', e=>{
    if(e.key==='Escape' && abortCurrentCall()) toast('요청을 멈추는 중입니다');
  });
  window.addEventListener('beforeunload', ()=>{ if(DRAFT_DIRTY) saveDraftNow(); });
})();

$('#btnAbortCall').addEventListener('click', ()=>{
  if(abortCurrentCall()) toast('요청을 멈추는 중입니다');
});

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
