export const editorNames = ['魏磊','尚杰','十七'] as const;
export type ProductionRow = {id:string;businessDate:string} & Record<string,unknown>;
export function productionGroups(rows:ProductionRow[],by:'editor'|'persona') {
  const groups=new Map<string,ProductionRow[]>();
  for(const row of rows){const name=String(by==='editor'?row.editorName||'历史未归类':row.personaName||'未命名人设');groups.set(name,[...(groups.get(name)??[]),row]);}
  return [...groups].sort(([a],[b])=>by==='editor'?(editorNames.indexOf(a as typeof editorNames[number])+1||99)-(editorNames.indexOf(b as typeof editorNames[number])+1||99):a.localeCompare(b,'zh-CN')).map(([name,records])=>{
    const snapshots=new Map<string,ProductionRow>();
    for(const row of records){const key=JSON.stringify([row.editorName??row.userId??row.id,row.personaName]);const previous=snapshots.get(key);if(!previous||`${row.businessDate}${row.updatedAt??''}`>=`${previous.businessDate}${previous.updatedAt??''}`)snapshots.set(key,row);}
    const sum=(key:string,list=records)=>list.every(r=>r[key]!=null)?list.reduce((total,row)=>total+Number(row[key]),0):null;
    return {name,records,shoot:sum('shootCount'),edit:sum('editCount'),sent:sum('sentToOpsCount'),inventory:sum('inventorySnapshot',[...snapshots.values()])};
  });
}
