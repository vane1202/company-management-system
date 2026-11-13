import { useState } from 'react';
import type { CsAccount } from '../api';
import { Field } from '../OrderWorkspace';
import { InfoTip } from '../InfoTip';
import { demoOrderRooms } from './orderIdentity';

export default function RoomAttendance({today,account}:{today:string;account:CsAccount}) {
  const [date,setDate]=useState(today),[room,setRoom]=useState(''),[count,setCount]=useState(''),[source,setSource]=useState(''),[note,setNote]=useState(''),[checked,setChecked]=useState(false);
  const selected=demoOrderRooms.find(r=>r.code===room);
  const hasHolder=!!account.holderName?.trim();
  return <section className="card attendance-fill" aria-label="实际入场人数登记">
    <div className="desk-section-heading"><h2>入场登记</h2><InfoTip label="入场人数如何统计" text="填写实际进入私域直播间的客户人数，不是发送邀请的人数。同一客户同日同直播间只计1人；跨接待账号的重复客户请人工核对。本阶段仅试填，暂不纳入考核。"/></div>
    <p className="notice">演示试填 · 检查后不保存，不计入统计。</p>
    <form onSubmit={event=>{event.preventDefault();if(hasHolder && source.trim())setChecked(true);}} onChange={()=>setChecked(false)}>
      <div className="grid two"><Field label="入场日期"><input required type="date" max={today} value={date} onChange={e=>setDate(e.target.value)}/></Field>
      <Field label="主播 / 直播间"><select required value={room} onChange={e=>setRoom(e.target.value)}><option value="">请选择演示直播间</option>{demoOrderRooms.map(r=><option key={r.code} value={r.code}>{r.name} · {r.host}</option>)}</select></Field>
      <Field label="经办客服"><input readOnly value={account.holderName||''} placeholder="请先由主管设置持有人"/><small className="hint">按所选接待账号的当前持有人显示。</small></Field>
      <Field label="实际入场客户人数"><input required inputMode="numeric" pattern="[0-9]{1,7}" value={count} placeholder="填写非负整数，无人入场填0" onChange={e=>setCount(e.target.value)}/></Field>
      <Field label="核对来源"><input required pattern=".*\S.*" maxLength={128} value={source} placeholder="如：直播间后台当日入场记录" onChange={e=>setSource(e.target.value)}/></Field></div>
      <Field label="备注（选填）"><textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="补充重复客户核对等情况"/></Field>
      <button type="button" disabled={!hasHolder} onClick={event=>{if(event.currentTarget.form?.reportValidity() && source.trim())setChecked(true);}}>检查试填内容（不保存）</button>
      {checked&&<p role="status" className="notice">已检查：{date} · {selected?.name} · {account.holderName} · 实际入场 {Number(count)} 人。演示未保存。</p>}
    </form>
  </section>;
}
