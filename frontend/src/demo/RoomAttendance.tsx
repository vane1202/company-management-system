import { useState } from "react";
import { fillHolder, type FillAccount } from "./serviceDirectory";
import { Field } from "../OrderWorkspace";
import { InfoTip } from "../InfoTip";
import { shareLabel, type AssessmentAttendance, type EmployeeRecord, type TenureRecord } from "./assessmentFoundation";
import { demoOrderRooms } from "./orderIdentity";

export default function RoomAttendance({ today, account, employees, tenures, attendance }: { today: string; account: FillAccount; employees: EmployeeRecord[]; tenures: TenureRecord[]; attendance: AssessmentAttendance[] }) {
  const [date, setDate] = useState(today), [room, setRoom] = useState(""), [count, setCount] = useState(""), [source, setSource] = useState(""), [note, setNote] = useState(""), [checked, setChecked] = useState(false);
  const roomOptions = account.registeredRoomName ? [{ code: "registered-room", name: account.registeredRoomName, host: account.registeredHostName || "" }] : demoOrderRooms;
  const selected = roomOptions.find((item) => item.code === room);
  const employee = fillHolder(account, date, today, employees, tenures);
  const history = attendance.filter((item) => item.accountId === account.id);
  return <section className="card attendance-fill" aria-label="实际入场人数登记">
    <div className="desk-section-heading"><h2>入场登记</h2><InfoTip label="入场人数如何统计" text="填写实际进入私域直播间的客户人数，不是发送邀请的人数。同一客户同日同直播间只计1人；跨接待账号的重复客户请人工核对。开单率要等入场客户与开单客户关联后才计算。" /></div>
    <p className="notice">演示试填 · 检查后不保存。已有示例按当时的使用人封存。</p>
    <form onSubmit={(event) => { event.preventDefault(); if (employee && source.trim()) setChecked(true); }} onChange={() => setChecked(false)}>
      <div className="grid two"><Field label="入场日期"><input required type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="主播 / 直播间"><select required value={room} onChange={(event) => setRoom(event.target.value)}><option value="">请选择直播间</option>{roomOptions.map((item) => <option key={item.code} value={item.code}>{item.name} · {item.host}</option>)}</select></Field>
        <Field label={account.registeredHolderId ? "当前登记负责人" : "考核归属"}><input readOnly value={employee ? employee.name + (employee.code ? " · " + employee.code : "") : ""} placeholder="该日期没有已确认的账号使用人" /><small className="hint">{account.registeredHolderId ? "今日按当前负责人试填；负责起始日期尚未提供，历史归属待补。" : "当前持有人：" + (account.holderName || "待设置") + "。历史日期仍归原使用人。"}</small></Field>
        <Field label="实际入场客户人数"><input required inputMode="numeric" pattern="[0-9]{1,7}" value={count} placeholder="填写非负整数，无人入场填0" onChange={(event) => setCount(event.target.value)} /></Field>
        <Field label="核对来源"><input required pattern=".*\S.*" maxLength={128} value={source} placeholder="如：直播间后台当日入场记录" onChange={(event) => setSource(event.target.value)} /></Field></div>
      <Field label="备注（选填）"><textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充重复客户核对等情况" /></Field>
      {!employee && <p className="notice">这一天没有使用人，不能把入场人数记到当前持有人名下。</p>}
      <button type="button" disabled={!employee} onClick={(event) => { if (event.currentTarget.form?.reportValidity() && source.trim()) setChecked(true); }}>检查试填内容（不保存）</button>
      {checked && employee && <p role="status" className="notice">已检查：{date} · {selected?.name} · {employee.name}{employee.code ? " · " + employee.code : ""} · 实际入场 {Number(count)} 人。演示未保存。</p>}
    </form>
    <h3>已封存的入场示例</h3>
    {history.length === 0 && <p className="notice">这个接待账号还没有封存的入场示例。</p>}
    {history.map((item) => {
      const person = employees.find((employee) => employee.id === item.employeeId);
      const linked = item.orderLink === "linked";
      const label = linked ? shareLabel(item.orderedCustomerIds.length, item.enteredCount) : null;
      return <article className="review-card" key={item.id}><h3>{item.businessDate} · {item.roomName}</h3><p>{person ? person.name + " · " + person.code : "使用人待核对"} · 入场 {item.enteredCount} 人</p><p>{linked ? "已关联开单客户 " + item.orderedCustomerIds.length + " 人 · 开单率 " + (label ?? "—") : "尚未与开单客户关联，开单率不作 0%"}</p><p className="notice">{item.source} · 封存记录，不随当前持有人改变</p></article>;
    })}
  </section>;
}
