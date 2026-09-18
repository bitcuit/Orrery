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
  if(name==='studio'){ renderConnectionAction(); renderStudioScreen(); }
  if(name==='talk'){ renderChat(); syncTalkSettingsLabel(); }
  if(name==='library'){ // 기록은 열 때마다 분류 '전부'·검색 초기화
    libFilter=''; libQuery='';
    if($('#libFilter')) $('#libFilter').value='';
    if($('#libSearch')) $('#libSearch').value='';
    renderLib();
  }
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('.topctl button[data-tab]').forEach(b=> b.addEventListener('click', ()=>tab(b.dataset.tab)));

function syncTalkSettingsLabel(){
  const select=$('#talkRole');
  $('#talkSettingsSummary').textContent=select.selectedOptions[0]?.textContent||'';
}
$('#talkRole').addEventListener('change',syncTalkSettingsLabel);
(function(){
  if(typeof window.matchMedia!=='function') return;
  const desktop=window.matchMedia('(min-width: 981px)');
  const sync=()=>{ $('#talkSettings').open=desktop.matches; };
  desktop.addEventListener('change',sync); sync();
})();

/* 쉬운 모드 */
function applyEasy(){
  S.opts.easy=false;
  document.body.classList.remove('easy');
}
function setEasy(on){
  applyEasy();
  if(typeof renderBuildMode==='function') renderBuildMode();
  if(typeof renderOneshot==='function') renderOneshot();
  save();
}

/* 첫 진입 온보딩 */
function openWelcome(){ $('#welcomeConnNote').hidden = !!S.connections.length; $('#welcomeModal').hidden = false; }
function closeWelcome(){ $('#welcomeModal').hidden = true; }
$('#welcomeClose').addEventListener('click', closeWelcome);
$('#welcomeModal').addEventListener('click', e=>{ if(e.target.id==='welcomeModal') closeWelcome(); });
$('#welcomeModal').addEventListener('click', e=>{
  const c = e.target.closest('.welcome-card'); if(!c) return;
  const g = c.dataset.group;
  S.opts.easy=false;
  applyEasy();
  closeWelcome();
  if(g && g!==S.opts.group) applyGroup(g); else renderBuildMode();
  save();
  tab('studio');
  setTimeout(()=>{ const bf=$('#optBrief'); if(bf) bf.focus(); }, 200);
});

const THEME_KEY='orrery.theme';
function applyTheme(theme){
  const light=theme==='light';
  document.documentElement.dataset.theme=light?'light':'dark';
  const t=$('#btnThemeText'); if(t) t.textContent=light?'어둡게':'밝게';
  const b=$('#btnTheme'); if(b) b.title=light?'어두운 화면으로':'밝은 화면으로';
}
function currentTheme(){ try{ return localStorage.getItem(THEME_KEY)==='light'?'light':'dark'; }catch(_){ return 'dark'; } }
$('#btnTheme').addEventListener('click',()=>{
  const next=currentTheme()==='light'?'dark':'light';
  try{ localStorage.setItem(THEME_KEY,next); }catch(_){ }
  applyTheme(next);
});
function bootUI(){
  applyTheme(currentTheme());
  migrateWorldPreset();
  convertPrefs();
  if(mergeLegacyRequests()){ save(); touchDraft(); }
  $('#optLang').value = S.opts.lang;
  $('#optTone').value = S.opts.tone;
  $('#optSeedN').value = S.opts.seedCount;
  $('#optCastN').value = S.opts.castCount;
  $('#optNsfw').value = S.opts.nsfw ? '1':'0';
  $('#optCheck').value = S.opts.check ? '1':'0';
  $('#logVerbose').checked = !!S.logVerbose;
  $('#optBrief').value = curBrief();
  $('#talkRole').value = S.chat.role;
  $('#chatIn').value=S.chat.inputDraft||'';
  $('#ctxAssets').checked = !!S.chat.ctx.assets;
  $('#ctxDigest').checked = !!S.chat.ctx.digest;
  $('#ctxCard').checked   = !!S.chat.ctx.card;
  renderModeChooser();
  $('#castPanel').style.display = activeMode()==='cast' ? '' : 'none';
  syncLibFilter();
  renderConnSel(); renderConns(); renderGroup(); renderPresetSel(); renderSchema(); renderStages();
  renderAssets(); renderDigest(); renderSeeds(); renderCard(); renderCheck(); renderCast(); renderQA(); renderLib(); renderChat(); renderMat(); applyGroupUi(); renderOneshot();
  updateTalkRoleUI();
  syncTalkSettingsLabel();
  applyEasy();
}

