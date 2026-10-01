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
