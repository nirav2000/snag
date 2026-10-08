// Snag's dependency-free XLSX generator. Data stays in the browser; links open the authenticated app.
const encoder=new TextEncoder();
const xml=v=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const cell=(ref,value,style=0)=>{
  const prefix='<c r="'+ref+'" s="'+style+'"';
  if(value&&typeof value==='object'&&Object.hasOwn(value,'formula'))return prefix+'><f>'+xml(value.formula)+'</f><v>'+Number(value.cached||0)+'</v></c>';
  return prefix+' t="inlineStr"><is><t xml:space="preserve">'+xml(value??'')+'</t></is></c>';
};
const alphabet=n=>{let t='';for(let k=n+1;k;k=Math.floor((k-1)/26))t=String.fromCharCode(65+(k-1)%26)+t;return t};
const row=(n,values,{style=0,height}={})=>'<row r="'+n+'"'+(height?' ht="'+height+'" customHeight="1"':'')+'>'+values.map((v,i)=>cell(alphabet(i)+n,v,style)).join('')+'</row>';
const dimensions=widths=>'<cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols>';
const heading=(n,values)=>row(n,values,{style:1,height:30});
const linkCell=(ref,label)=>cell(ref,label,2);
const rel=(id,target,type,external=false)=>'<Relationship Id="rId'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+type+'" Target="'+xml(target)+'"'+(external?' TargetMode="External"':'')+'/>';
const worksheet=(widths,rows,links=[],drawingId=0,merge='')=>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
  '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="17"/>'+
  dimensions(widths)+'<sheetData>'+rows.join('')+'</sheetData>'+
  (merge?'<mergeCells count="1"><mergeCell ref="'+merge+'"/></mergeCells>':'')+
  (links.length?'<hyperlinks>'+links.map((l,i)=>'<hyperlink ref="'+l.ref+'" r:id="rId'+(i+1)+'" tooltip="Open in Snag (authorised access required)"/>').join('')+'</hyperlinks>':'')+
  (drawingId?'<drawing r:id="rId'+drawingId+'"/>':'')+
  '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.25" footer="0.25"/></worksheet>';
