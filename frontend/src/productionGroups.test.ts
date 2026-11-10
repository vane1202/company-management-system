import {expect,it} from 'vitest';
import {productionGroups,type ProductionRow} from './productionGroups';
const row=(id:string,date:string,editorName:string,personaName:string,inventorySnapshot:number):ProductionRow=>({id,businessDate:date,editorName,personaName,inventorySnapshot,shootCount:1,editCount:2,sentToOpsCount:1});
it('同一拍剪师可负责多个人设；库存逐师逐人设取末次，拍摄按天累加',()=>{
 const rows=[row('1','2026-11-01','魏磊','A',8),row('2','2026-11-02','魏磊','A',5),row('3','2026-11-02','魏磊','B',3),row('4','2026-11-02','尚杰','A',7)];
 expect(productionGroups(rows,'editor').find(g=>g.name==='魏磊')).toMatchObject({inventory:8,shoot:3,edit:6,sent:3});
 expect(productionGroups(rows,'persona').find(g=>g.name==='A')).toMatchObject({inventory:12,shoot:3});
});
it('未知历史人员不冒认给三位老师，未记录的剪辑数保留未知',()=>{
 const rows=[{...row('1','2026-11-01','','A',6),editorName:null,userId:'old-a',editCount:null},{...row('2','2026-11-01','','A',4),editorName:null,userId:'old-b',editCount:null}];
 expect(productionGroups(rows,'editor')[0]).toMatchObject({name:'历史未归类',inventory:10,edit:null});
});
