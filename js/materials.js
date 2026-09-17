"use strict";
/* Orrery · 재료 읽기 · 관리 */
/* ==================================================================
   3. 재료 읽기 — PNG · CHARX · JSON · 텍스트
   ================================================================== */
function b64bytes(s){
  const bin = atob(String(s).replace(/[\s\n\r]/g,''));
  const u = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return u;
}
const utf8 = b => new TextDecoder('utf-8').decode(b);

async function inflate(bytes, raw){
  if(typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다.');
  const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
  const st = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(st).arrayBuffer());
}

/* --- PNG tEXt/zTXt/iTXt 읽기 --- */
async function pngChunks(buf){
  const out = {};
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  while(p + 8 <= buf.length){
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p+4],buf[p+5],buf[p+6],buf[p+7]);
    const ds = p+8, de = ds+len;
    if(de > buf.length) break;
    if(type==='tEXt' || type==='zTXt' || type==='iTXt'){
      let i = ds; while(i<de && buf[i]!==0) i++;
      const kw = utf8(buf.slice(ds,i));
      try{
        if(type==='tEXt')      out[kw] = utf8(buf.slice(i+1,de));
        else if(type==='zTXt') out[kw] = utf8(await inflate(buf.slice(i+2,de)));
        else {
          let q = i+1; q += 2;                       // compression flag + method
          while(q<de && buf[q]!==0) q++; q++;        // language tag
          while(q<de && buf[q]!==0) q++; q++;        // translated keyword
          out[kw] = buf[i+1]===1 ? utf8(await inflate(buf.slice(q,de))) : utf8(buf.slice(q,de));
        }
      }catch(e){ log('PNG 청크 '+kw+' 해석 실패: '+e.message,'err'); }
    }
    if(type==='IEND') break;
    p = de + 4;
  }
  return out;
}

/* --- ZIP(CHARX) 최소 읽기 --- */
async function zipEntries(buf,filter=()=>true){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eo = -1;
  for(let i=buf.length-22;i>=0 && i>buf.length-70000;i--){
    if(dv.getUint32(i,true)===0x06054b50){ eo=i; break; }
  }
  if(eo<0) throw new Error('ZIP 구조를 찾지 못했습니다.');
  const n = dv.getUint16(eo+10,true);
  const declared=dv.getUint32(eo+16,true),centralSize=dv.getUint32(eo+12,true);
  let p=declared;
  if(p+4>buf.length||dv.getUint32(p,true)!==0x02014b50)p=eo-centralSize;
  const offset=p-declared;
  const list = [];
  for(let k=0;k<n;k++){
    if(p<0||p+46>buf.length||dv.getUint32(p,true)!==0x02014b50) throw new Error('ZIP 목록이 손상되었습니다.');
    const method = dv.getUint16(p+10,true);
    const csize  = dv.getUint32(p+20,true);
    const nlen   = dv.getUint16(p+28,true);
    const elen   = dv.getUint16(p+30,true);
    const clen   = dv.getUint16(p+32,true);
    const lho    = dv.getUint32(p+42,true)+offset;
    const name   = utf8(buf.slice(p+46,p+46+nlen));
    if(filter(name)){
      if(dv.getUint16(p+8,true)&1)throw new Error('암호화된 ZIP 파일은 지원하지 않습니다.');
      if(![0,8].includes(method))throw new Error('지원하지 않는 ZIP 압축 방식입니다.');
      if(dv.getUint32(p+24,true)>50*1024*1024)throw new Error('재료 파일 하나의 압축 해제 크기가 너무 큽니다.');
      list.push({name, method, csize, lho});
    }
    p += 46+nlen+elen+clen;
  }
  for(const e of list){
    if(e.lho<0||e.lho+30>buf.length||dv.getUint32(e.lho,true)!==0x04034b50)throw new Error('ZIP 항목이 손상되었습니다.');
    const ln = dv.getUint16(e.lho+26,true), le = dv.getUint16(e.lho+28,true);
    const start = e.lho+30+ln+le;
    const raw = buf.slice(start, start+e.csize);
    if(start+e.csize>buf.length)throw new Error('ZIP 데이터가 잘렸습니다.');
    e.data = e.method===0 ? raw : await inflate(raw, true);
  }
  return list;
}

