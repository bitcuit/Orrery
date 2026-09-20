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
/* 대화창마다 요청 하나씩, 서로 동시에 오간다.
   chatId -> {kind:'send'|'wrap', controller} */
const CHAT_JOBS = new Map();
function chatJob(id){ return CHAT_JOBS.get(id)||null; }
function renderChatActions(){
  const send=$('#btnSend'), wrap=$('#btnTalkWrap');
  const job=chatJob(S.chatId);
  if(send){
    const sending=job&&job.kind==='send';
    send.textContent=sending?'중지':'보내기';
    send.title=sending?'이 대화의 요청을 중지합니다':'보내기 (Ctrl+Enter)';
    send.classList.toggle('primary',!sending);
    send.classList.toggle('ghost',!!sending);
    send.disabled=!!(job&&job.kind==='wrap');
  }
  if(wrap){
    const wrapping=job&&job.kind==='wrap';
    wrap.textContent=wrapping?'정리 중지':'대화 요약';
    wrap.disabled=!!(job&&!wrapping);
  }
}
function resizeChatInput(){
  const input=$('#chatIn');
  if(!input || !input.clientWidth) return;
  const css=getComputedStyle(input);
  const min=parseFloat(css.minHeight)||48, max=parseFloat(css.maxHeight)||160;
  const border=(parseFloat(css.borderTopWidth)||0)+(parseFloat(css.borderBottomWidth)||0);
  const scrollTop=input.scrollTop;
  const log=$('#chatLog'), logTop=log.scrollTop;
  const atBottom=logTop+log.clientHeight>=log.scrollHeight-1;
  input.style.height='auto';
  input.style.overflowY='hidden';
  const needed=input.scrollHeight+border;
  input.style.height=Math.min(max,Math.max(min,needed))+'px';
  input.style.overflowY=needed>max?'auto':'hidden';
  input.scrollTop=scrollTop;
  log.scrollTop=atBottom?log.scrollHeight:logTop;
}
if(typeof ResizeObserver==='function'){
  let previousWidth=0;
  new ResizeObserver(entries=>{
    const width=entries[0].contentRect.width;
    if(width===previousWidth) return;
    previousWidth=width;
    resizeChatInput();
  }).observe($('#chatIn'));
}
if(document.fonts) document.fonts.ready.then(resizeChatInput);
function talkTurnIndexes(index){
  const msgs=S.chat.msgs;
  if(!msgs[index]) return [];
  let start=index, end=index+1;
  while(start>0 && msgs[start].role!=='user') start--;
  while(end<msgs.length && msgs[end].role!=='user') end++;
  return Array.from({length:end-start},(_,i)=>start+i);
}
function talkTurnExcluded(index){
  return talkTurnIndexes(index).some(i=>S.chat.msgs[i].includeHistory===false);
}
function talkHistoryMessages(pendingMessage=null, limit=Infinity){
  const messages=S.chat.msgs.filter((m,i)=>(m===pendingMessage || !m.status)
    && (m.role==='user' || m.role==='assistant') && !talkTurnExcluded(i)).slice(-limit);
  // A history limit must not leave an answer without its question.
  while(messages.length && messages[0].role!=='user') messages.shift();
  return messages;
}
function talkSummaryItems(){
  const items=(S.chat.summaryHistory||[]).map(m=>({...m,current:false}));
  if(S.chat.summary) items.push({id:'current',content:S.chat.summary,includeHistory:S.chat.summaryIncluded!==false,current:true});
  return items;
}
function talkHistorySummary(){
  return talkSummaryItems().filter(m=>m.includeHistory!==false).map(m=>m.content).join('\n\n');
}
function talkHistoryButton(excluded, attributes, subject){
  const label=`${subject}을 다음 전송에서 ${excluded?'포함':'제외'}`;
  const icon=excluded
    ? '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.2 3.8M6.2 6.2A19.2 19.2 0 0 0 2 12s4 7 10 7a10.4 10.4 0 0 0 5-1.3"/>'
    : '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
  return `<button type="button" class="mini ghost chat-history-toggle" ${attributes} aria-label="${label}" title="${label}" aria-pressed="${excluded}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></button>`;
}
/* ---- 여러 대화창 ------------------------------------------------
   각 대화창은 역할·보낼 내용·요약·입력까지 따로 가지며 서로를 참조하지 않는다.
   보내는 중에는 전환·추가·삭제를 막는다 — 도착한 답이 갈 곳을 잃지 않도록. */
