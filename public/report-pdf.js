import {fmtDate} from './report-data.js';
import {downloadFile} from './download.js';
export {downloadFile};

const ink=[0.09,0.18,0.16], muted=[0.27,0.33,0.31], rule=[0.82,0.86,0.84], pale=[0.93,0.96,0.94];
const fileName=s=>String(s).replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,100);
async function loadPhoto(url) {
  const resp=await fetch(url);
  if(!resp.ok)throw new Error('Gambar tidak tersedia.');
  return jpegPreview(await resp.blob());
}
async function jpegPreview(blob){
  const src=URL.createObjectURL(blob);
  try{
    const img=new Image();img.src=src;await img.decode();
    const scale=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight)), canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.83);
  }finally{URL.revokeObjectURL(src);}
}
export async function renderPDF(doc,fileUrl) {
  if(doc.requirePhotos&&(doc.missingPhotos||!doc.photos.length))throw new Error('Gambar penghantaran dan gambar setiap lot diperlukan untuk mengeluarkan borang.');
  const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
  const pdf=await PDFDocument.create(), regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(doc.title+' · '+doc.ref);pdf.setAuthor('Ariffin Jewels');
  const landscape=doc.tables.some(t=>t.cols.length>=7), [width,height]=landscape?[841.89,595.28]:[595.28,841.89];
  const left=35, usable=width-left*2, bottom=42;
  let page, y;
  const color=c=>rgb(...c);
  const canEncode=(str,font)=>{try{font.encodeText(str);return true;}catch{return false;}};
  const textCanvas=document.createElement('canvas'), measureCtx=textCanvas.getContext('2d');
  const cssFont=(font,size)=>(font===bold?'bold ':'')+size+'px Arial, sans-serif';
  function widthOf(str,font,size){
    if(canEncode(str,font))return font.widthOfTextAtSize(str,size);
    measureCtx.font=cssFont(font,size);return measureCtx.measureText(str).width;
  }
  async function draw(str,x,baseline,size=9,font=regular,c=ink){
    str=String(str??'—').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
    if(!str)return;
    if(canEncode(str,font)){page.drawText(str,{x,y:baseline,font,size,color:color(c)});return;}
    // Use browser font fallback for names and symbols absent from the PDF base fonts.
    const canvas=document.createElement('canvas'),scale=3;
    canvas.width=Math.ceil((widthOf(str,font,size)+3)*scale);canvas.height=Math.ceil(size*1.7*scale);
    const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.font=cssFont(font,size);ctx.fillStyle='rgb('+c.map(n=>Math.round(n*255)).join(',')+')';
    ctx.fillText(str,0,size*1.23);const img=await pdf.embedPng(canvas.toDataURL('image/png'));
    page.drawImage(img,{x,y:baseline-(canvas.height/scale-size*1.23),width:canvas.width/scale,height:canvas.height/scale});
  }
  function wrap(value,width,font,size) {
    const lines=[];
    for(const paragraph of String(value??'—').split(/\r?\n/)){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        const joined=line?line+' '+word:word;
        if(widthOf(joined,font,size)<=width){line=joined;continue;}
        if(line)lines.push(line);
        line='';
        for(const ch of word){if(line&&widthOf(line+ch,font,size)>width){lines.push(line);line='';}line+=ch;}
      }
      lines.push(line);
    }
    return lines;
  }
  async function newPage(){
    page=pdf.addPage([width,height]); y=height-36;
    await draw('ARIFFIN JEWELS',left,y,12,bold);
    const mark=doc.demo?'CONTOH  /  RUANG LATIHAN':String(doc.ref);await draw(mark,width-left-widthOf(mark,bold,8),y,8,bold,muted);
    y-=12;page.drawLine({start:{x:left,y},end:{x:width-left,y},color:color(rule),thickness:1});y-=23;
  }
  const space=async amount=>{if(y-amount<bottom)await newPage();};
  async function paragraph(value,{size=10,font=regular,c=ink,gap=8}={}){
    for(const line of wrap(value,usable,font,size)){await space(size+5);await draw(line,left,y,size,font,c);y-=size+4;}
    y-=gap;
  }
  async function pair(label,value,emphasis=false){
    const keyWidth=Math.min(165,usable*0.35),font=emphasis?bold:regular,size=10;
    const keys=wrap(label,keyWidth-12,regular,size),values=wrap(value,usable-keyWidth,font,size);
    const count=Math.max(keys.length,values.length);await space(Math.min(38,count*14+4));
    for(let index=0;index<count;index++){await space(14);await draw(keys[index]||'',left,y,size,regular,muted);await draw(values[index]||'',left+keyWidth,y,size,font);y-=14;}
    y-=4;
  }
  await newPage();await paragraph(doc.title,{size:21,font:bold,gap:4});
  await paragraph(String(doc.ref)+'   /   '+fmtDate(doc.date),{size:10,c:muted,gap:12});
  for(const [k,v] of doc.meta)await pair(k,v);
  for(const t of doc.tables){
    if(t.title){await space(62);await paragraph(t.title,{size:12,font:bold,gap:4});}
    const n=t.cols.length, fontSize=n>=7?8.4:9;
    const samples=[t.cols,...t.rows.slice(0,100)];
    const demand=t.cols.map((_,j)=>{
      const widest=Math.max(...samples.map(row=>widthOf(String(row[j]||''),regular,fontSize)+12));
      return Math.max(45,Math.min(180,widest));
    });
    const total=demand.reduce((a,b)=>a+b,0), widths=demand.map(w=>usable*w/total);
    const rowLines=(row,font)=>row.map((v,j)=>wrap(v,widths[j]-10,font,fontSize));
    const lineHeight=fontSize+3;
    async function drawPart(lines,count,offset,header) {
      const h=count*lineHeight+9;
      if(header)page.drawRectangle({x:left,y:y-h+2,width:usable,height:h,color:color(pale)});
      let x=left;
      for(let j=0;j<n;j++){
        for(let k=0;k<count;k++)await draw(lines[j][offset+k]||'',x+5,y-fontSize-k*lineHeight,fontSize,header?bold:regular);
        x+=widths[j];
      }
      y-=h;page.drawLine({start:{x:left,y:y+2},end:{x:left+usable,y:y+2},color:color(rule),thickness:0.5});
    }
    const heads=rowLines(t.cols,bold),headCount=Math.max(...heads.map(a=>a.length));
    const head=()=>drawPart(heads,headCount,0,true);
    await space((headCount+1)*lineHeight+20);await head();
    for(const row of t.rows){
      const lines=rowLines(row,regular),count=Math.max(...lines.map(a=>a.length));
      if(y-bottom<count*lineHeight+9 && count*lineHeight+9<height-140){await newPage();await head();}
      let offset=0;
      while(offset<count){
        let room=Math.floor((y-bottom-9)/lineHeight);
        if(room<1){await newPage();await head();room=Math.floor((y-bottom-9)/lineHeight);}
        const take=Math.min(room,count-offset);await drawPart(lines,take,offset,false);offset+=take;
      }
    }
    if(!t.rows.length){y-=12;await paragraph('Tiada rekod dalam tempoh ini.',{size:9,c:muted});}
    y-=15;
  }
  for(const [k,v] of doc.totals)await pair(k,v,true);
  if(doc.note)await paragraph(doc.note,{size:9,c:muted});
  if(doc.files.length){await space(45);await paragraph('Lampiran rekod',{size:12,font:bold});for(const f of doc.files)await paragraph(f.label+'  ·  '+f.id,{size:9,gap:4});}
  for(const pic of doc.photos){
    await space(155);
    try{
      const image=await pdf.embedJpg(await loadPhoto(fileUrl(pic.id)));
      const scale=Math.min(1,(usable-4)/image.width,115/image.height);
      page.drawImage(image,{x:left,y:y-image.height*scale,width:image.width*scale,height:image.height*scale});y-=image.height*scale+12;
      await paragraph(pic.caption,{size:9,gap:7,c:muted});
    }catch{
      if(doc.requirePhotos)throw new Error('Gambar wajib tidak dapat dimuatkan: '+pic.caption+'. Cuba lagi.');
      await paragraph(pic.caption+' · Gambar tidak dapat dimuatkan ('+pic.id+')',{size:9,c:muted});
    }
  }
  const pages=pdf.getPages();
  for(let n=0;n<pages.length;n++){page=pages[n];const label=(n+1)+' / '+pages.length;await draw(label,width-left-widthOf(label,regular,8),22,8,regular,muted);await draw(doc.demo?'Contoh · Ariffin Jewels':'Ariffin Jewels',left,22,8,regular,muted);}
  // Preserve the uploaded originals, including signatures. Copied pages are for reading/printing.
  const attachments=new Map(doc.files.map(f=>[f.id,f]));
  for(const f of attachments.values()){
    const response=await fetch(fileUrl(f.id));
    if(!response.ok)throw new Error('Lampiran tidak dapat dimuatkan: '+f.label+'. Cuba lagi.');
    const blob=await response.blob(), bytes=new Uint8Array(await blob.arrayBuffer());
    const isPDF=String.fromCharCode(...bytes.subarray(0,5))==='%PDF-';
    const extension=isPDF?'pdf':({'image/jpeg':'jpg','image/webp':'webp','image/png':'png'}[blob.type]);
    if(!extension||!bytes.length)throw new Error('Format lampiran tidak dikenali: '+f.label);
    await pdf.attach(bytes,fileName(f.label)+'-'+fileName(f.id)+'.'+extension,{mimeType:isPDF?'application/pdf':blob.type,description:f.label});
    if(isPDF){
      const original=await PDFDocument.load(bytes,{ignoreEncryption:true});
      if(!original.isEncrypted){
        const copies=await pdf.copyPages(original,original.getPageIndices());
        for(const copied of copies)pdf.addPage(copied);
      }
    }else{
      const preview=await pdf.embedJpg(await jpegPreview(blob));
      await newPage();await paragraph(f.label,{size:14,font:bold});
      const scale=Math.min(usable/preview.width,(y-bottom)/preview.height);
      page.drawImage(preview,{x:left,y:y-preview.height*scale,width:preview.width*scale,height:preview.height*scale});
    }
  }
  return pdf.save();
}
export const pdfFilename=doc=>(doc.demo?'CONTOH-':'')+fileName(doc.title)+'-'+fileName(doc.ref)+'.pdf';
export async function downloadPDF(doc,fileUrl){
  const bytes=await renderPDF(doc,fileUrl);
  downloadFile(new Blob([bytes],{type:'application/pdf'}),pdfFilename(doc));
}
