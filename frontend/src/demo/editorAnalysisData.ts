import type {ProductionRow} from '../productionGroups';
import {daysIn,type TrendPoint,type TrendSeries} from './bossTrendData';

type Range={from:string;to:string};
type Selection={editor:string;persona:string};
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const sum=(rows:ProductionRow[],field:string)=>!rows.length||rows.some(r=>!integer(r[field]))?null:rows.reduce((n,r)=>n+Number(r[field]),0);
const series=(key:string,label:string,points:TrendPoint[]):TrendSeries=>({key,label,points});
const point=(date:string,value:number|null,count:number,reason='未填报'):TrendPoint=>({date,value:value===null?null:String(value),reason:value===null?reason:'',count,native:'',estimated:false});
const latestDate=(rows:ProductionRow[],to:string)=>rows.reduce<string|null>((found,row)=>row.businessDate<=to&&(!found||row.businessDate>found)?row.businessDate:found,null);
export function editorAnalysis(rows:ProductionRow[],range:Range,filters:Selection,by:'editor'|'persona'){
  const archive=rows.filter(r=>r.businessDate<=range.to&&(!filters.editor||(filters.editor==='legacy'?!r.editorName:r.editorName===filters.editor))&&(!filters.persona||r.personaName===filters.persona));
  const period=archive.filter(r=>r.businessDate>=range.from);
  const cutoff=latestDate(archive,range.to);
  const ending=cutoff?archive.filter(r=>r.businessDate===cutoff):[];
  const summary=(current:ProductionRow[],dayRows:ProductionRow[])=>({shoot:sum(current,'shootCount'),edit:sum(current,'editCount'),sent:sum(current,'sentToOpsCount'),inventory:sum(dayRows,'inventorySnapshot'),snapshotDates:cutoff?[cutoff]:[],records:current.length});
  const names=[...new Set(archive.map(r=>String(by==='editor'?r.editorName||'历史未归类':r.personaName||'未命名人设')))];
  const groupName=(r:ProductionRow)=>String(by==='editor'?r.editorName||'历史未归类':r.personaName||'未命名人设');
  const groups=names.map(name=>({name,...summary(period.filter(r=>groupName(r)===name),ending.filter(r=>groupName(r)===name))}));
  const days=daysIn(range.from,range.to);
  const flow=(field:string)=>days.map(date=>{const daily=period.filter(r=>r.businessDate===date);return point(date,sum(daily,field),daily.length,daily.length?'字段待补':'未填报');});
  const stock=days.map(date=>{const daily=archive.filter(r=>r.businessDate===date);const value=sum(daily,'inventorySnapshot');return {...point(date,value,daily.length,daily.length?'字段待补':'未填报'),native:value===null?'':`当日屯量 ${date}`};});
  return {summary:summary(period,ending),groups,period:[...period].sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||String(a.editorName).localeCompare(String(b.editorName))),series:{shoot:series('shoot','拍摄',flow('shootCount')),edit:series('edit','剪辑',flow('editCount')),sent:series('sent','发给运营',flow('sentToOpsCount')),inventory:series('inventory','库存',stock)}};
}
