const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
function boot(t, saved = '{}') {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url:'http://orrery.test/', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  w.fetch = async () => { throw new Error('Unexpected network request'); };
  w.localStorage.setItem('orrery.v1', saved);
  const context = dom.getInternalVMContext(), run = code => vm.runInContext(code, context);
  for (const script of w.document.querySelectorAll('script[src]')) {
    const file = script.getAttribute('src').split('?')[0];
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
  }
  vm.runInContext('RETRY_DELAYS=[5,5]', context);   // 시험에서는 다시 시도 대기를 아주 짧게
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  return {w,run,$:selector=>w.document.querySelector(selector),$$:selector=>w.document.querySelectorAll(selector)};
}
const plain = value => JSON.parse(JSON.stringify(value));
function stubReplies(a, replies) {
  const requests = [];
  a.run("S.connections=[{id:'test',name:'Test',provider:'openai',apiKey:'test-only',model:'test-model'}]; S.activeConn='test';");
  a.w.fetch = async (_url,opts) => {
    requests.push(JSON.parse(opts.body));
    assert.ok(replies.length, 'unexpected extra request');
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:replies.shift()}}]})};
  };
  return requests;
}
function exchanges(a) {
  a.run(`S.chat.msgs=[
    {role:'user',content:'private question'}, {role:'assistant',content:'private answer'},
    {role:'user',content:'public question'}, {role:'assistant',content:'public answer'}
  ]; renderChat();`);
}

test('an eye toggle excludes its entire exchange, preserves visible text and survives reload', t => {
  const a = boot(t);
  exchanges(a);
  assert.equal(a.run('talkHistoryMessages().length'), 4, 'legacy messages are included by default');
  a.$('[data-message-index="1"]').click();
  assert.deepEqual(plain(a.run('S.chat.msgs.map(m=>m.includeHistory)')), [false,false,null,null]);
  assert.deepEqual(plain(a.run('talkHistoryMessages().map(m=>m.content)')), ['public question','public answer']);
  assert.equal(a.w.document.querySelectorAll('.history-excluded').length, 2);
  assert.match(a.$('#chatLog').textContent, /private answer/);
  assert.equal(a.$('[data-message-index="0"]').getAttribute('aria-pressed'), 'true');
  assert.match(a.$('[data-message-index="0"]').getAttribute('aria-label'), /이 문답.*포함/);
  const restored = boot(t,a.w.localStorage.getItem('orrery.v1'));
  assert.equal(restored.$('[data-message-index="1"]').getAttribute('aria-pressed'), 'true');
  restored.$('[data-message-index="0"]').click();
  assert.equal(restored.run('talkHistoryMessages().length'), 4);
});

test('outbound chat removes excluded exchanges and summary while sending the new message once', async t => {
  const a = boot(t), requests = stubReplies(a,['fresh answer']);
  exchanges(a);
  a.run("S.chat.summary='private old summary'; renderChat();");
  a.$('[data-message-index="0"]').click();
  a.$('[data-summary="current"]').click();
  a.$('#chatIn').value = 'fresh question';
  await a.run('sendChat()');
  assert.equal(requests.length,1);
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /private/);
  assert.deepEqual(requests[0].messages.filter(m=>m.role!=='system').map(m=>m.content),
    ['public question','public answer','fresh question']);
  assert.equal(a.run('S.chat.msgs.length'),6);
});

test('summarizing omits excluded content and keeps excluded exchanges and old summary recoverable', async t => {
  const a = boot(t), requests = stubReplies(a,['public compressed summary','later answer']);
  exchanges(a);
  a.run("S.chat.summary='private old summary'; renderChat();");
  a.$('[data-message-index="1"]').click();
  a.$('[data-summary="current"]').click();
  await a.run('wrapTalk()');
  assert.equal(requests.length,1);
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /private/);
  assert.deepEqual(plain(a.run('S.chat.msgs.map(m=>m.content)')), ['private question','private answer']);
  assert.equal(a.run('S.chat.summaryHistory[0].content'),'private old summary');
  assert.equal(a.run('S.chat.summaryHistory[0].includeHistory'),false);
  assert.match(a.$('#chatLog').textContent, /private old summary/);
  a.$('#chatIn').value = 'later question';
  await a.run('sendChat()');
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /private/);
  const archivedId = a.run('S.chat.summaryHistory[0].id');
  [...a.w.document.querySelectorAll('[data-summary]')].find(el=>el.dataset.summary===archivedId).click();
  assert.match(a.run('talkHistorySummary()'), /private old summary/);
  a.$('#btnTalkClear').click();
  assert.equal(a.run('talkSummaryItems().length'),0);
});

test('exported material contains only included history; the full transcript still preserves all text', t => {
  const a = boot(t);
  exchanges(a);
  a.$('[data-message-index="0"]').click();
  assert.match(a.run('talkTranscript(false,true)'), /private answer/);
  a.$('#btnTalkToAsset').click();
  assert.doesNotMatch(a.run('S.assets.at(-1).body'), /private/);
  assert.match(a.run('S.assets.at(-1).body'), /public answer/);
  a.$('[data-message-index="2"]').click();
  assert.equal(a.run('talkTranscript(true)'), '');
});

test('sending chat to materials persists across reload and refreshes the context picker and token count', t => {
  const a = boot(t);
  exchanges(a);
  a.run('S.assets=[]; S.chat.ctx.assets=true; renderAssets(); renderChat();');
  const tokenLabelBefore = a.$('#ctxTok').textContent;
  assert.equal(a.w.document.querySelectorAll('#talkAssetList .t-use').length, 0);
  a.$('#btnTalkToAsset').click();
  const asset = plain(a.run('S.assets[0]'));
  assert.match(asset.body, /public answer/);
  assert.equal(asset.use, true);
  assert.equal(a.w.document.querySelectorAll('#talkAssetList .t-use').length, 1);
  assert.equal(a.$('#talkAssetList .t-use').dataset.id, asset.id);
  // 지금 대화를 재료로 만든 것이라 같은 대화창에는 고르지 않는다(대화가 두 번 들어가지 않게).
  // 작업대·다른 대화창에서 쓰는 용도
  assert.equal(a.$('#talkAssetList .t-use').checked, false);
  assert.match(a.$('#talkAssetCount').textContent, /0\/1/);
  assert.equal(a.$('#ctxTok').textContent, tokenLabelBefore);
  assert.match(a.$('#ctxTok').textContent, /함께 보낼 것 없음/);
  assert.equal(a.$('#ctxAssets').disabled, false);
  const restored = boot(t, a.w.localStorage.getItem('orrery.v1'));
  assert.equal(restored.run('S.assets.length'), 1);
  assert.equal(restored.run('S.assets[0].id'), asset.id);
  assert.equal(restored.run('S.assets[0].body'), asset.body);
  assert.equal(restored.$('#talkAssetList .t-use').checked, false);
});

