const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
function boot(t,storage={}){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://orrery.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
  w.localStorage.setItem('orrery.v1','{}');for(const [key,value]of Object.entries(storage))w.localStorage.setItem(key,value);
  w.fetch=async()=>{throw new Error('Unexpected network request');};
  const context=dom.getInternalVMContext(),run=code=>vm.runInContext(code,context);
  for(const script of w.document.querySelectorAll('script[src]')){const name=script.getAttribute('src').split('?')[0];vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});}
  run('RETRY_DELAYS=[]');t.after(()=>{w.close();assert.deepEqual(errors,[]);});
  return{w,run,$:s=>w.document.querySelector(s)};
}
const plain=x=>JSON.parse(JSON.stringify(x));
function connection(a){a.run("S.connections=[{id:'fake',name:'Test',provider:'openai',apiKey:'fake',model:'fake'}];S.activeConn='fake'");}
function queue(a,replies){const requests=[];a.w.fetch=async(_url,opts)=>{requests.push(JSON.parse(opts.body));assert.ok(replies.length,'Unexpected request');const item=replies.shift();if(item instanceof Error)throw item;return{ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:typeof item==='string'?item:JSON.stringify(item)}}]})};};return requests;}
function fixture(a){connection(a);a.run("applyGroup('character');S.project.card={fields:{name:'Keeper',appearance:'Blue coat',user_relation:'自由',secret:'PRIVATE-SETTING'},publicIntro:'PUBLIC-INTRO'};renderCard();previewState(S.project.card).opening='OPENING';renderCreationFlow();tab('studio');showStudioScreen('result')");}
const judge={verdict:'continue',oneLine:'A clear beginning',likes:[{quote:'OPENING',why:'Room to respond'}],dislikes:[{quote:'Fabricated quote',why:'Unverified'}],persona:{name:'Visitor',intro:'An adult traveler'},reply:'Hello'};

