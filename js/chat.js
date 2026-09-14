"use strict";
/* Orrery · 대화 */
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
  if(c.digest && S.project.digest) parts.push('[정리한 내용]\n'+JSON.stringify(S.project.digest,null,1));
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
  if(!confirm(`이 대화의 결론을 “${P.name}” 결과에 반영합니다. 잠근 칸은 그대로 두고 바뀐 칸만 덮어씁니다. 계속할까요?`)) return;
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
  const box = $('#talkAssetList'), assetCount = $('#talkAssetCount'); if(!box) return;
  const c=S.chat.ctx||{}, materialText=sourceText(), digestText=S.project.digest?JSON.stringify(S.project.digest):'';
  const cardText=S.project.card?JSON.stringify(S.project.card.fields||{}):'';
  const n = S.assets.filter(a=>a.use).length;
  assetCount.textContent = S.assets.length ? `선택 ${n}/${S.assets.length}개` : '성운이 비어 있습니다';
  box.innerHTML = S.assets.length ? S.assets.map(talkAssetRow).join('')
    : '<div class="note">재료 탭에서 파일이나 글을 먼저 넣어 주세요.</div>';
  const assets=$('#ctxAssets'), digest=$('#ctxDigest'), card=$('#ctxCard');
  assets.disabled=!(S.assets.length||curBrief().trim()); digest.disabled=!digestText; card.disabled=!cardText;
  $('#ctxAssetsMeta').textContent=materialText.trim()
    ? `${n?`고른 재료 ${n}개${curBrief().trim()?' + 구상':''}`:'구상'} · ${tok(materialText)} 토큰쯤`
    : '선택한 재료나 구상 없음';
  $('#ctxDigestMeta').textContent=digestText?`${tok(digestText)} 토큰쯤`:'아직 정리한 내용 없음';
  $('#ctxCardMeta').textContent=cardText?`${activePreset().name} · ${tok(cardText)} 토큰쯤`:'아직 만든 결과 없음';
  const kinds=(c.assets&&materialText.trim()?1:0)+(c.digest&&digestText?1:0)+(c.card&&cardText?1:0);
  $('#talkPickCount').textContent=`선택 ${kinds}개`;
  $('#talkMaterialPick').hidden=!c.assets;
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