test('sending chat to materials refuses to change state while another task is active', t => {
  const a = boot(t);
  exchanges(a);
  a.run('save(); beginTask();');
  const assetsBefore = plain(a.run('S.assets'));
  const savedBefore = a.w.localStorage.getItem('orrery.v1');
  a.$('#btnTalkToAsset').click();
  assert.deepEqual(plain(a.run('S.assets')), assetsBefore);
  assert.equal(a.w.localStorage.getItem('orrery.v1'), savedBefore);
  a.run('endTask(ACTIVE_TASK);');
  a.$('#btnTalkToAsset').click();
  assert.equal(a.run('S.assets.length'), assetsBefore.length + 1);
});

test('applying chat to the result excludes hidden exchanges and hidden summaries', async t => {
  const a=boot(t);
  const key=a.run('activePreset().schema[0].key');
  const requests=stubReplies(a,[JSON.stringify({updates:{[key]:'Changed result'}})]);
  exchanges(a);
  a.run(`S.project.card={fields:{${JSON.stringify(key)}:'Original'}};S.chat.summary='private summary';renderChat();`);
  a.$('[data-message-index="0"]').click();a.$('[data-summary="current"]').click();
  await a.run('doChatToCard()');
  assert.equal(requests.length,1);assert.doesNotMatch(JSON.stringify(requests[0].messages),/private/);
  assert.match(JSON.stringify(requests[0].messages),/public answer/);
  assert.equal(a.run(`S.project.card.fields[${JSON.stringify(key)}]`),'Changed result');
});

test('history window starts with a question and failed/pending messages have no exclusion control', t => {
  const a = boot(t);
  a.run(`S.chat.msgs=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:String(i)}));
    S.chat.msgs.push({id:'pending',role:'user',content:'current',status:'pending'});
    CHAT_SENDING=true; renderChat();`);
  assert.equal(a.$('[data-message-index="30"]'), null);
  const sent = plain(a.run('talkHistoryMessages(S.chat.msgs[30],24)'));
  assert.equal(sent[0].role, 'user');
  assert.equal(sent.at(-1).content, 'current');
  assert.equal(sent.length,23);
  a.run('CHAT_SENDING=false; renderChat();');
  assert.equal(a.run('S.chat.msgs[30].status'),'failed');
  assert.equal(a.$('[data-message-index="30"]'), null);
  assert.ok(a.$('.chat-retry'));
  assert.ok(!a.run('talkHistoryMessages().some(m=>m.id==="pending")'));
});

test('chat messages render markdown while copy keeps the raw text and raw HTML stays inert', t => {
  const a = boot(t);
  const raw = '## 정리\n**굵게** 와 *기울임*, `코드`\n\n- 하나\n- 둘\n\n1. 첫째\n2. 둘째\n\n> 인용\n\n| 이름 | 값 |\n|---|---|\n| a | **b** |\n\n<img src=x onerror=alert(1)> 2 * 3 * 4';
  a.run(`S.chat.msgs=[{role:'user',content:'질문'},{role:'assistant',content:${JSON.stringify(raw)}}];renderChat();`);
  const body = a.$('.msg.bot .msg-md');
  assert.equal(body.querySelector('.md-h').textContent, '정리');
  assert.equal(body.querySelector('strong').textContent, '굵게');
  assert.equal(body.querySelector('em').textContent, '기울임');
  assert.equal(body.querySelector('code').textContent, '코드');
  assert.equal(body.querySelectorAll('ul li').length, 2);
  assert.equal(body.querySelectorAll('ol li').length, 2);
  assert.equal(body.querySelector('blockquote').textContent, '인용');
  assert.equal(body.querySelector('td strong').textContent, 'b');
  assert.equal(body.querySelector('img'), null);
  assert.match(body.textContent, /<img src=x onerror=alert\(1\)> 2 \* 3 \* 4/);
  assert.doesNotMatch(body.textContent, /\*\*/);
  assert.equal(a.run('S.chat.msgs[1].content'), raw);
});

test('refining an existing work needs a picked material and puts the material picker first', async t => {
  const a = boot(t);
  a.run(`S.opts.group='world'; activeMode(); S.opts.modeBy.world='supplement'; applyGroupUi();`);
  assert.ok(a.$('#briefPanel').classList.contains('source-first'));
  assert.equal(a.$('#studioMaterialTitle').textContent, '다듬을 세계');
  assert.ok(a.$('#nebulaPick').open);
  assert.match(a.$('#optBrief').placeholder, /합치고/);
  a.run(`S.project.brief='바다가 마른 항구';`);
  await assert.rejects(a.run('doDigest()'), /다듬을 세계를 재료에서 골라 주세요/);
  await assert.rejects(a.run('doOneShot()'), /연결|다듬을 세계/);
  a.run(`tab('studio')`);
  a.$('#btnDigest').click();
  assert.equal(a.$('#materialsManagerModal').hidden, false);
  assert.equal(a.$('#pasteBox').hidden, false);
  a.$('#pasteIn').value='원본 세계 설정';
  a.$('#btnPasteAdd').click();
  assert.equal(a.run('S.assets.length'), 1);
  assert.equal(a.run('S.assets[0].use'), true);
  assert.doesNotThrow(() => a.run('requireModeSource()'));
  a.$('#pasteIn').value='두 번째';
  a.$('#btnPasteAdd').click();
  assert.equal(a.run('S.assets[1].use'), false);
  a.run('closeMaterialsManager()');
  a.run(`S.assets=[{id:'w1',kind:'text',name:'세계',body:'원본 세계',use:true}]; renderModeChooser();`);
  assert.doesNotThrow(() => a.run('requireModeSource()'));
  a.run(`S.opts.modeBy.world='new'; renderModeChooser();`);
  assert.ok(!a.$('#briefPanel').classList.contains('source-first'));
  assert.equal(a.$('#studioMaterialTitle').textContent, '사용할 재료');
});

