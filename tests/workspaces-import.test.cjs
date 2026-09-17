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
test('named work restores inputs, selected materials, candidates, chat and unfinished stage',async t=>{
  const a=boot(t);
  a.run("S.assets=[{id:'m',kind:'text',name:'Material',body:'Original',use:true}];S.opts.briefBy.world='First work';S.project.digest={title:'Digest'};S.project.seeds=[{id:'a',line:'Seed'}];S.project.sel=['a'];S.project.seedNote='Keep note';S.project.screen='seed';S.chat.msgs=[{role:'user',content:'First chat'}];checkpointWorkspace('First')");
  const id=a.run('S.activeWorkspaceId');
  a.$('#btnNewWork').click();assert.notEqual(a.run('S.activeWorkspaceId'),id);
  a.run("S.opts.briefBy.world='Second work';S.assets[0].body='Changed';S.assets[0].use=false;checkpointWorkspace('Second')");
  await a.run(`openWorkspace('${id}')`);
  assert.equal(a.run('curBrief()'),'First work');assert.equal(a.run('S.project.screen'),'seed');
  assert.equal(a.run('S.project.sel[0]'),'a');assert.equal(a.$('#seedNote').value,'Keep note');
  assert.equal(a.run('S.assets[0].body'),'Original');assert.equal(a.run('S.assets[0].use'),true);
  assert.equal(a.run('S.chat.msgs[0].content'),'First chat');assert.equal(a.run('S.workspaces.length'),2);
});
test('backup selection excludes nested chat and materials while retaining work progress',t=>{
  const a=boot(t);a.run("S.opts.briefBy.world='Work';S.chat.msgs=[{role:'user',content:'Private chat'}];S.assets=[{id:'m',kind:'text',body:'Private material',use:true}];checkpointWorkspace('Work')");
  const data=a.run('makeBackup({assets:false,chat:false,presets:false,settings:false,connections:false,library:false,project:true})');
  for(const key of ['assets','chat','presets','opts','connections','library','commonPrompts'])assert.equal(data[key],undefined);
  assert.equal(data.workspaces.length,1);assert.equal(data.workOpts.briefBy.world,'Work');
  assert.equal(data.workspaces[0].snapshot.materials,undefined);assert.equal(data.workspaces[0].snapshot.chat,undefined);
  assert.equal(data.workspaces[0].snapshot.presets,undefined);
});
test('three or more candidates can be mixed without dropping earlier selections',async t=>{
  const a=boot(t);a.run("S.project.digest={title:'World'};S.project.seeds=['A','B','C','D'].map((line,i)=>({id:'s'+i,line}));renderSeeds();window.sent=[];runStage=async(stage,vars)=>{window.sent.push(vars);return {line:'Combined'}}");
  for(let i=0;i<4;i++)a.$(`[data-sid="s${i}"]`).click();
  assert.equal(a.run('S.project.sel.length'),4);assert.equal(a.$('#btnCross').disabled,false);
  a.$('#btnCross').click();await new Promise(resolve=>setImmediate(resolve));
  for(const value of ['A','B','C','D'])assert.ok(a.w.sent[0].seed.includes(value));
  assert.equal(a.run('S.project.seeds.length'),5);assert.equal(a.run('S.project.sel.length'),1);
});
test('Marinara cards retain identity fields and embedded lore',t=>{
  const a=boot(t),data={type:'marinara_character',version:1,data:{spec:'chara_card_v2',data:{name:'Harbor keeper',description:'Keeps boats',post_history_instructions:'Voice note',extensions:{backstory:'Former sailor',appearance:'Blue coat'},character_book:{entries:[{keys:['port'],content:'The port is quiet'}]}}}};
  const got=a.run(`fromJson(${JSON.stringify(data)},'native')`);
  assert.equal(got[0].kind,'character');assert.equal(got[0].fields.backstory,'Former sailor');
  assert.equal(got[0].fields.appearance,'Blue coat');assert.equal(got[0].fields.post_history_instructions,'Voice note');
  assert.equal(got[1].kind,'lorebook');assert.equal(got[1].entries[0].content,'The port is quiet');
});
test('ST, Marinara and Risu JSON prompts become materials without changing active instructions',t=>{
  const a=boot(t),before=a.run('JSON.stringify(S.presets)');
  const cases=[
    {prompts:[{identifier:'a',name:'One',content:'First {{char}}'},{identifier:'b',name:'Two',content:'Second'}],prompt_order:[{order:[{identifier:'b',enabled:true},{identifier:'a',enabled:false}]}]},
    {type:'marinara_preset',data:{preset:{name:'Mari',sectionOrder:['b','a']},sections:[{id:'a',content:'First'},{id:'b',content:'Second'}]}},
    {name:'Risu',promptTemplate:[{type:'plain',role:'system',text:'First {{char}}'},{type:'plain',role:'user',text:'Second'}]}
  ];
  for(const input of cases){
    const got=a.run(`fromJson(${JSON.stringify(input)},'preset')`);
    assert.equal(got[0].kind,'text');assert.equal(got[0].purposes[0],'prompt');assert.match(got[0].body,/First/);assert.match(got[0].body,/Second/);
  }
  assert.equal(a.run('JSON.stringify(S.presets)'),before);
  assert.throws(()=>a.run("fromJson({type:'marinara_profile',data:{}},'profile')"),/앱 전체 설정/);
});
test('unreadable JSON and binary exports fail instead of becoming corrupted text materials',async t=>{
  const a=boot(t);a.w.TextDecoder=TextDecoder;
  for(const [name,bytes] of [['broken.json',Buffer.from('{bad')],['preset.risup',Buffer.from([0,2,255])]]){
    a.w.fixture={name,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
    await assert.rejects(a.run('sniff(window.fixture)'));
  }
  assert.equal(a.run('S.assets.length'),0);
});
test('records remain stored beyond the old automatic deletion threshold',t=>{
  const a=boot(t);a.run("S.library=Array.from({length:205},(_,i)=>({id:'r'+i,fields:{name:'record '+i},at:i}));pruneLib();save()");
  assert.equal(a.run('S.library.length'),205);
});