/* --- 로어북 엔트리 정규화 --- */
function normEntries(src){
  let arr = [];
  if(Array.isArray(src)) arr = src;
  else if(src && typeof src==='object') arr = Object.values(src);
  return arr.map((e,i)=>{
    if(!e || typeof e!=='object') return null;
    const keys = e.keys || e.key || e.keywords || [];
    const content = e.content || e.entry || e.text || '';
    if(!content) return null;
    return {
      id: 'e'+i+uid(),
      keys: Array.isArray(keys) ? keys : String(keys).split(',').map(s=>s.trim()).filter(Boolean),
      content: String(content),
      comment: e.comment || e.name || e.title || '',
      constant: !!(e.constant || e.alwaysActive),
      enabled: e.enabled !== false && e.disable !== true,
      order: e.insertion_order ?? e.order ?? i
    };
  }).filter(Boolean);
}
function looksLikeEntries(v){
  const a = Array.isArray(v) ? v : (v && typeof v==='object' ? Object.values(v) : []);
  if(!a.length) return false;
  const s = a.slice(0,5);
  return s.some(e => e && typeof e==='object' &&
    (('content' in e)||('entry' in e)) && (('keys' in e)||('key' in e)||('keywords' in e)||('constant' in e)));
}
/* 설정이 아니라 AI에게 내리는 명령으로 보이는 항목 */
const CMD_PAT = /(\bOOC\b|\[System|<system|당신은\s|너는\s+반드시|출력하라|출력할\s*것|절대\s|반드시\s|금지한다|응답은|assistant는|\{\{char\}\}는\s*반드시|Do not |You must |You are an? (AI|assistant)|NEVER |ALWAYS )/i;
function suspectEntry(e){
  if(!e.keys.length && !e.constant) return true;
  if(e.constant && e.content.length>320) return true;
  return CMD_PAT.test(e.content.slice(0,600));
}

/* --- 카드 정규화 --- */
function cardAsset(data, fallbackName){
  const d = (data && data.data && typeof data.data==='object') ? data.data : data;
  const out = [];
  const fields = {};
  ['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions','creator_notes']
    .forEach(k=>{ if(d[k]) fields[k]=String(d[k]); });
  for(const key of ['backstory','appearance'])if(typeof d.extensions?.[key]==='string'&&d.extensions[key])fields[key]=d.extensions[key];
  if(d.extensions?.depth_prompt?.prompt)fields.depth_prompt=String(d.extensions.depth_prompt.prompt);
  if(Array.isArray(d.alternate_greetings) && d.alternate_greetings.length)
    fields.alternate_greetings = d.alternate_greetings.join('\n\n');
  out.push({ id:uid(), kind:'character', name: d.name || fallbackName || '이름 없는 카드',
             fields, use:true });
  const book = d.character_book || d.characterBook;
  if(book && (book.entries)){
    const en = normEntries(book.entries);
    if(en.length) out.push({ id:uid(), kind:'lorebook',
      name:(d.name||fallbackName||'카드')+' 내장 로어북', from:'embedded',
      entries: en.map(e=>({...e, use: !suspectEntry(e)})), use:true });
  }
  return out;
}
function isCard(j){
  if(!j || typeof j!=='object') return false;
  if(j.spec && /chara_card/.test(j.spec)) return true;
  const d = j.data && typeof j.data==='object' ? j.data : j;
  return !!(d.name && (d.description || d.first_mes || d.personality));
}
function fromJson(j, fname){
  if(j?.type==='marinara_character' && j.data) return fromJson(j.data,fname);
  if(j?.type==='marinara_lorebook' && j.data){
    const data=j.data;return fromJson({name:data.lorebook?.name||data.name||fname,entries:data.entries||data.lorebook?.entries||[]},fname);
  }
  if(j?.type==='marinara_profile'||j?.type==='marinara_chat_settings_profile')throw new Error('앱 전체 설정 파일입니다. 재료로 사용할 카드·로어북·프리셋을 내보내 주세요.');
  const prompt=externalPromptMaterial(j,fname);if(prompt)return [prompt];
  if(isCard(j)) return cardAsset(j, fname);
  if(j && j.entries && looksLikeEntries(j.entries)){
    const en = normEntries(j.entries);
    return [{ id:uid(), kind:'lorebook', name: j.name || fname || '로어북',
      entries: en.map(e=>({...e, use: !suspectEntry(e)})), use:true }];
  }
  if(looksLikeEntries(j)){
    const en = normEntries(j);
    return [{ id:uid(), kind:'lorebook', name: fname || '로어북',
      entries: en.map(e=>({...e, use: !suspectEntry(e)})), use:true }];
  }
  if(Array.isArray(j) && j.some(isCard)) {
    let out=[]; j.filter(isCard).forEach(c=>{ out = out.concat(cardAsset(c, fname)); }); return out;
  }
  return [{ id:uid(), kind:'text', name: fname||'텍스트', body: JSON.stringify(j,null,2), use:true }];
}
function externalPromptMaterial(j,fname){
  if(!j||typeof j!=='object')return null;
  let parts=[],name=j.name||fname;
  if(j.type==='marinara_preset'&&j.data){
    const data=j.data,p=data.preset||{},sections=Array.isArray(data.sections)?data.sections:[];
    name=p.name||name;
    const order=p.sectionOrder||[];
    parts=[...sections].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?1e9:ai)-(bi<0?1e9:bi);}).filter(s=>!s.isMarker).map(s=>({name:s.name,role:s.role,text:s.content,enabled:s.enabled}));
    for(const key of ['conversationPrompt','gamePrompt'])if(p[key])parts.push({name:key,text:p[key]});
  }else if(Array.isArray(j.prompts)){
    const order=Array.isArray(j.prompt_order)?j.prompt_order.at(-1)?.order:[];
    const prompts=j.prompts.filter(p=>p&&!p.marker);
    const ordered=Array.isArray(order)&&order.length?order.map(o=>{const p=prompts.find(p=>p.identifier===o.identifier);return p?{...p,enabled:o.enabled!==false}:null;}).filter(Boolean):prompts;
    parts=ordered.map(p=>({name:p.name||p.identifier,role:p.role,text:p.content,enabled:p.enabled}));
  }else if(Array.isArray(j.promptTemplate)){
    parts=j.promptTemplate.map(p=>({name:p.name||p.type,role:p.role,text:p.text||p.content,enabled:p.enabled}));
  }else return null;
  const body=parts.filter(p=>typeof p.text==='string'&&p.text.trim()).map(p=>`## ${p.name||'구획'}${p.role?' · '+p.role:''}${p.enabled===false?' · 비활성 구획':''}\n${p.text}`).join('\n\n');
  if(!body)throw new Error('이 프리셋에는 읽을 수 있는 지문이 없습니다.');
  return {id:uid(),kind:'text',name:name||'가져온 프롬프트',body,purposes:['prompt'],use:true};
}

async function sniff(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  const base = file.name.replace(/\.[^.]+$/,'');
  if(buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47){
    const ch = await pngChunks(buf);
    const key = ch.ccv3 ? 'ccv3' : (ch.chara ? 'chara' : Object.keys(ch)[0]);
    if(!key) throw new Error('이 PNG에는 카드 정보가 없습니다.');
    let txt;
    try{ txt = utf8(b64bytes(ch[key])); }catch(e){ txt = ch[key]; }
    return fromJson(JSON.parse(txt), base);
  }
  if((buf[0]===0x50 && buf[1]===0x4B)||/\.(charx|zip|jpg|jpeg)$/i.test(file.name)){
    const es = await zipEntries(buf,name=>/\.(json|marinara)$/i.test(name));
    const card=es.find(e=>/(^|\/)card\.json$/i.test(e.name));
    if(card)return fromJson(JSON.parse(utf8(card.data)),base);
    if(!es.length) throw new Error('압축 파일 안에서 카드·재료 JSON을 찾지 못했습니다.');
    return es.flatMap(e=>fromJson(JSON.parse(utf8(e.data)),e.name));
  }
  const text = utf8(buf);
  if(/\.(risup|risupreset|risum)$/i.test(file.name))throw new Error('이 바이너리 형식은 아직 지원하지 않습니다. JSON 또는 PNG·CHARX로 내보낸 파일을 사용해 주세요.');
  let json;
  try{json=JSON.parse(text);}catch(e){
    if(/\.(json|marinara|preset)$/i.test(file.name))throw new Error('JSON 형식이 올바르지 않습니다.');
    if(text.includes('\u0000')||(text.match(/\ufffd/g)||[]).length>3)throw new Error('읽을 수 없는 바이너리 파일입니다.');
    return [{ id:uid(), kind:'text', name:file.name, body:text, use:true }];
  }
  return fromJson(json,base);
}

