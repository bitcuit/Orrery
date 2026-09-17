// Local Chrome/Edge layout checks. Uses an isolated temporary profile and no API calls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const executable=[process.env.ORRERY_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
if(!executable) throw new Error('Set ORRERY_TEST_BROWSER to a Chrome or Edge executable.');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orrery-layout-'));
const server=http.createServer((req,res)=>{
  const requested=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!requested.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(requested,(err,data)=>{
    if(err){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(requested)]||'application/octet-stream');res.end(data);
  });
});
let browser,ws,closeBrowser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Browser startup timed out')),15000);
    browser.once('error',reject);browser.once('exit',code=>reject(new Error('Browser exited '+code)));
    browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const job=pending.get(message.id);if(job){pending.delete(message.id);message.error?job.reject(new Error(JSON.stringify(message.error))):job.resolve(message.result);}
  });
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params,sessionId}));});
  closeBrowser=()=>call('Browser.close');
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>call(method,params,sessionId);
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('orrery.v1','{}');window.confirm=()=>true;"});
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/index.html`});
  for(let n=0;n<100;n++){if(await evaluate("typeof BOOTING!=='undefined'&&!BOOTING")) break;await delay(50);}
  await evaluate("document.body.classList.remove('boot');tab('talk');S.chat.role='prompt';$('#talkRole').value='prompt';updateTalkRoleUI();syncTalkSettingsLabel();S.chat.msgs=Array.from({length:24},(_,i)=>({id:'fixture'+i,role:i%2?'assistant':'user',content:'Layout fixture '+i+'\\n'+('Long text for scroll checks. '.repeat(30))}));S.assets=Array.from({length:15},(_,i)=>({id:'material'+i,kind:'text',name:'Long material name for narrow column '+i,body:'Material contents',use:true,purposes:['world'],tags:[]}));renderAssets();renderChat();window.scrollTo(0,0);");
  await evaluate('Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,3000))]).then(()=>true)');
  assert.ok(await evaluate("$('.chat-history-toggle svg').getBoundingClientRect().width>=18"),'History eye icon remains legible');
  const metrics=()=>evaluate(`(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,settings:rect('#talkSettings'),chat:rect('.talk-conversation'),input:rect('#chatIn'),send:rect('#btnSend'),log:rect('#chatLog'),tokens:rect('#ctxTok'),actions:rect('.talk-actions'),settingsOpen:$('#talkSettings').open,logScroll:$('#chatLog').scrollHeight,logClient:$('#chatLog').clientHeight};
  })()`);
  const artifacts=path.join(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
  const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(shot.data,'base64'));};
  for(const [width,height] of [[1920,1080],[1280,720],[768,1024],[390,844],[360,740]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);
    const m=await metrics();await screenshot('chat-'+width);
    assert.ok(m.documentWidth<=width+1,'No horizontal page overflow at '+width);
    assert.ok(m.documentHeight<=height+1,'No vertical page scroll at '+width);
    assert.ok(m.send.bottom<=height&&m.input.bottom<=height,'Composer is in viewport at '+width);
    assert.equal(Math.round(m.input.height),48,'Empty composer starts at one line at '+width);
    assert.ok(Math.abs(m.send.height-m.input.height)<1,'Empty input and send button heights match at '+width);
    assert.ok(Math.abs(m.send.bottom-m.input.bottom)<1,'Send button aligns with input bottom at '+width);
    assert.ok(Math.abs(m.actions.right-m.chat.right)<1,'Conversation actions align right at '+width);
    if(width>700){
      assert.ok(Math.abs(m.tokens.y+m.tokens.height/2-m.actions.y-m.actions.height/2)<1,'Tokens and conversation actions share a row at '+width);
      assert.ok(m.tokens.right<=m.actions.x,'Tokens do not overlap actions at '+width);
    }
    assert.ok(m.log.height>=100,'Chat remains readable at '+width);
    assert.equal(m.settingsOpen,width>980,'Responsive settings default at '+width);
    if(width>980) assert.ok(m.settings.right<=m.chat.x,'Settings and chat are side by side');
    else{
      await evaluate("$('#talkSettings').open=true");await delay(50);
      const expanded=await metrics();assert.ok(expanded.send.bottom<=height,'Composer remains visible with settings expanded at '+width);
      await screenshot('chat-settings-'+width);
      await evaluate("$('#talkSettings').open=false");
    }
    await evaluate("$('#chatLog').scrollTop=$('#chatLog').scrollHeight;$('#chatIn').focus()");
    await send('Input.insertText',{text:Array.from({length:14},(_,i)=>'Long draft line '+i).join('\n')});
    const grown=await metrics();
    const inputState=await evaluate("({max:parseFloat(getComputedStyle($('#chatIn')).maxHeight),resize:getComputedStyle($('#chatIn')).resize,overflow:getComputedStyle($('#chatIn')).overflowY,scroll:$('#chatIn').scrollHeight,client:$('#chatIn').clientHeight})");
    assert.equal(Math.round(grown.input.height),inputState.max,'Long draft stops growing at its cap at '+width);
    assert.equal(inputState.resize,'none');assert.equal(inputState.overflow,'auto');assert.ok(inputState.scroll>inputState.client,'Long draft can scroll internally');
    assert.ok(await evaluate("Math.abs($('#chatLog').scrollHeight-$('#chatLog').clientHeight-$('#chatLog').scrollTop)<2"),'Growing input keeps latest messages in view');
    assert.equal(Math.round(grown.send.height),48);assert.ok(Math.abs(grown.send.bottom-grown.input.bottom)<1,'Send stays at the lower right');
    assert.ok(grown.documentHeight<=height+1&&grown.log.height>=100,'Long draft keeps chat and composer in viewport at '+width);
    if(width===1920||width===390) await screenshot('chat-composer-'+width);
    await evaluate("$('#chatLog').scrollTop=100;$('#chatIn').value+='\\nAnother line';$('#chatIn').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.ok(await evaluate("Math.abs($('#chatLog').scrollTop-100)<2"),'Typing preserves reading position in older messages');
    await evaluate("$('#chatIn').value='';$('#chatIn').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(Math.round((await metrics()).input.height),48,'Cleared draft shrinks again at '+width);
    console.log(`${width}x${height}: composer visible, no page overflow, settings ${m.settingsOpen?'open':'collapsed'}`);
  }
  await evaluate("tab('studio');S.chat.inputDraft=Array(8).fill('Restored draft').join('\\n');bootUI();tab('talk')");await delay(100);
  assert.equal(Math.round((await metrics()).input.height),120,'Restored draft sizes when the hidden chat tab opens');
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await delay(100);
  assert.equal(Math.round((await metrics()).input.height),160,'Existing draft resizes for a wider viewport');
  await evaluate("$('#chatIn').value='';$('#chatIn').dispatchEvent(new Event('input',{bubbles:true}))");
  for(const height of [1080,960,920]){
    await send('Emulation.setDeviceMetricsOverride',{width:1920,height,deviceScaleFactor:1,mobile:false});
    for(const group of ['world','character','prompt']){
      await evaluate(`applyGroup('${group}');tab('studio');window.scrollTo(0,0)`);await delay(450);
      const input=await evaluate("({height:innerHeight,documentHeight:document.documentElement.scrollHeight,briefHeight:$('#optBrief').getBoundingClientRect().height,buttonBottom:$('#btnOneShot').getBoundingClientRect().bottom,resize:getComputedStyle($('#optBrief')).resize})");
      console.log(`${group} at 1920x${height}: page ${input.documentHeight}px, brief ${input.briefHeight}px, action bottom ${Math.round(input.buttonBottom)}px`);
      assert.ok(input.documentHeight<=input.height+1,'No default studio page scroll for '+group+' at '+height);
      assert.ok(input.buttonBottom<=input.height,'Create button is visible for '+group);
      assert.equal(input.resize,'vertical','Brief can still be resized');
      await screenshot('studio-'+group+'-1920x'+height);
    }
  }
  for(const width of [1920,390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
    for(const group of ['world','character','prompt']){
    await evaluate(`applyGroup('${group}');tab('studio');showStudioScreen('input');window.scrollTo(0,0);window.seedLayoutBackup=clone(S.project)`);await delay(450);
    const before=await evaluate("({x:$('#studioTitle').getBoundingClientRect().x,y:$('#studioTitle').getBoundingClientRect().y})");
    await evaluate("S.project.digest={title:'Town'};S.project.seeds=[{id:'layout',line:'Harbor village'}];renderSeeds();showStudioScreen('seed');window.scrollTo(0,0)");await delay(100);
    const after=await evaluate("(()=>{const r=id=>{const b=$('#'+id).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}};return {title:r('studioTitle'),back:r('btnBackToInput'),preset:r('studioResultPreset'),note:r('seedNote'),page:document.documentElement.scrollWidth}})()");
    assert.ok(after.page<=width+1,'Candidate screen fits at '+width);
    assert.ok(after.note.x>=0&&after.note.right<=width,'Candidate adjustment input fits at '+width);
    if(width===1920){
      assert.equal(after.title.x,before.x,'Desktop title keeps its horizontal position');
      assert.equal(after.title.y,before.y,'Desktop title keeps its vertical position');
      assert.ok(after.back.right<=after.title.x,'Back arrow is left of the title');
      assert.ok(after.preset.x>=after.title.right&&after.preset.y<after.title.bottom,'Preset is beside the title');
    }
    await screenshot('seed-adjustment-'+group+'-'+width);
    await evaluate("S.project.seeds=[{id:'k1',line:'해안 도시',keyword:true},{id:'k2',line:'축제',keyword:true},{id:'k3',line:'느슨한 규칙',keyword:true}];S.project.sel=[];renderSeeds();['k1','k2','k3'].forEach(id=>$$('.seed-keyword').find(el=>el.dataset.sid===id).click())");
    const keywords=await evaluate("({count:S.project.sel.length,disabled:$('#btnSeedNext').disabled,overflow:document.documentElement.scrollWidth,boxes:$$('.seed-keyword').map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))})");
    assert.equal(keywords.count,3);assert.equal(keywords.disabled,false);
    assert.ok(keywords.overflow<=width+1&&keywords.boxes.every(b=>b.left>=0&&b.right<=width),'Keyword chips fit '+group+' at '+width);
    await screenshot('seed-keywords-'+group+'-'+width);
    await evaluate("Object.assign(S.project,window.seedLayoutBackup);renderSeeds();showStudioScreen('input')");
    }
  }
  for(const width of [1920,390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
    await evaluate("applyGroup('world');$('#optAdv').open=true;$('#worldSettings details').open=true");await delay(100);
    const layout=await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:['worldMood','worldDensity','worldChars'].map(id=>{const r=$('#'+id).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})})");
    assert.ok(layout.scroll<=width+1,'World advanced settings have no horizontal overflow at '+width);
    for(const control of layout.controls) assert.ok(control.width>0&&control.left>=0&&control.right<=width,'World control fits at '+width);
    await screenshot('world-settings-'+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:920,deviceScaleFactor:1,mobile:false});
  await evaluate("$('#worldSettings details').open=false;$('#optAdv').open=true;window.scrollTo(0,document.documentElement.scrollHeight)");
  assert.ok(await evaluate("scrollY>0&&$('#btnOneShot').getBoundingClientRect().bottom<=innerHeight"),'Expanded settings remain scrollable');
  await evaluate("$('#optAdv').open=false;$('#optBrief').style.height='360px';window.scrollTo(0,document.documentElement.scrollHeight)");
  assert.ok(await evaluate("scrollY>0&&$('#btnOneShot').getBoundingClientRect().bottom<=innerHeight"),'Resized brief remains scrollable');
  await evaluate("$('#optBrief').style.height=''");
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate("applyGroup('prompt');tab('studio');window.scrollTo(0,0)");await delay(150);
  const studio=await evaluate("({label:$('#briefLabel').textContent,titleOffsets:$$('#modeBox .mode').map(el=>el.querySelector('.mn').getBoundingClientRect().top-el.getBoundingClientRect().top),modes:$$('#modeBox .mode').length})");
  assert.equal(studio.label,'구상');assert.equal(studio.modes,2);assert.ok(Math.max(...studio.titleOffsets)-Math.min(...studio.titleOffsets)<1,'Titles align at top');
  const materialRow=()=>evaluate("(()=>{const title=$('#studioMaterialTitle'),count=$('#nebulaCount');return {titleY:title.getBoundingClientRect().top,countY:count.getBoundingClientRect().top,countRight:count.getBoundingClientRect().right,actionLeft:$('#btnStudioMaterials').getBoundingClientRect().left,titleWeight:Number(getComputedStyle(title).fontWeight),countWeight:Number(getComputedStyle(count).fontWeight),height:$('.studio-material-group').getBoundingClientRect().height};})()");
  const assertMaterialRow=async()=>{
    const row=await materialRow();assert.ok(Math.abs(row.titleY-row.countY)<1,'Material title and count share one line');
    assert.ok(row.countRight+12<row.actionLeft,'Material count and manage button do not overlap');
    assert.ok(row.titleWeight>row.countWeight&&row.countWeight===400,'Only material title is bold');
    assert.ok(row.height<=52,'Collapsed materials fit in a compact row');
  };
  await assertMaterialRow();
  await evaluate("$('#nebulaPick summary').click()");
  assert.ok(await evaluate("$('#nebulaPick').open&&$('#nebulaList').getBoundingClientRect().height>0"),'Material row still expands');
  await evaluate("$('#nebulaPick summary').click();$('#btnStudioMaterials').click()");
  assert.ok(await evaluate("!$('#materialsManagerModal').hidden&&!$('#nebulaPick').open"),'Manage opens the modal without expanding materials');
  await evaluate("$('#materialsManagerClose').click()");
  await screenshot('studio-prompt-1920');
  for(const width of [320,360,390,768]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});await delay(80);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'No horizontal studio overflow at '+width);
    if(width>=360) await assertMaterialRow();
    for(const group of ['world','character','prompt']){
      await evaluate(`applyGroup('${group}')`);
      const choices=await evaluate("$$('#buildModeBox .build-mode').map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,height:r.height,client:el.clientWidth,scroll:el.scrollWidth};})");
      assert.ok(Math.abs(choices[0].y-choices[1].y)<1&&choices[0].right<choices[1].x,'Build choices remain side by side for '+group+' at '+width);
      assert.ok(choices.every(b=>b.scroll<=b.client+1),'Build explanations fit inside each button for '+group+' at '+width);
    }
    await evaluate("$('#buildModeBox').scrollIntoView({block:'center'})");
    await screenshot('studio-build-'+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate("S.assets[0].purposes=['world','character','prompt'];renderAssets();tab('sources');window.scrollTo(0,0)");await delay(450);
  await screenshot('material-purpose-badges');
  assert.ok(await evaluate(`(async()=>{
    const fields={name:'카드 검사',background:'한글 배경과 문장'},preset=S.presets.find(p=>p.id==='default');
    const blob=await makeCardPng(fields,preset),chunks=await pngChunks(new Uint8Array(await blob.arrayBuffer()));
    const card=JSON.parse(utf8(b64bytes(chunks.chara))),assets=fromJson(card,'roundtrip.png');
    return blob.type==='image/png'&&assets[0].name===fields.name&&assets[0].fields.description==='[배경]\\n'+fields.background;
  })()`),'Actual canvas PNG preserves Unicode card metadata on re-import');
  await evaluate(`tab('settings');S.connections=[{id:'browser-test',name:'Transfer test',provider:'openai',model:'test-model',apiKey:'test-only-key',baseUrl:'https://example.invalid/v1'}];S.activeConn='browser-test';renderConns();renderConnSel();
    window.savedDownload=dl;dl=(name,text)=>{window.connectionDownload={name,text}};$('#btnConnExport').click();dl=window.savedDownload;
    S.connections=[];S.activeConn=null;renderConns();renderConnSel();
    const transfer=new DataTransfer();transfer.items.add(new File([window.connectionDownload.text],window.connectionDownload.name,{type:'application/json'}));
    $('#connBackupFile').files=transfer.files;$('#connBackupFile').dispatchEvent(new Event('change',{bubbles:true}));`);
  for(let n=0;n<50;n++){if(await evaluate("S.connections.length===1")) break;await delay(20);}
  assert.ok(await evaluate("S.connections[0]?.apiKey==='test-only-key'&&S.activeConn==='browser-test'&&JSON.parse(localStorage.getItem('orrery.v1')).connections[0].id==='browser-test'"),'Connection backup downloads and restores through a real File input');
  for(const width of [1920,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===1920?1080:844,deviceScaleFactor:1,mobile:false});
    for(const view of ['settings','prompts','library','log']){
      await evaluate(`tab('${view}');window.scrollTo(0,0)`);await delay(450);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'No horizontal '+view+' overflow at '+width);
      if(view==='settings'){
        assert.ok(await evaluate("['btnConnExport','btnConnImport'].every(id=>{const r=$('#'+id).getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})"),'Connection transfer actions remain accessible');
        await screenshot('connections-'+width);
      }
    }
  }
  await send('Page.navigate',{url:'file:///'+path.join(root,'index.html').replace(/\\/g,'/')});
  for(let n=0;n<100;n++){if(await evaluate("typeof BOOTING!=='undefined'&&!BOOTING")) break;await delay(50);}
  assert.ok(await evaluate("location.protocol==='file:'&&typeof BOOTING!=='undefined'&&!BOOTING&&S.presets.length>0&&!!$('#btnConnExport')"),'Direct file entry boots without a server');
  assert.deepEqual(errors,[]);console.log('Desktop/mobile layout, connection backup, PNG round trip and direct-file boot passed.');
  await call('Browser.close');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(ws?.readyState===WebSocket.OPEN&&closeBrowser) await Promise.race([closeBrowser().catch(()=>{}),delay(1000)]);
  if(ws) ws.close();if(browser&&!browser.killed) browser.kill();server.close();
  await delay(200);
  // Only remove the fresh test profile created above, outside the user's browser profile.
  const resolved=path.resolve(profile),temp=path.resolve(os.tmpdir());
  if(path.dirname(resolved)===temp&&path.basename(resolved).startsWith('orrery-layout-')){
    try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{console.warn('Temporary test profile remains at '+resolved);}
  }
});
