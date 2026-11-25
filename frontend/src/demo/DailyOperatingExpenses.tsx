import { useEffect, useRef, useState } from "react";
import { requestInner } from "../api";
import { submissionKey } from "../commerceUi";
import { toErrorMessage } from "../errors";
import { Field } from "../OrderWorkspace";
import "./boss-priority.css";
import "../finance-menu.css";

const labels = {rent:"房租",utilities:"水电",hospitality:"招待费用",other:"其他费用"};
type Expense = {id:string;date:string;category:keyof typeof labels;amount:string;operator:string;purpose:string;proof:string};
const demo = import.meta.env.MODE === "demo";
async function request(body?:object):Promise<{records:Expense[]}> {
  const options = body ? {method:"POST",body:JSON.stringify(body)} : {};
  if (!demo) return requestInner("/api/finance/daily-expenses",options);
  const response = await fetch("/api/demo/daily-expenses",{...options,headers:{"Content-Type":"application/json"}});
  const data = await response.json();
  if (!response.ok) throw Error(data.error||"费用读取失败");
  return data;
}
export default function DailyOperatingExpenses({today}:{today:string}) {
  const [form,setForm] = useState({date:today,category:"rent",amount:"",operator:"",purpose:"",proof:""});
  const [records,setRecords] = useState<Expense[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [drawerOpen,setDrawerOpen] = useState(false);
  const [categoryFilter,setCategoryFilter] = useState<""|keyof typeof labels>("");
  const [query,setQuery] = useState("");
  const key = useRef(submissionKey());
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy){setDrawerOpen(false);}};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[busy]);
 async function load() {
    setError("");
    try {setRecords((await request()).records);}
    catch(error) {setError(toErrorMessage(error));}
  }
  useEffect(()=>{void load();},[]);
  const filtered = records.filter(r => (!categoryFilter || r.category === categoryFilter) && `${r.purpose} ${r.operator} ${r.proof} ${labels[r.category]}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section>
    <p className="notice">登记房租、水电、招待及其他日常费用。工资、投流和售后成本分别沿用各自台账。{demo&&"演示记录仅保留在当前浏览器会话。"}</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    <section className="card">
      <header className="commerce-line"><h2>已登记日常费用（{filtered.length}）</h2><div className="actions"><button type="button" disabled={busy} onClick={()=>setDrawerOpen(true)}>＋ 登记日常费用</button><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>刷新记录</button></div></header>
      <div className="fin-toolbar">
        <div className="fin-pills" role="group" aria-label="费用类别筛选">
          <button type="button" className="fin-pill" aria-pressed={categoryFilter===""} onClick={()=>setCategoryFilter("")}>全部</button>
          {(Object.entries(labels) as [keyof typeof labels,string][]).map(([value,label])=><button key={value} type="button" className="fin-pill" aria-pressed={categoryFilter===value} onClick={()=>setCategoryFilter(value)}>{label}</button>)}
        </div>
        <input type="search" placeholder="查找用途、经办人或凭证" value={query} onChange={e=>setQuery(e.target.value)} style={{maxWidth:240}}/>
      </div>
      <div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>费用日期</th><th>分类</th><th>用途</th><th>经办人</th><th>凭证</th><th>金额 CNY</th></tr></thead><tbody>{filtered.slice().reverse().map(record=><tr key={record.id}><td className="fin-num">{record.date}</td><td>{labels[record.category]}</td><td>{record.purpose}</td><td>{record.operator}</td><td>{record.proof||"待补"}</td><td className="fin-num">¥{record.amount}</td></tr>)}</tbody></table></div>
      {!filtered.length&&<p className="empty-state">暂无符合条件的日常费用记录。</p>}
    </section>
    {drawerOpen&&<div className="fin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setDrawerOpen(false);}}><div className="fin-drawer-panel" role="dialog" aria-modal="true" aria-label="登记日常费用"><header className="fin-drawer-head"><h2>登记日常费用</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setDrawerOpen(false)}>关闭</button></header><form className="fin-drawer-body daily-operating-form" id="daily-expense-form" onSubmit={async event=>{
      event.preventDefault();if(busy)return;
      setBusy(true);setError("");setNotice("");
      try {
        setRecords((await request({...form,requestKey:key.current(form)})).records);
        key.current=submissionKey();
        setNotice("日常费用已登记。");
        setForm({...form,amount:"",purpose:"",proof:""});
        setDrawerOpen(false);
      } catch(error) {setError(toErrorMessage(error));}
      finally {setBusy(false);}
    }}>
      <div className="grid two">
        <Field label="费用发生日期"><input required type="date" max={today} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="费用类别"><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
        {([["amount","金额 · ¥",16],["operator","经办人",64],["purpose","用途",300],["proof","凭证编号（选填）",200]] as const).map(([name,label,max])=>
          <Field label={label} key={name}><input required={name!=="proof"} maxLength={max} inputMode={name==="amount"?"decimal":undefined} value={form[name]} onChange={e=>setForm({...form,[name]:e.target.value})}/></Field>)}
      </div>
    </form><footer className="fin-drawer-foot"><button type="button" className="secondary" disabled={busy} onClick={()=>setDrawerOpen(false)}>取消</button><button type="submit" form="daily-expense-form" disabled={busy}>{busy?"登记中…":"登记费用"}</button></footer></div></div>}
  </section>;
}