const rights='Links require an authorised Snag account and permission for each snag. Downloaded photographs cannot be revoked.';
export function listEvidence(snag){
  const result=[];
  const add=(items,source,marker)=>{(items||[]).forEach((media,index)=>result.push({media,source,marker:marker+':'+index}))};
  add(snag.media,'Original report','root');
  for(const u of snag.updates||[])add(u.media,'Update '+(u.createdAt||''),'update:'+u.id);
  return result;
}
export function snagLink(base,projectId,snagId,inviteId='',asset=''){
  const u=new URL(base);
  u.search='';
  u.hash='';
  u.searchParams.set('project',projectId);
  if(inviteId)u.searchParams.set('invite',inviteId);
  u.searchParams.set('snag',snagId);
  if(asset)u.searchParams.set('asset',asset);
  return u.toString();
}
function safeFileName(v){return String(v||'project').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,64)||'project'}
function status(v){return ({open:'Open','in-progress':'In progress',review:'Needs review',resolved:'Resolved'})[v]||String(v||'Open')}
function isoDate(v){const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toISOString().slice(0,10):''}
function mediaType(m){const type=String(m?.type||'');return type.startsWith('image/')?'Photograph':type.startsWith('video/')?'Video':type.startsWith('audio/')?'Audio':'Attachment'}
function bodyHeader(){return '<row r="1" ht="35" customHeight="1">'+cell('A1','SNAG · PROPERTY REPORT',3)+'</row>'}
function bodySub(title){return '<row r="2">'+cell('A2',title,4)+'</row>'}
function buildSummary(project,snags,generated){
  const n=Math.max(5,4+snags.length),range="'Snags'!$G$5:$G$"+n;
  const values=['Open','In progress','Needs review','Resolved'];
  const rows=[bodyHeader(),bodySub(String(project.name||'Project')+' · '+generated),row(4,['OVERVIEW','COUNT'],{style:1})];
  rows.push(row(5,['Total snags',{formula:"COUNTA('Snags'!$A$5:$A$"+n+')',cached:snags.length}]));
  values.forEach((name,i)=>rows.push(row(i+6,[name,{formula:'COUNTIF('+range+',"'+name+'")',cached:snags.filter(s=>status(s.status)===name).length}])));
  rows.push(row(12,['NOTES'],{style:1}));
  rows.push(row(13,[rights],{height:38}));
  rows.push(row(15,['Evidence links open the live record, where photographs, videos, notes and status can be inspected.'],{height:32}));
  return worksheet([98,22],rows,[],0,'A1:B1');
}
const drawingHeader='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
function photoAnchor(id,rowNumber){
  const cx=116*9525,cy=72*9525;
  return '<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>38000</xdr:colOff><xdr:row>'+(rowNumber-1)+'</xdr:row><xdr:rowOff>18000</xdr:rowOff></xdr:from>'+
  '<xdr:ext cx="'+cx+'" cy="'+cy+'"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+id+'" name="Snag photo '+id+'"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'+
  '<xdr:blipFill><a:blip r:embed="rId'+id+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
}
function buildSnags(project,snags,base,inviteId,previews){
  const labels=['Reference','Photograph','Title','Description','Area / room','Priority','Status','Assigned to','Recorded','Updated','Acceptance check','Evidence','Open in Snag'];
  const rows=[bodyHeader(),bodySub(String(project.name||'Project')+' · '+snags.length+' snags'),heading(4,labels)];
  const links=[],pictures=[];
  for(let i=0;i<snags.length;i++){
    const s=snags[i],n=i+5,assets=listEvidence(s),url=snagLink(base,project.id,s.id,inviteId);
    const values=[s.ref||s.id,'',s.title||'',s.description||'',s.location||'',s.priority||'',status(s.status),s.assignee||'',isoDate(s.createdAt),isoDate(s.updatedAt),s.outcome||'',assets.length,'Open snag'];
    // Hyperlinks use relationships, never spreadsheet formulas assembled from user input.
    const cells=values.map((v,j)=>j===12?linkCell('M'+n,v):cell(alphabet(j)+n,v,j===5||j===6?5:0));
    rows.push('<row r="'+n+'" ht="78" customHeight="1">'+cells.join('')+'</row>');
    links.push({ref:'M'+n,url});
    const p=previews?.[s.id];
    if(p instanceof Uint8Array&&p.length){pictures.push({row:n,bytes:p})}
  }
  const drawingId=pictures.length?links.length+1:0;
  const content=worksheet([18,22,42,65,25,16,21,23,17,17,58,13,21],rows,links,drawingId);
  return{content,links,pictures};
}
function buildEvidence(project,snags,base,inviteId){
  const rows=[bodyHeader(),bodySub(String(project.name||'Project')+' · photo, video, audio and other attachments'),heading(4,['Snag','Type','File / asset','Attached to','Open asset','Snag title'])];
  const links=[];let r=5;
  for(const s of snags)for(const asset of listEvidence(s)){
    const m=asset.media||{},name=m.name||m.key?.split('/').pop()||m.type||'Asset';
    const cells=[s.ref||s.id,mediaType(m),name,asset.source,'Open in Snag',s.title||''].map((v,j)=>j===4?linkCell('E'+r,v):cell(alphabet(j)+r,v));
    rows.push('<row r="'+r+'" ht="27" customHeight="1">'+cells.join('')+'</row>');
    links.push({ref:'E'+r,url:snagLink(base,project.id,s.id,inviteId,asset.marker)});r++;
  }
  if(r===5)rows.push(row(5,['No evidence attached']));
  return{content:worksheet([18,20,52,36,25,48],rows,links),links};
}
function relationships(list,drawingId){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    list.map((l,i)=>rel(i+1,l.url,'hyperlink',true)).join('')+
    (drawingId?rel(drawingId,'../drawings/drawing1.xml','drawing'):'')+'</Relationships>';
}
const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/></font><font><u/><color rgb="FF1261A0"/><sz val="11"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="18"/></font><font><color rgb="FF476277"/><sz val="11"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const utf8=s=>encoder.encode(s);
function crc32(bytes){
  let crc=-1;
  for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^(crc&1?0xEDB88320:0)}
  return(crc^-1)>>>0;
}
function zip(entries){
  const local=[],central=[];let offset=0;
  const u16=(view,o,v)=>view.setUint16(o,v,true),u32=(view,o,v)=>view.setUint32(o,v>>>0,true);
  for(const [path,value] of entries){
    const name=utf8(path),bytes=typeof value==='string'?utf8(value):value,crc=crc32(bytes);
    const h=new Uint8Array(30+name.length),v=new DataView(h.buffer);
    u32(v,0,0x04034b50);u16(v,4,20);u16(v,6,0x0800);u16(v,8,0);u32(v,14,crc);u32(v,18,bytes.length);u32(v,22,bytes.length);u16(v,26,name.length);h.set(name,30);
    local.push(h,bytes);
    const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);
    u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);u16(cv,10,0);u32(cv,16,crc);u32(cv,20,bytes.length);u32(cv,24,bytes.length);u16(cv,28,name.length);u32(cv,42,offset);c.set(name,46);
    central.push(c);offset+=h.length+bytes.length;
  }
  const cdSize=central.reduce((n,b)=>n+b.length,0);
  const end=new Uint8Array(22),v=new DataView(end.buffer);
  u32(v,0,0x06054b50);u16(v,8,entries.length);u16(v,10,entries.length);u32(v,12,cdSize);u32(v,16,offset);
  return new Blob([...local,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
/** Generate a self-contained Excel workbook with photographs and authenticated Snag links.
 * previews maps snag id -> JPEG Uint8Array. No URL tokens or private R2 keys are exported.
 */
export function createSnagWorkbook({project,snags,base,inviteId='',previews={},generatedAt=new Date().toISOString()}){
  if(!project?.id||!Array.isArray(snags)||!/^https:\/\//.test(String(base)))throw new Error('Invalid export options');
  if(snags.length>65000)throw new Error('Export limited to 65,000 snags per workbook');
  const main=buildSnags(project,snags,base,inviteId,previews),evidence=buildEvidence(project,snags,base,inviteId),hasImages=main.pictures.length>0;
  const files=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+(hasImages?'<Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>':'')+'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rel(1,'xl/workbook.xml','officeDocument')+'</Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Snags" sheetId="2" r:id="rId2"/><sheet name="Evidence" sheetId="3" r:id="rId3"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rel(1,'worksheets/sheet1.xml','worksheet')+rel(2,'worksheets/sheet2.xml','worksheet')+rel(3,'worksheets/sheet3.xml','worksheet')+rel(4,'styles.xml','styles')+'</Relationships>'],
    ['xl/styles.xml',styles],
    ['xl/worksheets/sheet1.xml',buildSummary(project,snags,generatedAt)],
    ['xl/worksheets/sheet2.xml',main.content],
    ['xl/worksheets/sheet3.xml',evidence.content],
    ['xl/worksheets/_rels/sheet2.xml.rels',relationships(main.links,hasImages?main.links.length+1:0)],
    ...(evidence.links.length?[['xl/worksheets/_rels/sheet3.xml.rels',relationships(evidence.links,0)]]:[])
  ];
  if(hasImages){
    files.push(['xl/drawings/drawing1.xml',drawingHeader+main.pictures.map((p,i)=>photoAnchor(i+1,p.row)).join('')+'</xdr:wsDr>']);
    files.push(['xl/drawings/_rels/drawing1.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+main.pictures.map((p,i)=>rel(i+1,'../media/snag-'+(i+1)+'.jpg','image')).join('')+'</Relationships>']);
    main.pictures.forEach((p,i)=>files.push(['xl/media/snag-'+(i+1)+'.jpg',p.bytes]));
  }
  return{blob:zip(files),filename:'snag-'+safeFileName(project.name)+'-'+generatedAt.slice(0,10)+'.xlsx',snagCount:snags.length,photoCount:main.pictures.length,evidenceCount:evidence.links.length};
}