test('workbench material picker: cards, search by text and tag, search history, preview popup', t => {
  const a = boot(t);
  a.run(`S.assets=[{id:'m1',kind:'text',name:'소금 항구',body:'물을 파는 길드',use:false,purposes:['world'],tags:['항구']},
    {id:'m2',kind:'text',name:'등대지기',body:'밤마다 불을 켠다',use:false,purposes:['character'],tags:['바다']}];
    tab('studio');renderNebulaPicker();`);
  assert.equal(a.$$('#nebulaList .pick-card').length, 2);
  const search = a.$('#pickSearch');
  search.value = '길드'; search.dispatchEvent(new a.w.Event('input'));
  assert.deepEqual([...a.$$('#nebulaList .pick-name')].map(x=>x.textContent), ['소금 항구']);
  search.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Enter'}));
  a.run(`setPickSearch('')`);
  a.$('#nebulaList [data-tag="바다"]').click();
  assert.equal(search.value, '#바다');
  assert.deepEqual([...a.$$('#nebulaList .pick-name')].map(x=>x.textContent), ['등대지기']);
  assert.equal(a.run('S.assets[1].use'), false);
  a.run(`setPickSearch('')`);
  assert.deepEqual([...a.$$('#pickHistory .pick-hist-q')].map(x=>x.textContent), ['#바다','길드']);
  a.$('#pickHistory .pick-hist-q').click();
  assert.equal(search.value, '#바다');
  a.run(`setPickSearch('')`);
  a.$('#pickHistory .pick-hist-del').click();
  assert.deepEqual([...a.$$('#pickHistory .pick-hist-q')].map(x=>x.textContent), ['길드']);
  a.$('#nebulaList .pick-view[data-id="m2"]').click();
  assert.equal(a.$('#assetViewModal').hidden, false);
  assert.match(a.$('#assetViewBody').textContent, /밤마다 불을 켠다/);
  assert.equal(a.run('S.assets[1].use'), false);
  a.$('#assetViewUse').click();
  assert.equal(a.run('S.assets[1].use'), true);
  assert.ok(a.$('#nebulaList .n-use[data-id="m2"]').checked);
});

test('record cards open the preview, keep star and load on the card, and delete from the preview', t => {
  const a = boot(t);
  a.run(`S.library=[{id:'r1',name:'소금의 도시',group:'world',presetId:'world',presetName:'세계관 설계',fields:{title:'소금의 도시',premise:'바다가 말라붙은 항구'},at:1}];tab('library');`);
  const card = a.$('.libitem');
  assert.match(card.querySelector('.lp').textContent, /바다가 말라붙은 항구/);
  assert.equal(card.querySelector('.l-del'), null);
  card.querySelector('.l-star').click();
  assert.equal(a.run('S.library[0].star'), true);
  assert.equal(a.$('#libViewModal').hidden, true);
  a.$('.libitem .ln').click();
  assert.equal(a.$('#libViewModal').hidden, false);
  a.$('#libViewDel').click();
  assert.equal(a.run('S.library.length'), 0);
  assert.equal(a.$('#libViewModal').hidden, true);
});

test('Marinara preset exports with string flags keep their real sections in order', t => {
  const a = boot(t);
  const env = {type:'marinara_preset',version:1,data:{
    preset:{name:'P',sectionOrder:JSON.stringify(['s2','s1','m1','s3'])},
    sections:[{id:'s1',name:'Rules',role:'system',content:'rule text',enabled:'true',isMarker:'false'},
      {id:'m1',name:'Chat History',content:'',enabled:'true',isMarker:'true'},
      {id:'s2',name:'Role',role:'system',content:'role text',enabled:'true',isMarker:'false'},
      {id:'s3',name:'Old',role:'system',content:'old text',enabled:'false',isMarker:'false'}]}};
  const [m] = a.run(`fromJson(${JSON.stringify(env)},'p')`);
  assert.deepEqual(m.body.split('\n').filter(l=>l.startsWith('## ')), ['## Role · system','## Rules · system','## Old · system · 비활성 구획']);
});

test('chat attachments: text files ride along in the message, images go out as provider image parts', async t => {
  const a = boot(t);
  a.run("S.connections=[{id:'c',name:'C',provider:'openai',apiKey:'k',model:'m'}];S.activeConn='c';tab('talk')");
  const bodies = [];
  a.w.fetch = async (_u,o) => { bodies.push(JSON.parse(o.body)); return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'읽었어요'}}]})}; };
  await a.run(`addChatFiles([new File(['소금 항구 설정 본문'],'world.txt',{type:'text/plain'})])`);
  assert.equal(a.$$('#chatAttach .chat-attach-item').length, 1);
  await a.run('sendChat()');
  const user = bodies[0].messages.at(-1);
  assert.match(user.content, /\[첨부 파일: world\.txt\]\n소금 항구 설정 본문/);
  assert.equal(a.$('#chatAttach').hidden, true);
  assert.match(a.$('.msg.user .msg-file').textContent, /world\.txt/);
  const img = {role:'user',content:'이거 봐',images:[{mime:'image/png',data:'AAAA'}]};
  const oai = a.run(`PROV.openai.chat({model:'m',apiKey:'k'},[${JSON.stringify(img)}],{})`).body.messages[0].content;
  assert.deepEqual(JSON.parse(JSON.stringify(oai)), [{type:'text',text:'이거 봐'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]);
  const ant = a.run(`PROV.anthropic.chat({model:'claude-sonnet-5',apiKey:'k'},[${JSON.stringify(img)}],{})`).body.messages[0].content;
  assert.deepEqual(JSON.parse(JSON.stringify(ant))[0], {type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}});
  const gem = a.run(`PROV.gemini.chat({model:'g',apiKey:'k'},[${JSON.stringify(img)}],{})`).body.contents[0].parts;
  assert.deepEqual(JSON.parse(JSON.stringify(gem))[1], {inline_data:{mime_type:'image/png',data:'AAAA'}});
  const plain = a.run(`PROV.openai.chat({model:'m',apiKey:'k'},[{role:'user',content:'글만'}],{})`).body.messages[0].content;
  assert.equal(plain, '글만');
});