/* --- 재료 → 프롬프트용 텍스트 --- */
function sourceText(){
  const parts = [];
  const brief=curBrief().trim();
  if(brief) parts.push('## 구상\n'+brief);
  for(const a of S.assets){
    if(!a.use) continue;
    if(a.kind==='character'){
      const f = a.fields;
      parts.push(`## 캐릭터: ${a.name}\n` +
        Object.keys(f).map(k=>`### ${k}\n${f[k]}`).join('\n\n'));
    }else if(a.kind==='lorebook'){
      const on = a.entries.filter(e=>e.use);
      if(!on.length) continue;
      parts.push(`## 설정집: ${a.name}\n` + on.map(e=>{
        const label = e.comment || (e.keys[0]||'항목');
        return `### ${label}${e.keys.length?` [${e.keys.join(', ')}]`:''}\n${e.content}`;
      }).join('\n\n'));
    }else{
      parts.push(`## 자료: ${a.name}\n${a.body}`);
    }
  }
  return parts.join('\n\n');
}
function activeMode(){
  const by = S.opts.modeBy || (S.opts.modeBy = {world:'new',character:S.opts.mode||'w2c',prompt:'new'});
  return by[S.opts.group] || (S.opts.group==='character' ? 'w2c' : 'new');
}
function assetStats(){
  const t = sourceText();
  return { chars:t.length, tokens:tok(t),
    chars_n: S.assets.filter(a=>a.kind==='character'&&a.use).length,
    books_n: S.assets.filter(a=>a.kind==='lorebook'&&a.use).length };
}

/* ==================================================================
   5. 화면 — 재료
   ================================================================== */

const MAT_HINT = {
  world: '설정집 · 로어북 · 캐릭터 카드',
  character: '세계 로어북 · 기존 캐릭터 카드',
  prompt: '캐릭터 카드 · 세계 설정 · 기존 프롬프트'
};
const ASSET_KIND_LABEL = {character:'인물 카드', lorebook:'로어북', text:'텍스트'};
const STAR_SVG = on=>`<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 5.6 3 6.4 7 .9-5.1 4.9 1.3 7L16 21.4l-6.2 3.4 1.3-7L6 12.9l7-.9Z" ${on?'fill="currentColor"':'fill="none"'} stroke="currentColor"/></svg>`;
const FOLDER_ADD_SVG = '<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5.5 9.5h8l2.2 2.6h10.8v11.4a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M20 15.5v7M16.5 19h7" stroke="#e9b654"/></svg>';
const PENCIL_SVG = '<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7.5 24.5 1.2-5.2L20.5 7.5a2.4 2.4 0 0 1 3.4 0l.6.6a2.4 2.4 0 0 1 0 3.4L12.7 23.3Z"/><path d="m18.8 9.2 4 4M8.7 19.3l4 4" stroke="#e9b654"/></svg>';
const TRASH_SVG = '<svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7.6 9.7h16.8"/><path d="M12.8 9.7V8.2a1.8 1.8 0 0 1 1.8-1.8h2.8a1.8 1.8 0 0 1 1.8 1.8v1.5"/><path d="m9.8 9.7.9 14.1a2.4 2.4 0 0 0 2.4 2.2h5.8a2.4 2.4 0 0 0 2.4-2.2l.9-14.1"/><path d="M13.7 13.7v8.1M18.3 13.7v8.1" stroke="#e9b654"/></svg>';
let ASSET_FOLDER_FILTER='all', ASSET_PURPOSE_FILTER='all', ASSET_FOLDER_SCROLL=0, ASSET_SEARCH='', EDITING_ASSET_FOLDER_ID=null, PENDING_ASSET_FOLDER_DELETE=null;

