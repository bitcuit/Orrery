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
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orrery-jobs-'));
const requests=[];
const server=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.url==='/v1/chat/completions'){let body='';req.on('data',c=>body+=c);req.on('end',()=>requests.push({res,body:JSON.parse(body)}));return;}
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

  const origin=`http://127.0.0.1:${server.address().port}`;
  const waitFor=async (predicate,label)=>{for(let n=0;n<160;n++){if(await predicate())return;await delay(50);}throw new Error('Timed out: '+label);};
  const release=(index,content)=>requests[index].res.end(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}));
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.confirm=()=>true;"});
  await send('Page.navigate',{url:origin+'/index.html'});
  await waitFor(()=>evaluate("typeof BOOTING!=='undefined'&&!BOOTING"),'initial boot');
  const setup=`S.connections=[{id:'test',name:'Test',provider:'openai',model:'test',apiKey:'test-only',baseUrl:'${origin}/v1'}];S.activeConn='test';S.opts.buildMode='staged';S.opts.check=false;applyGroup('world');tab('studio');`;
  await evaluate(setup+"S.opts.briefBy.world='Task A';S.project.digest={title:'Task A'};S.project.seedNote='Keep A';renderSeeds();showStudioScreen('seed');$('#btnSeeds').click()");
  await waitFor(()=>requests.length===1,'A starts in background');
  const aId=await evaluate('S.activeWorkspaceId');
  assert.equal(await evaluate('ACTIVE_TASK===null&&!!currentWorkspaceJob()'),true);
  await evaluate("createWorkspace();S.opts.briefBy.world='Task B';S.project.digest={title:'Task B'};renderSeeds();showStudioScreen('seed');$('#btnSeeds').click()");
  await waitFor(()=>requests.length===2,'B starts while A is pending');
  const bId=await evaluate('S.activeWorkspaceId');assert.notEqual(aId,bId);
  await evaluate("tab('talk');$('#chatIn').value='Chat during generation';$('#btnSend').click()");
  await waitFor(()=>requests.length===3,'chat starts during two generations');
  release(1,[{id:'b',line:'Candidate B'}]);
  await waitFor(()=>evaluate('workspaceById(S.activeWorkspaceId).pendingApply===true'),'studio result waits for foreground chat safely');
  release(2,'Chat reply');await waitFor(()=>evaluate('!workIsBusy()'),'chat completes');
  release(0,[{id:'a',line:'Candidate A'}]);
  await waitFor(()=>evaluate('WORKSPACE_JOBS.size===0'),'both workers complete');
  assert.equal(await evaluate('S.project.seeds[0].line'),'Candidate B');
  assert.equal(await evaluate('S.chat.msgs.at(-1).content'),'Chat reply');
  assert.equal(await evaluate('S.activeWorkspaceId'),bId);
  await evaluate(`openWorkspace('${aId}')`);
  assert.equal(await evaluate('S.project.seeds[0].line'),'Candidate A');
  assert.equal(await evaluate("$('#seedNote').value"),'Keep A');

  const target2=await call('Target.createTarget',{url:'about:blank'});
  const session2=await call('Target.attachToTarget',{targetId:target2.targetId,flatten:true});
  const send2=(method,params)=>call(method,params,session2.sessionId);
  const eval2=async expression=>{const r=await send2('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await send2('Runtime.enable');await send2('Page.enable');
  await send2('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});
  await send2('Page.navigate',{url:origin+'/index.html'});
  await waitFor(()=>eval2("typeof BOOTING!=='undefined'&&!BOOTING&&S.activeWorkspaceId!=="+JSON.stringify(aId)),'second tab copies locked A');
  await eval2("S.opts.briefBy.world='Task C in another tab';checkpointWorkspace('Task C')");
  const cId=await eval2('S.activeWorkspaceId');
  await waitFor(()=>evaluate(`!!workspaceById('${cId}')`),'first tab sees independently saved C');
  assert.equal(await evaluate(`workspaceById('${aId}').snapshot.project.seeds[0].line`),'Candidate A');
  assert.equal(await eval2(`workspaceById('${bId}').snapshot.project.seeds[0].line`),'Candidate B');
  const copied=await eval2(`openWorkspace('${bId}').then(()=>S.activeWorkspaceId)`);assert.notEqual(copied,bId);
  await eval2("S.opts.briefBy.world='Changed copy';checkpointWorkspace('Copy of B')");
  assert.equal(await evaluate(`workspaceById('${bId}').snapshot.opts.briefBy.world`),'Task B');
  await Promise.all([
    evaluate("S.project.card={fields:{title:'Record from tab one'}};S.project.libId=null;saveRecord()"),
    eval2("S.project.card={fields:{title:'Record from tab two'}};S.project.libId=null;saveRecord()")
  ]);
  await waitFor(async()=>await evaluate('S.library.length')===2&&await eval2('S.library.length')===2,'both windows accumulate both records');

  await evaluate("tab('studio');showStudioScreen('seed');$('#btnSeeds').click()");
  await waitFor(()=>requests.length===4,'new request before reload');
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Page.javascriptDialogOpening')call('Page.handleJavaScriptDialog',{accept:true},m.sessionId);});
  await send('Page.reload');
  await waitFor(()=>evaluate("typeof BOOTING!=='undefined'&&!BOOTING&&workspaceById(S.activeWorkspaceId)?.status==='interrupted'"),'reload reports interrupted');
  assert.equal(requests.length,4,'Reload does not repeat the API request');
  assert.equal(await evaluate('S.project.seeds[0].line'),'Candidate A');

  await send('Page.navigate',{url:'file:///'+path.join(root,'index.html').replace(/\\/g,'/')});
  await waitFor(()=>evaluate("typeof BOOTING!=='undefined'&&!BOOTING&&location.protocol==='file:'"),'file boot');
  await evaluate(setup+"S.opts.briefBy.world='File task';S.project.digest={title:'File task'};renderSeeds();showStudioScreen('seed');$('#btnSeeds').click()");
  await waitFor(()=>requests.length===5,'file iframe request');
  release(4,[{id:'file',line:'File candidate'}]);
  await waitFor(()=>evaluate('WORKSPACE_JOBS.size===0'),'file worker complete');
  assert.equal(await evaluate('S.project.seeds[0].line'),'File candidate');
  assert.deepEqual(errors,[]);
  console.log('Concurrent work, chat, two tabs, ownership copies, reload recovery and direct-file workers passed.');
  await call('Browser.close');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(ws?.readyState===WebSocket.OPEN&&closeBrowser) await Promise.race([closeBrowser().catch(()=>{}),delay(1000)]);
  if(ws) ws.close();if(browser&&!browser.killed) browser.kill();server.closeAllConnections();server.close();
  await delay(200);
  // Only remove the fresh test profile created above, outside the user's browser profile.
  const resolved=path.resolve(profile),temp=path.resolve(os.tmpdir());
  if(path.dirname(resolved)===temp&&path.basename(resolved).startsWith('orrery-jobs-')){
    try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{console.warn('Temporary test profile remains at '+resolved);}
  }
});