function applyChatToUI(){
  $('#talkRole').value = S.chat.role;
  $('#chatIn').value = S.chat.inputDraft||'';
  $('#ctxAssets').checked = !!S.chat.ctx.assets;
  $('#ctxDigest').checked = !!S.chat.ctx.digest;
  $('#ctxCard').checked   = !!S.chat.ctx.card;
  updateTalkRoleUI();
}
function renderChatTabs(){
  const box=$('#chatTabs'); if(!box) return;
  const list=chatList();
  box.innerHTML = list.map((c,i)=>{
    const on=c.id===S.chatId, label=chatLabel(c,i), sending=CHAT_JOBS.has(c.id);
    return `<div class="chat-tab${on?' on':''}${sending?' sending':''}" role="presentation">${sending?'<span class="chat-tab-dot" title="답을 기다리는 중" aria-label="답을 기다리는 중"></span>':''}<button type="button" role="tab" aria-selected="${on}" class="chat-tab-open" data-chat="${esc(c.id)}" title="${esc(label)}${on?' · 한 번 더 누르면 이름 바꾸기':''}">${esc(label)}</button>`
      + (list.length>1?`<button type="button" class="chat-tab-close" data-chat-close="${esc(c.id)}" title="이 대화창 닫기" aria-label="${esc(label)} 닫기">×</button>`:'')
      + `</div>`;
  }).join('') + '<button type="button" class="chat-tab-add" id="btnChatNew"><span aria-hidden="true">+</span> 새 대화</button>';
}
/* 답을 기다리는 동안에도 다른 대화창을 읽고 쓸 수 있다.
   답은 보낸 창으로 돌아간다. 다만 그 창을 닫아 버리면 갈 곳이 없다. */