function folderById(id){ return S.assetFolders.find(f=>f.id===id); }
function assetMatchesFolder(a){
  if(ASSET_FOLDER_FILTER==='all') return true;
  if(ASSET_FOLDER_FILTER==='favorites') return !!a.favorite;
  if(ASSET_FOLDER_FILTER==='unfiled') return !!a.favorite && !a.folderId;
  return ASSET_FOLDER_FILTER.startsWith('folder:') && a.favorite && a.folderId===ASSET_FOLDER_FILTER.slice(7);
}
function assetMatchesSearch(a){
  const q=ASSET_SEARCH.trim().toLowerCase(); if(!q) return true;
  normalizeAssetMetadata(a);
  const parts=[a.name,a.kind,a.from,a.body,...a.purposes.map(x=>ASSET_PURPOSE_LABEL[x]||x),...a.tags,...a.tags.map(x=>'#'+x)];
  if(a.kind==='character') Object.entries(a.fields||{}).forEach(([k,v])=>parts.push(k,v));
  if(a.kind==='lorebook') (a.entries||[]).forEach(en=>parts.push(en.comment,(en.keys||[]).join(' '),en.content));
  return parts.filter(Boolean).join('\n').toLowerCase().includes(q);
}
function assetMatchesPurpose(a){
  normalizeAssetMetadata(a);
  return ASSET_PURPOSE_FILTER==='all' || a.purposes.includes(ASSET_PURPOSE_FILTER);
}
function folderOptions(a){
  return `<option value="" ${!a.folderId?'selected':''}>미분류</option>`+
    S.assetFolders.map(f=>`<option value="${f.id}" ${a.folderId===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
}
function renderAssetFolderBar(){
  const previousScroll=$('#assetFolderScroll');
  if(previousScroll) ASSET_FOLDER_SCROLL=previousScroll.scrollLeft;
  normalizeAssetFolders();
  if(ASSET_FOLDER_FILTER.startsWith('folder:') && !folderById(ASSET_FOLDER_FILTER.slice(7))) ASSET_FOLDER_FILTER='all';
  const fav=S.assets.filter(a=>a.favorite).length;
  const unfiled=S.assets.filter(a=>a.favorite&&!a.folderId).length;
  const chip=(id,label,count,on)=>`<button class="folder-chip ${on==null?(ASSET_FOLDER_FILTER===id?'on':''):(on?'on':'')}" data-folder-filter="${id}">${esc(label)}<span class="fc">${count}</span></button>`;
  const selectedId=ASSET_FOLDER_FILTER.startsWith('folder:')?ASSET_FOLDER_FILTER.slice(7):null;
  const insideFavorites=ASSET_FOLDER_FILTER!=='all';
  $('#assetFolderBar').innerHTML = `<div class="asset-folder-row asset-scope-row">${chip('all','전체 재료',S.assets.length,ASSET_FOLDER_FILTER==='all')}${chip('favorites','즐겨찾기',fav,insideFavorites)}`+
    `<select class="asset-purpose-filter" aria-label="쓰임새 필터"><option value="all">모든 쓰임새</option>${ASSET_PURPOSE_KEYS.map(k=>`<option value="${k}" ${ASSET_PURPOSE_FILTER===k?'selected':''}>${ASSET_PURPOSE_LABEL[k]}</option>`).join('')}</select>`+
    `<input type="search" class="asset-search" value="${esc(ASSET_SEARCH)}" placeholder="이름·내용·#태그 검색" aria-label="재료 검색">`+
    `<button class="iconbtn danger asset-clear-temp" title="즐겨찾기 외 전체 삭제" aria-label="즐겨찾기 외 전체 삭제">${TRASH_SVG}</button></div>`+
    (insideFavorites?`<div class="favorite-folder-row"><div class="folder-scroll" id="assetFolderScroll">${chip('favorites','모두',fav)}${chip('unfiled','미분류',unfiled)}`+
      S.assetFolders.map(f=>chip('folder:'+f.id,f.name,S.assets.filter(a=>a.favorite&&a.folderId===f.id).length)).join('')+'</div>'+
      `<span class="folder-tools"><button class="iconbtn folder-new" title="즐겨찾기 폴더 만들기" aria-label="즐겨찾기 폴더 만들기">${FOLDER_ADD_SVG}</button>`+
      (selectedId?`<button class="iconbtn folder-rename" title="폴더 이름 바꾸기" aria-label="폴더 이름 바꾸기">${PENCIL_SVG}</button><button class="iconbtn danger folder-del" title="폴더 삭제" aria-label="폴더 삭제">${TRASH_SVG}</button>`:'')+'</span></div>':'');
  const folderScroll=$('#assetFolderScroll');
  if(folderScroll){
    const forceEnd=ASSET_FOLDER_SCROLL===Number.MAX_SAFE_INTEGER;
    folderScroll.scrollLeft=ASSET_FOLDER_SCROLL;
    if(!forceEnd){
      const selected=folderScroll.querySelector('.folder-chip.on');
      if(selected){
        const left=selected.offsetLeft, right=left+selected.offsetWidth;
        if(left<folderScroll.scrollLeft) folderScroll.scrollLeft=left;
        else if(right>folderScroll.scrollLeft+folderScroll.clientWidth) folderScroll.scrollLeft=right-folderScroll.clientWidth;
      }
    }
    dragScroll(folderScroll);
  }
}
function closeAssetFolderModal(){
  $('#assetFolderModal').hidden=true; EDITING_ASSET_FOLDER_ID=null; $('#assetFolderName').value='';
}
function openAssetFolderModal(folder){
  EDITING_ASSET_FOLDER_ID=folder?folder.id:null;
  $('#assetFolderModalTitle').textContent=folder?'폴더 이름 바꾸기':'즐겨찾기 폴더 만들기';
  $('#assetFolderSave').textContent=folder?'바꾸기':'만들기';
  $('#assetFolderName').value=folder?folder.name:'';
  $('#assetFolderModal').hidden=false;
  setTimeout(()=>{ $('#assetFolderName').focus(); if(folder) $('#assetFolderName').select(); },0);
}
function renderMat(){
  const box = $('#matStatus'); if(!box) return;
  const P = activePreset(), st = assetStats();
  const req = P.needs === 'required';
  let cls='matrow', html='';
  box.hidden=st.tokens===0&&!req;
  if(st.tokens > 0){
    cls += ' ok';
    html = `<span class="pip"></span>입력 약 ${st.tokens}토큰`;
  } else if(req){
    cls += ' warn';
    html = `<span class="pip"></span>원본 재료가 필요합니다`
         + ` <button class="mini ghost" id="matGo">재료 추가</button>`;
  }
  box.className = cls; box.innerHTML = html;
  const go = $('#matGo'); if(go) go.addEventListener('click', openMaterialsManager);
  const mh = $('#matHint');
  if(mh) mh.textContent = MAT_HINT[S.opts.group] || '';
}

function renderAssets(keepFolderBar){
  const box = $('#assetList');
  $('#bAssets').textContent = S.assets.length;
  if(!keepFolderBar) renderAssetFolderBar();
  if(!S.assets.length){
    box.innerHTML = `<div class="empty"><b>재료 없이도 시작할 수 있습니다</b>구상만 적어 만들거나, 나중에 재료를 더해도 됩니다.
      <div class="empty-actions"><button class="mini ghost" data-group-start="world">세계 만들기</button><button class="mini ghost" data-group-start="character">인물 만들기</button><button class="mini ghost" data-group-start="prompt">프롬프트 만들기</button></div></div>`;
    renderMat(); renderNebulaPicker(); return;
  }
  renderMat();
  const shown=S.assets.filter(a=>assetMatchesFolder(a)&&assetMatchesPurpose(a)&&assetMatchesSearch(a)).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite));
  box.innerHTML = (shown.length ? shown.map(a=>{
    const on = a.kind==='lorebook' ? a.entries.filter(e=>e.use).length : 0;
    const meta = a.kind==='lorebook' ? `${on}/${a.entries.length}개 · ${tok(a.entries.filter(e=>e.use).map(e=>e.content).join(''))} 토큰쯤`
      : a.kind==='character' ? `${Object.keys(a.fields).length}개 항목 · ${tok(Object.values(a.fields).join(''))} 토큰쯤`
      : `${tok(a.body)} 토큰쯤`;
    const purposeHtml=a.purposes.map(k=>`<span class="asset-purpose" data-purpose="${k}">${ASSET_PURPOSE_LABEL[k]}</span>`).join('')
      || '<span class="asset-purpose unassigned">미분류</span>';
    const tagHtml=a.tags.map(t=>`<button class="asset-tag" data-tag="${esc(t)}" title="이 태그로 검색">#${esc(t)}</button>`).join('');
    return `<div class="asset ${a.kind}" data-id="${a.id}">
      <div class="asset-head">
        <label style="flex:none;display:flex;align-items:center">
          <input type="checkbox" class="a-use" ${a.use?'checked':''} style="width:auto;accent-color:var(--brass)"></label>
        <div class="asset-title">
          <span class="asset-purposes" aria-label="쓸 곳">${purposeHtml}</span>
          <span class="asset-name">${esc(a.name)}</span>
        </div>
        <span class="asset-meta">${meta}</span>
        ${a.favorite?`<select class="asset-folder-select a-folder" aria-label="${esc(a.name)} 폴더">${folderOptions(a)}</select>`:''}
        ${a.kind==='lorebook' ? '<button class="mini ghost a-toggle">항목 고르기</button>':''}
        ${a.kind==='character' ? '<button class="mini ghost a-peek">내용</button>':''}
        <span class="asset-tools">
          <button class="iconbtn a-star ${a.favorite?'on':''}" title="${a.favorite?'즐겨찾기 해제':'즐겨찾기 · 삭제 보호와 폴더 분류'}" aria-label="${a.favorite?'즐겨찾기 해제':'즐겨찾기'}">${STAR_SVG(!!a.favorite)}</button>
          <button class="iconbtn a-edit" title="수정" aria-label="수정"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7.5 24.5 1.2-5.2L20.5 7.5a2.4 2.4 0 0 1 3.4 0l.6.6a2.4 2.4 0 0 1 0 3.4L12.7 23.3Z"/><path d="m18.8 9.2 4 4M8.7 19.3l4 4" stroke="#e9b654"/></svg></button>
          <button class="iconbtn a-copy" title="복제" aria-label="복제"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="11" y="7" width="14" height="14" rx="2.5"/><rect x="7" y="11" width="14" height="14" rx="2.5" stroke="#e9b654"/></svg></button>
          <button class="iconbtn danger a-del" title="삭제" aria-label="삭제">${TRASH_SVG}</button>
        </span>
      </div>
      ${tagHtml?`<div class="asset-taxonomy">${tagHtml}</div>`:''}
      ${a.kind==='lorebook' ? entriesHtml(a) : ''}
      ${a.kind==='character' ? `<div class="entries"><pre style="white-space:pre-wrap;font-size:12px;color:var(--dim);margin:0;max-height:280px;overflow:auto">${esc(Object.keys(a.fields).map(k=>'['+k+']\n'+a.fields[k]).join('\n\n'))}</pre></div>`:''}
      ${assetEditorHtml(a)}
    </div>`;
  }).join('') : (ASSET_SEARCH.trim()||ASSET_PURPOSE_FILTER!=='all'?'<div class="empty"><b>검색 결과가 없습니다</b>검색어나 쓰임새 필터를 바꿔보세요.</div>':'<div class="empty"><b>이 폴더는 비어 있습니다</b>전체에서 재료를 즐겨찾기한 뒤 폴더를 골라 주세요.</div>'));
  renderNebulaPicker();
}
const EDIT_ASSETS = new Set();
function assetEditorHtml(a){
  let body = '';
  if(a.kind==='character') body = Object.keys(a.fields).map(k=>`
    <div class="editrow"><label class="fl">${esc(k)}</label><textarea class="ae-field" data-key="${esc(k)}" rows="3">${esc(a.fields[k])}</textarea></div>`).join('');
  else if(a.kind==='lorebook') body = a.entries.map(en=>`
    <div class="editrow edit-entry" data-eid="${en.id}">
      <div><input class="ae-comment" value="${esc(en.comment||'')}" placeholder="항목 이름"><input class="ae-keys" value="${esc((en.keys||[]).join(', '))}" placeholder="키워드, 쉼표로 구분" style="margin-top:6px"></div>
      <textarea class="ae-content" rows="4">${esc(en.content||'')}</textarea>
    </div>`).join('');
  else body = `<div class="editrow"><label class="fl">본문</label><textarea class="ae-body" rows="8">${esc(a.body||'')}</textarea></div>`;
  return `<div class="asset-editor ${EDIT_ASSETS.has(a.id)?'open':''}">
    <div class="asset-editor-head"><span>재료 수정</span><span class="sp"></span><button class="iconbtn a-edit-close" title="닫기 · 이번 수정은 적용하지 않음" aria-label="닫기"><svg class="ic" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8.5 8.5 15 15M23.5 8.5l-15 15"/></svg></button></div>
    <div class="editrow asset-format"><span class="fl">자료 형식</span><span class="note">${esc(ASSET_KIND_LABEL[a.kind]||a.kind)}</span></div>
    <div class="editrow"><label class="fl">재료 이름</label><input class="ae-name" value="${esc(a.name||'')}"></div>
    <div class="editrow"><span class="fl">쓸 곳</span><div class="purpose-options" role="group" aria-label="${esc(a.name||'재료')} 쓸 곳">${ASSET_PURPOSE_KEYS.map(k=>`<label class="purpose-choice"><input type="checkbox" class="ae-purpose" value="${k}" ${a.purposes.includes(k)?'checked':''}><span>${ASSET_PURPOSE_LABEL[k]}</span></label>`).join('')}</div></div>
    <div class="editrow"><label class="fl">태그</label><input class="ae-tags" value="${esc(a.tags.join(', '))}" placeholder="예: 마법학교, 라이벌, 겨울 · 쉼표로 구분"></div>
    ${body}
    <div class="bar asset-editor-actions">
      <button class="mini ghost a-compare">원본과 비교</button><button class="mini ghost a-original">원본으로 되돌리기</button>
      <button class="mini primary a-edit-done">수정</button>
    </div>
  </div>`;
}
function entriesHtml(a){
  return `<div class="entries">
    <div class="entry-tools">
      <input type="search" class="e-search" placeholder="항목 검색">
      <button class="mini ghost e-all">전체 선택</button>
      <button class="mini ghost e-none">해제</button>
      <button class="mini ghost e-clean">설정 항목만</button>
    </div>
    <div class="elist">${a.entries.map(e=>{
      const label = e.comment || e.keys[0] || '(제목 없음)';
      const sus = suspectEntry(e);
      return `<label class="erow ${sus?'suspect':''}" data-eid="${e.id}" data-text="${esc((label+' '+e.keys.join(' ')+' '+e.content).toLowerCase())}">
        <input type="checkbox" class="e-use" ${e.use?'checked':''}>
        <div style="flex:1;min-width:0">
          <div class="ek">${esc(label)}${sus?'<span class="flag">지시문?</span>':''}</div>
          <div class="ep">${esc(e.content.slice(0,180))}</div>
        </div></label>`;
    }).join('')}</div></div>`;
}
function assetById(id){ return S.assets.find(a=>a.id===id); }
const EDIT_BASELINE = new Map(), EDIT_WAS_DIRTY = new Map();
function replaceAssetFrom(a, snap){
  const i=S.assets.findIndex(x=>x.id===a.id); if(i<0) return null;
  const keepOriginal=clone(ensureAssetOriginal(a).original), keepUse=a.use, keepFavorite=!!a.favorite, keepFolder=a.folderId;
  const next=clone(snap); next.id=a.id; next.use=keepUse; next.original=keepOriginal; next.favorite=keepFavorite;
  if(keepFavorite && keepFolder) next.folderId=keepFolder; else delete next.folderId;
  S.assets[i]=next; return next;
}
function duplicateAsset(a){
  const d=assetCore(a); d.id=uid(); d.name=(a.name||'재료')+' 복사본';
  d.favorite=false; delete d.folderId;
  if(d.kind==='lorebook') d.entries.forEach(en=>{ en.id=uid(); });
  S.assets.push(d); return d;
}
function assetReadable(a){
  normalizeAssetMetadata(a);
  const head=`이름: ${a.name}\n쓸 곳: ${a.purposes.map(x=>ASSET_PURPOSE_LABEL[x]).join(', ')||'미분류'}\n태그: ${a.tags.join(', ')||'없음'}\n\n`;
  if(a.kind==='character') return head+Object.keys(a.fields||{}).map(k=>`[${k}]\n${a.fields[k]}`).join('\n\n');
  if(a.kind==='lorebook') return head+(a.entries||[]).map((en,i)=>`[${i+1}] ${en.comment||'(제목 없음)'}\n키워드: ${(en.keys||[]).join(', ')}\n${en.content||''}`).join('\n\n');
  return head+(a.body||'');
}
function showAssetCompare(a){
  ensureAssetOriginal(a);
  $('#assetCompareTitle').textContent=(a.name||'재료')+' · 원본과 수정본';
  $('#assetCompareOriginal').textContent=assetReadable(a.original);
  $('#assetCompareCurrent').textContent=assetReadable(a);
  $('#assetCompare').hidden=false;
}
// 같은 재료 화면을 모달에 잠시 옮겨 파일 입력과 편집 중인 내용을 유지합니다.
const MATERIALS_HOME=document.createComment('materials-home');
$('#v-sources').before(MATERIALS_HOME);
function openMaterialsManager(){
  if(!canChangeWork()) return;
  if(curTab==='sources') return;
  const modal=$('#materialsManagerModal');
  if(!modal.hidden) return;
  $('#materialsManagerMount').append($('#v-sources'));
  renderAssets(); renderNebulaPicker();
  modal.hidden=false;
}
function restoreMaterialsHome(){
  const source=$('#v-sources');
  if(source.parentElement!==$('#materialsManagerMount')) return;
  MATERIALS_HOME.after(source);
  renderDigest(); renderMat(); renderNebulaPicker(); renderOneshot();
}
function closeMaterialsManager(){
  $('#materialsManagerModal').hidden=true;
  restoreMaterialsHome();
}
$('#btnStudioMaterials').addEventListener('click',openMaterialsManager);
$('#materialsManagerClose').addEventListener('click',closeMaterialsManager);
$('#materialsManagerDone').addEventListener('click',closeMaterialsManager);
$('#materialsManagerModal').addEventListener('click',e=>{
  if(e.target.id==='materialsManagerModal') closeMaterialsManager();
});
new MutationObserver(()=>{
  if($('#materialsManagerModal').hidden) restoreMaterialsHome();
}).observe($('#materialsManagerModal'),{attributes:true,attributeFilter:['hidden']});
function renderNebulaPicker(){
  const box = $('#nebulaList'), count = $('#nebulaCount'); if(!box || !count) return;
  const n = S.assets.filter(a=>a.use).length;
  count.textContent = `선택 ${n}/${S.assets.length}개`;
  $('#materialsManagerCount').textContent=`선택한 재료 ${n}개`;
  const ordered=[...S.assets].map(normalizeAssetMetadata).sort((a,b)=>Number(b.purposes.includes(S.opts.group))-Number(a.purposes.includes(S.opts.group)));
  box.innerHTML = ordered.length ? ordered.map(a=>`
    <label class="nebula-row"><input type="checkbox" class="n-use" data-id="${a.id}" ${a.use?'checked':''}>
      <span>${esc(a.name)}</span><span class="sp"></span><span class="note">${a.purposes.includes(S.opts.group)?'추천 · ':''}${a.purposes.map(x=>ASSET_PURPOSE_LABEL[x]).join(' · ')||'미분류'} · ${{character:'캐릭터',lorebook:'로어북',text:'텍스트'}[a.kind]||a.kind}</span></label>`).join('')
    : '<div class="note">고를 재료가 없습니다 · 그대로 구상만으로 만들 수 있습니다.</div>';
}
function materialChanged(){ save(); renderDigest(); renderMat(); renderNebulaPicker(); renderOneshot(); touchDraft(); }
function deleteUnfavoriteAssets(){
  const removable=S.assets.filter(a=>!a.favorite);
  if(!removable.length) return toast(S.assets.length?'삭제할 일반 재료가 없습니다':'삭제할 재료가 없습니다');
  const kept=S.assets.length-removable.length;
  PENDING_ASSET_FOLDER_DELETE=null;
  $('#assetClearTitle').textContent='즐겨찾기 외 전체 삭제';
  $('#assetClearDesc').textContent=`즐겨찾기하지 않은 재료 ${removable.length}개를 모두 삭제합니다.${kept?` 즐겨찾기 ${kept}개는 남습니다.`:''}`;
  $('#assetClearConfirm').textContent='삭제';
  $('#assetClearModal').hidden=false;
}
function openAssetFolderDelete(folder){
  PENDING_ASSET_FOLDER_DELETE=folder.id;
  $('#assetClearTitle').textContent='폴더 삭제';
  $('#assetClearDesc').textContent=`“${folder.name}” 폴더만 삭제합니다. 안의 재료는 즐겨찾기 미분류로 남습니다.`;
  $('#assetClearConfirm').textContent='폴더 삭제';
  $('#assetClearModal').hidden=false;
}
function closeAssetClearModal(){ $('#assetClearModal').hidden=true; PENDING_ASSET_FOLDER_DELETE=null; }
function confirmDeleteUnfavoriteAssets(){
  if(PENDING_ASSET_FOLDER_DELETE){
    const folder=folderById(PENDING_ASSET_FOLDER_DELETE); if(!folder) return closeAssetClearModal();
    S.assets.forEach(a=>{ if(a.folderId===folder.id) delete a.folderId; });
    S.assetFolders=S.assetFolders.filter(f=>f.id!==folder.id); ASSET_FOLDER_FILTER='unfiled';
    closeAssetClearModal(); save(); renderAssets(); toast('폴더만 삭제했습니다 · 재료는 미분류에 남았습니다'); return;
  }
  const removable=S.assets.filter(a=>!a.favorite);
  const ids=new Set(removable.map(a=>a.id));
  S.assets=S.assets.filter(a=>a.favorite);
  ids.forEach(id=>{ EDIT_ASSETS.delete(id); EDIT_BASELINE.delete(id); EDIT_WAS_DIRTY.delete(id); });
  closeAssetClearModal(); renderAssets(); materialChanged(); toast('즐겨찾기하지 않은 재료를 삭제했습니다');
}

