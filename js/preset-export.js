"use strict";
/* Orrery · 롤플레이 프리셋 배치 · 내보내기 (실리태번 · 마리나라 · 리스AI)
   양식 칸 하나가 구획 하나. 마커는 채팅 앱이 내용을 채우는 자리로, 형식마다 이름이 다르다.
   형식 근거: 실리태번 PromptManager(prompt_order 100001, 직접 만든 구획은 system_prompt:false),
   마리나라 내보내기 봉투(marinara_preset, 불리언은 문자열), 리스 importPreset(일반 JSON botPreset). */

// 형식에 없는 마커는 그 형식으로 뽑을 때 빠진다.
const RP_MARKERS = {
  wi_before:        {label:'로어북 (앞)',      st:'worldInfoBefore',    mari:'world_info_before', risu:'lorebook'},
  char_desc:        {label:'캐릭터 설명',      st:'charDescription',    mari:'character',         risu:'description'},
  char_personality: {label:'캐릭터 성격',      st:'charPersonality'},
  scenario:         {label:'시나리오',         st:'scenario'},
  persona:          {label:'페르소나',         st:'personaDescription', mari:'persona',           risu:'persona'},
  examples:         {label:'대화 예시',        st:'dialogueExamples',   mari:'dialogue_examples'},
  wi_after:         {label:'로어북 (뒤)',      st:'worldInfoAfter',     mari:'world_info_after'},
  summary:          {label:'지난 이야기 요약', mari:'chat_summary',      risu:'memory'},
  chat:             {label:'채팅 기록',        st:'chatHistory',        mari:'chat_history',      risu:'chat'}
};
const ST_MARKER_NAME = {worldInfoBefore:'World Info (before)', charDescription:'Char Description', charPersonality:'Char Personality',
  scenario:'Scenario', personaDescription:'Persona Description', dialogueExamples:'Chat Examples', worldInfoAfter:'World Info (after)', chatHistory:'Chat History'};
const RP_FORMATS = [
  {id:'st', label:'실리태번', key:'st'},
  {id:'marinara', label:'마리나라', key:'mari'},
  {id:'risu', label:'리스AI', key:'risu'}
];

function isRpPreset(P){ return !!(P||activePreset()).rpPreset; }
// 'title'은 프리셋 이름 칸이라 구획이 아니다.
const RP_NOT_SECTION = new Set(['title']);
const rpSectionSchema = schema => schema.filter(f=>!RP_NOT_SECTION.has(f.key));
function rpDefaultLayout(schema){
  const keys = schema.map(f=>f.key), sec = key=>({t:'sec', key, on:true}), mk = id=>({t:'mk', id, on:true});
  const head = ['role','direction','npc','style'].filter(k=>keys.includes(k));
  const tail = ['forbid','format'].filter(k=>keys.includes(k));
  const rest = keys.filter(k=>!head.includes(k) && !tail.includes(k));
  return [...head.map(sec), ...rest.map(sec),
    mk('wi_before'), mk('char_desc'), mk('persona'), mk('examples'), mk('wi_after'), mk('summary'),
    mk('chat'), ...tail.map(sec)];
}
// 칸을 끄거나 켜도 배치가 따라오게 맞춘다. 새 칸은 채팅 기록 앞에 넣는다.
function rpLayout(card, schema){
  if(!card) return [];
  schema = rpSectionSchema(schema);
  const keys = new Set(schema.map(f=>f.key));
  if(!Array.isArray(card.layout)) card.layout = rpDefaultLayout(schema);
  card.layout = card.layout.filter(x=>x.t==='mk' ? !!RP_MARKERS[x.id] : keys.has(x.key));
  const have = new Set(card.layout.filter(x=>x.t==='sec').map(x=>x.key));
  for(const f of schema){
    if(have.has(f.key)) continue;
    const at = card.layout.findIndex(x=>x.t==='mk' && x.id==='chat');
    card.layout.splice(at<0 ? card.layout.length : at, 0, {t:'sec', key:f.key, on:true});
  }
  return card.layout;
}
function rpExportChoice(){
  const raw = S.opts.rpExport;
  return S.opts.rpExport = Array.isArray(raw) ? raw.filter(x=>RP_FORMATS.some(f=>f.id===x)) : ['st'];
}

