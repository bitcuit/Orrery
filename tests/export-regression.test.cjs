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
    const file = script.getAttribute('src');
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
  }
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  return {w,run,$:selector=>w.document.querySelector(selector)};
}
const plain = value => JSON.parse(JSON.stringify(value));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function characterRecord(a) {
  a.run(`S.library=[{id:'record',name:'Test',group:'character',presetId:'default',
    fields:{name:'Test',background:'History'},at:1}];
    libFilter='';renderLib();window.exports=[];dl=(name,text)=>window.exports.push({name,text});`);
}

test('record JSON exports use the recorded preset while another workbench is active', t => {
  const a = boot(t);
  characterRecord(a);
  assert.equal(a.run('S.opts.group'), 'world');
  a.$('.l-json').click();
  a.run("openLibView('record')");
  a.$('#libViewJson').click();
  assert.equal(a.w.exports.length, 2);
  for (const item of a.w.exports) {
    assert.equal(JSON.parse(item.text).data.description, '[배경]\nHistory');
  }
  assert.equal(a.run('S.opts.group'), 'world');
  a.run("applyGroup('character');switchPreset('default')");
  assert.equal(a.run("toV2({name:'Test',background:'History'}).data.description"), '[배경]\nHistory');
});

function deferredCanvas(a) {
  const callbacks = [];
  a.w.TextEncoder = TextEncoder;
  a.w.Blob = Blob;
  a.w.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient:() => ({addColorStop(){}}), fillRect(){}, strokeRect(){}, fillText(){}
  });
  a.w.HTMLCanvasElement.prototype.toBlob = callback => callbacks.push(callback);
  return () => {
    assert.equal(callbacks.length, 1);
    callbacks.shift()(new Blob([Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex')], {type:'image/png'}));
  };
}
async function pngCard(blob) {
  const data = Buffer.from(await blob.arrayBuffer());
  for (let offset = 8; offset < data.length - 8;) {
    const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'tEXt') {
      const text = data.toString('ascii', offset + 8, offset + 8 + length);
      if (text.startsWith('chara\0')) return JSON.parse(Buffer.from(text.slice(6),'base64').toString('utf8'));
    }
    offset += length + 12;
  }
  assert.fail('PNG has no character metadata');
}
test('record PNG exports retain their preset across asynchronous rendering', async t => {
  const a = boot(t), finishCanvas = deferredCanvas(a);
  characterRecord(a);
  a.run('window.pngs=[];dlBlob=(name,blob)=>window.pngs.push({name,blob})');
  for (const selector of ['.l-png','#libViewPng']) {
    a.run("applyGroup('world');libFilter='';renderLib();openLibView('record')");
    a.$(selector).click();
    a.run("applyGroup('prompt')");
    finishCanvas();
    await nextTurn();
  }
  assert.equal(a.w.pngs.length, 2);
  for (const item of a.w.pngs) assert.equal((await pngCard(item.blob)).data.description, '[배경]\nHistory');
});
test('current-result PNG captures its original preset before canvas rendering completes', async t => {
  const a = boot(t), finishCanvas = deferredCanvas(a);
  a.run("applyGroup('character');switchPreset('default')");
  const pending = a.run("makeCardPng({name:'Test',background:'History'})");
  a.run("applyGroup('prompt')");
  finishCanvas();
  assert.equal((await pngCard(await pending)).data.description, '[배경]\nHistory');
});

test('empty staged generation preserves the previous result and existing records', async t => {
  const a = boot(t);
  a.run(`S.connections=[{id:'test',provider:'openai',apiKey:'test-only',model:'test-model'}];S.activeConn='test';
    S.project.card={fields:{title:'Previous'}};saveRecord();`);
  const before = plain(a.run('({card:S.project.card,library:S.library,libId:S.project.libId})'));
  let requests = 0;
  a.w.fetch = async () => {
    requests++;
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{}'}}]})};
  };
  await assert.rejects(a.run('makeExpandedResult(null)'), /결과에서 칸을 찾지 못했습니다/);
  assert.equal(requests, 1);
  assert.deepEqual(plain(a.run('({card:S.project.card,library:S.library,libId:S.project.libId})')), before);
});
test('bulk cast records preserve truncated-output recovery on save and restore', t => {
  const a = boot(t);
  a.run(`applyGroup('character');switchPreset('default');
    S.project.cast=[{fields:{name:'Partial',background:'Cut'},truncated:true,truncatedField:'background',
      continuations:[{at:1,instruction:'Continue',added:{background:'More'}}],conversion:{result:'Translated'}}];
    renderCast();$('#btnCastSave').click();`);
  const record = plain(a.run('S.library[0]'));
  assert.equal(record.truncated, true);
  assert.equal(record.truncatedField, 'background');
  assert.equal(record.continuations[0].added.background, 'More');
  assert.equal(record.conversion.result, 'Translated');
  a.run('loadRecordToStudio(S.library[0])');
  const card = plain(a.run('S.project.card'));
  assert.equal(card.truncated, true);
  assert.equal(card.truncatedField, 'background');
  assert.deepEqual(card.continuations, record.continuations);
  assert.equal(a.$('#continueBox').open, true);
});

function checkMaterialPersistence(t, a, expectedKind, expectedText) {
  const asset = plain(a.run('S.assets[0]'));
  assert.equal(asset.kind, expectedKind);
  assert.match(expectedKind === 'lorebook' ? asset.entries[0].content : asset.body, expectedText);
  assert.equal(a.$('#talkAssetList .t-use').dataset.id, asset.id);
  assert.equal(a.$('#talkAssetList .t-use').checked, true);
  assert.match(a.$('#talkAssetCount').textContent, /1\/1/);
  assert.equal(a.$('#ctxAssets').disabled, false);
  assert.match(a.$('#ctxTok').textContent, new RegExp(String(a.run('tok(talkContext())'))));
  const restored = boot(t, a.w.localStorage.getItem('orrery.v1'));
  assert.equal(restored.run('S.assets.length'), 1);
  const stored = plain(restored.run('S.assets[0]'));
  assert.equal(stored.id, asset.id);
  assert.equal(stored.kind, asset.kind);
  assert.equal(stored.use, true);
  if(expectedKind === 'lorebook') assert.deepEqual(stored.entries, asset.entries);
  else assert.equal(stored.body, asset.body);
}
test('sending a saved record to materials persists immediately and refreshes chat context', t => {
  const a = boot(t);
  characterRecord(a);
  a.run("S.assets=[];S.chat.ctx.assets=true;renderChat();openLibView('record')");
  a.$('#libViewMat').click();
  checkMaterialPersistence(t, a, 'text', /History/);
});
test('sending the current result to materials persists immediately and refreshes chat context', t => {
  const a = boot(t);
  a.run("S.assets=[];S.chat.ctx.assets=true;S.project.card={fields:{title:'Current world'}};renderCard();renderChat()");
  a.$('#btnToAsset').click();
  checkMaterialPersistence(t, a, 'text', /Current world/);
});
test('record and result material actions preserve state while another task is active', t => {
  const a = boot(t);
  characterRecord(a);
  a.run("S.project.card={fields:{title:'Current world'}};save();beginTask();openLibView('record')");
  const assetsBefore = plain(a.run('S.assets'));
  const savedBefore = a.w.localStorage.getItem('orrery.v1');
  a.$('#libViewMat').click();
  a.$('#btnToAsset').click();
  assert.deepEqual(plain(a.run('S.assets')), assetsBefore);
  assert.equal(a.w.localStorage.getItem('orrery.v1'), savedBefore);
  a.run('endTask(ACTIVE_TASK);S.project.card=null;recordToMaterial(null)');
  a.$('#btnToAsset').click();
  a.$('#btnDlBook').click();
  assert.deepEqual(plain(a.run('S.assets')), assetsBefore);
  assert.equal(a.run('ACTIVE_TASK'), null);
});
test('lorebook creation persists materials on completion and refuses concurrent requests', async t => {
  const a = boot(t);
  a.run(`S.assets=[];S.chat.ctx.assets=true;S.project.card={fields:{title:'Current world'}};
    S.connections=[{id:'test',provider:'openai',apiKey:'test-only',model:'test-model'}];S.activeConn='test';
    window.downloads=[];dl=(name,text)=>window.downloads.push({name,text});renderCard();renderChat();beginTask();`);
  let requests = 0, finish;
  a.w.fetch = async () => {
    requests++;
    return new Promise(resolve => { finish = () => resolve({ok:true,status:200,text:async()=>JSON.stringify({
      choices:[{message:{content:JSON.stringify({entries:[{keys:['City'],content:'City lore',comment:'City'}]})}}]
    })}); });
  };
  a.$('#btnDlBook').click();
  assert.equal(requests, 0);
  a.run('endTask(ACTIVE_TASK)');
  a.$('#btnDlBook').click();
  assert.equal(requests, 1);
  assert.equal(a.run('S.assets.length'), 0);
  a.$('#btnDlBook').click();
  assert.equal(requests, 1);
  finish();
  for(let i=0;i<10&&a.run('ACTIVE_TASK');i++) await nextTurn();
  assert.equal(a.run('ACTIVE_TASK'), null);
  assert.equal(a.w.downloads.length, 1);
  assert.match(a.w.downloads[0].text, /City lore/);
  checkMaterialPersistence(t, a, 'lorebook', /City lore/);
});
