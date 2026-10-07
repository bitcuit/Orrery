"use strict";
/* Orrery · 대화 */
/* ==================================================================
   9. 대화
   ================================================================== */
// 예비값: talk-roles.js 가 없을 때만 쓴다. 상담역을 고칠 땐 talk-roles.js(편집기 '대화 상담역' 탭)를 고칠 것.
const TALK_ROLE_CODE = {
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
/* ---- 대화창별 재료 ------------------------------------------------
   대화창마다 고른 재료·완성본을 따로 가진다(작업대의 재료 선택과도 별개).
   picks 가 없는 예전 대화창은 처음 열 때 지금 앱에서 켜 둔 재료를 이어받는다.
   로어북 안의 항목 켜기·끄기는 재료 자체의 값이라 모든 곳이 같이 쓴다. */
function chatPicks(chat){
  chat = chat||S.chat;
  if(!chat.picks || typeof chat.picks!=='object')
    chat.picks = {assets:S.assets.filter(a=>a.use).map(a=>a.id), records:S.library.filter(r=>r.use).map(r=>r.id)};
  if(!Array.isArray(chat.picks.assets)) chat.picks.assets=[];
  if(!Array.isArray(chat.picks.records)) chat.picks.records=[];
  return chat.picks;
}
function chatPicked(kind, id, chat){ return chatPicks(chat)[kind].includes(id); }
function setChatPick(kind, id, on, chat){
  const list=chatPicks(chat)[kind], i=list.indexOf(id);
  if(on && i<0) list.push(id);
  if(!on && i>=0) list.splice(i,1);
}
function chatMaterials(chat){
  const p=chatPicks(chat);
  return { assets:S.assets.filter(a=>p.assets.includes(a.id)), records:S.library.filter(r=>p.records.includes(r.id)) };
}
function chatSourceText(chat){
  const parts=[], brief=curBrief().trim(), m=chatMaterials(chat);
  if(brief) parts.push('## 구상\n'+brief);
  m.assets.forEach(a=>{ const t=assetText(a); if(t) parts.push(t); });
  m.records.forEach(r=>{ const t=recordText(r); if(t) parts.push(t); });
  return parts.join('\n\n');
}
function talkContext(chat){
  chat = chat||S.chat;
  const c = chat.ctx, parts = [];
  if(c.assets){ const t = chatSourceText(chat); if(t.trim()) parts.push('[재료]\n'+t); }
  if(c.digest && S.project.digest) parts.push('[정리한 내용]\n'+JSON.stringify(S.project.digest,null,1));
  if(c.card && S.project.card) parts.push('[지금 만든 것]\n'+JSON.stringify(S.project.card.fields,null,1));
  return parts.join('\n\n');
}
// 보낼 때 함께 간 자료를 메시지에 남긴다(이름은 그때 이름으로)
function talkSentSnapshot(chat){
  const c=chat.ctx, out={};
  if(c.assets){
    const m=chatMaterials(chat);
    const items=[...m.assets.filter(a=>assetText(a)).map(a=>({k:'a',id:a.id,name:a.name||'이름 없음'})),
                 ...m.records.filter(r=>recordText(r)).map(r=>({k:'r',id:r.id,name:r.name||'이름 없음'}))];
    if(items.length) out.items=items;
    if(curBrief().trim()) out.brief=true;
  }
  if(c.digest && S.project.digest) out.digest=true;
  if(c.card && S.project.card) out.card=activePreset().name;
  return Object.keys(out).length ? out : null;
}
function talkSentHtml(sent, prevKey){
  if(!sent) return '';
  const n=(sent.items||[]).length+(sent.brief?1:0)+(sent.digest?1:0)+(sent.card?1:0);
  if(JSON.stringify(sent)===prevKey) return `<div class="msg-sent same">자료 그대로 · ${n}개</div>`;
  const chips=[...(sent.items||[]).map(x=>`<button type="button" class="sent-chip" data-k="${x.k}" data-id="${esc(x.id)}" title="크게 보기">${esc(x.name)}</button>`),
    sent.brief?'<span class="sent-chip plain">구상</span>':'', sent.digest?'<span class="sent-chip plain">정리한 내용</span>':'',
    sent.card?`<span class="sent-chip plain">지금 만든 것 · ${esc(sent.card)}</span>`:''].join('');
  return `<div class="msg-sent"><span class="sent-label">함께 보낸 자료</span>${chips}</div>`;
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
const CHAT_MAX=50;        // 기록이 쌓이는 곳이므로 넉넉히
const CHAT_TAB_LIMIT=8;   // 왼쪽에 바로 보이는 개수. 나머지는 전체 보기로
function labelOf(c){ return chatLabel(c, chatList().indexOf(c)); }
function chatPreview(c){
  const last=[...(c.msgs||[])].reverse().find(m=>m.content && m.content.trim());
  if(last) return (last.role==='user'?'나: ':'상대: ')+last.content.trim().replace(/\s+/g,' ').slice(0,60);
  if(c.summary) return '정리만 남아 있음';
  return '아직 아무 말도 안 했습니다';
}
function chatsByRecent(){
  return chatList().slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
}
function touchChat(c){ if(c) c.updated=Date.now(); }
function renderChatTabs(){
  const box=$('#chatTabs'); if(!box) return;
  const all=chatList(), recent=chatsByRecent();
  // 활성 창은 최근 순위에서 밀려나도 항상 보인다
  let shown=recent.slice(0,CHAT_TAB_LIMIT);
  if(!shown.some(c=>c.id===S.chatId)){
    const cur=all.find(c=>c.id===S.chatId);
    if(cur) shown=[cur,...shown.slice(0,CHAT_TAB_LIMIT-1)];
  }
  const list=shown;
  box.innerHTML = list.map((c)=>{
    const on=c.id===S.chatId, label=labelOf(c), sending=CHAT_JOBS.has(c.id);
    return `<div class="chat-tab${on?' on':''}${sending?' sending':''}" role="presentation">${sending?'<span class="chat-tab-dot" title="답을 기다리는 중" aria-label="답을 기다리는 중"></span>':''}<button type="button" role="tab" aria-selected="${on}" class="chat-tab-open" data-chat="${esc(c.id)}" title="${esc(label)}">${esc(label)}</button>`
      + `<button type="button" class="chat-tab-edit" data-chat-rename="${esc(c.id)}" title="이름 바꾸기" aria-label="${esc(label)} 이름 바꾸기"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg></button>`
      + (all.length>1?`<button type="button" class="chat-tab-close" data-chat-close="${esc(c.id)}" title="이 대화창 닫기" aria-label="${esc(label)} 닫기">×</button>`:'')
      + `</div>`;
  }).join('')
    + (all.length>list.length
        ? `<button type="button" class="chat-tab-all" id="btnChatAll">전체 ${all.length}개 보기</button>` : '')
    + '<button type="button" class="chat-tab-add" id="btnChatNew"><span aria-hidden="true">+</span> 새 대화</button>';
}

/* ---- 전체 대화창 보기 --------------------------------------------
   대화창이 쌓이면 고르는 일 자체가 작업이 된다. 팝업에 욱여넣지 않고
   오른쪽 대화 칸을 목록 화면으로 바꿔, 검색하며 찾게 한다. */
let CHAT_BROWSE=false, CHAT_BROWSE_Q='';
function openChatBrowse(){
  CHAT_BROWSE=true; renderChatBrowse();
  const q=$('#chatBrowseQ'); if(q){ q.value=CHAT_BROWSE_Q; q.focus(); }
}
function closeChatBrowse(){ CHAT_BROWSE=false; renderChatBrowse(); }
function renderChatBrowse(){
  const pane=$('#chatBrowse'), wrap=$('#chatWrap');
  if(!pane||!wrap) return;
  pane.hidden=!CHAT_BROWSE; wrap.hidden=CHAT_BROWSE;
  if(!CHAT_BROWSE) return;
  const box=$('#chatBrowseList'); if(!box) return;
  const q=CHAT_BROWSE_Q.trim().toLowerCase();
  const rows=chatsByRecent().filter(c=>{
    if(!q) return true;
    if(labelOf(c).toLowerCase().includes(q)) return true;
    return (c.msgs||[]).some(m=>(m.content||'').toLowerCase().includes(q));
  });
  if(!rows.length){
    box.innerHTML=`<div class="empty"><b>${q?'찾는 대화창이 없습니다':'대화창이 없습니다'}</b>${q?'다른 말로 찾아보세요.':'왼쪽 새 대화로 시작하세요.'}</div>`;
    return;
  }
  box.innerHTML=rows.map(c=>{
    const on=c.id===S.chatId, n=(c.msgs||[]).length;
    const when=c.updated?new Date(c.updated).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    return `<div class="chat-row${on?' on':''}" data-row="${esc(c.id)}">
      <button type="button" class="chat-row-open" data-chat="${esc(c.id)}">
        <span class="chat-row-top"><b>${esc(labelOf(c))}</b>${CHAT_JOBS.has(c.id)?'<span class="chat-tab-dot" aria-label="답을 기다리는 중"></span>':''}<span class="sp"></span><span class="note">${esc(when)}</span></span>
        <span class="chat-row-prev">${esc(chatPreview(c))}</span>
        <span class="note">${TALK_ROLE_LABEL[c.role]||c.role} · ${n}개</span>
      </button>
      <button type="button" class="mini ghost" data-chat-rename="${esc(c.id)}" title="이름 바꾸기" aria-label="${esc(labelOf(c))} 이름 바꾸기">이름</button>
      <button type="button" class="mini ghost danger" data-chat-close="${esc(c.id)}" title="이 대화창 닫기" aria-label="${esc(labelOf(c))} 닫기">×</button>
    </div>`;
  }).join('');
}
// 상담역은 talk-roles.js(window.TALK_ROLES)가 기준. 파일에 없는 역할은 위 예비값
const TALK_ROLE_FILE=(typeof window!=='undefined'&&Array.isArray(window.TALK_ROLES))?window.TALK_ROLES.filter(r=>r&&typeof r.id==='string'&&typeof r.content==='string'):[];
const TALK_ROLE = Object.assign({}, TALK_ROLE_CODE, ...TALK_ROLE_FILE.map(r=>({[r.id]:r.content})));
const TALK_ROLE_LABEL=Object.assign({world:'세계관 상담역',char:'인물 상담역',prompt:'프롬프트 상담역',critic:'냉정한 평가자',free:'역할 없음'},
  ...TALK_ROLE_FILE.filter(r=>r.name).map(r=>({[r.id]:r.name})));
$$('#talkRole option').forEach(o=>{ if(TALK_ROLE_LABEL[o.value]) o.textContent=TALK_ROLE_LABEL[o.value]; });
$('#chatBrowse').addEventListener('click', e=>{
  const close=e.target.closest('[data-chat-close]');
  if(close) return closeChat(close.dataset.chatClose);
  const rename=e.target.closest('[data-chat-rename]');
  if(rename) return renameChat(rename.dataset.chatRename);
  const open=e.target.closest('[data-chat]');
  if(open){ selectChat(open.dataset.chat); closeChatBrowse(); }
});
$('#chatBrowseQ').addEventListener('input', e=>{ CHAT_BROWSE_Q=e.target.value; renderChatBrowse(); });
$('#chatBrowseQ').addEventListener('keydown', e=>{ if(e.key==='Escape'){ e.preventDefault(); closeChatBrowse(); } });
$('#btnChatBrowseClose').addEventListener('click', closeChatBrowse);
/* 답을 기다리는 동안에도 다른 대화창을 읽고 쓸 수 있다.
   답은 보낸 창으로 돌아간다. 다만 그 창을 닫아 버리면 갈 곳이 없다. */
function selectChat(id){
  if(id===S.chatId) return;
  if(!chatList().some(c=>c.id===id)) return;
  S.chatId=id; touchChat(S.chat); save(); applyChatToUI(); renderChat();
}
function newChat(){
  const list=chatList();
  if(list.length>=CHAT_MAX) return toast(`대화창은 ${CHAT_MAX}개까지 만들 수 있습니다`,1);
  // 여러 창을 오갈 때 무슨 대화였는지가 목록의 전부다. 만들 때 물어 둔다.
  const name=prompt('대화창 이름 (비우면 첫 메시지에서 자동)','');
  if(name===null) return;
  const c=emptyChat(S.opts.group);
  c.name=name.trim().slice(0,24);
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
  const next=prompt('대화창 이름 (비우면 첫 메시지에서 자동)', list[at].name||'');
  if(next===null) return;
  list[at].name=next.trim().slice(0,24);
  save(); renderChatTabs();
}
$('#chatTabs').addEventListener('click', e=>{
  const close=e.target.closest('[data-chat-close]');
  if(close) return closeChat(close.dataset.chatClose);
  const rename=e.target.closest('[data-chat-rename]');
  if(rename) return renameChat(rename.dataset.chatRename);
  if(e.target.closest('#btnChatAll')) return openChatBrowse();
  if(e.target.closest('#btnChatNew')) return newChat();
  const open=e.target.closest('[data-chat]'); if(!open) return;
  selectChat(open.dataset.chat);
});
function talkTurnButton(cls, index, label, icon){
  return `<button type="button" class="mini ghost ${cls}" data-message-index="${index}" `
    + `aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" `
    + `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></button>`;
}
const ICON_COPY='<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>';
const ICON_REDO='<path d="M21 4v6h-6"/><path d="M20.5 14a8.5 8.5 0 1 1-2.2-8.1L21 8"/>';
const ICON_TRASH='<path d="M4 7h16"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/>'
  +'<path d="m6 7 .8 12.1A2 2 0 0 0 8.8 21h6.4a2 2 0 0 0 2-1.9L18 7"/><path d="M10 11v6M14 11v6"/>';

/* 답변 다시 받기 — 그 질문을 그대로 다시 보낸다.
   뒤에 이어진 대화는 새 답변과 어긋나므로 함께 지우고, 그 사실을 먼저 묻는다. */
function talkRegenerate(index){
  const chat=S.chat;
  if(CHAT_JOBS.has(chat.id)) return toast('이 대화창은 답을 기다리는 중입니다',1);
  if(chat.msgs.some(m=>m.status)) return toast('실패한 메시지를 먼저 다시 보내거나 삭제해 주세요',1);
  const conn=S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  const idxs=talkTurnIndexes(index); if(!idxs.length) return;
  const start=idxs[0], ask=chat.msgs[start];
  if(!ask || ask.role!=='user') return toast('다시 받을 질문을 찾지 못했습니다',1);
  const tail=chat.msgs.length-(start+idxs.length);
  if(tail>0 && !confirm(`이 답변 뒤의 대화 ${tail}개도 함께 지워집니다. 계속할까요?`)) return;
  chat.msgs.splice(start+1);              // 질문만 남기고 답변부터 끝까지 지운다
  ask.status='failed'; delete ask.error;  // 재전송 경로를 그대로 탄다
  save();
  sendChat(ask.id);
}
function talkDeleteTurn(index){
  if(CHAT_JOBS.has(S.chatId)) return toast('이 대화창은 답을 기다리는 중입니다',1);
  const idxs=talkTurnIndexes(index); if(!idxs.length) return;
  if(idxs.some(i=>S.chat.msgs[i].status)) return;
  if(!confirm('이 문답을 지울까요? 뒤의 대화는 그대로 남습니다.')) return;
  S.chat.msgs.splice(idxs[0], idxs.length);
  save(); renderChat();
}
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
    return `<div class="msg bot wrap${excluded?' history-excluded':''}"><div class="msg-heading"><span class="who">${m.current?'지금까지의 정리':'이전 정리'}</span></div><div class="msg-md">${mdHtml(m.content)}</div><div class="msg-history-control">${excluded?'<span class="chat-history-status">전송 제외</span>':''}${talkHistoryButton(excluded,`data-summary="${esc(m.id)}"`,'이 요약')}</div></div>`;
  }).join('');
  if(!S.chat.msgs.length && !wrapHtml){
    box.innerHTML = '<div class="empty"><b>아직 아무 말도 안 했습니다</b>만든 것을 보여주고 물어보세요.</div>';
  } else {
    // 같은 자료를 연달아 보냈으면 짧게 적으려고 직전 내 메시지의 자료를 기억해 둔다
    let lastSent=null;
    const prevSent=S.chat.msgs.map(m=>{ if(m.role!=='user') return null; const p=lastSent; lastSent=m.sent?JSON.stringify(m.sent):null; return p; });
    box.innerHTML = wrapHtml + S.chat.msgs.map((m,i)=>{
      const excluded=talkTurnExcluded(i), completed=talkTurnIndexes(i).every(n=>!S.chat.msgs[n].status);
      return `<div class="msg ${m.role==='user'?'user':'bot'}${excluded?' history-excluded':''}"><div class="msg-heading"><span class="who">${m.role==='user'?'나':'상대'}</span></div>${m.content?`<div class="msg-md">${mdHtml(m.content)}</div>`:''}${talkFilesHtml(m.files)}${m.role==='user'?talkSentHtml(m.sent, prevSent[i]):''}<div class="msg-history-control">${excluded?'<span class="chat-history-status">전송 제외</span>':''}${completed?talkHistoryButton(excluded,`data-message-index="${i}"`,'이 문답'):''}${talkTurnButton('chat-copy',i,'이 메시지 복사',ICON_COPY)}${completed?talkTurnButton('chat-regen',i,'이 문답의 답변 다시 받기',ICON_REDO)+talkTurnButton('chat-delturn',i,'이 문답 삭제',ICON_TRASH):''}</div>${m.status==='failed'?`<div class="chat-failure"><span>${esc(m.error||'응답을 받지 못했습니다.')}</span><div><button type="button" class="mini chat-retry" data-message="${esc(m.id)}">다시 보내기</button> <button type="button" class="mini ghost chat-discard" data-message="${esc(m.id)}">메시지 삭제</button></div></div>`:m.status==='pending'?'<div class="note">응답을 기다리고 있습니다.</div>':''}</div>`;
    }).join('');
  }
  const t = tok(talkContext());
  const ct = tok(talkHistorySummary()+talkHistoryMessages().map(m=>m.content).join('\n'));
  $('#ctxTok').textContent = (t ? `함께 보낼 분량 ${t} 토큰쯤` : '함께 보낼 것 없음')
    + (ct ? ` · 대화 ${ct} / 한도 ${talkBudget(S.connections.find(c=>c.id===S.activeConn), talkSystemParts(S.chat).join('\n\n')).toLocaleString()} 토큰쯤` : '');
  renderChatTabs();
  renderChatBrowse();
  renderChatActions();
  $('#talkAutoCompact').checked = talkAutoCompactOn();
  renderChatAttach();
  hydrateChatImages(box);
  renderTalkAssets();
  renderWrapNudge(ct);
  const toCard = $('#btnTalkToCard');
  if(toCard) toCard.disabled = !(S.project.card && (talkHistoryMessages().length || talkHistorySummary()));
  resizeChatInput();
  box.scrollTop = preserveScroll?scrollTop:box.scrollHeight;
}
// 요약 권유는 자동 정리를 끈 경우에만, 대화가 한도의 70%를 넘을 때 띄운다
function renderWrapNudge(){
  const el = $('#wrapNudge'); if(!el) return;
  const conn = S.connections.find(c=>c.id===S.activeConn);
  const ct = talkHistoryMessages().reduce((a,m)=>a+msgTok(m),0);
  const show = !talkAutoCompactOn() && ct >= talkBudget(conn, talkSystemParts(S.chat).join('\n\n'))*TALK_NUDGE_AT
    && talkHistoryMessages().length >= 4 && !S.chat.nudgeOff;
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
    const head = `<label class="nebula-row"><input type="checkbox" class="t-use" data-id="${a.id}" ${chatPicked('assets',a.id)?'checked':''}>
      <span>${esc(a.name)}</span><span class="sp"></span>
      <button type="button" class="lb-toggle" data-id="${a.id}">${on}/${a.entries.length} 항목 ${open?'▴':'▾'}</button></label>`;
    const entries = a.entries.map((en,i)=>`
      <label class="nebula-row lb-entry"><input type="checkbox" class="t-entry" data-id="${a.id}" data-ei="${i}" ${en.use?'checked':''} ${chatPicked('assets',a.id)?'':'disabled'}>
        <span>${esc(en.comment||en.key||(en.keys&&en.keys.join(', '))||'항목 '+(i+1))}</span><span class="sp"></span><span class="note">${tok(en.content||'')} 토큰쯤</span></label>`).join('');
    return `<div class="lb-pick" data-id="${a.id}">${head}<div class="lb-entries" ${open?'':'hidden'}>${entries}</div></div>`;
  }
  return `<label class="nebula-row"><input type="checkbox" class="t-use" data-id="${a.id}" ${chatPicked('assets',a.id)?'checked':''}>
      <span>${esc(a.name)}</span><span class="sp"></span><span class="note">${kindLabel} · ${assetTok(a)} 토큰쯤</span></label>`;
}
function renderTalkAssets(){
  const box = $('#talkAssetList'), assetCount = $('#talkAssetCount'); if(!box) return;
  const c=S.chat.ctx||{}, materialText=chatSourceText(S.chat), digestText=S.project.digest?JSON.stringify(S.project.digest):'';
  const cardText=S.project.card?JSON.stringify(S.project.card.fields||{}):'';
  const picks=chatPicks(), n = picks.assets.filter(id=>assetById(id)).length + picks.records.filter(id=>S.library.some(r=>r.id===id)).length, total=S.assets.length+S.library.length;
  assetCount.textContent = total ? `선택 ${n}/${total}개` : '성운이 비어 있습니다';
  const recRows=S.library.length?'<div class="pick-section">완성본</div>'+[...S.library].sort((a,b)=>(b.updated||b.at)-(a.updated||a.at)).map(r=>`
    <label class="nebula-row"><input type="checkbox" class="t-rec" data-id="${r.id}" ${chatPicked('records',r.id)?'checked':''}>
      <span>${esc(r.name||'이름 없음')}</span><span class="sp"></span><span class="note">${esc(GROUP_LABEL[r.group]||'')} · ${esc(r.presetName||'')}</span></label>`).join(''):'';
  box.innerHTML = total ? S.assets.map(talkAssetRow).join('')+recRows
    : '<div class="note">재료 탭에서 파일이나 글을 먼저 넣어 주세요.</div>';
  const assets=$('#ctxAssets'), digest=$('#ctxDigest'), card=$('#ctxCard');
  assets.disabled=!(total||curBrief().trim()); digest.disabled=!digestText; card.disabled=!cardText;
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
  // 대화창별 선택: 작업대의 재료 선택은 건드리지 않는다
  if(e.target.classList.contains('t-rec')){ setChatPick('records', e.target.dataset.id, e.target.checked); save(); renderChat(); return; }
  if(e.target.classList.contains('t-use')){
    if(!assetById(e.target.dataset.id)) return;
    setChatPick('assets', e.target.dataset.id, e.target.checked);
    save(); renderChat();
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
/* ---- 대화 분량 ---------------------------------------------------
   개수가 아니라 토큰 분량으로 보낸다. 한도 = 연결의 컨텍스트 상한(없으면 64,000)에서
   응답 몫과 시스템 지시(역할·정리·자료)를 뺀 나머지.
   대화가 그 80%에 닿으면 오래된 쪽을 요약해 '지금까지의 정리'에 합치고,
   최근 대화(한도의 40%, 최소 4개)는 원문으로 둔다 — 묻지 않고 알아서. */
const TALK_CONTEXT_DEFAULT=64000, TALK_REPLY_TOKENS=2200, TALK_COMPACT_AT=0.8, TALK_KEEP_SHARE=0.4, TALK_KEEP_MIN=4, TALK_NUDGE_AT=0.7;
function talkSystemParts(chat){
  const sys=[];
  const custom=S.customTalkPrompts && S.customTalkPrompts[chat.role];
  if(custom && custom.trim()) sys.push(custom.trim());
  else if(TALK_ROLE[chat.role]) sys.push(TALK_ROLE[chat.role]);
  sys.push(`${S.opts.lang||'한국어'} 로 답한다.`);
  const summary=talkHistorySummary();
  if(summary) sys.push('아래는 지금까지 나눈 대화를 압축한 정리다. 이 맥락 위에서 이어서 대화한다.\n\n'+summary);
  const ctx=talkContext(chat);
  if(ctx) sys.push('아래는 상대가 지금 다루고 있는 자료다. 묻지 않은 것까지 통째로 다시 써주지 마라.\n\n'+ctx);
  return sys;
}
// 이미지는 한 장에 1,000토큰쯤, 글 첨부는 글자 수로 어림한다
function msgTok(m){ return tok(m.content)+(m.files||[]).reduce((a,f)=>a+(f.kind==='image'?1000:Math.ceil((f.size||0)/3)),0); }
function talkBudget(conn, sysText){
  const total=(conn&&conn.contextLimit)||TALK_CONTEXT_DEFAULT;
  const reply=(conn&&conn.maxTokens)||TALK_REPLY_TOKENS;
  return Math.max(2000, total-reply-tok(sysText||''));
}
// 끝에서부터 분량 안에 드는 만큼. 질문 없는 답으로 시작하지 않게 앞을 다듬는다
function talkHistoryFit(pendingMessage, budget){
  const all=talkHistoryMessages(pendingMessage), out=[]; let used=0;
  for(let i=all.length-1;i>=0;i--){
    const t=msgTok(all[i]); if(out.length && used+t>budget) break;
    out.unshift(all[i]); used+=t;
  }
  while(out.length>1 && out[0].role!=='user') out.shift();
  return out;
}
function talkAutoCompactOn(){ return S.talkAutoCompact!==false; }
$('#talkAutoCompact').checked = talkAutoCompactOn();
$('#talkAutoCompact').addEventListener('change', e=>{ S.talkAutoCompact = e.target.checked; save(); renderChat(true); });
function talkSummaryRequest(convo, merging){
  return [
    {role:'system', content:'너는 진행 중인 창작 상담 대화를 이어가기 위한 압축 정리를 만든다. 새 의견이나 제안을 덧붙이지 않는다. '+(S.opts.lang||'한국어')+' 로 쓴다.'},
    {role:'user', content:(merging?'맨 앞의 [지금까지의 정리]는 이미 정리해 둔 내용이다. 그 내용을 빠뜨리지 말고 뒤의 대화와 합쳐 하나로 다시 정리하라.\n':'')
      +'아래 대화를 다음 항목으로 정리하라. 각 항목은 짧은 개조식으로, 없는 항목은 빼라.\n- 다룬 주제\n- 정해진 것·합의\n- 검토했지만 접은 것\n- 아직 열린 질문\n\n대화:\n'+convo}
  ];
}
// 새 정리를 앉히고 정리한 원문을 뺀다. 전송에서 제외해 둔 이전 정리는 기록으로 남긴다
function applyTalkSummary(chat, text, dropped){
  chat.summaryHistory=(chat.summaryHistory||[]).filter(m=>m.includeHistory===false);
  if(chat.summary && chat.summaryIncluded===false) chat.summaryHistory.push({id:uid(),content:chat.summary,includeHistory:false});
  chat.summary=text.trim(); chat.summaryIncluded=true;
  const drop=new Set(dropped); chat.msgs=chat.msgs.filter(m=>!drop.has(m));
}
function talkNeedsCompact(chat, conn, pendingMessage){
  if(!talkAutoCompactOn() || chat!==S.chat) return false;
  const budget=talkBudget(conn, talkSystemParts(chat).join('\n\n'));
  return talkHistoryMessages(pendingMessage).reduce((a,m)=>a+msgTok(m),0) >= budget*TALK_COMPACT_AT;
}
async function autoCompactTalk(chat, conn, pendingMessage, job){
  if(!talkNeedsCompact(chat, conn, pendingMessage)) return false;
  const all=talkHistoryMessages(pendingMessage);
  const budget=talkBudget(conn, talkSystemParts(chat).join('\n\n'));
  // 끝에서부터 남길 몫을 세고, 남는 쪽이 질문으로 시작하게(문답이 갈리지 않게) 자른다
  let keep=0, used=0;
  for(let i=all.length-1;i>=0;i--){
    const t=msgTok(all[i]);
    if(keep>=TALK_KEEP_MIN && used+t>budget*TALK_KEEP_SHARE) break;
    used+=t; keep++;
  }
  let cut=all.length-keep;
  while(cut>0 && all[cut] && all[cut].role!=='user') cut--;
  const old=all.slice(0,cut).filter(m=>m!==pendingMessage);
  if(old.length<2) return false;
  const prev=talkHistorySummary();
  const wired=await Promise.all(old.map(talkWireMessage));
  const convo=(prev?'[지금까지의 정리]\n'+prev+'\n\n':'')+wired.map((w,i)=>(old[i].role==='user'?'[나] ':'[상대] ')+w.content+(w.images?`\n(이미지 ${w.images.length}장)`:'')).join('\n\n');
  const out=await callProvider(conn, talkSummaryRequest(convo, !!prev), {temperature:0.3, maxTokens:1500,
    concurrent:true, onStart:c=>{ job.controller=c; }});
  if(job.cancelled) throw new Error('__ABORT__');
  applyTalkSummary(chat, out, old);
  save();
  toast(`대화가 길어져 앞부분 ${old.length}개를 자동으로 정리했습니다`);
  return true;
}
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
    const out = await callProvider(conn, talkSummaryRequest(convo, false), {temperature:0.3, maxTokens:1000,
      concurrent:true, onStart:c=>{ job.controller=c; }});
    if(job.cancelled) throw new Error('__ABORT__');
    applyTalkSummary(chat, out, included);
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
/* ---- 대화 첨부 ------------------------------------------------
   내용은 IndexedDB(orrery-files)에 두고 메시지에는 {id,name,kind,mime}만 남긴다 —
   이미지를 localStorage 에 넣으면 금방 꽉 찬다. IndexedDB 가 없으면 이 창 메모리에만 둔다. */
const CHAT_FILE_DB='orrery-files', CHAT_TEXT_MAX=200000, CHAT_IMAGE_EDGE=1568, CHAT_ATTACH_MAX=8;
const CHAT_FILE_MEM=new Map();      // id -> {mime,data} | {text}
const CHAT_PENDING=new Map();       // chatId -> 보내기 전 첨부 [{id,name,kind,mime}]
const FILE_ICON='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>';
let chatFileDb=null;
function openChatFileDb(){
  if(!chatFileDb) chatFileDb=new Promise(resolve=>{
    try{
      if(!window.indexedDB) return resolve(null);
      const req=indexedDB.open(CHAT_FILE_DB,1);
      req.onupgradeneeded=()=>req.result.createObjectStore('files');
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>resolve(null);
    }catch(_){ resolve(null); }
  });
  return chatFileDb;
}
async function chatFileStore(mode, fn){
  const db=await openChatFileDb(); if(!db) return undefined;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('files',mode), req=fn(tx.objectStore('files'));
    tx.oncomplete=()=>resolve(req&&req.result); tx.onerror=()=>reject(tx.error);
  });
}
async function putChatFile(id,rec){
  rec={...rec,at:Date.now()}; CHAT_FILE_MEM.set(id,rec);
  try{ await chatFileStore('readwrite',st=>st.put(rec,id)); }
  catch(_){ toast('첨부를 저장하지 못했습니다 · 새로고침하면 사라집니다',1); }
}
async function getChatFile(id){
  if(CHAT_FILE_MEM.has(id)) return CHAT_FILE_MEM.get(id);
  try{ const rec=await chatFileStore('readonly',st=>st.get(id)); if(rec) CHAT_FILE_MEM.set(id,rec); return rec||null; }
  catch(_){ return null; }
}
// 어느 대화에도 남지 않은 첨부(지운 문답, 보내지 않고 닫은 것)는 시작할 때 지운다.
// 다른 창에서 아직 보내지 않은 첨부를 건드리지 않게 하루 지난 것만.
async function gcChatFiles(){
  const keep=new Set(chatList().flatMap(c=>c.msgs.flatMap(m=>(m.files||[]).map(f=>f.id))));
  try{ await chatFileStore('readwrite',st=>{
    const cur=st.openCursor();
    cur.onsuccess=()=>{ const c=cur.result; if(!c) return; if(!keep.has(c.key) && Date.now()-(c.value?.at||0)>864e5) c.delete(); c.continue(); };
    return null;
  }); }catch(_){}
}
function blobBase64(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(',')[1]||'');
    r.onerror=()=>reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
  });
}
// 긴 변이 1568px 를 넘거나 1.5MB 가 넘으면 줄여서 JPEG 로. 공급자 대부분이 그 이상은 어차피 줄인다.
async function shrinkImage(file){
  const mime=/^image\/(png|jpeg|webp|gif)$/.test(file.type)?file.type:'image/png';
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{
      const i=new Image(); i.onload=()=>resolve(i); i.onerror=()=>reject(new Error(`${file.name||'이미지'}: 이미지를 열지 못했습니다.`)); i.src=url;
    });
    const w=img.naturalWidth, h=img.naturalHeight, scale=Math.min(1,CHAT_IMAGE_EDGE/Math.max(w,h,1));
    if(scale===1 && file.size<=1.5e6) return {mime, data:await blobBase64(file)};
    const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*scale)); c.height=Math.max(1,Math.round(h*scale));
    const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
    return {mime:'image/jpeg', data:c.toDataURL('image/jpeg',0.86).split(',')[1]};
  }finally{ URL.revokeObjectURL(url); }
}
async function saveChatText(name,text){
  const id=uid();
  if(text.length>CHAT_TEXT_MAX) text=text.slice(0,CHAT_TEXT_MAX)+`\n…(${CHAT_TEXT_MAX.toLocaleString()}자 이후 생략)`;
  await putChatFile(id,{text});
  return {id,name,kind:'text',size:text.length};
}
// 카드·로어북·프리셋은 재료와 같은 방식으로 글로 푼다. 로어북은 꺼 둔 항목까지 전부.
async function chatFileAsText(file){
  const assets=await sniff(file);
  const text=assets.map(a=>assetText(a.kind==='lorebook'?{...a,entries:(a.entries||[]).map(e=>({...e,use:true}))}:a)).filter(Boolean).join('\n\n');
  if(!text.trim()) throw new Error(`${file.name}: 읽을 내용이 없습니다.`);
  return saveChatText(file.name,text);
}
async function readChatAttachment(file){
  const name=file.name||'붙여넣은 이미지';
  if(/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(name)){
    // 카드 PNG 는 그림이 아니라 카드 내용으로 읽는다. 카드 정보가 없으면 그냥 그림.
    if(file.type==='image/png' || /\.png$/i.test(name)){
      const card=await chatFileAsText(file).catch(()=>null);
      if(card) return card;
    }
    const img=await shrinkImage(file), id=uid();
    await putChatFile(id,img);
    return {id,name,kind:'image',mime:img.mime};
  }
  if(/\.(json|charx|marinara|preset|zip)$/i.test(name)) return chatFileAsText(file);
  const text=await file.text();
  if(text.includes('\u0000')||(text.match(/�/g)||[]).length>3)
    throw new Error(`${name}: 읽을 수 없는 파일입니다. 이미지나 글 파일을 붙여 주세요.`);
  return saveChatText(name,text);
}
async function addChatFiles(files){
  const chatId=S.chatId, list=CHAT_PENDING.get(chatId)||[];
  for(const file of files){
    if(list.length>=CHAT_ATTACH_MAX){ toast(`한 번에 ${CHAT_ATTACH_MAX}개까지 붙일 수 있습니다`,1); break; }
    try{ list.push(await readChatAttachment(file)); }
    catch(err){ toast(err.message,1); }
  }
  CHAT_PENDING.set(chatId,list);
  if(S.chatId===chatId) renderChatAttach();
}
function chatImageSrc(rec){ return rec&&rec.data?`data:${rec.mime};base64,${rec.data}`:''; }
function renderChatAttach(){
  const box=$('#chatAttach'), list=CHAT_PENDING.get(S.chatId)||[];
  box.hidden=!list.length;
  box.innerHTML=list.map((f,i)=>`<span class="chat-attach-item">${f.kind==='image'
      ?`<img data-file="${esc(f.id)}" alt="">`:FILE_ICON}<span class="chat-attach-name">${esc(f.name)}</span>`+
    `<button type="button" class="chat-attach-del" data-index="${i}" aria-label="${esc(f.name)} 빼기">×</button></span>`).join('');
  hydrateChatImages(box);
}
function talkFilesHtml(files){
  if(!files||!files.length) return '';
  return `<div class="msg-files">${files.map(f=>f.kind==='image'
    ?`<img class="msg-img" data-file="${esc(f.id)}" alt="${esc(f.name)}" title="${esc(f.name)}">`
    :`<span class="msg-file">${FILE_ICON}${esc(f.name)}</span>`).join('')}</div>`;
}
async function hydrateChatImages(root){
  for(const img of root.querySelectorAll('img[data-file]:not([src])')){
    const rec=await getChatFile(img.dataset.file);
    if(rec&&rec.data){ img.src=chatImageSrc(rec); continue; }
    const miss=document.createElement('span');
    miss.className='msg-file missing'; miss.textContent=(img.alt||'이미지')+' · 이 브라우저에 없음';
    img.replaceWith(miss);
  }
}
// 보낼 때: 글 파일은 본문 뒤에 붙이고, 이미지는 images 로 따로 싣는다.
async function talkWireMessage(m){
  const out={role:m.role, content:m.content||''};
  if(!m.files||!m.files.length) return out;
  const texts=[], images=[];
  for(const f of m.files){
    const rec=await getChatFile(f.id);
    if(!rec){ texts.push(`[첨부 ${f.name}: 이 브라우저에서 찾을 수 없음]`); continue; }
    if(f.kind==='image') images.push({mime:rec.mime,data:rec.data});
    else texts.push(`[첨부 파일: ${f.name}]\n${rec.text}`);
  }
  out.content=[out.content,...texts].filter(Boolean).join('\n\n');
  if(images.length) out.images=images;
  return out;
}
$('#chatLog').addEventListener('click',e=>{
  const img=e.target.closest('.msg-img'); if(img){ img.classList.toggle('zoom'); return; }
  const chip=e.target.closest('.sent-chip[data-id]'); if(!chip) return;
  const id=chip.dataset.id;
  if(chip.dataset.k==='r'){ if(S.library.some(r=>r.id===id)) openLibView(id); else toast('지금은 성도에 없는 완성본입니다',1); }
  else if(assetById(id)) openAssetView(id); else toast('지금은 재료에 없는 자료입니다',1);
});
$('#btnChatAttach').addEventListener('click',()=>$('#chatFileIn').click());
$('#chatFileIn').addEventListener('change',e=>{ const files=[...e.target.files]; e.target.value=''; addChatFiles(files); });
$('#chatAttach').addEventListener('click',e=>{
  const del=e.target.closest('.chat-attach-del'); if(!del) return;
  const list=CHAT_PENDING.get(S.chatId)||[]; list.splice(Number(del.dataset.index),1);
  renderChatAttach(); $('#chatIn').focus();
});
$('#chatIn').addEventListener('paste',e=>{
  const files=[...(e.clipboardData?.files||[])];
  if(!files.length) return;
  e.preventDefault(); addChatFiles(files);
});
$('#chatWrap').addEventListener('dragover',e=>{ if([...(e.dataTransfer?.types||[])].includes('Files')){ e.preventDefault(); $('#chatWrap').classList.add('drop'); } });
$('#chatWrap').addEventListener('dragleave',e=>{ if(!$('#chatWrap').contains(e.relatedTarget)) $('#chatWrap').classList.remove('drop'); });
$('#chatWrap').addEventListener('drop',e=>{
  $('#chatWrap').classList.remove('drop');
  const files=[...(e.dataTransfer?.files||[])]; if(!files.length) return;
  e.preventDefault(); addChatFiles(files);
});
async function sendChat(retryId){
  const chat=S.chat, inp=$('#chatIn');
  if(CHAT_JOBS.has(chat.id)) return;
  const failed=chat.msgs.find(m=>m.status==='failed');
  const retry=typeof retryId==='string' && failed && failed.id===retryId;
  if(failed&&!retry) return toast('실패한 메시지의 다시 보내기를 눌러 주세요. 새 입력은 그대로 남겨 뒀습니다.',1);
  const text=retry?failed.content:inp.value.trim();
  const files=retry?(failed.files||[]):[...(CHAT_PENDING.get(chat.id)||[])];
  if(!text && !files.length) return;
  const conn = S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  const job={kind:'send',controller:null,cancelled:false};
  CHAT_JOBS.set(chat.id,job); touchChat(chat);
  const message=retry?failed:{id:uid(),role:'user',content:text,includeHistory:true,...(files.length?{files}:{})};
  message.includeHistory=true; message.status='pending'; delete message.error;
  if(!retry){ chat.msgs.push(message); inp.value=''; chat.inputDraft=''; CHAT_PENDING.delete(chat.id); renderChatAttach(); }
  try{
  renderChat(); save();
  // 넘치기 전에 오래된 앞부분을 자동 정리한다. 실패해도 대화는 막지 않고 분량에 맞춰 자른 채 보낸다.
  // 정리할 게 없으면 기다리지 않고 바로 보낸다
  try{ if(talkNeedsCompact(chat, conn, message) && await autoCompactTalk(chat, conn, message, job)) renderChat(chat.id!==S.chatId); }
  catch(err){ if(err.message==='__ABORT__') throw err; log('대화 자동 정리 실패 · 앞부분을 잘라 보냅니다: '+err.message,'err'); }
  // 보낼 내용은 지금 이 자리에서 다 굳힌다 — 기다리는 동안 다른 창으로 옮겨도 흔들리지 않게.
  const sys = talkSystemParts(chat);
  const sent = talkSentSnapshot(chat);
  if(sent) message.sent = sent; else delete message.sent;
  // 개수가 아니라 분량으로: 한도 안에 드는 만큼 최근 대화부터 싣는다.
  // 첨부가 있을 때만 파일을 읽느라 기다린다. 글뿐이면 바로 보낸다.
  const history = talkHistoryFit(message, talkBudget(conn, sys.join('\n\n')));
  const msgs = [{role:'system', content: sys.join('\n\n')}].concat(
    history.some(m=>m.files&&m.files.length) ? await Promise.all(history.map(talkWireMessage))
      : history.map(m=>({role:m.role, content:m.content})));
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
  const copyBtn=e.target.closest('.chat-copy');
  if(copyBtn){ const m=S.chat.msgs[Number(copyBtn.dataset.messageIndex)]; if(m) copy(m.content); return; }
  const regen=e.target.closest('.chat-regen');
  if(regen) return talkRegenerate(Number(regen.dataset.messageIndex));
  const delTurn=e.target.closest('.chat-delturn');
  if(delTurn) return talkDeleteTurn(Number(delTurn.dataset.messageIndex));
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


/* ---- 대화 → 완성본 -------------------------------------------
   대화에서 확정된 것만 골라 양식 칸에 옮겨 성도(완성본)에 저장한다. */
let TALK_RECORD_BUSY=false;
// 세계·인물 분류의 양식이면 사용자가 만든 것도 쓴다. 점검 보고서·양식 설계는 완성본이 아니라 뺀다.
function talkRecordPresets(){
  return S.presets.filter(p=>['character','world'].includes(p.group)&&!['report','schema'].includes(p.kind)&&Array.isArray(p.schema)&&p.schema.length);
}
function openTalkRecord(){
  if(!talkHistoryMessages().length && !talkHistorySummary()) return toast('정리할 대화가 없습니다',1);
  const list=talkRecordPresets(), sel=$('#talkRecordPreset');
  const want=S.chat.role==='char'?'character':S.chat.role==='world'?'world':null;
  const pick=(want&&list.find(p=>p.group===want))||list.find(p=>p.id===S.activePreset)||list[0];
  sel.innerHTML=list.map(p=>`<option value="${esc(p.id)}" ${p===pick?'selected':''}>[${esc(GROUP_LABEL[p.group]||'')}] ${esc(p.name)}</option>`).join('');
  renderTalkRecordNote();
  $('#talkRecordModal').hidden=false; sel.focus();
}
function renderTalkRecordNote(){
  const P=S.presets.find(p=>p.id===$('#talkRecordPreset').value);
  $('#talkRecordNote').textContent=P?`칸 ${P.schema.length}개: ${P.schema.map(f=>f.label).join(' · ')}`:'';
}
function closeTalkRecord(){ $('#talkRecordModal').hidden=true; }
async function talkRecordTranscript(){
  const parts=[], summary=talkHistorySummary();
  if(summary) parts.push('[지금까지의 정리]\n'+summary);
  for(const m of talkHistoryMessages()){
    const w=await talkWireMessage(m);
    parts.push((m.role==='user'?'[나] ':'[상대] ')+w.content+(w.images?`\n(이미지 ${w.images.length}장 첨부)`:''));
  }
  return parts.join('\n\n');
}
async function runTalkRecord(){
  if(TALK_RECORD_BUSY) return;
  const P=S.presets.find(p=>p.id===$('#talkRecordPreset').value); if(!P) return;
  const conn=S.connections.find(c=>c.id===S.activeConn);
  if(!conn) return toast('먼저 연결을 만들어 주세요',1);
  const btn=$('#talkRecordRun'); TALK_RECORD_BUSY=true; btn.disabled=true; btn.textContent='정리하는 중…';
  try{
    const lang=S.opts.lang||'한국어';
    const fields=P.schema.map(f=>`- "${f.key}": ${f.label}${f.hint?' — '+f.hint:''}`).join('\n');
    const msgs=[
      {role:'system',content:`너는 창작 상담 대화에서 확정된 내용을 정해진 양식의 칸에 옮겨 적는 정리자다.
- 대화에서 합의되거나 확정된 내용만 쓴다. 제안만 되고 채택되지 않은 것, 아직 여러 안이 남은 것은 쓰지 않는다.
- 대화에 없는 내용을 지어내지 않는다. 대화에서 다루지 않은 칸은 빈 문자열로 둔다.
- 뒤에 나온 결정이 앞의 결정을 바꿨으면 뒤의 것을 따른다.
- ${lang}로 쓴다.
- 출력은 JSON 객체 하나뿐이다. 설명이나 코드 울타리를 붙이지 않는다.`},
      {role:'user',content:`양식: ${P.name}\n칸:\n${fields}\n\n위 칸 이름(key)을 그대로 키로 쓴 JSON 객체로 답하라.\n\n[대화]\n${await talkRecordTranscript()}`}
    ];
    const out=await callProvider(conn,msgs,{temperature:0.4,maxTokens:4000,concurrent:true});
    const j=extractJson(out), got={};
    P.schema.forEach(f=>{ const v=j&&j[f.key]; const t=Array.isArray(v)?v.join('\n'):v==null?'':typeof v==='object'?JSON.stringify(v,null,1):String(v); if(t.trim()) got[f.key]=t.trim(); });
    if(!Object.keys(got).length) throw new Error('대화에서 이 양식에 옮길 내용을 찾지 못했습니다.');
    const now=Date.now();
    const rec={id:uid(),star:false,at:now,updated:now,name:guessName(got,P)||'대화에서 정리',fields:got,
      presetId:P.id,presetName:P.name,group:P.group||'character',world:'',from:'chat'};
    S.library.push(rec); save(); renderLib();
    closeTalkRecord(); openLibView(rec.id);
    toast('완성본에 저장했습니다 · 성도에서 다시 볼 수 있습니다');
  }catch(err){ if(err.message!=='__ABORT__') showErr(err); }
  finally{ TALK_RECORD_BUSY=false; btn.disabled=false; btn.textContent='정리하기'; }
}
$('#btnTalkToRecord').addEventListener('click',openTalkRecord);
$('#talkRecordPreset').addEventListener('change',renderTalkRecordNote);
$('#talkRecordRun').addEventListener('click',runTalkRecord);
$('#talkRecordClose').addEventListener('click',closeTalkRecord);
$('#talkRecordModal').addEventListener('click',e=>{ if(e.target.id==='talkRecordModal') closeTalkRecord(); });