(function init(){
  if(WORKER_WINDOW) return;
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
  restoreActiveWorkspace();
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
  claimInitialWorkspace();
  if(restoredDraft) touchDraft();
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

/* 요청 중에는 입력과 작업 교체를 막고, 탐색·복사·중지는 허용한다. */
(function(){
  const safe='#btnAbortCall,.qhelp,.fld-toggle,#btnToggleFields,.stage-toggle,#spine li,.modal-h button,'+
    '#btnCopyText,#btnDlText,#btnCopyCard,#btnDlCard,#btnDlPng,#btnLogCopy,#btnTalkCopy,.l-md,.l-json,.l-png';
  function locked(target){
    if(!workIsBusy() || !(target instanceof Element) || target.closest(safe)) return false;
    if(target.closest('#groupBox [data-group],#btnEasy,#connSel,#drop,#talkAssetList')) return true;
    const control=target.closest('button,input,select,textarea,.mode,.seed,.q-apply,.l-open');
    return !!(control && target.closest('#v-studio,#v-sources,#v-settings,#v-prompts,#libList,#libViewActions'));
  }
  function block(e){
    if(e.type==='keydown' && ['Tab','Escape'].includes(e.key)) return;
    if(!locked(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if(e.type==='click'||e.type==='keydown') canChangeWork();
  }
  ['pointerdown','click','keydown','beforeinput','change','drop'].forEach(type=>document.addEventListener(type,block,true));
})();

/* 모달의 포커스·배경 입력·닫기 동작을 한곳에서 관리한다. */
(function(){
  const stack=[], background=new Map();
  let overflow='', hadModal=false;
  const focusable='button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';
  function top(){ return stack[stack.length-1]; }
  function focusIn(modal){
    const first=Array.from(modal.querySelectorAll(focusable)).find(el=>el.getClientRects().length);
    (first||modal).focus();
  }
  function sync(records){
    let closed;
    records.forEach(({target:modal})=>{
      if(!modal.classList.contains('modal')) return;
      const index=stack.indexOf(modal);
      if(modal.hidden){ if(index>=0){ stack.splice(index,1); closed=modal; } }
      else if(index<0){ modal._returnFocus=document.activeElement; stack.push(modal); }
    });
    const active=top();
    if(active){
      if(!hadModal){ overflow=document.body.style.overflow; document.body.style.overflow='hidden'; }
      Array.from(document.body.children).forEach(el=>{
        if(!background.has(el)) background.set(el,el.inert);
        el.inert=el!==active;
      });
      active.inert=false;
      if(!active.contains(document.activeElement)) focusIn(active);
    }else if(hadModal){
      background.forEach((inert,el)=>{ el.inert=inert; }); background.clear();
      document.body.style.overflow=overflow;
      const origin=closed&&closed._returnFocus;
      if(origin&&origin.isConnected) origin.focus();
    }
    hadModal=!!active;
  }
  const modals=$$('.modal');
  modals.forEach(modal=>{
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.tabIndex=-1;
    const heading=modal.querySelector('h2');
    if(heading){ if(!heading.id) heading.id=modal.id+'Title'; modal.setAttribute('aria-labelledby',heading.id); }
  });
  const observer=new MutationObserver(sync);
  modals.forEach(modal=>observer.observe(modal,{attributes:true,attributeFilter:['hidden']}));
  sync(modals.map(target=>({target})));
  document.addEventListener('keydown',e=>{
    const modal=top(); if(!modal) return;
    if(e.key==='Escape'){
      e.preventDefault(); e.stopImmediatePropagation();
      const close=Array.from(modal.querySelectorAll('.modal-h button')).find(btn=>/close$/i.test(btn.id));
      if(close) close.click(); else modal.hidden=true;
    }else if(e.key==='Tab'){
      const list=Array.from(modal.querySelectorAll(focusable)).filter(el=>el.getClientRects().length);
      const first=list[0],last=list[list.length-1];
      if(!first){ e.preventDefault(); modal.focus(); }
      else if(e.shiftKey&&(document.activeElement===first||document.activeElement===modal)){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
    }
  },true);
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

/* 용어 도움말 툴팁 — hover·클릭·키보드 포커스로 여닫기 */
(function(){
  const tip = document.createElement('div'); tip.id = 'tipbox';
  tip.setAttribute('role','tooltip'); tip.hidden=true;
  document.body.appendChild(tip);
  let cur=null, openedBy='', pointerTarget=null, ownsDescription=false;
  const helpButton=target=>target instanceof Element?target.closest('.qhelp'):null;
  function visible(btn){
    if(!btn || !btn.isConnected || btn.matches(':disabled')) return false;
    for(let el=btn; el; el=el.parentElement){
      const css=getComputedStyle(el);
      if(el.hidden || el.getAttribute('aria-hidden')==='true' || css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse') return false;
      if(el.tagName==='DETAILS' && !el.open){
        const summary=Array.from(el.children).find(child=>child.tagName==='SUMMARY');
        if(!summary || !summary.contains(btn)) return false;
      }
    }
    return true;
  }
  function place(){
    if(!cur) return;
    if(!visible(cur)) return hide();
    const r = cur.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    if(r.bottom<0 || r.top>innerHeight || r.right<0 || r.left>innerWidth) return hide();
    let x = r.left + r.width/2 - tw/2;
    x = Math.max(12, Math.min(x, innerWidth - tw - 12));
    let y = r.bottom + 8;
    if(y + th > innerHeight - 12) y = r.top - th - 8;
    y=Math.max(12,y);
    tip.style.left = x+'px'; tip.style.top = y+'px';
  }
  function show(btn,source){
    if(!visible(btn) || !btn.dataset.tip) return;
    if(cur!==btn){
      hide(); cur=btn;
      const ids=(btn.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      ownsDescription=!ids.includes(tip.id);
      if(ownsDescription) btn.setAttribute('aria-describedby',[...ids,tip.id].join(' '));
    }
    openedBy=source; btn.classList.add('on');
    tip.textContent=btn.dataset.tip;
    tip.hidden=false; tip.classList.add('on');
    place();
  }
  function hide(){
    if(cur){
      cur.classList.remove('on');
      if(ownsDescription){
        const ids=(cur.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id && id!==tip.id);
        if(ids.length) cur.setAttribute('aria-describedby',ids.join(' '));
        else cur.removeAttribute('aria-describedby');
      }
    }
    cur=null; openedBy=''; ownsDescription=false;
    tip.hidden=true; tip.classList.remove('on');
  }
  // 포인터로 받은 포커스는 클릭에서 처리해 첫 터치가 곧바로 닫히지 않게 한다.
  document.addEventListener('pointerdown',e=>{ pointerTarget=helpButton(e.target); });
  document.addEventListener('pointercancel',()=>{ pointerTarget=null; });
  // 마우스만 hover로 — 터치는 클릭 토글만 사용한다.
  document.addEventListener('pointerover', e=>{
    if(e.pointerType!=='mouse') return;
    const b=helpButton(e.target);
    if(b && !b.contains(e.relatedTarget) && cur!==b) show(b,'hover');
  });
  document.addEventListener('pointerout', e=>{
    if(e.pointerType!=='mouse') return;
    const b=helpButton(e.target);
    if(b && !b.contains(e.relatedTarget) && cur===b && openedBy==='hover') hide();
  });
  document.addEventListener('focusin',e=>{
    const b=helpButton(e.target);
    if(b && pointerTarget!==b) show(b,'focus');
  });
  document.addEventListener('focusout',e=>{
    const b=helpButton(e.target);
    if(b && cur===b && !b.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('click', e=>{
    pointerTarget=null;
    const b=helpButton(e.target);
    if(b){
      e.preventDefault();
      // button의 Enter/Space도 기본 click으로 들어오므로 별도 키 토글을 겹치지 않는다.
      if(cur===b) hide(); else show(b,'click');
      return;
    }
    if(cur) hide();
  });
  window.addEventListener('keydown',e=>{
    pointerTarget=null;
    if(e.key==='Escape' && cur){
      hide(); e.preventDefault(); e.stopPropagation();
    }
  },true);
  // 화면 전환·접기·동적 문구 변경을 따라가고, 사라진 트리거의 설명은 남기지 않는다.
  const observer=new MutationObserver(records=>{
    if(!cur || !records.some(record=>record.target!==tip && !tip.contains(record.target))) return;
    if(!visible(cur) || !cur.dataset.tip) return hide();
    if(tip.textContent!==cur.dataset.tip) tip.textContent=cur.dataset.tip;
    place();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,
    attributeFilter:['class','style','hidden','open','disabled','data-tip','aria-hidden']});
  // 스크롤 중에는 앵커를 따라가고 화면 밖으로 나가면 닫는다.
  window.addEventListener('scroll',place,true);
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