test('a finished conversation becomes a completed record in the chosen form, and records can be picked as materials', async t => {
  const a = boot(t);
  a.run("S.connections=[{id:'c',name:'C',provider:'openai',apiKey:'k',model:'m'}];S.activeConn='c';tab('talk');S.chat.role='char'");
  a.run(`S.chat.msgs=[{id:'u',role:'user',content:'이름은 레아, 항해사로 하자',includeHistory:true},{id:'b',role:'assistant',content:'좋아요. 레아는 말수가 적은 항해사입니다.',includeHistory:true}];renderChat();`);
  const sent=[];
  a.w.fetch = async (_u,o) => { sent.push(JSON.parse(o.body)); return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'```json\n{"name":"레아","description":"말수가 적은 항해사","unknown":"x"}\n```'}}]})}; };
  a.$('#btnTalkToRecord').click();
  assert.equal(a.$('#talkRecordModal').hidden, false);
  const preset = a.$('#talkRecordPreset').value;
  assert.equal(a.run(`S.presets.find(p=>p.id===${JSON.stringify(preset)}).kind`), 'character');
  await a.run('runTalkRecord()');
  assert.match(sent[0].messages.at(-1).content, /\[나\] 이름은 레아, 항해사로 하자/);
  const rec = plain(a.run('S.library.at(-1)'));
  assert.equal(rec.name, '레아');
  assert.equal(rec.from, 'chat');
  assert.equal(rec.fields.unknown, undefined);
  assert.equal(a.$('#talkRecordModal').hidden, true);
  assert.equal(a.$('#libViewModal').hidden, false);
  a.run("tab('studio');renderNebulaPicker()");
  const box = a.$('#nebulaList .r-use');
  assert.ok(box);
  box.checked = true; box.dispatchEvent(new a.w.Event('change',{bubbles:true}));
  assert.equal(a.run('S.library.at(-1).use'), true);
  assert.match(a.run('sourceText()'), /## 완성본: 레아/);
  assert.ok(a.run('sourcePicked()'));
});

test('roleplay preset: layout with markers, reorder and toggle, and exports for SillyTavern, Marinara and RisuAI', t => {
  const a = boot(t);
  a.run(`applyGroup('prompt');switchPreset('rp-preset');tab('studio');renderFieldToggles();`);
  assert.equal(a.$('#rpExportBox').hidden, false);
  assert.equal(a.run(`render('{{char}} 와 {{user}} · {{missing}}',{})`), '{{char}} 와 {{user}} · ');
  a.run(`S.project.card={fields:{title:'항구 GM',role:'{{char}}는 게임 마스터다',direction:'사건을 던진다',npc:'',style:'짧게',format:'세 문단',forbid:'{{user}} 대신 말하지 않는다'}};renderCard();`);
  assert.equal(a.$('#rpLayout').hidden, false);
  const names = () => [...a.$$('#rpLayout .rp-name')].map(x=>x.textContent);
  assert.ok(!names().includes('이름'));
  assert.equal(names()[0], '역할');
  assert.ok(names().includes('채팅 기록'));
  // 역할을 한 칸 아래로, 페르소나는 끄기
  a.$('#rpLayout .rp-item[data-i="0"] .rp-move[data-d="1"]').click();
  assert.deepEqual(names().slice(0,2), ['진행 지침','역할']);
  const persona = [...a.$$('#rpLayout .rp-item')].find(r=>r.querySelector('.rp-name').textContent==='페르소나').querySelector('.rp-on');
  persona.checked=false; persona.dispatchEvent(new a.w.Event('change',{bubbles:true}));
  a.run(`window.out={};dl=(n,t)=>window.out[n]=JSON.parse(t)`);
  for(const f of ['st','marinara','risu']) a.run(`exportRpPreset('${f}')`);
  const out = plain(a.run('window.out'));
  const st = out['항구 GM.json'];
  const order = st.prompt_order[0];
  assert.equal(order.character_id, 100001);
  const custom = st.prompts.filter(p=>!p.marker);
  assert.ok(custom.every(p=>p.system_prompt===false && p.role==='system'));
  assert.ok(!custom.some(p=>p.name==='NPC 운용'));          // 빈 구획은 뺀다
  assert.equal(st.prompts.find(p=>p.identifier==='chatHistory').marker, true);
  assert.equal(order.order.find(o=>o.identifier==='personaDescription').enabled, false);
  assert.equal(st.prompts.find(p=>p.identifier===order.order[0].identifier).name, '진행 지침');
  const mari = out['항구 GM.marinara.json'];
  assert.equal(mari.type, 'marinara_preset');
  assert.ok(mari.data.sections.every(s=>typeof s.isMarker==='string' && typeof s.enabled==='string'));
  assert.equal(mari.data.sections.find(s=>s.identifier==='chat_history').markerConfig, '{"type":"chat_history"}');
  const risu = out['항구 GM_preset.json'];
  assert.equal(risu.name, '항구 GM');
  assert.ok(!risu.promptTemplate.some(p=>p.type==='persona'));   // 끈 마커는 리스에서 빠진다
  assert.deepEqual(risu.promptTemplate.find(p=>p.type==='chat'), {type:'chat',rangeStart:-1000,rangeEnd:'end',name:'채팅 기록'});
  // 내보낸 파일을 다시 재료로 읽으면 같은 순서의 구획이 나온다
  const heads = j => a.run(`fromJson(${JSON.stringify(j)},'x')`)[0].body.split('\n').filter(l=>l.startsWith('## ')).map(l=>l.slice(3).split(' · ')[0]);
  assert.deepEqual(heads(mari), ['진행 지침','역할','문체','금지 사항','출력 형식']);
  assert.deepEqual(heads(st), ['진행 지침','역할','문체','금지 사항','출력 형식']);
  assert.deepEqual(heads(risu), ['진행 지침','역할','문체','금지 사항','출력 형식']);
});

test('user-made forms in the world or character group are offered for organizing a conversation', t => {
  const a = boot(t);
  a.run("applyGroup('world');tab('prompts');window.prompt=()=>'우리 세계 양식'");
  a.$('#btnPresetBlank').click();
  const made = plain(a.run("S.presets.find(p=>p.name==='우리 세계 양식')"));
  assert.equal(made.group, 'world');
  assert.equal(made.kind, 'world');
  a.run("tab('talk');S.chat.role='world';S.chat.msgs=[{id:'u',role:'user',content:'정하자',includeHistory:true},{id:'b',role:'assistant',content:'좋아요',includeHistory:true}];openTalkRecord()");
  const opts = [...a.$$('#talkRecordPreset option')].map(o=>o.textContent);
  assert.ok(opts.includes('[세계] 우리 세계 양식'));
  assert.ok(!opts.some(o=>/점검|양식 설계/.test(o)));
});

