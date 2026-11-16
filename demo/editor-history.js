(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CmsEditorHistory=api;})(typeof window!=='undefined'?window:globalThis,function(){
  const names=['魏磊','尚杰','十七'];
  const keys=['shootCount','editCount','sentToOpsCount','inventorySnapshot'];
  function checkDate(date,today){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||Number.isNaN(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>today)throw Error('业务日期无效，且不能晚于今天');}
  function apply(records,input,{editor,today,id,now}){
    if(!names.includes(editor))throw Error('请先选择拍剪师');
    checkDate(input.businessDate,today);
    if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>20)throw Error('每次填写1至20个人设');
    const lines=input.lines.map(line=>{
      const personaName=String(line.personaName||'').trim(),note=String(line.note||'').trim();
      if(!personaName||personaName.length>128||note.length>500)throw Error('请核对人设和备注长度');
      const result={personaName,note};
      for(const key of keys){if(!/^\d{1,7}$/.test(String(line[key])))throw Error('数量须为0至9999999的整数');result[key]=Number(line[key]);}
      return result;
    });
    if(new Set(lines.map(line=>line.personaName)).size!==lines.length)throw Error('同一日期的人设不能重复');
    const existing=input.id?records.find(record=>record.id===input.id):null;
    if(input.id&&(!existing||existing.editorName!==editor))throw Error('记录不存在或不属于当前拍剪师');
    if(existing&&existing.version!==input.version)throw Error('记录已更新，请重新打开后修改');
    if(records.some(record=>record.id!==input.id&&record.editorName===editor&&record.businessDate===input.businessDate))throw Error('该日已有日报，请到历史填报管理中修改，避免重复登记');
    const reason=String(input.reason||'').trim();
    if(existing&&(!reason||reason.length>300))throw Error('修改历史记录需填写300字以内的修改原因');
    const before=existing?{businessDate:existing.businessDate,lines:existing.lines}:null;
    const record={id:existing?.id||id,editorName:editor,businessDate:input.businessDate,lines,version:(existing?.version||0)+1,createdAt:existing?.createdAt||now,updatedAt:now,sample:existing?.sample||false,history:[...(existing?.history||[]),{at:now,actor:editor,action:existing?'correct':'create',reason:existing?reason:'新增日报',before,after:{businessDate:input.businessDate,lines}}]};
    return [...records.filter(item=>item.id!==record.id),record];
  }
  function seed(editors,today){return names.flatMap((name,index)=>[0,1,2].map(offset=>{
    const date=new Date(Date.parse(today+'T00:00:00Z')-offset*86400000).toISOString().slice(0,10);
    const original=editors.filter(row=>row.editorName===name);
    const lines=original.map(row=>({personaName:row.personaName,shootCount:offset?index+1:row.shootCount,editCount:offset?1:row.editCount,sentToOpsCount:offset?1:row.sentToOpsCount,inventorySnapshot:row.inventorySnapshot,note:'虚构演练样本'}));
    return {id:'editor-history-'+index+'-'+date,editorName:name,businessDate:date,lines,version:1,createdAt:date+'T03:30:00Z',updatedAt:date+'T03:30:00Z',sample:true,history:[]};
  }));}
  return {names,keys,apply,seed};
});
