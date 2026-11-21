import {describe,expect,it} from 'vitest';
import {editorAnalysis} from './editorAnalysisData';
import {leadAnalysis,selectAnalysisLeads} from './leadAnalysisData';
import type {ProductionRow} from '../productionGroups';
import type {Lead,LeadReport} from '../leadApi';

const range={from:'2026-11-11',to:'2026-11-12'},none={editor:'',persona:''};
const row=(id:string,date:string,editorName:string,personaName:string,inventorySnapshot:number|null,extra:object={}):ProductionRow=>({id,businessDate:date,editorName,personaName,inventorySnapshot,shootCount:2,editCount:1,sentToOpsCount:1,...extra});
describe('拍剪期间流量与截止库存分别统计',()=>{
  const rows=[row('old','2026-11-10','魏磊','A',8),row('1','2026-11-11','魏磊','A',5),row('2','2026-11-12','魏磊','A',4),row('3','2026-11-10','尚杰','B',3),row('future','2026-11-13','魏磊','A',999)];
  it('产出按期间累加，库存只取最近填报日当天的屯量',()=>{
    const view=editorAnalysis(rows,range,none,'editor');
    expect(view.summary).toMatchObject({shoot:4,edit:2,sent:2,inventory:4,snapshotDates:['2026-11-12']});
    expect(view.groups.find(g=>g.name==='尚杰')).toMatchObject({shoot:null,inventory:null,records:0});
    expect(view.series.inventory.points.map(p=>p.value)).toEqual(['5','4']);
    expect(view.series.inventory.points[1].native).toContain('2026-11-12');
    expect(view.series.shoot.points.map(p=>p.value)).toEqual(['2','2']);
    expect(view.groups.find(g=>g.name==='魏磊')?.inventory).toBe(view.summary.inventory);
  });
  it('11月20日只加当天三列屯量，不把更早人设算进实时库存',()=>{
    const sheet=[
      row('1','2026-11-12','尚杰','小雪',4),row('2','2026-11-03','尚杰','涵则',1),row('3','2026-11-03','尚杰','糖糖',4),
      row('4','2026-11-20','尚杰','主播文强',4),row('5','2026-11-20','尚杰','伟哥',2),
      row('6','2026-11-20','魏磊','圆哥',4),row('7','2026-11-20','魏磊','文强',1),
      row('8','2026-11-20','十七','甜甜',1),row('9','2026-11-20','十七','秋菊',1)
    ];
    const view=editorAnalysis(sheet,{from:'2026-11-01',to:'2026-11-21'},none,'editor');
    expect(view.summary.inventory).toBe(13);
    expect(view.groups.find(g=>g.name==='尚杰')?.inventory).toBe(6);
    expect(view.groups.find(g=>g.name==='魏磊')?.inventory).toBe(5);
    expect(view.groups.find(g=>g.name==='十七')?.inventory).toBe(2);
  });
  it('按人设分类和人员筛选不绑定一师一人设，分组总量与汇总相等',()=>{
    const view=editorAnalysis([...rows,row('4','2026-11-12','魏磊','B',6)],range,{editor:'魏磊',persona:''},'persona');
    expect(view.summary).toMatchObject({shoot:6,inventory:10});expect(view.groups.map(g=>g.name).sort()).toEqual(['A','B']);
    expect(view.groups.reduce((n,g)=>n+(g.shoot||0),0)).toBe(6);
  });
  it('缺字段不当零；晚出现的库存组合不回填历史；明确零保留',()=>{
    const view=editorAnalysis([row('1','2026-11-11','魏磊','A',0,{editCount:0}),row('2','2026-11-12','尚杰','A',null,{editCount:null})],range,none,'editor');
    expect(view.summary.edit).toBeNull();expect(view.summary.inventory).toBeNull();
    expect(view.series.inventory.points.map(p=>p.value)).toEqual(['0',null]);
    expect(view.series.edit.points.map(p=>p.value)).toEqual(['0',null]);
    expect(editorAnalysis([],range,none,'editor').summary).toMatchObject({shoot:null,inventory:null});
  });
  it('历史未归类账号保持独立库存，不冒认给当前三位老师',()=>{
    const view=editorAnalysis([row('a','2026-11-11','','A',2,{userId:'old-1'}),row('b','2026-11-12','','A',3,{userId:'old-2'})],range,{editor:'legacy',persona:''},'editor');
    expect(view.summary.inventory).toBe(3);expect(view.groups[0].name).toBe('历史未归类');
  });
});

const lead=(id:string,date:string,extra:object={}):Lead=>({id,receivedOn:date,accountId:'a',teamId:'t',teamName:'一组',wechatId:'MS-A',pageName:'主页A',operatorName:'甲',channel:'ms',qualifiedOn:null,voidedAt:null,...extra}) as Lead;
const report=(date:string,count:number):LeadReport=>({accountId:'a',pageName:'主页A',businessDate:date,msToday:count,wsToday:0,addedCount:count});
describe('线索排名和逐日趋势同源',()=>{
  it('独立七日趋势沿用账号、小组和人员筛选，不混入其他组的客户',()=>{
    const rows=[lead('a',range.to,{personaCode:'P'}),lead('b',range.to,{teamName:'二组',operatorName:'乙',personaCode:'P'})];
    const selected=selectAnalysisLeads(rows,{account:'a',team:'一组',page:'主页A',persona:'P',operator:'甲',channel:'ms',adAccount:''});
    expect(selected.map(item=>item.id)).toEqual(['a']);
    const result=leadAnalysis(selected,[report(range.to,2)],range,range.to,'team',rows);
    expect(result.series[0].points.at(-1)?.value).toBe('1');
  });
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

  it('下粉广告户按登记文本筛选，空值只表示来源待补',()=>{
    const base={account:'',team:'',page:'',persona:'',operator:'',channel:'',adAccount:''};
    const rows=[lead('kept',range.to,{sourceAdAccountId:'09001',pageName:'主页A',operatorName:'甲'}),lead('other',range.to,{sourceAdAccountId:'9001',pageName:'主页A',operatorName:'甲'}),lead('blank',range.to,{pageName:'主页A',operatorName:'甲'})];
    expect(selectAnalysisLeads(rows,{...base,adAccount:'09001'}).map(item=>item.id)).toEqual(['kept']);
    expect(selectAnalysisLeads(rows,{...base,adAccount:'__missing__'}).map(item=>item.id)).toEqual(['blank']);
  });
});