test('hook-point guidance goes to characters and worlds with their own text, never to prompt forms', t => {
  const a = boot(t);
  const hooks = g => a.run(`applyGroup('${g}');activeBuiltinCommons({}).map(c=>c.content.split(String.fromCharCode(10))[0]).filter(l=>l.includes('후킹포인트'))`);
  assert.deepEqual(plain(hooks('character')), ['[후킹포인트 설계 — 인물]']);
  assert.deepEqual(plain(hooks('world')), ['[후킹포인트 설계 — 세계]']);
  assert.deepEqual(plain(hooks('prompt')), []);
});

test('a connection can be duplicated to swap only the model, and its key copied', async t => {
  const a = boot(t);
  a.run("S.connections=[{id:'c1',name:'Claude',provider:'anthropic',apiKey:'sk-test',model:'claude-sonnet-5',maxTokens:4000,_ok:true}];S.activeConn='c1';CONN_OPEN.add('c1');renderConns()");
  a.$('#connList .c-dup').click();
  const list = plain(a.run('S.connections'));
  assert.equal(list.length, 2);
  assert.equal(list[1].name, 'Claude 복사본');
  assert.equal(list[1].apiKey, 'sk-test');
  assert.equal(list[1].maxTokens, 4000);
  assert.equal(list[1]._ok, undefined);
  assert.notEqual(list[1].id, 'c1');
  assert.equal(a.run('S.activeConn'), 'c1');
  assert.equal(a.w.document.activeElement, a.$(`#connList .conn[data-id="${list[1].id}"] .c-model`));
  let copied; a.run('copy=t=>{window.copied=t}');
  a.$('#connList .conn[data-id="c1"] .c-keycopy').click();
  assert.equal(a.run('window.copied'), 'sk-test');
});

test('common instructions: built-in ones can be switched off for every form, and tagged ones follow the active connection tags', t => {
  const a = boot(t);
  a.run(`window.BUILTIN_COMMON=[{name:'항상',content:'ALWAYS',groups:['all']},{name:'클로드 전용',content:'CLAUDE ONLY',groups:['all']}];
    S.connections=[{id:'A',name:'A',provider:'anthropic',apiKey:'k',model:'m',tags:['클로드']},{id:'G',name:'G',provider:'gemini',apiKey:'k',model:'g'}];
    S.activeConn='G';renderConnSel();applyGroup('world');renderCommon();`);
  const live = () => plain(a.run('activeBuiltinCommons({}).map(c=>c.content)'));
  assert.deepEqual(live(), ['ALWAYS','CLAUDE ONLY']);
  // 태그 달기: 클로드 태그가 없는 연결에선 빠진다
  const tagInput = a.$('#commonBox .stitem.inherited[data-name="클로드 전용"] .ci-tags');
  tagInput.value = '#클로드'; tagInput.dispatchEvent(new a.w.Event('change',{bubbles:true}));
  assert.deepEqual(live(), ['ALWAYS']);
  assert.match(a.$('#commonBox .stitem.inherited[data-name="클로드 전용"] .ctag-state').textContent, /빠짐/);
  // 연결을 A로 바꾸면 같이 켜진다
  a.$('#connSel').value='A'; a.$('#connSel').dispatchEvent(new a.w.Event('change',{bubbles:true}));
  assert.deepEqual(live(), ['ALWAYS','CLAUDE ONLY']);
  assert.match(a.$('#commonBox .stitem.inherited[data-name="클로드 전용"] .ctag-state').textContent, /맞음/);
  // 끄면 모든 양식에서 빠진다 (분류를 바꿔도)
  const sw = a.$('#commonBox .stitem.inherited[data-name="항상"] .ci-on');
  sw.checked = false; sw.dispatchEvent(new a.w.Event('change',{bubbles:true}));
  a.run("applyGroup('character')");
  assert.deepEqual(live(), ['CLAUDE ONLY']);
  // 양식별 지시문도 태그를 따른다
  a.run("activePreset().common=[{id:'x',name:'own',content:'OWN',enabled:true,tags:['제미니']}]");
  assert.equal(a.run("(activePreset().common||[]).filter(c=>c.enabled&&tagsMatch(c.tags)).length"), 0);
  // 연결 태그 입력과 백업 왕복
  a.run("CONN_OPEN.add('G');tab('settings');renderConns()");
  const ct = a.$('#connList .conn[data-id="G"] .c-tags');
  ct.value = '제미니, 긴 출력'; ct.dispatchEvent(new a.w.Event('input',{bubbles:true}));
  assert.deepEqual(plain(a.run("S.connections[1].tags")), ['제미니','긴 출력']);
  assert.deepEqual(plain(a.run("readConnectionBackup({app:'Orrery',connections:backupConnections(true)})[1].tags")), ['제미니','긴 출력']);
  const restored = boot(t, a.w.localStorage.getItem('orrery.v1'));
  assert.equal(restored.run("commonPref('항상').off"), true);
  assert.deepEqual(plain(restored.run("commonPref('클로드 전용').tags")), ['클로드']);
});

test('the app reads common instructions without tags or enabled as untagged and on, and corrects malformed values', t => {
  const a = boot(t);
  const got = plain(a.run(`normCommon([{name:'a',content:'x'},{name:'b',content:'y',tags:'클로드',enabled:'false'},{name:'c',content:'z',enabled:0}]).map(x=>[x.tags,x.enabled])`));
  assert.deepEqual(got, [[[],true],[['클로드'],false],[[],false]]);
});

