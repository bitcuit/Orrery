const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
function boot(t){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{
    url:'http://orrery.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
  w.fetch=async()=>{throw new Error('No network calls expected');};w.localStorage.setItem('orrery.v1','{}');
  const context=dom.getInternalVMContext(),run=code=>vm.runInContext(code,context);
  for(const script of w.document.querySelectorAll('script[src]')) run(fs.readFileSync(path.join(root,script.getAttribute('src')),'utf8'));
  t.after(()=>{w.close();assert.deepEqual(errors,[]);});
  return {w,run,$:selector=>w.document.querySelector(selector)};
}
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function chooseJson(a,id,value){
  Object.defineProperty(a.$('#'+id),'files',{configurable:true,value:[{text:async()=>JSON.stringify(value)}]});
  a.$('#'+id).dispatchEvent(new a.w.Event('change',{bubbles:true}));await tick();
}
const connection=(id,extra={})=>({id,name:'Connection '+id,provider:'openai',model:'test-model',apiKey:'test-only-key-'+id,baseUrl:'https://example.invalid/v1',...extra});
const transfer=connections=>({app:'Orrery',type:'connections',backupVersion:1,includes:{apiKeys:true},connections,activeConn:connections[0]?.id});

test('connection-only JSON includes keys and settings and restores on a new device through the file input',async t=>{
  const a=boot(t);
  const c=connection('portable',{temperature:0,topP:0.8,maxTokens:4096,contextLimit:64000,_ok:true,_models:['cached'],_lastTest:{ok:true}});
  a.run(`S.connections=[${JSON.stringify(c)}];S.activeConn='portable';renderConns();window.downloads=[];dl=(name,text)=>window.downloads.push({name,text});`);
  a.$('#btnConnExport').click();
  assert.equal(a.w.downloads.length,1);assert.match(a.w.downloads[0].name,/^orrery-connections-.*\.json$/);
  const data=JSON.parse(a.w.downloads[0].text);
  assert.equal(data.connections[0].apiKey,c.apiKey);assert.equal(data.connections[0].temperature,0);
  for(const key of ['assets','presets','project','chat','library']) assert.equal(data[key],undefined);
  for(const key of ['_ok','_models','_lastTest']) assert.equal(data.connections[0][key],undefined);
  const b=boot(t);await chooseJson(b,'connBackupFile',data);
  assert.equal(b.run('S.activeConn'),'portable');
  assert.deepEqual(plain(b.run('S.connections')),data.connections);
  assert.equal(JSON.parse(b.w.localStorage.getItem('orrery.v1')).connections[0].apiKey,c.apiKey);
  assert.equal(b.$('.c-key').value,c.apiKey);
});

test('connection import updates by id, preserves other work and keys omitted from older backups',t=>{
  const a=boot(t),old=connection('same'),untouched=connection('keep');
  a.run(`S.connections=${JSON.stringify([old,untouched])};S.activeConn='keep';applyGroup('character');S.project.card={fields:{name:'Existing'}};S.opts.briefBy.character='Current brief';S.chat.msgs=[{role:'user',content:'Stay'}];`);
  const before=plain(a.run('({project:S.project,opts:S.opts,chat:S.chat,presets:S.presets,assets:S.assets,activePreset:S.activePreset})'));
  const incoming=transfer([connection('same',{apiKey:'new-test-key',model:'new-model'}),connection('added')]);
  assert.equal(a.run(`importConnectionBackup(${JSON.stringify(incoming)})`),true);
  assert.equal(a.run('S.connections.length'),3);assert.equal(a.run('S.activeConn'),'keep');
  assert.equal(a.run("connById('same').apiKey"),'new-test-key');
  assert.deepEqual(plain(a.run("connById('keep')")),untouched);
  assert.deepEqual(plain(a.run('({project:S.project,opts:S.opts,chat:S.chat,presets:S.presets,assets:S.assets,activePreset:S.activePreset})')),before);
  const noKey=connection('same',{model:'other-model'});delete noKey.apiKey;
  a.run(`importConnectionBackup(${JSON.stringify(transfer([noKey]))})`);
  assert.equal(a.run("connById('same').apiKey"),'new-test-key');
});

test('invalid, duplicate, cancelled and busy connection imports leave stored state unchanged',t=>{
  const a=boot(t);a.run(`S.connections=[${JSON.stringify(connection('same'))}];S.activeConn='same';save()`);
  const before=plain(a.run('S')),saved=a.w.localStorage.getItem('orrery.v1');
  for(const invalid of [transfer([connection('first'),connection('bad',{apiKey:42})]),transfer([connection('same'),connection('same')]),transfer([connection('bad',{provider:'unknown'})]),transfer([connection('bad"id')]),{connections:[]}]){
    assert.throws(()=>a.run(`importConnectionBackup(${JSON.stringify(invalid)})`));
    assert.deepEqual(plain(a.run('S')),before);assert.equal(a.w.localStorage.getItem('orrery.v1'),saved);
  }
  a.w.confirm=()=>false;
  assert.equal(a.run(`importConnectionBackup(${JSON.stringify(transfer([connection('same',{apiKey:'replacement'})]))})`),false);
  a.run('window.testTask=beginTask()');
  assert.equal(a.run(`importConnectionBackup(${JSON.stringify(transfer([connection('other')]))})`),false);
  a.run('endTask(window.testTask)');assert.deepEqual(plain(a.run('S')),before);
});

test('work-excluded full backup cannot relabel or overwrite an existing workbench',async t=>{
  const a=boot(t);const backup=plain(a.run('makeBackup({project:false,assets:false,chat:false})'));
  a.run("applyGroup('character');S.opts.briefBy.character='Character request';S.project.card={fields:{name:'Keep character'}};$('#continueNote').value='Keep note';renderCard();");
  const preset=plain(a.run('activePreset()'));backup.presets.find(p=>p.id===preset.id).schema=[{key:'wrong',label:'Wrong'}];
  const before=plain(a.run('({group:S.opts.group,opts:S.opts,activePreset:S.activePreset,project:S.project})'));
  await chooseJson(a,'dataFile',backup);
  assert.deepEqual(plain(a.run('({group:S.opts.group,opts:S.opts,activePreset:S.activePreset,project:S.project})')),before);
  assert.deepEqual(plain(a.run('activePreset()')),preset);assert.equal(a.$('#continueNote').value,'Keep note');
});

test('full backup transfers continuation/reroll instructions and older backups clear stale instructions',async t=>{
  const a=boot(t);a.run("S.project.card={fields:{name:'Example'}};$('#continueNote').value='Continue here';$('#rerollNote').value='Revise this';");
  const data=plain(a.run('makeBackup()'));
  const b=boot(t);await chooseJson(b,'dataFile',data);
  assert.equal(b.$('#continueNote').value,'Continue here');assert.equal(b.$('#rerollNote').value,'Revise this');
  delete data.continueNote;delete data.rerollNote;await chooseJson(b,'dataFile',data);
  assert.equal(b.$('#continueNote').value,'');assert.equal(b.$('#rerollNote').value,'');
});

test('settings-only backups still restore options on an empty device',async t=>{
  const source=boot(t);source.run("applyGroup('prompt');S.opts.lang='English';");
  const backup=plain(source.run('makeBackup({project:false,assets:false,chat:false})'));
  const target=boot(t);await chooseJson(target,'dataFile',backup);
  assert.equal(target.run('S.opts.group'),'prompt');assert.equal(target.run('S.opts.lang'),'English');
  assert.equal(target.run('S.activePreset'),backup.activePreset);
});

test('connection-only backup selected through full restore still preserves work',async t=>{
  const a=boot(t);a.run("S.project.card={fields:{name:'Keep'}};S.opts.briefBy.world='Keep request';");
  const before=plain(a.run('({project:S.project,opts:S.opts,activePreset:S.activePreset})'));
  await chooseJson(a,'dataFile',transfer([connection('new-device')]));
  assert.equal(a.run('S.connections.length'),1);
  assert.deepEqual(plain(a.run('({project:S.project,opts:S.opts,activePreset:S.activePreset})')),before);
});

test('malformed full backups cannot partially replace connections or work',async t=>{
  const a=boot(t);a.run(`S.connections=[${JSON.stringify(connection('original'))}];S.activeConn='original';save();`);
  const before=plain(a.run('S'));
  for(const bad of [{connections:[connection('replacement')],assets:[null]},
    {connections:[connection('replacement')],project:{card:{fields:{title:'Wrong'}}},presets:[{id:'broken',schema:null}],activePreset:'broken'}]){
    await chooseJson(a,'dataFile',bad);
    assert.deepEqual(plain(a.run('S')),before);
    assert.equal(JSON.parse(a.w.localStorage.getItem('orrery.v1')).connections[0].id,'original');
    assert.match(a.$('#toast').textContent,/가져오기 실패/);
  }
});
