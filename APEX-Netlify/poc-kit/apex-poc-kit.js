/* APEX POC Kit Builder — shared state + shell logic (vanilla, no framework) */
(function(){
  const LS_KEY = 'apexPocKit';
  const STEPS = [
    {id:'team',      label:'פרטי נבחרת', page:'index.html'},
    {id:'map',       label:'מפת הזירה',  page:'map.html'},
    {id:'statement', label:'משפט המוצר', page:'statement.html'},
    {id:'criteria',  label:'קריטריונים', page:'criteria.html'},
    {id:'review',    label:'בדיקה והורדה', page:'review.html'}
  ];
  const DEFAULTS = {teamName:'',teamNumber:'',statement:'',criteria:[
    {text:'',type:''},{text:'',type:''},{text:'',type:''}
  ],mapMeta:null,mapCrop:null};

  /* Central final-map configuration (aspect + export size in one place).
     NOTE: physical mm dimensions are not yet defined by APEX — adjust ASPECT/EXPORT_W here when provided. */
  const POC_MAP = { ASPECT: 4/3, EXPORT_W: 1600 };

  /* ---- localStorage text state ---- */
  function get(){
    let raw={}; try{raw=JSON.parse(localStorage.getItem(LS_KEY)||'{}');}catch(e){}
    const s = Object.assign({}, DEFAULTS, raw);
    if(!Array.isArray(s.criteria)||s.criteria.length<3) s.criteria = DEFAULTS.criteria.map(c=>Object.assign({},c));
    return s;
  }
  function save(part){
    const next = Object.assign(get(), part||{});
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    flashSaved();
    return next;
  }

  /* ---- IndexedDB for the map blob ---- */
  function db(){
    return new Promise((res,rej)=>{
      const r = indexedDB.open('apexPocKitDB',1);
      r.onupgradeneeded=()=>{ r.result.createObjectStore('files'); };
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
  }
  async function putMap(blob){ const d=await db(); return new Promise((res,rej)=>{const t=d.transaction('files','readwrite');t.objectStore('files').put(blob,'map');t.oncomplete=res;t.onerror=()=>rej(t.error);}); }
  async function getMap(){ try{const d=await db(); return await new Promise((res,rej)=>{const t=d.transaction('files','readonly');const q=t.objectStore('files').get('map');q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error);});}catch(e){return null;} }
  async function delMap(){ try{const d=await db(); await new Promise((res)=>{const t=d.transaction('files','readwrite');t.objectStore('files').delete('map');t.oncomplete=res;t.onerror=res;});}catch(e){} }

  /* ---- validation / completion ---- */
  function wordCount(str){ return (str||'').trim().split(/\s+/).filter(Boolean).length; }
  function complete(step, s){
    s = s||get();
    switch(step){
      case 'team': return !!(s.teamName.trim() && s.teamNumber.trim());
      case 'map': return !!s.mapMeta;
      case 'statement': { const w=wordCount(s.statement); return w>=1 && w<=20; }
      case 'criteria': return s.criteria.length>=3 && s.criteria.length<=7 &&
        s.criteria.every(c=>c.text.trim() && (c.type==='manual'||c.type==='autonomous'));
      case 'review': return ['team','map','statement','criteria'].every(x=>complete(x,s));
      default: return false;
    }
  }
  // a step is reachable if every earlier step is complete
  function reachable(idx, s){
    for(let i=0;i<idx;i++){ if(!complete(STEPS[i].id,s)) return false; }
    return true;
  }
  function filename(s){ s=s||get(); const n=(s.teamNumber.trim()||'00'); const t=(s.teamName.trim()||'Team').replace(/[\/\\:*?"<>|]+/g,'').replace(/\s+/g,'-'); return `APEX_POC_Team_${n}_${t}.zip`; }

  /* ---- shell rendering ---- */
  function flashSaved(){ const el=document.querySelector('[data-kb-save]'); if(!el) return; el.textContent='נשמר מקומית'; el.style.opacity='1'; clearTimeout(flashSaved._t); flashSaved._t=setTimeout(()=>{el.style.opacity='.55';},1200); }

  function renderShell(currentId){
    const s = get();
    const curIdx = STEPS.findIndex(x=>x.id===currentId);
    // step nav
    const nav = document.querySelector('[data-kb-steps]');
    if(nav){
      nav.innerHTML = STEPS.map((st,i)=>{
        const isCur = st.id===currentId;
        const isDone = complete(st.id,s);
        const canGo = isCur || reachable(i,s) || isDone;
        const cls = ['kb-step']; if(isCur)cls.push('active'); else if(isDone)cls.push('done'); if(!canGo && !isCur)cls.push('locked');
        return canGo && !isCur
          ? `<a class="${cls.join(' ')}" href="${st.page}">${st.label}</a>`
          : `<span class="${cls.join(' ')}" aria-current="${isCur?'step':'false'}">${st.label}</span>`;
      }).join('');
    }
    const mp = document.querySelector('[data-kb-mobile]');
    if(mp) mp.innerHTML = `שלב <b>${curIdx+1}</b> מתוך ${STEPS.length} · ${STEPS[curIdx].label}`;
    // guard: if this step not reachable, bounce to first incomplete
    if(curIdx>0 && !reachable(curIdx,s)){
      const target = STEPS.find((st,i)=> i<curIdx && !complete(st.id,s));
      if(target){ location.replace(target.page); }
    }
  }

  /* ---- start over ---- */
  function startOver(){ localStorage.removeItem(LS_KEY); delMap(); }

  /* ---- minimal text PDF generator (Helvetica) ---- */
  function makePDF(lines){
    // lines: array of {text, size, bold, gap}
    const esc = t => String(t).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
    let y = 780; const parts = [];
    lines.forEach(ln=>{
      const size = ln.size||12; const font = ln.bold?'F2':'F1';
      y -= (ln.gap||0);
      // wrap ~ 92 chars at 11pt
      const max = Math.floor(92*11/size);
      const words = String(ln.text).split(' '); let cur='';
      const rows=[];
      words.forEach(w=>{ if((cur+' '+w).trim().length>max){rows.push(cur);cur=w;} else cur=(cur?cur+' ':'')+w; });
      if(cur)rows.push(cur);
      rows.forEach(r=>{ parts.push(`BT /${font} ${size} Tf 56 ${y} Td (${esc(r)}) Tj ET`); y -= size*1.5; });
    });
    const stream = parts.join('\n');
    const objs = [];
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>');
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    let pdf='%PDF-1.4\n'; const offsets=[];
    objs.forEach((o,i)=>{ offsets.push(pdf.length); pdf+=`${i+1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
    offsets.forEach(o=>{ pdf+=String(o).padStart(10,'0')+' 00000 n \n'; });
    pdf+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf],{type:'application/pdf'});
  }

  window.ApexKit = { STEPS, get, save, putMap, getMap, delMap, wordCount, complete, reachable, filename, renderShell, startOver, makePDF, makeImagePDF, POC_MAP, loadImage, renderFinalPocMap };

  /* ---- shared image helpers ---- */
  function loadImage(src){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=(src instanceof Blob)?URL.createObjectURL(src):src; }); }

  // ONE renderer for BOTH the Map preview and the exported PNG.
  // crop = {zoom, ox, oy}  (ox/oy fractional pan 0..1, 0.5 = centered)
  async function renderFinalPocMap(blob, crop, opts){
    opts = opts||{};
    const img = await loadImage(blob);
    const iw = img.naturalWidth||img.width, ih = img.naturalHeight||img.height;
    const EW = opts.width || POC_MAP.EXPORT_W;
    const EH = Math.round(EW / POC_MAP.ASPECT);
    const c = document.createElement('canvas'); c.width=EW; c.height=EH;
    const x = c.getContext('2d');
    x.fillStyle='#fff'; x.fillRect(0,0,EW,EH);
    const z = (crop&&crop.zoom)||1;
    const cover = Math.max(EW/iw, EH/ih) * z;
    const dw = iw*cover, dh = ih*cover;
    const ox = (crop&&crop.ox!=null)?crop.ox:0.5, oy=(crop&&crop.oy!=null)?crop.oy:0.5;
    const dx = -(ox*(dw-EW)), dy = -(oy*(dh-EH));
    x.drawImage(img, dx, dy, dw, dh);
    // small official logo lockup (APEX + CITY FORWARD) on a restrained charcoal plate, bottom-left
    try{
      const [apex, cf] = await Promise.all([loadImage('brand-apex.png'), loadImage('brand-cityforward.png')]);
      const pad=Math.round(EW*0.012), margin=Math.round(EW*0.02);
      const apexH=Math.round(EH*0.055), apexW=Math.round(apexH*(apex.naturalWidth/apex.naturalHeight));
      const cfH=Math.round(EH*0.055), cfW=Math.round(cfH*(cf.naturalWidth/cf.naturalHeight));
      const gap=Math.round(EW*0.014);
      const px=Math.round(EW*0.02), py=EH-Math.round(EH*0.02)-Math.max(apexH,cfH);
      x.drawImage(apex, px, py+(Math.max(apexH,cfH)-apexH)/2, apexW, apexH);
      x.drawImage(cf, px+apexW+gap, py+(Math.max(apexH,cfH)-cfH)/2, cfW, cfH);
    }catch(e){ /* logos missing — leave map clean */ }
    return c;
  }

  /* ---- JPEG image PDF (single page, DCTDecode) — used for Hebrew documents ---- */
  function makeImagePDF(jpeg, pxW, pxH){
    let W=842, H=Math.round(842*pxH/pxW); if(H>595){ H=595; W=Math.round(595*pxW/pxH); }
    const enc=new TextEncoder(); const chunks=[]; let len=0; const off=[];
    const push=d=>{ const b=(typeof d==='string')?enc.encode(d):d; chunks.push(b); len+=b.length; };
    push('%PDF-1.4\n');
    off[1]=len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    off[2]=len; push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    off[3]=len; push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n');
    const content='q '+W+' 0 0 '+H+' 0 0 cm /Im0 Do Q';
    off[4]=len; push('4 0 obj\n<< /Length '+content.length+' >>\nstream\n'); push(content); push('\nendstream\nendobj\n');
    off[5]=len; push('5 0 obj\n<< /Type /XObject /Subtype /Image /Width '+pxW+' /Height '+pxH+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n'); push(jpeg); push('\nendstream\nendobj\n');
    const xref=len; let x='xref\n0 6\n0000000000 65535 f \n';
    for(let i=1;i<=5;i++){ x+=String(off[i]).padStart(10,'0')+' 00000 n \n'; }
    push(x); push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
    return new Blob(chunks,{type:'application/pdf'});
  }
})();

/* wire up shell utilities present on every page */
document.addEventListener('DOMContentLoaded',function(){
  const modal = document.querySelector('[data-kb-modal]');
  const openers = document.querySelectorAll('[data-kb-startover]');
  openers.forEach(b=>b.addEventListener('click',()=>modal&&modal.classList.add('show')));
  if(modal){
    modal.querySelector('[data-kb-cancel]').addEventListener('click',()=>modal.classList.remove('show'));
    modal.querySelector('[data-kb-confirm]').addEventListener('click',()=>{ ApexKit.startOver(); location.href='index.html'; });
    modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('show'); });
  }
});