test('model names add a family tag automatically, which common instructions follow', t => {
  const a = boot(t);
  const fam = m => plain(a.run(`modelTags(${JSON.stringify(m)})`));
  assert.deepEqual(fam('claude-sonnet-5'), ['클로드']);
  assert.deepEqual(fam('anthropic/claude-sonnet-4.5'), ['클로드']);
  assert.deepEqual(fam('gemini-2.5-pro'), ['제미나이']);
  assert.deepEqual(fam('google/gemini-2.5-pro'), ['제미나이']);
  assert.deepEqual(fam('gpt-4o'), ['GPT']);
  assert.deepEqual(fam('o3-mini'), ['GPT']);
  assert.deepEqual(fam('chatgpt-4o-latest'), ['GPT']);
  assert.deepEqual(fam('grok-4'), ['그록']);
  assert.deepEqual(fam('deepseek-chat'), ['딥시크']);
  assert.deepEqual(fam('open-mistral-nemo'), ['미스트랄']);
  assert.deepEqual(fam('command-a-03-2025'), ['코히어']);
  assert.deepEqual(fam('venice-uncensored'), []);
  a.run(`window.BUILTIN_COMMON=[{name:'클로드 전용',content:'C',tags:['클로드'],groups:['all']}];
    S.connections=[{id:'x',name:'x',provider:'openrouter',apiKey:'k',model:'anthropic/claude-sonnet-4.5'}];S.activeConn='x';applyGroup('world');CONN_OPEN.add('x');renderConns();`);
  assert.deepEqual(plain(a.run('activeBuiltinCommons({}).map(c=>c.content)')), ['C']);
  assert.match(a.$('#connList .c-tag.auto').textContent, /클로드/);
  const model = a.$('#connList .c-model'); model.value='gemini-2.5-pro'; model.dispatchEvent(new a.w.Event('input',{bubbles:true}));
  assert.deepEqual(plain(a.run('activeBuiltinCommons({}).map(c=>c.content)')), []);
  assert.match(a.$('#connList .c-tag.auto').textContent, /제미나이/);
});

test('built-in forms come from builtin-presets.js and talk roles from talk-roles.js; untouched saved forms follow file changes, edited ones stay', t => {
  const a = boot(t);
  assert.ok(a.run('Array.isArray(window.BUILTIN_PRESETS) && window.BUILTIN_PRESETS.length>10'));
  assert.ok(a.run("builtinPresets().some(p=>p.id==='prompt-forge') && TALK_ROLE.world.length>0"));
  assert.equal(a.$('#talkRole option[value="critic"]').textContent, a.run('TALK_ROLE_LABEL.critic'));
  // 처음 시작한 상태에서 모든 내장 양식은 지문을 갖는다
  assert.ok(a.run('S.presets.every(p=>p._sig===presetSig(p))'));
  // 앱에서 default 를 고친다
  a.run("S.presets.find(p=>p.id==='default').name='내가 고친 기본 카드'");
  // 파일이 바뀐다: world·default 이름이 바뀐 새 내장본
  a.run("window.BUILTIN_PRESETS=window.BUILTIN_PRESETS.map(p=>p.id==='world'?{...p,name:'세계관 설계 v2'}:p.id==='default'?{...p,name:'기본 카드 v2'}:p);syncBuiltinPresets(builtinPresets())");
  assert.equal(a.run("S.presets.find(p=>p.id==='world').name"), '세계관 설계 v2');
  assert.equal(a.run("S.presets.find(p=>p.id==='default').name"), '내가 고친 기본 카드');
  // 지문이 없던 예전 양식: 내장본과 같으면 지문만 달고, 다르면 건드리지 않는다
  a.run("const w=S.presets.find(p=>p.id==='world');delete w._sig;syncBuiltinPresets(builtinPresets())");
  assert.ok(a.run("!!S.presets.find(p=>p.id==='world')._sig"));
  // 양식 내보내기에는 지문이 섞이지 않는다
  a.run("switchPreset('world');window.__out=null;dl=(n,t)=>window.__out=t");
  a.$('#btnPresetExport')?.click();
  if (a.run('window.__out')) assert.ok(!a.run('window.__out').includes('_sig'));
});

test('chat history is sent by token budget instead of a 24-message cap', async t => {
  const a = boot(t);
  const requests = stubReplies(a, ['ok']);
  a.run(`S.chat.msgs=Array.from({length:40},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'짧은 말 '+i,includeHistory:true}));renderChat();`);
  a.$('#chatIn').value='다음'; await a.run('sendChat()');
  assert.equal(requests[0].messages.length, 1+41);   // 시스템 + 40개 + 새 질문, 잘림 없음
});

test('when the conversation nears the connection limit, older turns are summarized automatically (in chunks that fit) and recent ones stay verbatim', async t => {
  const a = boot(t);
  a.run("S.connections=[{id:'test',name:'Test',provider:'openai',apiKey:'k',model:'m',contextLimit:8000}];S.activeConn='test'");
  const requests = []; let n = 0;
  a.w.fetch = async (_u,o) => {
    const body = JSON.parse(o.body); requests.push(body);
    const isSummary = /압축 정리/.test(body.messages[0].content);
    const content = isSummary ? '- 정해진 것: 항구 도시 '+(++n) : '이어서 답합니다';
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content}}]})};
  };
  const long = '가'.repeat(1500);   // 메시지마다 1,500토큰쯤 (한국어는 글자당 한 토큰으로 어림)
  a.run(`S.chat.msgs=Array.from({length:16},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'${long} '+i,includeHistory:true}));renderChat();`);
  a.$('#chatIn').value='다음 질문'; await a.run('sendChat()');
  const sums = requests.filter(r=>/압축 정리/.test(r.messages[0].content));
  assert.ok(sums.length >= 2, '한도에 맞게 나눠 여러 번 요약');
  for (const r of sums) assert.ok(a.run(`tok(${JSON.stringify(r.messages.map(m=>m.content).join(''))})`) <= 8000-1500, '요약 요청마다 한도 안');
  assert.match(sums[1].messages[1].content, /\[지금까지의 정리\][\s\S]*항구 도시 1/);   // 앞 묶음 요약을 이어받음
  assert.equal(a.run('S.chat.summary'), '- 정해진 것: 항구 도시 '+n);
  const kept = plain(a.run('S.chat.msgs.map(m=>m.id||"")'));
  assert.ok(!kept.includes('m0'));                 // 오래된 앞부분은 정리됨
  assert.ok(kept.includes('m15'));                 // 최근 것은 원문 그대로
  const last = requests.at(-1);
  assert.match(last.messages[0].content, /지금까지 나눈 대화를 압축한 정리[\s\S]*항구 도시/);
  assert.equal(last.messages[1].role, 'user');      // 남은 대화는 질문으로 시작
  assert.equal(a.run("S.chat.msgs.at(-1).content"), '이어서 답합니다');
});

