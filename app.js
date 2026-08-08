'use strict';

const USER_TAGS = ['status_panel', 'details', 'recall', 'supplement', '本轮用户输入'];
const $ = (id) => document.getElementById(id);
const state = { file: null, raw: '', unmatched: [], cover: null };

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function removeTagBlocks(message, tags) {
  for (const tag of tags) message = message.replace(new RegExp(`<${escapeRegExp(tag)}(?=[\\s/>])[^>]*>[\\s\\S]*?<\\/${escapeRegExp(tag)}\\s*>`, 'gi'), '');
  return message;
}
function removeOrphanClosingTags(message) { return message.replace(/<\/\d+\s*>/g, ''); }
function cleanUserMessage(message) {
  return removeTagBlocks(message.trim(), USER_TAGS).replace(/^（[^）]*）\s*/, '').replace(/^\([^)]*\)\s*/, '').trim();
}
function cleanAiMessage(message, tag) {
  const pattern = new RegExp(`<(/?)${escapeRegExp(tag)}(?=[\\s/>])[^>]*>`, 'gi');
  const matches = []; let contentStart = null;
  for (const token of message.matchAll(pattern)) {
    if (token[1]) {
      if (contentStart !== null) { matches.push(message.slice(contentStart, token.index).trim()); contentStart = null; }
    } else contentStart = token.index + token[0].length;
  }
  return matches.length ? removeOrphanClosingTags(matches.join('\n\n')).trim() : null;
}

function parseJsonl(raw, tag) {
  const output = [], unmatched = [], warnings = [];
  let skipped = 0;
  raw.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim(); if (!line) return;
    let obj;
    try { obj = JSON.parse(line); } catch (error) { warnings.push(`第 ${index + 1} 行不是有效 JSON，已跳过`); skipped++; return; }
    if (!obj || typeof obj !== 'object' || !('mes' in obj)) { skipped++; return; }
    if (typeof obj.mes !== 'string') { warnings.push(`第 ${index + 1} 行的消息不是文字，已跳过`); skipped++; return; }
    let cleaned;
    if (obj.is_user === true) cleaned = cleanUserMessage(obj.mes);
    else {
      cleaned = cleanAiMessage(obj.mes, tag);
      if (cleaned === null) {
        cleaned = removeOrphanClosingTags(obj.mes).trim();
        unmatched.push({ line: index + 1, original: obj.mes, kept: true });
      }
    }
    if (cleaned) output.push({ line: index + 1, text: cleaned });
  });
  return { output, unmatched, warnings, skipped };
}