test('recommended forms preserve legacy forms, keep optional extras off, and show the length target',t=>{
  const a=boot(t);assert.equal(a.run('S.activePreset'),'world-chat');
  assert.equal(a.run("activeSchema().filter(f=>f.key!=='title').length"),4);
  assert.match(a.$('#creationSummary').textContent,/1,500/);
  a.run("applyGroup('character')");assert.equal(a.run('S.activePreset'),'character-chat');
  assert.deepEqual(plain(a.run("fieldOffFor()")),['ability','secret']);
  assert.match(a.$('#creationSummary').textContent,/2,500/);
  assert.ok(a.run("S.presets.some(p=>p.id==='default')&&S.presets.some(p=>p.id==='char-engine')"));
  a.$('#creationLength').value='short';a.$('#creationLength').dispatchEvent(new a.w.Event('change'));
  a.run("applyGroup('world')");assert.equal(a.$('#creationLength').value,'standard');
  a.run("applyGroup('character')");assert.equal(a.$('#creationLength').value,'short');
});
test('creation constraints reach both generation methods; relationship proposals stay out of exported settings',async t=>{
  const a=boot(t);connection(a);a.run("applyGroup('character');S.opts.briefBy.character='A lighthouse keeper';S.project.digest={title:'Harbor'}");
  const result={name:'Keeper',basics:'Adult keeper',user_relation:'自由',ability:'Unrequested power',secret:'Unrequested secret',public_intro:'PUBLIC-INTRO',relation_suggestions:['Visitor','Colleague','Neighbor']};
  const requests=queue(a,[result,result]);
  a.run('S.project.card=null');
  const one=await a.run('doOneShot()');const staged=await a.run("doExpand({line:'Keeper'})");
  for(const card of [one,staged]){
    assert.equal(card.publicIntro,'PUBLIC-INTRO');assert.equal(card.relationSuggestions.length,3);
    assert.equal(card.fields.public_intro,undefined);assert.equal(card.fields.relation_suggestions,undefined);
    assert.equal(card.fields.ability,undefined);assert.equal(card.fields.secret,undefined);
  }
  for(const r of requests){const text=r.messages.map(m=>m.content).join('\n');assert.match(text,/2500자/);assert.match(text,/관계는 자유/);assert.match(text,/본문에 확정 사실로 넣지 않는다/);}
  a.run('S.project.card='+JSON.stringify(one)+';renderCard();saveRecord()');
  assert.doesNotMatch(a.run('fieldsToText(S.project.card.fields)'),/PUBLIC-INTRO|Colleague/);
  a.$('[data-relation="1"]').click();assert.equal(a.run('S.project.card.fields.user_relation'),'Colleague');
  a.$('#btnFreeRelationship').click();assert.equal(a.run('S.project.card.relationChoice'),undefined);
  assert.match(a.run('S.project.card.fields.user_relation'),/자유/);
  a.run('S.project.cast=[S.project.card]');a.$('#btnCastSave').click();
  assert.equal(a.run('S.library.at(-1).creation.publicIntro'),'PUBLIC-INTRO');
  assert.equal(a.run('S.library.at(-1).creation.relationSuggestions.length'),3);
});
test('first-message handoff preserves the original record and carries private settings only to the bot context',async t=>{
  const a=boot(t);fixture(a);a.run('saveRecord()');const original=a.run('S.project.libId');
  await a.run('prepareGreeting()');
  assert.equal(a.run('S.activePreset'),'greeting');assert.equal(a.run('activePreset().name'),'첫 메시지');
  assert.equal(a.run('S.project.openingSource.recordId'),original);
  assert.match(a.run('sourceText()'),/PRIVATE-SETTING/);
  assert.equal(a.run('S.library.find(r=>r.id===S.project.openingSource.recordId).fields.name'),'Keeper');
  queue(a,[{title:'Return',first_mes:'OPENING',opened:'A reply'}]);
  a.run('S.project.card=null');const generated=await a.run('doOneShot()');
  assert.equal(generated.origin.publicIntro,'PUBLIC-INTRO');
  a.run('S.project.card='+JSON.stringify(generated)+';renderCard();saveRecord()');
  assert.equal(a.$('#previewPublic').value,'PUBLIC-INTRO');assert.equal(a.$('#previewOpening').value,'OPENING');
  a.run('save();saveDraftNow()');const saved=Object.fromEntries(Object.keys(a.w.localStorage).map(k=>[k,a.w.localStorage.getItem(k)]));
  const b=boot(t,saved);assert.equal(b.run('S.project.card.origin.recordId'),original);
  b.run('loadRecordToStudio(S.library.find(r=>r.presetId===\'greeting\'))');assert.equal(b.$('#previewPublic').value,'PUBLIC-INTRO');
});
test('three first impressions use three isolated requests and keep citations, history, drafts, and backup data',async t=>{
  const a=boot(t);fixture(a);const requests=queue(a,[judge,judge,judge]);
  await a.run('doAudiencePreview()');assert.equal(requests.length,3);
  for(const r of requests){const text=r.messages.map(m=>m.content).join('\n');assert.match(text,/PUBLIC-INTRO|OPENING/);assert.doesNotMatch(text,/PRIVATE-SETTING/);}
  const run=a.run('S.project.card.preview.runs[0]');assert.equal(run.status,'complete');assert.equal(run.results.length,3);
  assert.equal(run.results[0].judge.likes[0].found,true);assert.equal(run.results[0].judge.dislikes[0].found,false);
  assert.match(a.$('#previewResults').textContent,/원문에서 못 찾음/);
  assert.doesNotMatch(a.$('#previewResults').textContent,/여러 유저가 짚은 부분/);
  a.run("S.project.card.fields.personality='Changed';renderCreationFlow()");assert.match(a.$('#previewResults').textContent,/이전 내용/);
  a.run('save();saveDraftNow()');const saved=Object.fromEntries(Object.keys(a.w.localStorage).map(k=>[k,a.w.localStorage.getItem(k)]));
  const b=boot(t,saved);assert.equal(b.run('S.project.card.preview.runs[0].results.length'),3);
  assert.equal(b.run('S.library.find(r=>r.id===S.project.libId).creation.preview.runs.length'),1);
  const snapshot=b.run('captureWorkspace()');assert.equal(snapshot.project.card.preview.runs.length,1);
});
test('a full playtest uses seven requests and only the acting bot receives private settings',async t=>{
  const a=boot(t);fixture(a);a.run("previewState(S.project.card).personas=['freedom'];previewState(S.project.card).mode='play'");
  const requests=queue(a,[judge,'BOT-1',{reply:'USER-2'},'BOT-2',{reply:'USER-3'},'BOT-3',{fun:'yes',oneLine:'Enjoyed it',notes:[{quote:'BOT-2',why:'Distinct voice'}]}]);
  await a.run('doAudiencePreview()');assert.equal(requests.length,7);
  for(let i=0;i<requests.length;i++){
    const text=requests[i].messages.map(m=>m.content).join('\n');
    if([1,3,5].includes(i))assert.match(text,/PRIVATE-SETTING/);else assert.doesNotMatch(text,/PRIVATE-SETTING/);
  }
  const result=a.run('S.project.card.preview.runs[0].results[0]');assert.equal(result.log.length,7);assert.equal(result.final.notes[0].found,true);
});
test('malformed evaluations count as errors and stopping preserves completed readers without auto retry',async t=>{
  const a=boot(t);fixture(a);queue(a,[{verdict:'invalid'},judge,judge]);await a.run('doAudiencePreview()');
  assert.equal(a.run('S.project.card.preview.runs[0].results.filter(r=>r.error).length'),1);
  assert.equal(a.run('S.project.card.preview.runs[0].results.filter(r=>r.judge).length'),2);
  let calls=0;a.w.fetch=async(_url,opts)=>{calls++;if(calls===1)return{ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(judge)}}]})};return new Promise((yes,no)=>opts.signal.addEventListener('abort',()=>no(new Error('AbortError'))));};
  const pending=a.run('doAudiencePreview()');for(let n=0;n<20&&calls<2;n++)await new Promise(r=>setImmediate(r));
  a.run('abortCurrentCall()');await pending;
  assert.equal(a.run('S.project.card.preview.runs[0].status'),'stopped');
  assert.equal(a.run('S.project.card.preview.runs[0].results.filter(r=>r.judge).length'),1);
  assert.equal(a.run('ACTIVE_TASK'),null);
});