$('#assetFolderBar').addEventListener('click', e=>{
  if(e.target.closest('.asset-clear-temp')){ deleteUnfavoriteAssets(); return; }
  const filter=e.target.closest('[data-folder-filter]');
  if(filter){ ASSET_FOLDER_FILTER=filter.dataset.folderFilter; renderAssets(); return; }
  if(e.target.closest('.folder-new')){
    openAssetFolderModal(null); return;
  }
  const id=ASSET_FOLDER_FILTER.startsWith('folder:')?ASSET_FOLDER_FILTER.slice(7):null;
  const folder=folderById(id); if(!folder) return;
  if(e.target.closest('.folder-rename')){
    openAssetFolderModal(folder); return;
  }
  if(e.target.closest('.folder-del')){
    openAssetFolderDelete(folder);
  }
});
$('#assetFolderBar').addEventListener('input', e=>{
  if(!e.target.classList.contains('asset-search')) return;
  ASSET_SEARCH=e.target.value; renderAssets(true);
});
$('#assetFolderBar').addEventListener('change', e=>{
  if(!e.target.classList.contains('asset-purpose-filter')) return;
  ASSET_PURPOSE_FILTER=e.target.value; renderAssets();
});
$('#assetFolderBar').addEventListener('keydown', e=>{
  if(e.target.classList.contains('asset-search')&&e.key==='Escape'){
    e.preventDefault(); ASSET_SEARCH=''; e.target.value=''; renderAssets(true);
  }
});
$('#assetFolderSave').addEventListener('click', ()=>{
  const clean=$('#assetFolderName').value.trim();
  if(!clean) return toast('폴더 이름을 적어 주세요',1);
  if(S.assetFolders.some(f=>f.id!==EDITING_ASSET_FOLDER_ID&&f.name.toLowerCase()===clean.toLowerCase())) return toast('같은 이름의 폴더가 있습니다',1);
  const folder=folderById(EDITING_ASSET_FOLDER_ID);
  if(folder){ folder.name=clean; toast('폴더 이름을 바꿨습니다'); }
  else{ S.assetFolders.push({id:uid(),name:clean}); ASSET_FOLDER_SCROLL=Number.MAX_SAFE_INTEGER; toast(`“${clean}” 폴더를 만들었습니다`); }
  save(); closeAssetFolderModal(); renderAssets();
});
$('#assetFolderName').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#assetFolderSave').click(); } });
$('#assetFolderClose').addEventListener('click', closeAssetFolderModal);
$('#assetFolderCancel').addEventListener('click', closeAssetFolderModal);
$('#assetFolderModal').addEventListener('click', e=>{ if(e.target.id==='assetFolderModal') closeAssetFolderModal(); });
$('#assetClearConfirm').addEventListener('click', confirmDeleteUnfavoriteAssets);
$('#assetClearClose').addEventListener('click', closeAssetClearModal);
$('#assetClearCancel').addEventListener('click', closeAssetClearModal);
$('#assetClearModal').addEventListener('click', e=>{ if(e.target.id==='assetClearModal') closeAssetClearModal(); });

