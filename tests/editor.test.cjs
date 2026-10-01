const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

function editor(t){
  const html = fs.readFileSync(path.join(root,'prompt-editor.html'),'utf8').replace(/<script src="[^"]+"><\/script>/g,'');
  const dom = new JSDOM(html,{url:'http://orrery.test/prompt-editor.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window; w.confirm=()=>true;
  const ctx = dom.getInternalVMContext();
  for (const f of ['prompts.js','builtin-presets.js','talk-roles.js']) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'), ctx);
  vm.runInContext(w.document.querySelector('script:not([src])').textContent, ctx);
  t.after(()=>w.close());
  return {w, run:c=>vm.runInContext(c,ctx), $:s=>w.document.querySelector(s)};
}
const plain = v => JSON.parse(JSON.stringify(v));

test('editor reads tags and enabled when present, defaults to none and on when absent, and writes them back only when set', t => {
  const e = editor(t);
  e.$('#btnLoadSource').click();
  const before = plain(e.run('items'));
  assert.ok(before.length > 0);
  // 실제 prompts.js 내용과 상관없이: 파일 값이 있으면 그대로, 없으면 태그 없음·켜짐
  const src = plain(e.run('window.BUILTIN_COMMON.filter(x=>x&&x.content)'));
  assert.deepEqual(before.map(x=>[x.tags,x.enabled]), src.map(x=>[Array.isArray(x.tags)?x.tags:[], x.enabled!==false]));
  e.run(`items=[];[{name:'A',content:'aaa'},{name:'B',content:'bbb',tags:['#클로드',' 긴 출력 '],enabled:false,groups:'all'}].forEach(x=>items.push(newItem(x)));render();`);
  assert.deepEqual(plain(e.run('items[1].tags')), ['클로드','긴 출력']);
  assert.ok(e.$('.item[data-i="1"]').classList.contains('dim'));
  const json = JSON.parse(e.run('toJson()'));
  assert.deepEqual(json[0], {name:'A',tags:[],enabled:true,content:'aaa'});
  assert.deepEqual(json[1], {name:'B',tags:['클로드','긴 출력'],enabled:false,content:'bbb'});
  // 화면에서 태그·스위치 바꾸기
  e.$('.item[data-i="0"] .chev').click();
  const tags = e.$('.item[data-i="0"] .tags'); tags.value='제미니'; tags.dispatchEvent(new e.w.Event('change',{bubbles:true}));
  const sw = e.$('.item[data-i="1"] .enabled'); sw.checked=true; sw.dispatchEvent(new e.w.Event('change',{bubbles:true}));
  assert.deepEqual(plain(e.run('items.map(x=>[x.tags,x.enabled])')), [[['제미니'],true],[['클로드','긴 출력'],true]]);
});

test('prompts.js output round-trips every instruction exactly, including backticks and ${}', t => {
  const e = editor(t);
  e.$('#btnLoadSource').click();
  e.run("items.push(newItem({name:'까다로운',content:'백틱 ` 과 ${x} 와 \\ 역슬래시',tags:['클로드'],enabled:false,groups:['world']}))");
  const out = e.run('toPromptsJs()');
  const back = plain(e.run(`parseBuiltin(${JSON.stringify(out)})`));
  const want = plain(e.run('items.map(itemOut)'));
  assert.deepEqual(back, want);
});

test('with a connected file, apply rewrites only the instruction list, keeps the header and line endings, and clears the app override', async t => {
  const e = editor(t);
  const original = fs.readFileSync(path.join(root,'prompts.js'),'utf8');
  let written = null;
  e.run(`fileHandle={name:'prompts.js',queryPermission:async()=>'granted',getFile:async()=>({text:async()=>${JSON.stringify(original)}}),
    createWritable:async()=>({write:async t=>{window.__w=t},close:async()=>{}})};
    localStorage.setItem(APPLIED_KEY,'[]');updateApplyState();`);
  assert.match(e.$('#btnApply').textContent, /파일에 반영/);
  e.$('#btnLoadSource').click();
  e.run("items[0].tags=['클로드']");
  await e.run('saveToFile()');
  written = e.run('window.__w');
  const head = original.slice(0, original.indexOf('window.BUILTIN_COMMON'));
  assert.ok(written.startsWith(head));
  assert.equal(/\r\n/.test(original), /\r\n/.test(written));
  const arr = plain(e.run(`parseBuiltin(${JSON.stringify(written)})`));
  assert.deepEqual(arr[0].tags, ['클로드']);
  assert.equal(e.run('localStorage.getItem(APPLIED_KEY)'), null);
});

test('malformed tags and enabled values are corrected on read', t => {
  const e = editor(t);
  e.run(`items=[];[{name:'S',content:'s',tags:'#클로드, 제미니',enabled:'false'},{name:'Z',content:'z',enabled:0},{name:'N',content:'n',enabled:'true'}].forEach(x=>items.push(newItem(x)))`);
  assert.deepEqual(plain(e.run('items.map(x=>[x.tags,x.enabled])')), [[['클로드','제미니'],false],[[],false],[[],true]]);
});

test('several cards can be picked to add or remove a tag and switch them on or off together', t => {
  const e = editor(t);
  e.run(`items=[];['A','B','C'].forEach(n=>items.push(newItem({name:n,content:n,tags:n==='C'?['클로드']:[]})));render();`);
  assert.equal(e.$('#bulkBar').hidden, true);
  for (const i of [0,2]) { const c=e.$(`.item[data-i="${i}"] .pick`); c.checked=true; c.dispatchEvent(new e.w.Event('change',{bubbles:true})); }
  assert.equal(e.$('#bulkBar').hidden, false);
  assert.equal(e.$('#bulkCount').textContent, '선택 2개');
  e.$('#bulkTags').value='클로드, 긴 출력'; e.$('#bulkAddTag').click();
  assert.deepEqual(plain(e.run('items.map(x=>x.tags)')), [['클로드','긴 출력'],[],['클로드','긴 출력']]);
  e.$('#bulkTags').value='#긴 출력'; e.$('#bulkDelTag').click();
  e.$('#bulkOff').click();
  assert.deepEqual(plain(e.run('items.map(x=>[x.tags,x.enabled])')), [[['클로드'],false],[[],true],[['클로드'],false]]);
  e.$('#bulkAll').click(); assert.equal(e.$('#bulkCount').textContent, '선택 3개');
  e.$('#bulkNone').click(); assert.equal(e.$('#bulkBar').hidden, true);
});

test('opens with the files in the same folder already loaded, and offers to resume an unsaved draft', t => {
  const e = editor(t);
  assert.ok(e.run('items.length') > 0);
  assert.equal(e.run('items.length'), e.run('window.BUILTIN_COMMON.filter(x=>x&&x.content).length'));
  assert.ok(e.run('presets.length') > 10);
  assert.equal(e.run('roles.length'), 5);
  assert.equal(e.$('#draft-common').hidden, true);
  // 반영하지 않은 편집이 남은 채 다시 연 상황
  e.run("items[0].name='고치던 중';save();items=window.BUILTIN_COMMON.filter(x=>x&&x.content).map(newItem);draftCheck('common')");
  assert.equal(e.$('#draft-common').hidden, false);
  e.$('#draft-common [data-draft="resume"]').click();
  assert.equal(e.run('items[0].name'), '고치던 중');
});

test('common instructions show categories and tags as chips, and search covers title, content, category and tags', t => {
  const e = editor(t);
  e.run(`items=[];[{name:'문체 규칙',content:'짧게 쓴다',groups:['world']},{name:'클로드 보정',content:'xml',tags:['클로드']},{name:'꺼둔 것',content:'zzz',enabled:false}].forEach(x=>items.push(newItem(x)));render();`);
  const card0 = e.$('.item[data-i="0"]');
  assert.match(card0.querySelector('.cat').textContent, /세계/);
  assert.match(e.$('.item[data-i="1"] .ctag').textContent, /#클로드/);
  const shown = () => [...e.w.document.querySelectorAll('#list .item .nm')].map(x=>x.textContent);
  const q = e.$('#q');
  for (const [word, want] of [['짧게',['문체 규칙']],['#클로드',['클로드 보정']],['세계',['문체 규칙']],['보정',['클로드 보정']]]) {
    q.value = word; q.dispatchEvent(new e.w.Event('input')); assert.deepEqual(shown(), want, word);
  }
  q.value=''; q.dispatchEvent(new e.w.Event('input'));
  e.$('#fchips [data-f="tag"][data-v="클로드"]').click(); assert.deepEqual(shown(), ['클로드 보정']);
  e.$('#fchips [data-f="tag"][data-v="클로드"]').click();
  e.$('#fchips [data-f="off"]').click(); assert.deepEqual(shown(), ['꺼둔 것']);
  e.$('#fchips [data-f="off"]').click();
  // 접힌 카드는 펼쳐야 편집 칸이 나온다
  assert.equal(e.$('.item[data-i="0"] textarea.content'), null);
  e.$('.item[data-i="0"] .chev').click();
  assert.ok(e.$('.item[data-i="0"] textarea.content'));
});

test('presets are edited as JSON with validation, and roles by name and content; both write their own file', async t => {
  const e = editor(t);
  const i = e.run("presets.findIndex(p=>p.id==='prompt-forge')");
  e.run(`presetOpen.add('prompt-forge');renderPresets();`);
  const ta = e.$(`#presetList textarea.json[data-pi="${i}"]`);
  const obj = JSON.parse(ta.value); obj.id = 'other';
  ta.value = JSON.stringify(obj); ta.dispatchEvent(new e.w.Event('input',{bubbles:true}));
  assert.match(e.$(`[data-pmsg="${i}"]`).textContent, /id는 바꿀 수 없습니다/);
  assert.throws(() => e.run('presetsListText()'), /id는 바꿀 수 없습니다/);
  obj.id = 'prompt-forge'; obj.name = '프롬프트 생성기 v2';
  ta.value = JSON.stringify(obj); ta.dispatchEvent(new e.w.Event('input',{bubbles:true}));
  assert.match(e.$(`[data-pmsg="${i}"]`).textContent, /괜찮음/);
  const fake = (name,v) => `({name:'${name}',queryPermission:async()=>'granted',getFile:async()=>({text:async()=>'/* head */\\r\\nwindow.${v} = [];'}),createWritable:async()=>({write:async t=>{window.__w=t},close:async()=>{}})})`;
  e.run(`TARGETS.presets.handle=${fake('builtin-presets.js','BUILTIN_PRESETS')};TARGETS.roles.handle=${fake('talk-roles.js','TALK_ROLES')}`);
  e.$('#btnApplyPresets').click(); await new Promise(r=>setTimeout(r,20));
  let w = e.run('window.__w');
  assert.ok(w.startsWith('/* head */\r\n'));
  const arr = Function('window','return (()=>{'+w+'; return window.BUILTIN_PRESETS})()')({});
  assert.equal(arr.find(p=>p.id==='prompt-forge').name, '프롬프트 생성기 v2');
  const rn = e.$('#roleList .rcontent[data-ri="0"]'); rn.value='새 세계관 상담역 지시'; rn.dispatchEvent(new e.w.Event('input',{bubbles:true}));
  e.$('#btnApplyRoles').click(); await new Promise(r=>setTimeout(r,20));
  w = e.run('window.__w');
  const rs = Function('window','return (()=>{'+w+'; return window.TALK_ROLES})()')({});
  assert.equal(rs[0].content, '새 세계관 상담역 지시');
});

test('commit message follows the house rules: prefix, short title, no period, body required, no AI signature', t => {
  const e = editor(t);
  assert.equal(e.$('#commitTitle').value, 'prompt: 프롬프트 수정');
  const bad = () => [...e.w.document.querySelectorAll('#commitChecks .bad')].map(x=>x.textContent);
  assert.ok(bad().some(x=>/본문/.test(x)));
  e.$('#commitBody').value='- 후킹포인트 설계를 세계용으로 나눔'; e.$('#commitBody').dispatchEvent(new e.w.Event('input'));
  assert.deepEqual(bad(), []);
  e.$('#commitTitle').value='프롬프트 수정.'; e.$('#commitTitle').dispatchEvent(new e.w.Event('input'));
  assert.ok(bad().some(x=>/접두어/.test(x)) && bad().some(x=>/마침표/.test(x)));
  e.$('#commitBody').value+='\n\nCo-Authored-By: Claude'; e.$('#commitBody').dispatchEvent(new e.w.Event('input'));
  assert.ok(bad().some(x=>/AI 서명/.test(x)));
  e.$('#btnCommitReset').click(); assert.equal(e.$('#commitTitle').value, 'prompt: 프롬프트 수정');
});
