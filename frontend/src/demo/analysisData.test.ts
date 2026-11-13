import {describe,expect,it} from 'vitest';
import {editorAnalysis} from './editorAnalysisData';
import {leadAnalysis} from './leadAnalysisData';
import type {ProductionRow} from '../productionGroups';
import type {Lead,LeadReport} from '../leadApi';

const range={from:'2026-11-11',to:'2026-11-12'},none={editor:'',persona:''};
const row=(id:string,date:string,editorName:string,personaName:string,inventorySnapshot:number|null,extra:object={}):ProductionRow=>({id,businessDate:date,editorName,personaName,inventorySnapshot,shootCount:2,editCount:1,sentToOpsCount:1,...extra});
describe('拍剪期间流量与截止库存分别统计',()=>{
  const rows=[row('old','2026-11-10','魏磊','A',8),row('1','2026-11-11','魏磊','A',5),row('2','2026-11-12','魏磊','A',4),row('3','2026-11-10','尚杰','B',3),row('future','2026-11-13','魏磊','A',999)];
  it('产出按期间累加，库存逐师逐人设取最近快照并保留区间前有效快照',()=>{
    const view=editorAnalysis(rows,range,none,'editor');
    expect(view.summary).toMatchObject({shoot:4,edit:2,sent:2,inventory:7,snapshotDates:['2026-11-10','2026-11-12']});
    expect(view.groups.find(g=>g.name==='尚杰')).toMatchObject({shoot:null,inventory:3,records:0});
    expect(view.series.inventory.points.map(p=>p.value)).toEqual(['8','7']);
    expect(view.series.inventory.points[1].native).toContain('2026-11-10');expect(view.series.inventory.points[1].native).toContain('沿用快照');
    expect(view.series.shoot.points.map(p=>p.value)).toEqual(['2','2']);
    expect(view.groups.reduce((n,g)=>n+(g.inventory||0),0)).toBe(view.summary.inventory);
  });
  it('按人设分类和人员筛选不绑定一师一人设，分组总量与汇总相等',()=>{
    const view=editorAnalysis([...rows,row('4','2026-11-12','魏磊','B',6)],range,{editor:'魏磊',persona:''},'persona');
    expect(view.summary).toMatchObject({shoot:6,inventory:10});expect(view.groups.map(g=>g.name).sort()).toEqual(['A','B']);
    expect(view.groups.reduce((n,g)=>n+(g.shoot||0),0)).toBe(6);
  });
  it('缺字段不当零；晚出现的库存组合不回填历史；明确零保留',()=>{
    const view=editorAnalysis([row('1','2026-11-11','魏磊','A',0,{editCount:0}),row('2','2026-11-12','尚杰','A',null,{editCount:null})],range,none,'editor');
    expect(view.summary.edit).toBeNull();expect(view.summary.inventory).toBeNull();
    expect(view.series.inventory.points.map(p=>p.value)).toEqual([null,null]);
    expect(view.series.edit.points.map(p=>p.value)).toEqual(['0',null]);
    expect(editorAnalysis([],range,none,'editor').summary).toMatchObject({shoot:null,inventory:null});
  });
  it('历史未归类账号保持独立库存，不冒认给当前三位老师',()=>{
    const view=editorAnalysis([row('a','2026-11-11','','A',2,{userId:'old-1'}),row('b','2026-11-12','','A',3,{userId:'old-2'})],range,{editor:'legacy',persona:''},'editor');
    expect(view.summary.inventory).toBe(5);expect(view.groups[0].name).toBe('历史未归类');
  });
});

const lead=(id:string,date:string,extra:object={}):Lead=>({id,receivedOn:date,accountId:'a',teamId:'t',teamName:'一组',wechatId:'MS-A',pageName:'主页A',operatorName:'甲',channel:'ms',qualifiedOn:null,voidedAt:null,...extra}) as Lead;
const report=(date:string,count:number):LeadReport=>({accountId:'a',pageName:'主页A',businessDate:date,msToday:count,wsToday:0,addedCount:count});
describe('线索排名和逐日趋势同源',()=>{
  it('无效保留、作废剔除；当日明确需求与后续明确分开，月累计不参与日趋势',()=>{
    const rows=[lead('1',range.from,{qualifiedOn:range.from}),lead('2',range.from,{qualifiedOn:range.to}),lead('3',range.from,{invalidReason:'垃圾线索'}),lead('void',range.from,{voidedAt:'x'})];
    const view=leadAnalysis(rows,[report(range.from,3),report(range.to,0)],range,range.to,'team');
    expect(view.groups[0].stats).toMatchObject({received:3,sameDay:1,sameDayRate:33.3});
    expect(view.series[0].points.map(p=>p.value)).toEqual(['3','0']);expect(view.series[1].points.map(p=>p.value)).toEqual(['1','0']);
  });
  it('缺报保留断点，日报与明细不齐时不画部分数据冒充完整值',()=>{
    const view=leadAnalysis([lead('1',range.to)],[report(range.to,2)],range,range.to,'account');
    expect(view.series[0].points.map(p=>p.value)).toEqual([null,null]);expect(view.series[0].points[1].reason).toBe('日报明细待对齐');
  });
  it('聚焦个人仍按全量明细核对日报，趋势显示所选子集，不误报缺明细',()=>{
    const rows=[lead('1',range.to,{qualifiedOn:range.to}),lead('2',range.to,{operatorName:'乙'})];
    const view=leadAnalysis([rows[0]],[report(range.to,2)],range,range.to,'account',rows);
    expect(view.series[0].points[1].value).toBe('1');expect(view.series[1].points[1].value).toBe('1');
  });
  it('长范围仅画末31天，分类汇总仍覆盖整个所选区间',()=>{
    const view=leadAnalysis([lead('1','2026-10-01'),lead('2',range.to,{accountId:'b',wechatId:'WS-B'})],[],{from:'2026-10-01',to:range.to},range.to,'account');
    expect(view.series[0].points).toHaveLength(31);expect(view.groups.reduce((n,g)=>n+g.stats.received,0)).toBe(2);expect(view.from).toBe('2026-10-13');
  });
});