$('#assetList').addEventListener('click', e=>{
  const start=e.target.closest('[data-group-start]');
  if(start){ closeMaterialsManager(); if(applyGroup(start.dataset.groupStart)!==false) tab('studio'); return; }
  const wrap = e.target.closest('.asset'); if(!wrap) return;
  const a = assetById(wrap.dataset.id); if(!a) return;
  const tag=e.target.closest('.asset-tag');
  if(tag){ ASSET_FOLDER_FILTER='all'; ASSET_PURPOSE_FILTER='all'; ASSET_SEARCH='#'+tag.dataset.tag; renderAssets(); return; }
  if(e.target.closest('.a-star')){ a.favorite=!a.favorite; if(!a.favorite) delete a.folderId; save(); renderAssets(); touchDraft(); toast(a.favorite?'즐겨찾기에 고정했습니다':'즐겨찾기에서 해제했습니다'); return; }
  if(e.target.closest('.a-del')){ if(!confirm(a.favorite?`“${a.name}” 즐겨찾기 재료를 영구 삭제할까요?`:`“${a.name}” 재료를 삭제할까요?`)) return; S.assets = S.assets.filter(x=>x.id!==a.id); EDIT_ASSETS.delete(a.id); EDIT_BASELINE.delete(a.id); EDIT_WAS_DIRTY.delete(a.id); renderAssets(); materialChanged(); return; }
  if(e.target.closest('.a-copy')){ const d=duplicateAsset(a); renderAssets(); materialChanged(); toast(`“${d.name}”을 만들었습니다`); return; }
  if(e.target.closest('.a-edit')){ if(!EDIT_BASELINE.has(a.id)){ ensureAssetOriginal(a); EDIT_BASELINE.set(a.id,assetCore(a)); EDIT_WAS_DIRTY.set(a.id,DRAFT_DIRTY); } EDIT_ASSETS.add(a.id); renderAssets(); $(`.asset[data-id="${a.id}"] .asset-editor`).scrollIntoView({behavior:'smooth',block:'nearest'}); return; }
  if(e.target.closest('.a-edit-close')){ const base=EDIT_BASELINE.get(a.id), wasDirty=EDIT_WAS_DIRTY.get(a.id); if(base) replaceAssetFrom(a,base); EDIT_BASELINE.delete(a.id); EDIT_WAS_DIRTY.delete(a.id); EDIT_ASSETS.delete(a.id); renderAssets(); renderDigest(); renderMat(); renderNebulaPicker(); if(wasDirty){ DRAFT_DIRTY=true; touchDraft(); }else clearDraft(); return; }
  if(e.target.closest('.a-original')){ if(!confirm('처음 불러온 내용으로 되돌릴까요?')) return; replaceAssetFrom(a,ensureAssetOriginal(a).original); renderAssets(); materialChanged(); toast('처음 불러온 내용으로 되돌렸습니다'); return; }
  if(e.target.closest('.a-compare')){ showAssetCompare(a); return; }
  if(e.target.closest('.a-edit-done')){ EDIT_BASELINE.delete(a.id); EDIT_WAS_DIRTY.delete(a.id); EDIT_ASSETS.delete(a.id); renderAssets(); materialChanged(); toast('재료 수정을 반영했습니다'); return; }
  if(e.target.closest('.a-toggle')||e.target.closest('.a-peek')){ $('.entries',wrap).classList.toggle('open'); return; }
  if(e.target.closest('.e-all')||e.target.closest('.e-none')||e.target.closest('.e-clean')){
    const mode = e.target.closest('.e-all')?'all':e.target.closest('.e-none')?'none':'clean';
    a.entries.forEach(en=>{ en.use = mode==='all' ? true : mode==='none' ? false : !suspectEntry(en); });
    const open = $('.entries',wrap).classList.contains('open');
    renderAssets();
    materialChanged();
    if(open) $(`.asset[data-id="${a.id}"] .entries`).classList.add('open');
    return;
  }
});
$('#assetList').addEventListener('change', e=>{
  const wrap = e.target.closest('.asset'); if(!wrap) return;
  const a = assetById(wrap.dataset.id); if(!a) return;
  if(e.target.classList.contains('a-folder')){ if(e.target.value) a.folderId=e.target.value; else delete a.folderId; save(); renderAssets(); return; }
  if(e.target.classList.contains('a-use')){ a.use = e.target.checked; renderAssets(); materialChanged(); return; }
  if(e.target.classList.contains('ae-purpose')){
    a.purposes=$$('.ae-purpose',wrap).filter(x=>x.checked).map(x=>x.value);
    touchDraft(); return;
  }
  if(e.target.classList.contains('e-use')){
    const row = e.target.closest('.erow');
    const en = a.entries.find(x=>x.id===row.dataset.eid);
    if(en) en.use = e.target.checked;
    materialChanged();
    return;
  }
});
$('#assetList').addEventListener('input', e=>{
  const wrap = e.target.closest('.asset');
  if(e.target.classList.contains('e-search')){
    const q = e.target.value.toLowerCase().trim();
    $$('.erow', wrap).forEach(r=>{ r.style.display = (!q || r.dataset.text.includes(q)) ? '' : 'none'; });
    return;
  }
  if(!wrap) return;
  const a = assetById(wrap.dataset.id); if(!a) return;
  if(e.target.classList.contains('ae-name')) a.name = e.target.value;
  else if(e.target.classList.contains('ae-tags')) a.tags=cleanAssetTags(e.target.value);
  else if(e.target.classList.contains('ae-body')) a.body = e.target.value;
  else if(e.target.classList.contains('ae-field')) a.fields[e.target.dataset.key] = e.target.value;
  else {
    const row = e.target.closest('.edit-entry'); if(!row) return;
    const en = a.entries.find(x=>x.id===row.dataset.eid); if(!en) return;
    if(e.target.classList.contains('ae-comment')) en.comment = e.target.value;
    if(e.target.classList.contains('ae-keys')) en.keys = e.target.value.split(',').map(x=>x.trim()).filter(Boolean);
    if(e.target.classList.contains('ae-content')) en.content = e.target.value;
  }
  touchDraft();
});

