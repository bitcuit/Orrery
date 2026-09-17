const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
function boot(t, storage = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'http://orrery.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  w.localStorage.setItem('orrery.v1', '{}');
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  w.fetch = async () => { throw new Error('Unexpected network request'); };
  const context = dom.getInternalVMContext();
  const run = code => vm.runInContext(code, context);
  for (const script of w.document.querySelectorAll('script[src]')) {
    const file = script.getAttribute('src');
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  return { w, run, $: selector => w.document.querySelector(selector) };
}
const plain = value => JSON.parse(JSON.stringify(value));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function screenIs(a, name) {
  const ids={input:'studioInput',loading:'studioLoading',digest:'digestPanel',seed:'seedPanel',result:'studioResults',cast:'castPanel'};
  for (const [screen,id] of Object.entries(ids)) assert.equal(a.$('#'+id).hidden, screen!==name, screen+' visibility');
}
function replyQueue(a, replies) {
  const requests=[];
  a.w.fetch=async (_url,opts)=>{
    requests.push(JSON.parse(opts.body));
    assert.ok(replies.length, 'unexpected extra API call');
    return response(JSON.stringify(replies.shift()));
  };
  return requests;
}
function connection(app, extra = {}) {
  app.run(`S.connections=[${JSON.stringify({ id:'test', name:'Test', provider:'openai', apiKey:'test-only', model:'test-model', ...extra })}]; S.activeConn='test'; renderConnSel();`);
}
function response(content, ok = true) {
  return { ok, status: ok ? 200 : 503, text: async () => JSON.stringify(ok
    ? { choices:[{ message:{ content } }] } : { error:{ message:content } }) };
}
function pendingFetch(app) {
  let resolve;
  let calls = 0;
  app.w.fetch = (_url, opts) => {
    calls++;
    return new Promise((yes, no) => {
      resolve = yes;
      opts.signal.addEventListener('abort', () => no(new app.w.DOMException('Stopped', 'AbortError')));
    });
  };
  return { finish: content => resolve(response(content)), count: () => calls };
}

test('boots all scripts; core inputs stay visible before the create action', t => {
  const a = boot(t);
  assert.equal(a.$('#studioInput').hidden, false);
  assert.equal(a.$('#studioResults').hidden, true);
  assert.equal(a.$('#studioResultNav').hidden, true);
  for (const id of ['studioPreset','modeBox','optBrief','btnStudioMaterials']) {
    const input = a.$('#'+id);
    assert.equal(input.closest('details'), null, id+' must not be inside a disclosure');
    assert.ok(input.compareDocumentPosition(a.$('#btnOneShot')) & 4);
  }
  assert.equal(a.$('#optAdv').open, false);
  assert.equal(a.$('#optExtra'), null);
  assert.equal(a.$('#nebulaList').closest('details'), a.$('#nebulaPick'));
  assert.equal(a.$('#briefPanel').contains(a.$('#btnOneShot')), false);
  assert.equal(a.run('S.opts.group'), 'world');
  assert.ok(a.$('#modeBox button[aria-pressed="true"]'));
  const ids = [...a.w.document.querySelectorAll('[id]')].map(el => el.id);
  assert.equal(new Set(ids).size, ids.length);
  a.run("tab('studio')");
  a.$('#btnStudioMaterials').click();
  assert.equal(a.run('curTab'), 'studio');
  assert.equal(a.$('#materialsManagerModal').hidden, false);
});

test('missing connection opens settings without losing the brief', t => {
  const a = boot(t);
  a.$('#optBrief').value = '바다 위에 떠 있는 도시';
  a.$('#optBrief').dispatchEvent(new a.w.Event('input', { bubbles:true }));
  a.$('#btnOneShot').click();
  assert.equal(a.run('curTab'), 'settings');
  assert.equal(a.run('curBrief()'), '바다 위에 떠 있는 도시');
  assert.ok(a.$('#connList .conn.open .c-key'));
  assert.equal(a.w.document.activeElement, a.$('#connList .conn.open .c-key'));
});

test('group round trip restores preset, candidates, edits, locks, QA and final output', t => {
  const a = boot(t);
  a.run(`S.opts.briefBy.world='world brief'; S.opts.extraBy.world='world rule';
    S.project.digest={title:'world digest'};
    S.project.seeds=[{id:'seed1',line:'choice',hook:'hook'}]; S.project.sel=['seed1'];
    S.project.card={fields:{name:'world result'},conversion:{result:'translated',meaning:'meaning'},continuations:[]};
    S.project.locked={name:true}; S.project.qa=[{q:'why',a:'because',changes:[]}];
    S.project.cast=[{fields:{name:'cast'}}]; S.project.relations={note:'relations'};
    $('#continueNote').value='continue world'; $('#rerollNote').value='patch world';
    renderCard(); saveRecord();`);
  const before = plain(a.run('({preset:S.activePreset,project:Object.fromEntries(Object.keys(emptyWork()).map(k=>[k,S.project[k]]))})'));
  a.run(`applyGroup('character'); S.project.card={fields:{name:'character result'}}; saveRecord(); applyGroup('world');`);
  const after = plain(a.run('({preset:S.activePreset,project:Object.fromEntries(Object.keys(emptyWork()).map(k=>[k,S.project[k]]))})'));
  assert.deepEqual(after, before);
  assert.equal(a.$('#optBrief').value, 'world brief');
  assert.equal(a.$('#continueNote').value, 'continue world');
  assert.equal(a.$('#rerollNote').value, 'patch world');
  a.run("applyGroup('character')");
  assert.equal(a.run('S.project.card.fields.name'), 'character result');
});

test('typing then immediately switching saves the edit under its original group', t => {
  const a = boot(t);
  a.run(`S.project.card={fields:{[activePreset().schema[0].key]:'old'}}; renderCard(); saveRecord();`);
  const key = a.run('activePreset().schema[0].key');
  const input = a.$('#cardOut textarea');
  input.value = 'edited';
  input.dispatchEvent(new a.w.Event('input', { bubbles:true }));
  a.run("applyGroup('character')");
  const record = plain(a.run('S.library[0]'));
  assert.equal(record.group, 'world');
  assert.equal(record.fields[key], 'edited');
  assert.equal(a.run('window.__saveT'), null);
});

test('pinning and resetting current work preserve another group through reload', t => {
  const a = boot(t);
  a.run(`S.project.card={fields:{name:'keep world'}}; saveRecord(); applyGroup('character');
    S.project.card={fields:{name:'current character'}}; renderCard();`);
  a.$('#btnSaveLib').click();
  a.$('#btnNewWork').click();
  a.run('saveDraftNow()');
  const storage = Object.fromEntries(Object.keys(a.w.localStorage).map(key => [key, a.w.localStorage.getItem(key)]));
  const b = boot(t, storage);
  assert.equal(b.run('S.project.card'), null);
  b.run("applyGroup('world')");
  assert.equal(b.run('S.project.card.fields.name'), 'keep world');
});

test('generation blocks switching and duplicate calls; cancellation saves no result', async t => {
  const a = boot(t); connection(a);
  a.run("S.opts.briefBy.world='make a world'");
  const pending = pendingFetch(a);
  const job = a.run("guard($('#btnOneShot'),'working',async()=>{S.project.card=await doOneShot();saveRecord();})");
  a.$('[data-group="character"]').click();
  a.$('#btnNewWork').click();
  const drop = new a.w.Event('drop', {bubbles:true, cancelable:true});
  assert.equal(a.$('#drop').dispatchEvent(drop), false);
  assert.equal(a.run('S.opts.group'), 'world');
  assert.equal(a.run('curBrief()'), 'make a world');
  assert.equal(await a.run("guard($('#btnOneShot'),'again',doOneShot)"), false);
  assert.equal(pending.count(), 1);
  a.$('#btnAbortCall').click();
  assert.equal(await job, false);
  assert.equal(a.run('S.project.card'), null);
  assert.equal(a.run('S.library.length'), 0);
  assert.equal(a.run('workIsBusy()'), false);
  assert.equal(a.$('#btnOneShot').disabled, false);
});

test('late response is rejected if its originating work is replaced', async t => {
  const a = boot(t); connection(a);
  const pending = pendingFetch(a);
  a.run('window.testTask=beginTask()');
  const job = a.run("callProvider(S.connections[0],[{role:'user',content:'hi'}],{})");
  a.run('S.project={...S.project}');
  pending.finish('late response');
  await assert.rejects(job, /__ABORT__/);
  a.run('endTask(window.testTask)');
});

test('failed chat stays visible; retry sends it once and preserves newly typed input', async t => {
  const a = boot(t); connection(a);
  const requests = [];
  a.w.fetch = async (_url, opts) => {
    requests.push(JSON.parse(opts.body));
    return requests.length === 1 ? response('temporary failure', false) : response('answer');
  };
  a.$('#chatIn').value = 'first message';
  await a.run('sendChat()');
  assert.equal(a.run('S.chat.msgs.length'), 1);
  assert.equal(a.run('S.chat.msgs[0].status'), 'failed');
  assert.ok(a.$('.chat-retry'));
  a.$('#chatIn').value = 'next message';
  a.$('#chatIn').dispatchEvent(new a.w.Event('input', { bubbles:true }));
  await a.run('sendChat()');
  assert.equal(requests.length, 1);
  await a.run('sendChat(S.chat.msgs[0].id)');
  assert.equal(a.run('S.chat.msgs.length'), 2);
  assert.equal(a.run('S.chat.msgs[0].status'), undefined);
  assert.equal(a.run('S.chat.msgs[1].content'), 'answer');
  assert.equal(a.$('#chatIn').value, 'next message');
  assert.equal(a.run('S.chat.inputDraft'), 'next message');
  assert.equal(requests[1].messages.filter(m => m.role === 'user').length, 1);
});

test('Ctrl+Enter cannot start a second chat while a response is pending', async t => {
  const a = boot(t); connection(a);
  const pending = pendingFetch(a);
  a.$('#chatIn').value = 'first';
  const job = a.run('sendChat()');
  a.$('#chatIn').value = 'next';
  a.$('#chatIn').dispatchEvent(new a.w.KeyboardEvent('keydown', { key:'Enter', ctrlKey:true, bubbles:true }));
  assert.equal(pending.count(), 1);
  pending.finish('done');
  await job;
  assert.equal(a.$('#chatIn').value, 'next');
  assert.equal(a.run('S.chat.msgs.length'), 2);
});

test('interrupted pending chat is recoverable after reload', t => {
  const saved = { chat:{role:'world',msgs:[{id:'interrupted',role:'user',content:'keep me',status:'pending'}],ctx:{},inputDraft:'next'} };
  const a = boot(t, { 'orrery.v1':JSON.stringify(saved) });
  assert.equal(a.run('S.chat.msgs[0].status'), 'failed');
  assert.ok(a.$('.chat-retry'));
  assert.equal(a.$('#chatIn').value, 'next');
});

test('connection check keeps its short response budget despite connection overrides', async t => {
  const a = boot(t); connection(a, { maxTokens:8192, temperature:1.5, topP:0.9 });
  let request;
  a.w.fetch = async (_url, opts) => { request = JSON.parse(opts.body); return response('OK'); };
  await a.run("testConn(S.connections[0],$('#btnTest'))");
  assert.equal(request.max_tokens, 24);
  assert.equal(request.temperature, 0);
  assert.equal(request.top_p, undefined);
  assert.equal(a.run('workIsBusy()'), false);
});

test('successful generation records its fields and releases the create button', async t => {
  const a = boot(t); connection(a);
  a.run("S.opts.briefBy.world='make a world';tab('studio')");
  const key = a.run('activePreset().schema[0].key');
  a.w.fetch = async () => response(JSON.stringify({[key]:'generated world'}));
  a.$('#btnOneShot').click();
  await nextTurn();
  assert.equal(a.run(`S.project.card.fields[${JSON.stringify(key)}]`), 'generated world');
  assert.equal(a.run('S.library[0].group'), 'world');
  assert.equal(a.run('workIsBusy()'), false);
  assert.equal(a.$('#btnOneShot').disabled, false);
  assert.equal(a.$('#studioInput').hidden, true);
  assert.equal(a.$('#studioResults').hidden, false);
  assert.equal(a.$('#s3Title').textContent, '결과');
  assert.equal(a.w.document.activeElement, a.$('#resultHeading'));
});

test('result and input swap without clearing inputs or making another API call', async t => {
  const a = boot(t); connection(a);
  a.run(`S.assets=[{id:'source',kind:'text',name:'setting',body:'world material',use:true,purposes:['world'],tags:[]}];
    renderNebulaPicker();tab('studio')`);
  for (const [id,value] of [['optBrief','original brief and rule']]) {
    a.$('#'+id).value=value;
    a.$('#'+id).dispatchEvent(new a.w.Event('input',{bubbles:true}));
  }
  const requests=[];
  const key=a.run('activePreset().schema[0].key');
  a.w.fetch=async (_url,opts)=>{
    requests.push(JSON.parse(opts.body));
    return response(JSON.stringify({[key]:'result '+requests.length}));
  };
  a.$('#btnOneShot').click(); await nextTurn();
  a.$('#btnBackToInput').click();
  assert.equal(a.$('#studioInput').hidden,false);
  assert.equal(a.$('#studioResults').hidden,true);
  assert.equal(a.$('#optBrief').value,'original brief and rule');
  assert.equal(a.$('.n-use').checked,true);
  assert.equal(a.w.document.activeElement,a.$('#studioPreset'));
  a.$('#btnViewResult').click();
  assert.equal(a.$('#studioInput').hidden,true);
  assert.equal(a.$('#studioResults').hidden,false);
  assert.equal(requests.length,1);
  a.$('#btnBackToInput').click();
  a.$('#optBrief').value='updated brief';
  a.$('#optBrief').dispatchEvent(new a.w.Event('input',{bubbles:true}));
  a.$('#btnOneShot').click(); await nextTurn();
  assert.equal(requests.length,2);
  assert.ok(requests[1].messages.some(m=>m.content.includes('updated brief')));
  assert.equal(a.$('#studioResults').hidden,false);
  assert.equal(a.run(`S.project.card.fields[${JSON.stringify(key)}]`),'result 2');
  assert.equal(a.run('S.library.length'),2);
});

test('failed or stopped regeneration keeps the previous result accessible', async t => {
  const a=boot(t); connection(a);
  a.run(`S.opts.briefBy.world='brief';S.project.card={fields:{name:'keep result'}};
    renderCard();saveRecord();tab('studio')`);
  a.$('#btnBackToInput').click();
  a.w.fetch=async()=>response('temporary failure',false);
  a.$('#btnOneShot').click(); await nextTurn();
  assert.equal(a.$('#studioInput').hidden,false);
  assert.equal(a.$('#btnViewResult').hidden,false);
  assert.equal(a.run('S.project.card.fields.name'),'keep result');
  const pending=pendingFetch(a);
  a.$('#btnOneShot').click();
  assert.equal(pending.count(),1);
  a.$('#btnAbortCall').click(); await nextTurn();
  assert.equal(a.run('workIsBusy()'),false);
  assert.equal(a.$('#studioInput').hidden,false);
  a.$('#btnViewResult').click();
  assert.equal(a.$('#studioResults').hidden,false);
  assert.equal(a.run('S.project.card.fields.name'),'keep result');
  assert.equal(a.run('S.library.length'),1);
});

test('input/result preference survives group switches and draft restore', t => {
  const a=boot(t);
  a.run("S.project.card={fields:{name:'saved result'}};renderCard();saveRecord();tab('studio')");
  a.$('#btnBackToInput').click();
  a.run("applyGroup('character');applyGroup('world')");
  assert.equal(a.$('#studioInput').hidden,false);
  assert.equal(a.$('#studioResults').hidden,true);
  a.run('saveDraftNow()');
  const storage=Object.fromEntries(Object.keys(a.w.localStorage).map(key=>[key,a.w.localStorage.getItem(key)]));
  const b=boot(t,storage);
  assert.equal(b.$('#studioInput').hidden,false);
  assert.equal(b.$('#btnViewResult').hidden,false);
  b.run('loadRecordToStudio(S.library[0])');
  assert.equal(b.$('#studioResults').hidden,false);
  assert.equal(b.$('#studioInput').hidden,true);
});

test('staged creation replaces one screen at a time and keeps candidate selection separate from generation', async t => {
  const a=boot(t); connection(a);
  a.run("S.opts.briefBy.world='world and its rules';S.opts.buildMode='staged';renderBuildMode();tab('studio')");
  const key=a.run('activePreset().schema[0].key');
  const requests=replyQueue(a,[{title:'Digest'},[{id:'a',line:'First'},{id:'b',line:'Second'}],{[key]:'Result'},{verdict:'ok',violations:[]}]);
  screenIs(a,'input');
  a.$('#btnOneShot').click(); screenIs(a,'loading');
  assert.equal(a.$('#btnAbortCall').parentElement,a.$('#studioStopSlot'));
  assert.equal(a.$('#btnAbortCall').hidden,false);
  await nextTurn(); screenIs(a,'digest'); assert.equal(requests.length,1);
  assert.equal(a.$('#spine [aria-current="step"]').dataset.st,'digest');
  a.$('#btnDigestNext').click(); screenIs(a,'loading');
  await nextTurn(); screenIs(a,'seed'); assert.equal(requests.length,2);
  assert.equal(a.$('#spine [aria-current="step"]').dataset.st,'seed');
  assert.equal(a.$('#btnSeedNext').disabled,true);
  a.$('.seed').click(); screenIs(a,'seed'); assert.equal(requests.length,2);
  assert.equal(a.$('#btnSeedNext').disabled,false);
  a.$('#btnSeedNext').click(); screenIs(a,'loading');
  await nextTurn(); screenIs(a,'result'); assert.equal(requests.length,4);
  assert.equal(a.run(`S.project.card.fields[${JSON.stringify(key)}]`),'Result');
  assert.ok(requests.every(r=>r.messages.some(m=>m.content.includes('world and its rules'))));
  a.$('#btnBackToInput').click(); screenIs(a,'input');
  a.$('#btnViewResult').click(); screenIs(a,'result'); assert.equal(requests.length,4);
});

test('prompt entry merges edit modes while retaining legacy adaptation and its generation instructions', t => {
  const a=boot(t,{'orrery.v1':JSON.stringify({opts:{group:'prompt',modeBy:{world:'new',character:'w2c',prompt:'adapt'}}})});
  assert.equal(a.w.document.querySelectorAll('#modeBox .mode').length,2);
  assert.equal(a.$('#modeBox [aria-pressed="true"]').dataset.mode,'supplement');
  assert.equal(a.run('activeMode()'),'adapt');
  const adapt=a.run("modeNote('expand')");
  assert.equal(a.$('#promptEditMode').value,'adapt');
  assert.equal(a.$('#promptEditMode').closest('details'),a.$('#optAdv'));
  assert.equal(a.$('#optAdv').open,false);
  a.$('#promptEditMode').value='supplement';a.$('#promptEditMode').dispatchEvent(new a.w.Event('change',{bubbles:true}));
  assert.equal(a.run('activeMode()'),'supplement');
  assert.notEqual(a.run("modeNote('expand')"),adapt);
  a.$('#promptEditMode').value='adapt';a.$('#promptEditMode').dispatchEvent(new a.w.Event('change',{bubbles:true}));
  a.$('#modeBox [data-mode="new"]').click();assert.equal(a.$('#promptEditField').hidden,true);
  a.$('#modeBox [data-mode="supplement"]').click();assert.equal(a.run('activeMode()'),'adapt');
  assert.equal(a.$('#refinePanel').closest('details'),a.$('#optAdv'));
  assert.equal(a.$('#briefLabel').textContent,'구상');
  assert.equal(a.$('#briefNote'),null);assert.equal(a.$('#studioNote'),null);
});

test('skip-seed presets stop for digest review before creating the result', async t => {
  const a=boot(t); connection(a);
  a.run("switchPreset('world-audit');S.opts.briefBy.world='source';S.opts.buildMode='staged';renderBuildMode();tab('studio')");
  const key=a.run('activePreset().schema[0].key');
  const requests=replyQueue(a,[{title:'Review'}, {[key]:'Audit'}]);
  a.$('#btnOneShot').click(); await nextTurn();
  screenIs(a,'digest'); assert.equal(requests.length,1);
  a.$('#btnDigestNext').click(); await nextTurn();
  screenIs(a,'result'); assert.equal(requests.length,2);
});

test('mixing two candidates keeps the combined candidate on the choice screen', async t => {
  const a=boot(t); connection(a);
  a.run("S.opts.buildMode='staged';S.project.digest={title:'Digest'};S.project.seeds=[{id:'a',line:'A'},{id:'b',line:'B'}];renderSeeds();renderBuildMode();tab('studio');showStudioScreen('seed')");
  const requests=replyQueue(a,[{line:'Combined',hook:'Both'}]);
  a.$('[data-sid="a"]').click(); a.$('[data-sid="b"]').click();
  assert.equal(a.$('#btnSeedNext').disabled,true);
  assert.equal(a.$('#btnCross').disabled,false);
  a.$('#btnCross').click(); screenIs(a,'loading'); await nextTurn();
  screenIs(a,'seed'); assert.equal(requests.length,1);
  assert.equal(a.run('S.project.seeds.at(-1).line'),'Combined');
  assert.equal(a.$('#btnSeedNext').disabled,false);
});

test('stopping validation preserves the completed result and returns from loading', async t => {
  const a=boot(t); connection(a);
  a.run("S.opts.buildMode='staged';S.project.digest={title:'Digest'};S.project.seeds=[{id:'a',line:'A'}];S.project.sel=['a'];renderSeeds();renderBuildMode();tab('studio');showStudioScreen('seed')");
  const key=a.run('activePreset().schema[0].key');
  const pending=pendingFetch(a), waitFetch=a.w.fetch;
  let first=true;
  a.w.fetch=async(...args)=>{if(first){first=false;return response(JSON.stringify({[key]:'Keep result'}));}return waitFetch(...args);};
  a.$('#btnSeedNext').click(); await nextTurn(); screenIs(a,'loading');
  assert.equal(pending.count(),1);
  assert.ok(a.$('#studioLoadingStep').textContent.includes('2'));
  assert.equal(a.$('#btnAbortCall').hidden,false);
  a.$('#btnAbortCall').click(); await nextTurn();
  screenIs(a,'result'); assert.equal(a.run('workIsBusy()'),false);
  assert.equal(a.run(`S.project.card.fields[${JSON.stringify(key)}]`),'Keep result');
  assert.equal(a.run('S.library.length'),1);
});

test('stopped candidate generation returns to the digest review with the original input intact', async t => {
  const a=boot(t); connection(a);
  a.run("S.opts.briefBy.world='Keep brief';S.opts.buildMode='staged';S.project.digest={title:'Keep digest'};renderDigest();renderSeeds();renderBuildMode();tab('studio');showStudioScreen('digest')");
  pendingFetch(a); a.$('#btnDigestNext').click(); screenIs(a,'loading');
  a.$('#btnAbortCall').click(); await nextTurn();
  screenIs(a,'digest'); assert.equal(a.run('S.project.digest.title'),'Keep digest');
  assert.equal(a.run('curBrief()'),'Keep brief');
});

test('cast creation opens its own screen and preserves completed people on cancellation', async t => {
  const a=boot(t); connection(a);
  a.run("applyGroup('character');S.project.card={fields:{name:'Earlier result'}};saveRecord();S.opts.modeBy.character='cast';S.opts.briefBy.character='Cast brief';S.opts.castCount=2;renderModeChooser();renderBuildMode();tab('studio');showStudioScreen('input')");
  const replies=[{title:'World'},[{id:'a',line:'Person A'}],{name:'Person A'}];
  const pending=pendingFetch(a), waitFetch=a.w.fetch;
  a.w.fetch=async(...args)=>replies.length?response(JSON.stringify(replies.shift())):waitFetch(...args);
  a.$('#btnOneShot').click(); await nextTurn(); screenIs(a,'loading');
  assert.equal(pending.count(),1);
  a.$('#btnAbortCall').click(); await nextTurn();
  screenIs(a,'cast'); assert.equal(a.run('S.project.cast.length'),1);
  a.$('.c-open').click(); screenIs(a,'result');
  assert.equal(a.run('S.project.card.fields.name'),'Person A');
  assert.equal(a.run('S.library.find(r=>r.fields.name===\'Earlier result\').fields.name'),'Earlier result');
  assert.equal(a.run('S.library.length'),2);
  a.$('#btnBackToCast').click(); screenIs(a,'cast');
});

test('an empty candidate response preserves existing choices and returns from loading', async t => {
  const a=boot(t);connection(a);
  a.run("S.opts.buildMode='staged';S.project.digest={title:'Digest'};S.project.seeds=[{id:'a',line:'Keep choice'}];S.project.sel=['a'];renderSeeds();renderBuildMode();tab('studio');showStudioScreen('seed')");
  replyQueue(a,[{seeds:[]}]);a.$('#btnSeeds').click();await nextTurn();
  screenIs(a,'seed');assert.equal(a.run('S.project.seeds[0].line'),'Keep choice');
  assert.deepEqual(plain(a.run('S.project.sel')),['a']);assert.equal(a.$('#btnSeedNext').disabled,false);
});

test('method cards show call counts and advanced controls stay collapsed in easy mode', t => {
  const a=boot(t);
  const style=a.w.document.createElement('style');
  style.textContent=fs.readFileSync(path.join(root,'styles.css'),'utf8');a.w.document.head.append(style);
  assert.equal(a.$('#btnOneshotHelp'),null);
  assert.ok(a.$('#stagedCost').textContent.includes('4'));
  assert.ok(a.$('#oneshotCost').textContent.includes('1'));
  assert.equal(a.$('#optAdv').open,false);
  assert.equal(a.$('#nebulaPick').open,false);
  for(const id of ['optTone','optSeedN','optCheck','optLang']) assert.equal(a.$('#'+id).closest('details'),a.$('#optAdv'));
  assert.equal(a.w.getComputedStyle(a.$('#oneshotBox')).alignItems,'flex-end');
  a.$('#optCheck').value='0';a.$('#optCheck').dispatchEvent(new a.w.Event('change',{bubbles:true}));
  assert.ok(a.$('#stagedCost').textContent.includes('3'));
  a.run("setEasy(true);S.opts.buildMode='staged';renderBuildMode();save()");
  assert.notEqual(a.w.getComputedStyle(a.$('#buildModeBox')).display,'none');
  assert.notEqual(a.w.getComputedStyle(a.$('#optAdv')).display,'none');
  const b=boot(t,{'orrery.v1':a.w.localStorage.getItem('orrery.v1')});
  assert.equal(b.run('S.opts.buildMode'),'staged');
});

test('result tools are disclosed separately while basic exports and interrupted-output recovery remain accessible', t => {
  const a=boot(t);
  a.run("S.project.card={fields:{name:'Result'}};renderCard();tab('studio');showStudioScreen('result')");
  const advanced=a.$('#resultAdvanced'); assert.equal(advanced.open,false);
  for(const id of ['btnReroll','rerollNote','btnLockAll','btnRawView','btnCheck','btnAsk','convertBox']) assert.ok(advanced.contains(a.$('#'+id)),id);
  for(const id of ['cardOut','btnCopyText','btnDlText','btnSaveLib','continueBox']) assert.equal(advanced.contains(a.$('#'+id)),false,id);
  assert.equal(a.$('#continueBox').open,false);
  a.run('S.project.card.truncated=true;renderContinue()');
  assert.equal(a.$('#continueBox').hidden,false);assert.equal(a.$('#continueBox').open,true);
  a.run("S.project.verdict='warn';renderCheck()");
  assert.ok(a.$('#checkSummary').textContent.length>0);assert.equal(advanced.open,false);
});

test('staged page survives switching groups and restoring a draft, including viewing it after changing method', t => {
  const a=boot(t);
  a.run("S.opts.buildMode='staged';S.project.digest={title:'Saved digest'};S.project.seeds=[{id:'a',line:'Saved choice'}];renderSeeds();renderBuildMode();tab('studio');showStudioScreen('seed');applyGroup('character');applyGroup('world')");
  screenIs(a,'seed');a.run('saveDraftNow()');
  const storage=Object.fromEntries(Object.keys(a.w.localStorage).map(key=>[key,a.w.localStorage.getItem(key)]));
  const b=boot(t,storage);screenIs(b,'seed');
  b.$('#btnBackToInput').click();b.$('[data-build="oneshot"]').click();b.$('#btnViewResult').click();
  screenIs(b,'seed');
  const style=b.w.document.createElement('style');style.textContent=fs.readFileSync(path.join(root,'styles.css'),'utf8');b.w.document.head.append(style);
  assert.notEqual(b.w.getComputedStyle(b.$('#seedPanel')).display,'none');
});

test('legacy extra requests merge into every group once and leave final-output requests separate', t => {
  const opts={group:'world',briefBy:{world:'Brief',character:'Person',prompt:''},extraBy:{world:'Rule',character:'Person rule',prompt:'Prompt rule'},convert:{extraBy:{world:'Output rule'}}};
  const a=boot(t,{'orrery.v1':JSON.stringify({opts})});
  const briefs=plain(a.run('S.opts.briefBy'));
  assert.ok(briefs.world.includes('Brief')&&briefs.world.includes('Rule'));
  assert.ok(briefs.character.includes('Person rule'));
  assert.ok(briefs.prompt.includes('Prompt rule'));
  assert.ok(Object.values(plain(a.run('S.opts.extraBy'))).every(v=>v===''));
  assert.equal(a.run('curConvertExtra()'),'Output rule');
  const b=boot(t,{'orrery.v1':a.w.localStorage.getItem('orrery.v1')});
  assert.deepEqual(plain(b.run('S.opts.briefBy')),briefs);
});

test('material manager preserves the tab, form and focus while supporting nested dialogs', async t => {
  const a=boot(t);a.run("tab('studio')");
  const source=a.$('#v-sources'),home=source.parentElement,file=a.$('#fileIn'),trigger=a.$('#btnStudioMaterials');
  trigger.focus();trigger.click(); await nextTurn();
  assert.equal(a.run('curTab'),'studio');assert.equal(source.parentElement,a.$('#materialsManagerMount'));
  assert.equal(a.$('main').inert,true);
  a.$('#btnPaste').click();a.$('#pasteName').value='Material';a.$('#pasteIn').value='Source text';a.$('#btnPasteAdd').click();
  assert.equal(a.run('S.assets[0].body'),'Source text');assert.equal(a.$('.n-use').checked,true);
  a.run('openAssetFolderModal()');await nextTurn();
  a.$('#assetFolderModal').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await nextTurn();
  assert.equal(a.$('#assetFolderModal').hidden,true);assert.equal(a.$('#materialsManagerModal').hidden,false);
  a.$('#btnPaste').click();a.$('#pasteIn').value='Unfinished';
  a.$('#materialsManagerModal').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await nextTurn();
  assert.equal(source.parentElement,home);assert.equal(a.$('#fileIn'),file);assert.equal(a.w.document.activeElement,trigger);
  trigger.click();await nextTurn();assert.equal(a.$('#pasteIn').value,'Unfinished');
  a.$('#materialsManagerModal').click();await nextTurn();assert.equal(source.parentElement,home);
  assert.equal(a.run('curTab'),'studio');
});

test('stopping an automatic continuation does not save partial output as success', async t => {
  const a = boot(t); connection(a);
  a.run("S.opts.briefBy.world='make a world'");
  const key = a.run('activePreset().schema[0].key');
  const pending = pendingFetch(a);
  const waitFetch = a.w.fetch;
  let first = true;
  a.w.fetch = async (...args) => {
    if(first){ first = false; return response('{'+JSON.stringify(key)+':"incomplete'); }
    return waitFetch(...args);
  };
  const job = a.run("guard($('#btnOneShot'),'working',async()=>{S.project.card=await doOneShot();saveRecord();})");
  await nextTurn();
  assert.equal(pending.count(), 1);
  a.$('#btnAbortCall').click();
  assert.equal(await job, false);
  assert.equal(a.run('S.project.card'), null);
  assert.equal(a.run('S.library.length'), 0);
});

test('current continuation and reroll instructions survive reload', t => {
  const a = boot(t);
  a.run("S.project.card={fields:{name:'draft'}};renderCard()");
  for (const id of ['continueNote','rerollNote']) {
    a.$('#'+id).value = id+' text';
    a.$('#'+id).dispatchEvent(new a.w.Event('input', {bubbles:true}));
  }
  a.run('saveDraftNow()');
  const storage = Object.fromEntries(Object.keys(a.w.localStorage).map(key => [key,a.w.localStorage.getItem(key)]));
  const b = boot(t, storage);
  assert.equal(b.$('#continueNote').value, 'continueNote text');
  assert.equal(b.$('#rerollNote').value, 'rerollNote text');
});

test('easy mode keeps per-field retry and truncated-output recovery available', t => {
  const a = boot(t);
  const style = a.w.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  a.w.document.head.append(style);
  a.run("S.project.card={fields:{name:'draft'},truncated:true};renderCard();setEasy(true);tab('studio')");
  assert.notEqual(a.w.getComputedStyle(a.$('.f-one')).display, 'none');
  assert.notEqual(a.w.getComputedStyle(a.$('#continueBox')).display, 'none');
  assert.equal(a.w.getComputedStyle(a.$('.f-lock')).display, 'none');
  a.run('S.project.card.truncated=false;renderContinue()');
  assert.equal(a.w.getComputedStyle(a.$('#continueBox')).display, 'none');
});

test('modal receives focus, isolates the page and returns focus on Escape', async t => {
  const a = boot(t);
  const trigger = a.$('#btnConnHelp');
  trigger.focus(); trigger.click();
  await nextTurn();
  const modal = a.$('#connHelp');
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(a.w.document.activeElement, modal); // jsdom has no layout or visible client rects.
  assert.equal(a.$('main').inert, true);
  modal.dispatchEvent(new a.w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await nextTurn();
  assert.equal(modal.hidden, true);
  assert.equal(a.w.document.activeElement, trigger);
  assert.ok(!a.$('main').inert);
});