function selectChat(id){
  if(id===S.chatId) return;
  if(!chatList().some(c=>c.id===id)) return;
  S.chatId=id; save(); applyChatToUI(); renderChat();
}
function newChat(){
  const list=chatList();
  if(list.length>=12) return toast('대화창은 12개까지 만들 수 있습니다',1);
  const c=emptyChat(S.opts.group);
  c.role=S.chat.role; c.ctx=Object.assign({},S.chat.ctx);
  list.push(c); S.chatId=c.id;
  save(); applyChatToUI(); renderChat();
  $('#chatIn').focus();
}
function closeChat(id){
  if(CHAT_JOBS.has(id)) return toast('이 대화창은 답을 기다리는 중입니다. 받은 뒤에 닫아 주세요.',1);
  const list=chatList(), at=list.findIndex(c=>c.id===id);
  if(at<0 || list.length<2) return;
  const c=list[at];
  if((c.msgs.length||c.summary) && !confirm(`“${chatLabel(c,at)}” 대화창을 닫을까요? 내용은 지워집니다.`)) return;
  list.splice(at,1);
  if(S.chatId===id) S.chatId=list[Math.max(0,at-1)].id;
  save(); applyChatToUI(); renderChat();
}
function renameChat(id){
  const list=chatList(), at=list.findIndex(c=>c.id===id); if(at<0) return;
  const next=prompt('대화창 이름 (비우면 자동)', list[at].name||'');
  if(next===null) return;
  list[at].name=next.trim().slice(0,24);
  save(); renderChatTabs();
}
$('#chatTabs').addEventListener('click', e=>{
  const close=e.target.closest('[data-chat-close]');
  if(close) return closeChat(close.dataset.chatClose);
  if(e.target.closest('#btnChatNew')) return newChat();
  const open=e.target.closest('[data-chat]'); if(!open) return;
  const id=open.dataset.chat;
  if(id===S.chatId) renameChat(id); else selectChat(id);
});
function renderChat(preserveScroll=false){
  // 새로고침 등으로 끊긴 요청은 지금 보고 있지 않은 대화창에도 남는다.
  chatList().forEach(c=>{ if(CHAT_JOBS.has(c.id)) return;
    c.msgs.forEach(m=>{
      if(m.status==='pending'){ m.status='failed'; m.error='응답을 받기 전에 작업이 종료됐습니다.'; }
    });
  });
  const box = $('#chatLog');
  const scrollTop=box.scrollTop;
  const wrapHtml = talkSummaryItems().map(m=>{
    const excluded=m.includeHistory===false;
    return `<div class="msg bot wrap${excluded?' history-excluded':''}"><div class="msg-heading"><span class="who">${m.current?'지금까지의 정리':'이전 정리'}</span><div class="msg-history-control">${excluded?'<span class="chat-history-status">전송 제외</span>':''}${talkHistoryButton(excluded,`data-summary="${esc(m.id)}"`,'이 요약')}</div></div>${esc(m.content)}</div>`;
  }).join('');
  if(!S.chat.msgs.length && !wrapHtml){
    box.innerHTML = '<div class="empty"><b>아직 아무 말도 안 했습니다</b>만든 것을 보여주고 물어보세요.</div>';
  } else {
    box.innerHTML = wrapHtml + S.chat.msgs.map((m,i)=>{
      const excluded=talkTurnExcluded(i), completed=talkTurnIndexes(i).every(n=>!S.chat.msgs[n].status);
      return `<div class="msg ${m.role==='user'?'user':'bot'}${excluded?' history-excluded':''}"><div class="msg-heading"><span class="who">${m.role==='user'?'나':'상대'}</span><div class="msg-history-control">${excluded?'<span class="chat-history-status">전송 제외</span>':''}${completed?talkHistoryButton(excluded,`data-message-index="${i}"`,'이 문답'):''}</div></div>${esc(m.content)}${m.status==='failed'?`<div class="chat-failure"><span>${esc(m.error||'응답을 받지 못했습니다.')}</span><div><button type="button" class="mini chat-retry" data-message="${esc(m.id)}">다시 보내기</button> <button type="button" class="mini ghost chat-discard" data-message="${esc(m.id)}">메시지 삭제</button></div></div>`:m.status==='pending'?'<div class="note">응답을 기다리고 있습니다.</div>':''}</div>`;
    }).join('');
  }
  const t = tok(talkContext());
  const ct = tok(talkHistorySummary()+talkHistoryMessages().map(m=>m.content).join('\n'));
  $('#ctxTok').textContent = (t ? `함께 보낼 분량 ${t} 토큰쯤` : '함께 보낼 것 없음')
    + (ct ? ` · 대화 ${ct} 토큰쯤` : '');
  renderChatTabs();
  renderChatActions();
  renderTalkAssets();
  renderWrapNudge(ct);
  const toCard = $('#btnTalkToCard');
  if(toCard) toCard.disabled = !(S.project.card && (talkHistoryMessages().length || talkHistorySummary()));
  resizeChatInput();
  box.scrollTop = preserveScroll?scrollTop:box.scrollHeight;
}
const WRAP_NUDGE_AT = 2500;
function renderWrapNudge(convoTok){
  const el = $('#wrapNudge'); if(!el) return;
  const ct = convoTok!=null ? convoTok : tok(talkHistorySummary()+talkHistoryMessages().map(m=>m.content).join('\n'));
  const show = ct >= WRAP_NUDGE_AT && talkHistoryMessages().length >= 4 && !S.chat.nudgeOff;
  el.hidden = !show;
  if(show) $('#wrapNudgeText').textContent = '대화가 길어졌습니다.';
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
  if(CHAT_JOBS.has(S.chatId)) return;
  if(S.chat.msgs.some(m=>m.status)) return toast('응답을 받지 못한 메시지를 먼저 다시 보내거나 삭제해 주세요.',1);
  const included=talkHistoryMessages();
  if(included.length < 2) return toast('정리할 대화가 없습니다',1);
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  if(!confirm('전송에 포함한 대화를 요약으로 바꿉니다. 제외한 대화는 남습니다.\n원문이 필요하면 먼저 복사해 두세요. 계속할까요?')) return;
  const chat=S.chat;
  const job={kind:'wrap',controller:null,cancelled:false};
  CHAT_JOBS.set(chat.id,job);
  renderChat();
  try{
    const convo = talkTranscript(true);
    const before = tok(convo);
    const out = await callProvider(conn, [
      {role:'system', content:'너는 진행 중인 창작 상담 대화를 이어가기 위한 압축 정리를 만든다. 새 의견이나 제안을 덧붙이지 않는다. '+(S.opts.lang||'한국어')+' 로 쓴다.'},
      {role:'user', content:'아래 대화를 다음 항목으로 정리하라. 각 항목은 짧은 개조식으로, 없는 항목은 빼라.\n- 다룬 주제\n- 정해진 것·합의\n- 검토했지만 접은 것\n- 아직 열린 질문\n\n대화:\n'+convo}
    ], {temperature:0.3, maxTokens:1000,
      concurrent:true, onStart:c=>{ job.controller=c; }});
    if(job.cancelled) throw new Error('__ABORT__');
    chat.summaryHistory=(chat.summaryHistory||[]).filter(m=>m.includeHistory===false);
    if(chat.summary && chat.summaryIncluded===false){
      chat.summaryHistory.push({id:uid(),content:chat.summary,includeHistory:false});
    }
    chat.summary = out.trim();
    chat.summaryIncluded = true;
    chat.msgs = chat.msgs.filter(m=>!included.includes(m));
    chat.nudgeOff = false;
    save();
    toast(`대화를 정리했습니다 — ${before} 토큰 → ${tok(out)} 토큰`);
  }catch(err){ if(err.message!=='__ABORT__') showErr(err); }
  finally{ CHAT_JOBS.delete(chat.id); save(); renderChat(chat.id!==S.chatId); }
}
$('#btnTalkWrap').addEventListener('click', ()=>{
  const job=chatJob(S.chatId);
  if(job&&job.kind==='wrap') stopChat(S.chatId); else wrapTalk();
});
async function sendChat(retryId){
  const chat=S.chat, inp=$('#chatIn');
  if(CHAT_JOBS.has(chat.id)) return;
  const failed=chat.msgs.find(m=>m.status==='failed');
  const retry=typeof retryId==='string' && failed && failed.id===retryId;
  if(failed&&!retry) return toast('실패한 메시지의 다시 보내기를 눌러 주세요. 새 입력은 그대로 남겨 뒀습니다.',1);
  const text=retry?failed.content:inp.value.trim();
  if(!text) return;
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  const job={kind:'send',controller:null,cancelled:false};
  CHAT_JOBS.set(chat.id,job);
  const message=retry?failed:{id:uid(),role:'user',content:text,includeHistory:true};
  message.includeHistory=true; message.status='pending'; delete message.error;
  if(!retry){ chat.msgs.push(message); inp.value=''; chat.inputDraft=''; }
  try{
  renderChat(); save();
  // 보낼 내용은 지금 이 자리에서 다 굳힌다 — 기다리는 동안 다른 창으로 옮겨도 흔들리지 않게.
  const sys = [];
  const roleKey = chat.role;
  const customPrompt = S.customTalkPrompts && S.customTalkPrompts[roleKey];
  if(customPrompt && customPrompt.trim()){
    sys.push(customPrompt.trim());
  } else if(TALK_ROLE[roleKey]){
    sys.push(TALK_ROLE[roleKey]);
  }
  sys.push(`{{lang}} 로 답한다.`.replace('{{lang}}', S.opts.lang||'한국어'));
  const summary=talkHistorySummary();
  if(summary) sys.push('아래는 지금까지 나눈 대화를 압축한 정리다. 이 맥락 위에서 이어서 대화한다.\n\n'+summary);
  const ctx = talkContext();
  if(ctx) sys.push('아래는 상대가 지금 다루고 있는 자료다. 묻지 않은 것까지 통째로 다시 써주지 마라.\n\n'+ctx);
  const msgs = [{role:'system', content: sys.join('\n\n')}].concat(
    talkHistoryMessages(message,24).map(m=>({role:m.role, content:m.content})));
    const out = await callProvider(conn, msgs, {temperature:0.85, maxTokens:2200,
      concurrent:true, onStart:c=>{ job.controller=c; }});
    if(job.cancelled) throw new Error('__ABORT__');
    delete message.status; delete message.error;
    chat.msgs.push({id:uid(),role:'assistant',content:out.trim(),includeHistory:true});
  }catch(err){
    message.status='failed'; message.error=err.message==='__ABORT__'?'요청을 중지했습니다. 메시지는 보관돼 있습니다.':err.message;
    if(err.message!=='__ABORT__') showErr(err);
  }
  // 보고 있지 않은 대화창이 끝났으면 지금 읽는 자리를 흔들지 않는다.
  finally{ CHAT_JOBS.delete(chat.id); save(); renderChat(chat.id!==S.chatId); }
}
function stopChat(id){
  const job=CHAT_JOBS.get(id); if(!job) return;
  job.cancelled=true;
  if(job.controller) job.controller.abort();
  renderChat();
}
$('#btnSend').addEventListener('click', ()=>{
  if(CHAT_JOBS.has(S.chatId)) stopChat(S.chatId); else sendChat();
});
$('#chatLog').addEventListener('click',e=>{
  const historyToggle=e.target.closest('.chat-history-toggle');
  if(historyToggle){
    if(CHAT_JOBS.has(S.chatId)) return;
    if(historyToggle.dataset.summary){
      if(historyToggle.dataset.summary==='current') S.chat.summaryIncluded=S.chat.summaryIncluded===false;
      else{
        const summary=(S.chat.summaryHistory||[]).find(m=>m.id===historyToggle.dataset.summary);
        if(!summary) return;
        summary.includeHistory=summary.includeHistory===false;
      }
    } else{
      const index=Number(historyToggle.dataset.messageIndex), indexes=talkTurnIndexes(index);
      if(!indexes.length || indexes.some(i=>S.chat.msgs[i].status)) return;
      const included=talkTurnExcluded(index);
      indexes.forEach(i=>{ S.chat.msgs[i].includeHistory=included; });
    }
    const {summary,messageIndex}=historyToggle.dataset;
    save(); renderChat(true);
    [...$('#chatLog').querySelectorAll('.chat-history-toggle')].find(button=>summary
      ? button.dataset.summary===summary : button.dataset.messageIndex===messageIndex)?.focus({preventScroll:true});
    return;
  }
  const retry=e.target.closest('.chat-retry'), discard=e.target.closest('.chat-discard');
  if(retry) return sendChat(retry.dataset.message);
  if(discard && !CHAT_JOBS.has(S.chatId)){
    S.chat.msgs=S.chat.msgs.filter(m=>!(m.id===discard.dataset.message && m.status==='failed'));
    save(); renderChat();
  }
});
$('#chatIn').addEventListener('input',e=>{ S.chat.inputDraft=e.target.value; resizeChatInput(); save(); });
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
  if(CHAT_JOBS.has(S.chatId)) return toast('이 대화창은 답을 기다리는 중입니다',1);
  if((!S.chat.msgs.length && !talkSummaryItems().length) || confirm('대화와 정리를 모두 비울까요?')){
    S.chat.msgs=[]; S.chat.summary=''; S.chat.summaryHistory=[]; S.chat.summaryIncluded=true; S.chat.nudgeOff=false; save(); renderChat();
  }
});
function talkTranscript(marks, includeExcluded=false){
  const parts=[];
  const summary=includeExcluded?talkSummaryItems().map(m=>m.content).join('\n\n'):talkHistorySummary();
  if(summary) parts.push((marks?'[지금까지의 정리]\n':'지금까지의 정리:\n')+summary);
  const messages=includeExcluded?S.chat.msgs:talkHistoryMessages();
  parts.push(...messages.map(m=>(m.role==='user'?(marks?'[나] ':'나: '):(marks?'[상대] ':'상대: '))+m.content));
  return parts.join('\n\n');
}
$('#btnTalkCopy').addEventListener('click', ()=> copy(talkTranscript(false,true)));
$('#btnTalkToAsset').addEventListener('click', ()=>{
  if(!canChangeWork()) return;
  const transcript=talkTranscript(true);
  if(!transcript.trim()) return toast('재료로 보낼 대화가 없습니다',1);
  const purpose={world:'world',char:'character',prompt:'prompt'}[S.chat.role];
  S.assets.push({ id:uid(), kind:'text', name:'대화 기록 '+new Date().toLocaleTimeString('ko-KR'),
    body: transcript, purposes:purpose?[purpose]:[], tags:[], use:true });
  renderAssets(); materialChanged(); renderChat(true); toast('재료에 넣었습니다');
});

