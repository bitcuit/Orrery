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
  assert.equal(a.$('#talkAssetList .t-use').checked, true);
  assert.match(a.$('#talkAssetCount').textContent, /1\/1/);
  assert.notEqual(a.$('#ctxTok').textContent, tokenLabelBefore);
  assert.match(a.$('#ctxTok').textContent, new RegExp(String(a.run('tok(talkContext())'))));
  assert.equal(a.$('#ctxAssets').disabled, false);
  const restored = boot(t, a.w.localStorage.getItem('orrery.v1'));
  assert.equal(restored.run('S.assets.length'), 1);
  assert.equal(restored.run('S.assets[0].id'), asset.id);
  assert.equal(restored.run('S.assets[0].body'), asset.body);
  assert.equal(restored.$('#talkAssetList .t-use').checked, true);
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