/* --- 화면 --- */
function renderRpExportBox(){
  const box = $('#rpExportBox'); if(!box) return;
  box.hidden = !isRpPreset();
  const on = new Set(rpExportChoice());
  box.querySelectorAll('input').forEach(x=>{ x.checked = on.has(x.value); });
}
const RP_UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
const RP_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
function renderRpLayout(){
  const box = $('#rpLayout'); if(!box) return;
  const card = S.project.card, P = activePreset();
  box.hidden = !(card && isRpPreset(P));
  if(box.hidden){ box.innerHTML=''; return; }
  const schema = activeSchema(), label = Object.fromEntries(schema.map(f=>[f.key,f.label]));
  const layout = rpLayout(card, schema);
  const used = new Set(layout.filter(x=>x.t==='mk').map(x=>x.id));
  const free = Object.keys(RP_MARKERS).filter(id=>!used.has(id));
  const fmts = RP_FORMATS.filter(f=>rpExportChoice().includes(f.id));
  const shown = fmts.length ? fmts : RP_FORMATS;
  box.innerHTML = `
    <div class="rp-head"><b>프리셋 배치</b><span class="note">위에서부터 이 순서로 들어갑니다</span><span class="sp"></span>
      ${free.length?`<select class="rp-add" aria-label="마커 추가"><option value="">마커 추가</option>${free.map(id=>`<option value="${id}">${esc(RP_MARKERS[id].label)}</option>`).join('')}</select>`:''}</div>
    <ol class="rp-list">${layout.map((x,i)=>{
      const mk = x.t==='mk', m = mk ? RP_MARKERS[x.id] : null;
      const name = mk ? m.label : (label[x.key]||x.key);
      const text = mk ? '' : String(card.fields[x.key]||'').replace(/\s+/g,' ').trim();
      const where = mk ? RP_FORMATS.filter(f=>m[f.key]).map(f=>f.label).join(' · ') : (text ? text.slice(0,80)+(text.length>80?'…':'') : '내용 없음');
      return `<li class="rp-item ${mk?'mk':'sec'}${x.on?'':' off'}" data-i="${i}">
        <input type="checkbox" class="rp-on" ${x.on?'checked':''} aria-label="${esc(name)} 넣기">
        <span class="rp-kind">${mk?'마커':'구획'}</span>
        <span class="rp-name">${esc(name)}</span>
        <span class="rp-where">${esc(where)}</span>
        <span class="rp-tools">
          <button type="button" class="rp-move" data-d="-1" aria-label="${esc(name)} 위로" ${i===0?'disabled':''}>${RP_UP}</button>
          <button type="button" class="rp-move" data-d="1" aria-label="${esc(name)} 아래로" ${i===layout.length-1?'disabled':''}>${RP_DOWN}</button>
          ${mk?`<button type="button" class="rp-del" aria-label="${esc(name)} 빼기">×</button>`:'<span class="rp-del-ph" aria-hidden="true"></span>'}
        </span></li>`;
    }).join('')}</ol>
    <div class="rp-dl">${shown.map(f=>`<button type="button" class="ghost rp-export" data-fmt="${f.id}">${f.label} 프리셋 내려받기</button>`).join('')}
      ${shown.some(f=>f.id==='risu')?'<span class="note">리스AI: 가져온 프리셋을 고르면 모델이 리스 기본값으로 바뀔 수 있습니다. 고른 뒤 모델을 확인하세요.</span>':''}</div>`;
}
$('#rpExportBox').addEventListener('change', e=>{
  if(!e.target.matches('input[type=checkbox]')) return;
  S.opts.rpExport = [...$('#rpExportBox').querySelectorAll('input:checked')].map(x=>x.value);
  save(); touchDraft(); renderRpLayout();
});
$('#rpLayout').addEventListener('change', e=>{
  const card = S.project.card; if(!card) return;
  if(e.target.classList.contains('rp-add') && e.target.value){
    const layout = rpLayout(card, activeSchema()), at = layout.findIndex(x=>x.t==='mk' && x.id==='chat');
    layout.splice(at<0 ? layout.length : at, 0, {t:'mk', id:e.target.value, on:true});
  } else if(e.target.classList.contains('rp-on')){
    const it = card.layout[+e.target.closest('.rp-item').dataset.i]; if(it) it.on = e.target.checked;
  } else return;
  save(); touchDraft(); renderRpLayout();
});
$('#rpLayout').addEventListener('click', e=>{
  const card = S.project.card; if(!card) return;
  const exp = e.target.closest('.rp-export');
  if(exp){ exportRpPreset(exp.dataset.fmt); return; }
  const row = e.target.closest('.rp-item'); if(!row) return;
  const i = +row.dataset.i, layout = card.layout;
  const move = e.target.closest('.rp-move');
  if(move){
    const j = i + Number(move.dataset.d); if(j<0 || j>=layout.length) return;
    [layout[i], layout[j]] = [layout[j], layout[i]];
    save(); touchDraft(); renderRpLayout();
    $('#rpLayout').querySelector(`.rp-item[data-i="${j}"] .rp-move[data-d="${move.dataset.d}"]`)?.focus();
    return;
  }
  if(e.target.closest('.rp-del')){ layout.splice(i,1); save(); touchDraft(); renderRpLayout(); }
});