function renderResult() {
  const tag = $('contentTag').value.trim();
  if (!tag || /[<>\s/]/.test(tag)) { $('notice').hidden = false; $('notice').textContent = '正文标签只能填写一个标签名，例如 content。'; return; }
  const result = parseJsonl(state.raw, tag); state.unmatched = result.unmatched;
  $('editor').value = result.output.map((item) => item.text).join('\n\n') + (result.output.length ? '\n' : '');
  $('fileSummary').textContent = `${state.file.name} · 清洗出 ${result.output.length} 条消息`;
  const notes = [];
  if (result.unmatched.length) notes.push(`${result.unmatched.length} 条 AI 消息未找到 <${tag}> 标签，当前已保留原文，可在下方逐条检查。`);
  if (result.warnings.length) notes.push(`${result.warnings.length} 行格式异常，已跳过。`);
  $('notice').hidden = notes.length === 0; $('notice').textContent = notes.join(' ');
  renderUnmatched(); updateCount();
  $('cleanSection').hidden = false; $('exportSection').hidden = false;
  $('cleanSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderUnmatched() {
  const panel = $('unmatchedPanel'); panel.hidden = state.unmatched.length === 0;
  $('toggleUnmatched').querySelector('span').textContent = `查看 ${state.unmatched.length} 条未匹配消息`;
  $('unmatchedList').innerHTML = '';
  state.unmatched.forEach((item, index) => {
    const div = document.createElement('div'); div.className = 'unmatched-item';
    const title = document.createElement('strong'); title.textContent = `JSONL 第 ${item.line} 行`;
    const p = document.createElement('p'); p.textContent = item.original;
    const keep = document.createElement('button'); keep.className = 'secondary'; keep.textContent = '原文已保留'; keep.disabled = true;
    const remove = document.createElement('button'); remove.className = 'text-btn'; remove.textContent = '从正文移除';
    remove.onclick = () => { removeOccurrence(item.original); item.kept = false; remove.textContent = '已移除'; remove.disabled = true; keep.textContent = '未保留'; updateCount(); };
    div.append(title, p, keep, remove); $('unmatchedList').append(div);
  });
}
function removeOccurrence(text) {
  const editor = $('editor'); const cleaned = removeOrphanClosingTags(text).trim();
  editor.value = editor.value.replace(cleaned + '\n\n', '').replace('\n\n' + cleaned, '').replace(cleaned, '');
}
async function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.jsonl')) { alert('请选择 .jsonl 文件。'); return; }
  state.file = file;
  try { state.raw = await file.text(); renderResult(); $('bookTitle').value = file.name.replace(/\.jsonl$/i, ''); }
  catch { alert('文件读取失败，请重新选择。'); }
}
function updateCount() { const text = $('editor').value; $('charCount').textContent = `${text.length.toLocaleString()} 字符`; }
function safeName(name) { return (name || '酒馆小说').replace(/[\\/:*?"<>|]+/g, '_').trim() || '酒馆小说'; }
function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }

function chapterPattern() {
  const mode = $('chapterMode').value;
  if (mode === 'line') return /^.{1,40}$/;
  if (mode === 'custom') {
    const source = $('chapterRegex').value.trim(); if (!source) throw new Error('请填写自定义章节规则。');
    try { return new RegExp(source); } catch { throw new Error('自定义正则表达式无效，请检查括号或符号。'); }
  }
  return /^(?:Chapter\s+\d+\b.*|第\s*(?:[0-9０-９]+|[一二三四五六七八九十百千万零〇两]+)\s*章.*)$/i;
}
function splitChapters(text) {
  const pattern = chapterPattern(); const lines = text.replace(/\r/g, '').split('\n'); const chapters = []; let current = { title: '正文', lines: [] };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && pattern.test(trimmed)) { if (current.lines.some((x) => x.trim())) chapters.push(current); current = { title: trimmed, lines: [] }; }
    else current.lines.push(line);
  }
  if (current.lines.some((x) => x.trim()) || !chapters.length) chapters.push(current);
  if (chapters.length > 1 && chapters[0].title === '正文') chapters[0].title = '序章';
  return chapters.map((c) => ({ title: c.title, text: c.lines.join('\n').trim() })).filter((c) => c.text || c.title !== '正文');
}
function xml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function paragraphs(text) { return text.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${xml(p.trim()).replace(/\n/g, '<br/>')}</p>`).join('\n'); }
function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); }); }

const crcTable = (() => { const table = new Uint32Array(256); for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table; })();
function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function u16(v){return new Uint8Array([v&255,(v>>>8)&255]);} function u32(v){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]);}
function concat(parts){const length=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(length);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function makeZip(files){const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;for(const file of files){const name=enc.encode(file.name),data=file.data instanceof Uint8Array?file.data:enc.encode(file.data),crc=crc32(data);const local=concat([u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);locals.push(local);const central=concat([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);centrals.push(central);offset+=local.length;}const body=concat(locals),directory=concat(centrals),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(directory.length),u32(body.length),u16(0)]);return new Blob([body,directory,end],{type:'application/epub+zip'});}

async function buildEpub() {
  const title = $('bookTitle').value.trim() || '未命名小说', author = $('bookAuthor').value.trim() || '佚名', id = uuid(), chapters = splitChapters($('editor').value);
  if (!chapters.length) throw new Error('正文为空，暂时无法生成 EPUB。');
  const files=[{name:'mimetype',data:'application/epub+zip'},{name:'META-INF/container.xml',data:'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'}];
  let coverManifest='',coverMeta='',coverPage='',coverSpine='';
  if(state.cover){const ext=state.cover.type==='image/png'?'png':'jpg',bytes=new Uint8Array(await state.cover.arrayBuffer());files.push({name:`OEBPS/images/cover.${ext}`,data:bytes});files.push({name:'OEBPS/cover.xhtml',data:`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>封面</title><style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head><body><img src="images/cover.${ext}" alt="${xml(title)} 封面"/></body></html>`});coverManifest=`<item id="cover-image" href="images/cover.${ext}" media-type="${state.cover.type}" properties="cover-image"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;coverMeta='<meta name="cover" content="cover-image"/>';coverSpine='<itemref idref="cover" linear="no"/>';coverPage='<reference type="cover" title="封面" href="cover.xhtml"/>';}
  chapters.forEach((chapter,i)=>files.push({name:`OEBPS/text/chapter-${i+1}.xhtml`,data:`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/></head><body><h1>${xml(chapter.title)}</h1>${paragraphs(chapter.text)}</body></html>`}));
  files.push({name:'OEBPS/styles/book.css',data:'body{font-family:serif;line-height:1.8;margin:6%;}h1{text-align:center;font-size:1.5em;margin:2em 0;}p{text-indent:2em;margin:.6em 0;}'});
  const navItems=chapters.map((c,i)=>`<li><a href="text/chapter-${i+1}.xhtml">${xml(c.title)}</a></li>`).join('');
  files.push({name:'OEBPS/nav.xhtml',data:`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${navItems}</ol></nav></body></html>`});
  files.push({name:'OEBPS/toc.ncx',data:`<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${xml(title)}</text></docTitle><navMap>${chapters.map((c,i)=>`<navPoint id="nav-${i+1}" playOrder="${i+1}"><navLabel><text>${xml(c.title)}</text></navLabel><content src="text/chapter-${i+1}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`});
  const manifest=chapters.map((_,i)=>`<item id="chapter-${i+1}" href="text/chapter-${i+1}.xhtml" media-type="application/xhtml+xml"/>`).join(''),spine=chapters.map((_,i)=>`<itemref idref="chapter-${i+1}"/>`).join('');
  files.push({name:'OEBPS/content.opf',data:`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${id}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}</meta>${coverMeta}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="styles/book.css" media-type="text/css"/>${coverManifest}${manifest}</manifest><spine toc="ncx">${coverSpine}${spine}</spine><guide>${coverPage}</guide></package>`});
  return { blob: makeZip(files), chapters, title };
}

$('fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
for (const event of ['dragenter','dragover']) $('dropZone').addEventListener(event,(e)=>{e.preventDefault();$('dropZone').classList.add('dragging');});
for (const event of ['dragleave','drop']) $('dropZone').addEventListener(event,(e)=>{e.preventDefault();$('dropZone').classList.remove('dragging');});
$('dropZone').addEventListener('drop',(e)=>loadFile(e.dataTransfer.files[0]));
$('dropZone').addEventListener('keydown',(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click();}});
$('reparseBtn').onclick=renderResult; $('editor').addEventListener('input',updateCount);
$('toggleUnmatched').onclick=()=>{const list=$('unmatchedList'),open=list.hidden;list.hidden=!open;$('toggleUnmatched').setAttribute('aria-expanded',String(open));};
$('downloadTxt').onclick=()=>download(new Blob([$('editor').value],{type:'text/plain;charset=utf-8'}),`${safeName($('bookTitle').value||state.file?.name.replace(/\.jsonl$/i,''))}.txt`);
$('showEpub').onclick=()=>{$('epubSettings').hidden=false;$('epubSettings').scrollIntoView({behavior:'smooth'});};
$('chapterMode').onchange=()=>{$('regexField').hidden=$('chapterMode').value!=='custom';};
$('coverInput').onchange=(e)=>{state.cover=e.target.files[0]||null;$('coverName').textContent=state.cover?state.cover.name:'选择 JPG 或 PNG';};
$('previewChapters').onclick=()=>{try{const chapters=splitChapters($('editor').value);$('chapterSummary').textContent=`识别到 ${chapters.length} 个章节`;$('chapterList').innerHTML=chapters.map(c=>`<li>${xml(c.title)}</li>`).join('');$('chapterList').hidden=false;}catch(e){alert(e.message);}};
$('generateEpub').onclick=async()=>{const btn=$('generateEpub');try{btn.disabled=true;btn.textContent='正在生成…';const result=await buildEpub();download(result.blob,`${safeName(result.title)}.epub`);$('chapterSummary').textContent=`已生成 ${result.chapters.length} 个章节的 EPUB`;}catch(e){alert(e.message);}finally{btn.disabled=false;btn.textContent='生成并下载 EPUB';}};
