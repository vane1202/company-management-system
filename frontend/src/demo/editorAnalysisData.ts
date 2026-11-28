import type {ProductionRow} from '../productionGroups';
import {daysIn,type TrendPoint,type TrendSeries} from './bossTrendData';

type Range={from:string;to:string};
type Selection={editor:string;persona:string};
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const sum=(rows:ProductionRow[],field:string)=>!rows.length||rows.some(r=>!integer(r[field]))?null:rows.reduce((n,r)=>n+Number(r[field]),0);
const series=(key:string,label:string,points:TrendPoint[]):TrendSeries=>({key,label,points});
const point=(date:string,value:number|null,count:number,reason='未填报'):TrendPoint=>({date,value:value===null?null:String(value),reason:value===null?reason:'',count,native:'',estimated:false});
const latestDate=(rows:ProductionRow[],to:string)=>rows.reduce<string|null>((found,row)=>row.businessDate<=to&&(!found||row.businessDate>found)?row.businessDate:found,null);
const shiftDay=(iso:string,days:number)=>{const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const rate=(num:number|null,den:number|null)=>num!==null&&den!==null&&den>0?Number((num/den*100).toFixed(1)):null;

export function editorAnalysis(rows:ProductionRow[],range:Range,filters:Selection,by:'editor'|'persona'){
  const archive=rows.filter(r=>r.businessDate<=range.to&&(!filters.editor||(filters.editor==='legacy'?!r.editorName:r.editorName===filters.editor))&&(!filters.persona||r.personaName===filters.persona));
  const period=archive.filter(r=>r.businessDate>=range.from);
  const cutoff=latestDate(archive,range.to);
  const ending=cutoff?archive.filter(r=>r.businessDate===cutoff):[];
  const summary=(current:ProductionRow[],dayRows:ProductionRow[])=>{
    const shoot=sum(current,'shootCount'),edit=sum(current,'editCount'),sent=sum(current,'sentToOpsCount'),inventory=sum(dayRows,'inventorySnapshot');
    return {shoot,edit,sent,inventory,snapshotDates:cutoff?[cutoff]:[],records:current.length,deliveryRate:rate(sent,edit),editRate:rate(edit,shoot)};
  };
  const editorKey=(r:ProductionRow)=>String(r.editorName||'历史未归类');
  const personaKey=(r:ProductionRow)=>String(r.personaName||'未命名人设');
  const groupName=(r:ProductionRow)=>by==='editor'?editorKey(r):personaKey(r);
  const names=[...new Set(archive.map(groupName))];
  const groups=names.map(name=>({name,...summary(period.filter(r=>groupName(r)===name),ending.filter(r=>groupName(r)===name))}));

  const editorNames=[...new Set(archive.map(editorKey))];
  const editorRows=editorNames.map(name=>{
    const base=summary(period.filter(r=>editorKey(r)===name),ending.filter(r=>editorKey(r)===name));
    const editConversionRate=rate(base.edit,base.shoot);
    return {name,...base,editConversionRate,backlog:editConversionRate!==null&&editConversionRate<65};
  });

  const trendFrom=daysIn(range.from,range.to).length<7?shiftDay(range.to,-6):range.from;
  const trendPeriod=archive.filter(r=>r.businessDate>=trendFrom);
  const personaNames=[...new Set(archive.map(personaKey))];
  const personaWaterLevels=personaNames.map(name=>{
    const pDayRows=ending.filter(r=>personaKey(r)===name);
    const pTrendRows=trendPeriod.filter(r=>personaKey(r)===name);
    const inventory=sum(pDayRows,'inventorySnapshot');
    const sentTotal=sum(pTrendRows,'sentToOpsCount');
    const activeDays=new Set(pTrendRows.map(r=>r.businessDate)).size;
    const dailyBurn=sentTotal!==null&&activeDays>0?Number((sentTotal/activeDays).toFixed(1)):null;
    const estDays=inventory!==null&&dailyBurn!==null&&dailyBurn>0?Number((inventory/dailyBurn).toFixed(1)):null;
    const lowStock=estDays!==null?estDays<3:(inventory!==null&&inventory<3);
    return {name,inventory,dailyBurn,estDays,lowStock,snapshotDate:cutoff};
  }).sort((a,b)=>(a.lowStock===b.lowStock?(a.estDays??999)-(b.estDays??999):a.lowStock?-1:1));

  const lowStockPersonaCount=personaWaterLevels.filter(p=>p.lowStock).length;
  const baseSummary=summary(period,ending);
  const buildSeries=(winDays:string[],winRows:ProductionRow[])=>{
    const flow=(field:string)=>winDays.map(date=>{const daily=winRows.filter(r=>r.businessDate===date);return point(date,sum(daily,field),daily.length,daily.length?'字段待补':'未填报');});
    const stock=winDays.map(date=>{const daily=archive.filter(r=>r.businessDate===date);const value=sum(daily,'inventorySnapshot');return {...point(date,value,daily.length,daily.length?'字段待补':'未填报'),native:value===null?'':`当日屯量 ${date}`};});
    return {shoot:series('shoot','拍摄',flow('shootCount')),edit:series('edit','剪辑',flow('editCount')),sent:series('sent','发给运营',flow('sentToOpsCount')),inventory:series('inventory','库存',stock)};
  };
  const days=daysIn(range.from,range.to);
  const trendDays=daysIn(trendFrom,range.to);
  return {
    summary:{...baseSummary,lowStockPersonaCount},
    groups,
    editorRows,
    personaWaterLevels,
    period:[...period].sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||String(a.editorName).localeCompare(String(b.editorName))),
    series:buildSeries(days,period),
    trendSeries:buildSeries(trendDays,trendPeriod),
    trendRange:{from:trendFrom,to:range.to},
  };
}