/* --- 내보내기 --- */
function rpUuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{ const r=Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); });
}
// 배치를 형식과 무관한 목록으로: 켜기 여부를 지닌 구획/마커. 빈 구획은 뺀다.
function rpItems(card, schema){
  const label = Object.fromEntries(schema.map(f=>[f.key,f.label]));
  return rpLayout(card, schema).map(x=>x.t==='mk'
    ? {mk:x.id, on:x.on}
    : {key:x.key, name:label[x.key]||x.key, text:String(card.fields[x.key]||'').trim(), on:x.on})
    .filter(x=>x.mk || x.text);
}
function rpToST(items){
  const prompts = [], order = [];
  for(const x of items){
    if(x.mk){
      const id = RP_MARKERS[x.mk].st; if(!id) continue;
      prompts.push({identifier:id, name:ST_MARKER_NAME[id]||id, system_prompt:true, marker:true});
      order.push({identifier:id, enabled:x.on});
    } else {
      const id = rpUuid();
      prompts.push({identifier:id, name:x.name, system_prompt:false, marker:false, role:'system', content:x.text,
        injection_position:0, injection_depth:4, injection_order:100, injection_trigger:[], forbid_overrides:false});
      order.push({identifier:id, enabled:x.on});
    }
  }
  return {prompts, prompt_order:[{character_id:100001, order}]};
}
function rpToMarinara(items, name){
  const presetId = uid()+uid(), sections = [];
  let n = 0;
  for(const x of items){
    const type = x.mk ? RP_MARKERS[x.mk].mari : null;
    if(x.mk && !type) continue;
    const order = n++ * 100;
    sections.push({id:uid()+uid(), presetId, identifier:x.mk?type:'section_'+(Date.now()+n), name:x.mk?RP_MARKERS[x.mk].label:x.name,
      content:x.mk?'':x.text, role:'system', enabled:String(!!x.on), isMarker:String(!!x.mk), groupId:null,
      markerConfig:x.mk?JSON.stringify({type}):null, injectionPosition:'ordered', injectionDepth:0, injectionOrder:order, forbidOverrides:'false'});
  }
  return {type:'marinara_preset', version:1, exportedAt:new Date().toISOString(), data:{
    preset:{id:presetId, name, description:'', conversationPrompt:'', gamePrompt:'',
      sectionOrder:JSON.stringify(sections.map(s=>s.id)), groupOrder:'[]', variableGroups:'[]', variableValues:'{}',
      parameters:'{}', wrapFormat:'xml', defaultChoices:'{}', author:''},
    sections, groups:[], choiceBlocks:[]}};
}
function rpToRisu(items, name){
  const promptTemplate = [];
  for(const x of items){
    if(!x.on) continue;               // 리스 템플릿에는 끄기 표시가 없다
    if(!x.mk){ promptTemplate.push({type:'plain', type2:'normal', role:'system', text:x.text, name:x.name}); continue; }
    const type = RP_MARKERS[x.mk].risu; if(!type) continue;
    promptTemplate.push(type==='chat'
      ? {type:'chat', rangeStart:-1000, rangeEnd:'end', name:RP_MARKERS[x.mk].label}
      : {type, innerFormat:'{{slot}}', name:RP_MARKERS[x.mk].label});
  }
  return {name, promptTemplate};
}
function exportRpPreset(fmt){
  const card = S.project.card; if(!card) return;
  const schema = activeSchema(), items = rpItems(card, schema);
  if(!items.some(x=>!x.mk)) return toast('내보낼 구획이 없습니다',1);
  const name = (String(card.fields.title||'').trim() || '오러리 프리셋').replace(/[\\/:*?"<>|]/g,'_');
  const missing = items.filter(x=>x.mk && !RP_MARKERS[x.mk][RP_FORMATS.find(f=>f.id===fmt).key]).map(x=>RP_MARKERS[x.mk].label);
  if(fmt==='st') dl(`${name}.json`, JSON.stringify(rpToST(items), null, 2));
  else if(fmt==='marinara') dl(`${name}.marinara.json`, JSON.stringify(rpToMarinara(items, name), null, 2));
  else dl(`${name}_preset.json`, JSON.stringify(rpToRisu(items, name), null, 2));
  const fl = RP_FORMATS.find(f=>f.id===fmt).label;
  toast(missing.length ? `${fl} 형식으로 내려받았습니다 · ${fl}에 없는 마커는 뺐습니다: ${missing.join(', ')}` : `${fl} 형식으로 내려받았습니다`);
}