$('#nebulaList').addEventListener('change', e=>{
  if(!e.target.classList.contains('n-use')) return;
  const a = assetById(e.target.dataset.id); if(!a) return;
  a.use = e.target.checked; renderAssets(); materialChanged();
});

$('#assetCompareClose').addEventListener('click', ()=>{ $('#assetCompare').hidden=true; });
$('#assetCompare').addEventListener('click', e=>{ if(e.target.id==='assetCompare') $('#assetCompare').hidden=true; });

async function addFiles(files){
  for(const f of files){
    try{
      const got = await sniff(f);
      S.assets.push(...got);
      log(`재료 추가: ${f.name} → ${got.map(g=>g.kind).join(', ')}`,'ok');
    }catch(err){
      log(`${f.name} 읽기 실패: ${err.message}`,'err');
      toast(`${f.name}: ${err.message}`, 1);
    }
  }
  renderAssets();
  materialChanged();
}
const drop = $('#drop');
drop.addEventListener('click', ()=>$('#fileIn').click());
drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', ()=>drop.classList.remove('over'));
drop.addEventListener('drop', e=>{ e.preventDefault(); drop.classList.remove('over');
  addFiles(Array.from(e.dataTransfer.files)); });
$('#fileIn').addEventListener('change', e=>{ addFiles(Array.from(e.target.files)); e.target.value=''; });
$('#btnPaste').addEventListener('click', ()=>{
  const box = $('#pasteBox');
  box.hidden = !box.hidden;
  if(!box.hidden){ $('#pasteName').focus(); if(box.scrollIntoView) box.scrollIntoView({behavior:'smooth', block:'nearest'}); }
});
$('#pasteIn').addEventListener('input', e=>{
  const n = e.target.value.length;
  $('#pasteInfo').textContent = n ? `${n}자 · ${tok(e.target.value)} 토큰쯤` : '0자';
});
function resetPasteForm(){
  $('#pasteName').value=''; $('#pasteTags').value=''; $('#pasteIn').value=''; $('#pasteInfo').textContent='0자';
  $$('#pastePurposes input').forEach(x=>{ x.checked=false; });
}
$('#btnPasteCancel').addEventListener('click', ()=>{
  resetPasteForm(); $('#pasteBox').hidden = true;
});
$('#btnPasteAdd').addEventListener('click', ()=>{
  const t = $('#pasteIn').value;
  if(!t.trim()) return toast('내용이 비어 있습니다', 1);
  const first = t.trim().split(/\n/)[0].slice(0, 24);
  const typedName = $('#pasteName').value.trim();
  const purposes=$$('#pastePurposes input').filter(x=>x.checked).map(x=>x.value);
  const tags=cleanAssetTags($('#pasteTags').value);
  S.assets.push({ id:uid(), kind:'text',
    name: typedName || (first ? first + (t.length>24?'…':'') : '붙여넣은 텍스트'), body:t, purposes, tags, use:true });
  resetPasteForm(); $('#pasteBox').hidden = true;
  renderAssets(); materialChanged(); toast('재료에 넣었습니다');
});
$('#pasteIn').addEventListener('keydown', e=>{
  if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); $('#btnPasteAdd').click(); }
});