test('with auto summary off, the oldest turns are trimmed to fit and the summary nudge appears', async t => {
  const a = boot(t);
  const requests = stubReplies(a, ['답']);
  a.run("S.connections[0].contextLimit=8000;S.talkAutoCompact=false");
  const long = '가'.repeat(1500);
  a.run(`S.chat.msgs=Array.from({length:16},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'${long} '+i,includeHistory:true}));renderChat();`);
  assert.equal(a.$('#talkAutoCompact').checked, false);
  assert.equal(a.$('#wrapNudge').hidden, false);
  a.$('#chatIn').value='다음'; await a.run('sendChat()');
  assert.equal(requests.length, 1);
  const sent = requests[0].messages.slice(1);
  assert.ok(sent.length < 17 && sent.length > 2);
  assert.equal(sent[0].role, 'user');
  assert.equal(sent.at(-1).content, '다음');
  assert.equal(a.run('S.chat.msgs.length'), 18);   // 원문은 지워지지 않는다
});

test('each chat keeps its own materials, separate from the workbench, and old chats inherit the current selection once', async t => {
  const a = boot(t);
  a.run(`S.assets=[{id:'a1',kind:'text',name:'항구',body:'소금 항구',use:true,purposes:[],tags:[]},{id:'a2',kind:'text',name:'길드',body:'물 길드',use:false,purposes:[],tags:[]}];
    S.chats=[normalizeChat({id:'c1',name:'첫 대화',msgs:[],ctx:{assets:true}},'world')];S.chatId='c1';tab('talk');renderChat();`);
  // 예전 대화창: 지금 켜 둔 재료(a1)를 이어받는다
  assert.deepEqual(plain(a.run('chatPicks().assets')), ['a1']);
  // 대화창에서 a2를 골라도 작업대 선택(use)은 그대로
  const box = a.$('#talkAssetList .t-use[data-id="a2"]'); box.checked=true; box.dispatchEvent(new a.w.Event('change',{bubbles:true}));
  assert.equal(a.run("S.assets.find(x=>x.id==='a2').use"), false);
  assert.match(a.run('talkContext()'), /물 길드/);
  // 새 대화창은 빈 채로 시작하고, 앞 대화창의 선택은 그대로 남는다
  a.run("window.prompt=()=>'두 번째';newChat()");
  assert.deepEqual(plain(a.run('chatPicks().assets')), []);
  assert.doesNotMatch(a.run('talkContext()'), /소금 항구|물 길드/);
  assert.deepEqual(plain(a.run("chatPicks(S.chats.find(c=>c.id==='c1')).assets")), ['a1','a2']);
  // 저장 후 다시 열어도 대화창별로 남는다
  const b = boot(t, a.w.localStorage.getItem('orrery.v1'));
  assert.deepEqual(plain(b.run("chatPicks(S.chats.find(c=>c.id==='c1')).assets")), ['a1','a2']);
});

test('my message shows which materials went with it, briefly when unchanged', async t => {
  const a = boot(t);
  const requests = stubReplies(a, ['답1','답2','답3']);
  a.run(`S.assets=[{id:'a1',kind:'text',name:'소금 항구',body:'소금 항구 설정',use:true,purposes:[],tags:[]}];
    S.chats=[normalizeChat({id:'c1',msgs:[],ctx:{assets:true},picks:{assets:['a1'],records:[]}},'world')];S.chatId='c1';tab('talk');renderChat();`);
  for (const q of ['첫 질문','두 번째']) { a.$('#chatIn').value=q; await a.run('sendChat()'); }
  const sent = [...a.w.document.querySelectorAll('.msg.user .msg-sent')].map(x=>x.textContent.trim());
  assert.match(sent[0], /함께 보낸 자료[\s\S]*소금 항구/);
  assert.match(sent[1], /자료 그대로 · 1개/);
  assert.match(JSON.stringify(requests[0].messages[0]), /소금 항구 설정/);
  // 자료를 빼고 보내면 표시도 빠진다
  const box = a.$('#talkAssetList .t-use[data-id="a1"]'); box.checked=false; box.dispatchEvent(new a.w.Event('change',{bubbles:true}));
  a.$('#chatIn').value='세 번째'; await a.run('sendChat()');
  assert.equal(a.run("S.chat.msgs.filter(m=>m.role==='user').at(-1).sent"), undefined);
  // 칩을 누르면 그 재료를 크게 본다
  a.$('.msg.user .sent-chip[data-id="a1"]').click();
  assert.equal(a.$('#assetViewModal').hidden, false);
});

/* ---- 채팅 앱처럼 길게: 스트리밍 · 잘림 · 이어서 쓰기 · 다시 시도 · 긴 화면 ---- */
const { TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder } = require('node:util');
function sse(chunks, signal, hangAt = -1) {
  const enc = new NodeTextEncoder(); let i = 0, rejectRead = null;
  const abortErr = () => Object.assign(new Error('aborted'), { name:'AbortError' });
  if (signal) signal.addEventListener('abort', () => rejectRead && rejectRead(abortErr()));
  return { ok:true, status:200, headers:{ get:()=>null }, body:{ getReader:()=>({ read:()=>new Promise((res, rej) => {
    if (signal && signal.aborted) return rej(abortErr());
    rejectRead = rej;
    if (i === hangAt) return;                       // 여기서 멈춰 중지를 기다린다
    setTimeout(() => i >= chunks.length ? res({ done:true }) : res({ done:false, value:enc.encode(chunks[i++]) }), 5);
  }) }) } };
}
const oai = (text, finish) => 'data: ' + JSON.stringify({ choices:[{ delta:{ content:text }, finish_reason:finish||null }] }) + '\n\n';
function streamApp(t) {
  const a = boot(t);
  a.w.TextDecoder = NodeTextDecoder;
  a.run("S.connections=[{id:'c',name:'C',provider:'openai',apiKey:'k',model:'gpt-4o'}];S.activeConn='c';tab('talk');renderChat();");
  return a;
}
const tick = ms => new Promise(r => setTimeout(r, ms));
const json = (status, obj) => ({ ok:status<400, status, headers:{ get:()=>null }, text:async()=>JSON.stringify(obj) });

test('replies stream into the chat as they arrive and become a normal message at the end', async t => {
  const a = streamApp(t);
  const bodies = [];
  a.w.fetch = async (_u, o) => { bodies.push(JSON.parse(o.body)); return sse([oai('소금기 '), oai('어린 '), oai('항구입니다.', 'stop'), 'data: [DONE]\n\n'], o.signal); };
  a.$('#chatIn').value = '분위기?';
  const job = a.run('sendChat()');
  await tick(14);
  assert.ok(a.$('#chatLog .msg.streaming'), '받는 중 말풍선');
  await job;
  assert.equal(bodies[0].stream, true);
  assert.equal(bodies[0].max_tokens, 4096);
  assert.equal(a.$('#chatLog .msg.streaming'), null);
  assert.equal(a.run('S.chat.msgs.at(-1).content'), '소금기 어린 항구입니다.');
  assert.equal(a.run('S.chat.msgs.at(-1).cut'), undefined);
});

test('a reply cut by the length limit is marked and can be continued in place', async t => {
  const a = streamApp(t);
  const bodies = []; let n = 0;
  a.w.fetch = async (_u, o) => { bodies.push(JSON.parse(o.body));
    return ++n === 1 ? sse([oai('첫 문단은 여기까지'), oai('', 'length')], o.signal) : sse([oai(' 이어지는 뒷부분.', 'stop')], o.signal); };
  a.$('#chatIn').value = '길게'; await a.run('sendChat()');
  assert.equal(a.run('S.chat.msgs.at(-1).cut'), 'length');
  assert.match(a.$('#chatLog .chat-cut').textContent, /길이 제한/);
  a.$('#chatLog .chat-continue').click();
  for (let i = 0; i < 40 && a.run('CHAT_JOBS.size'); i++) await tick(10);
  assert.match(bodies[1].messages.at(-1).content, /끊긴 지점에서 그대로 이어서/);
  assert.equal(bodies[1].messages.at(-2).role, 'assistant');
  assert.equal(a.run('S.chat.msgs.length'), 2);
  assert.equal(a.run('S.chat.msgs.at(-1).content'), '첫 문단은 여기까지 이어지는 뒷부분.');
  assert.equal(a.run('S.chat.msgs.at(-1).cut'), undefined);
});

test('stopping mid-stream keeps what arrived as the answer, marked as stopped', async t => {
  const a = streamApp(t);
  a.w.fetch = async (_u, o) => sse([oai('여기까지 '), oai('받았다')], o.signal, 2);
  a.$('#chatIn').value = '질문';
  const job = a.run('sendChat()');
  await tick(40);
  a.run('stopChat(S.chatId)');
  await job;
  assert.equal(a.run('S.chat.msgs[0].status'), undefined);
  assert.equal(a.run('S.chat.msgs.at(-1).content'), '여기까지 받았다');
  assert.equal(a.run('S.chat.msgs.at(-1).cut'), 'stopped');
});

test('a context-length error makes the chat trim harder and send once more; transient errors are retried', async t => {
  const a = streamApp(t);
  const long = '가'.repeat(3000);
  a.run("S.chat.msgs=Array.from({length:12},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'" + long + " '+i,includeHistory:true}));renderChat();");
  const bodies = []; let sends = 0;
  a.w.fetch = async (_u, o) => {
    const b = JSON.parse(o.body); bodies.push(b);
    if (/압축 정리/.test(b.messages[0].content)) return json(200, { choices:[{ message:{ content:'- 정리됨' } }] });
    sends++;
    if (sends === 1) return json(400, { error:{ message:"This model's maximum context length is 8192 tokens" } });
    if (sends === 2) return json(503, { error:{ message:'busy' } });
    return sse([oai('되었다', 'stop')], o.signal);
  };
  a.$('#chatIn').value = '다음'; await a.run('sendChat()');
  const real = bodies.filter(b => !/압축 정리/.test(b.messages[0].content));
  assert.ok(bodies.some(b => /압축 정리/.test(b.messages[0].content)), '한도 초과 뒤 앞부분 정리');
  assert.equal(real.length, 3, '한도 초과 → 다시 보냄(503) → 다시 시도');
  assert.ok(real.at(-1).messages.length < real[0].messages.length, '두 번째부터는 더 줄여서');
  assert.equal(a.run('S.chat.msgs.at(-1).content'), '되었다');
});

test('long chats render only the latest messages with a button to show earlier ones', t => {
  const a = streamApp(t);
  a.run("S.chat.msgs=Array.from({length:300},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'말 '+i,includeHistory:true}));renderChat();");
  assert.equal(a.w.document.querySelectorAll('#chatLog .msg:not(.wrap)').length, 120);
  assert.match(a.$('#chatLog .chat-more').textContent, /180개/);
  a.$('#chatLog .chat-more').click();
  assert.equal(a.w.document.querySelectorAll('#chatLog .msg:not(.wrap)').length, 240);
  assert.equal(a.$('#chatLog .msg.user [data-message-index]').dataset.messageIndex, '60');
});

test('Claude and Gemini stream pieces are read, including length cut-offs', t => {
  const a = streamApp(t);
  const claude = ['event: content_block_delta','data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안"}}','data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"녕"}}','data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'].join('\n');
  const gem = ['data: {"candidates":[{"content":{"parts":[{"text":"하"}]}}]}','data: {"candidates":[{"content":{"parts":[{"text":"이"}]},"finishReason":"MAX_TOKENS"}]}'].join('\n');
  const read = (prov, text) => plain(a.run('(()=>{let cut=false;const out=sseText(' + JSON.stringify(text) + ', PROV.' + prov + ', ()=>{}, ()=>{cut=true});return [out,cut];})()'));
  assert.deepEqual(read('anthropic', claude), ['안녕', true]);
  assert.deepEqual(read('gemini', gem), ['하이', true]);
  assert.match(a.run("PROV.gemini.chat({model:'g',apiKey:'k'},[{role:'user',content:'x'}],{stream:true}).url"), /:streamGenerateContent\?alt=sse&key=/);
  assert.equal(a.run("PROV.anthropic.chat({model:'claude-sonnet-5',apiKey:'k'},[{role:'user',content:'x'}],{stream:true}).body.stream"), true);
  assert.equal(a.run("tok('안녕하세요')"), 5);
});

test('saving warns once when browser storage passes 80%', t => {
  const a = boot(t);
  const toasts = [];
  a.run('window.__t=[];const _t=toast;toast=(m,b)=>{window.__t.push(m);}');
  a.run("STORAGE_OTHERS=4300000;STORAGE_OTHERS_AT=Date.now();STORAGE_WARNED=false;save();save();");
  const msgs = a.run('window.__t').filter(m=>/저장 공간/.test(m));
  assert.equal(msgs.length, 1);
  a.run("STORAGE_OTHERS=0;save();");
  assert.equal(a.run('STORAGE_WARNED'), false);
});
