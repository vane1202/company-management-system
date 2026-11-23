import { useEffect, useState } from "react";
import { api } from "../api";
import { customerStatus, invalidReasons, useCustomerCrm, type CrmActor } from "./customerCrm";
import { InvalidReviewDesk, ProductionInvalidReview, reviewStamp, type ReviewRow } from "./ProductionInvalidReview";
import { loadServiceDirectory } from "./serviceDirectory";

const actor: CrmActor = { role: "cs_supervisor", employeeId: "demo-supervisor", employeeName: "演示客服主管", teamIds: ["demo-team-a", "registered-team-qiuju"] };
const auditLabels = { pending: "待复核", approved: "已确认无效", rejected: "已驳回", restored: "已恢复跟进" } as const;

function DemoCustomerInvalidReview({ today }: { today: string }) {
  const { state, dispatch, error: storeError } = useCustomerCrm(today);
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.csAccounts(), loadServiceDirectory()]).then((results) => {
      if (!active) return;
      const accounts = results[0].status === "fulfilled" ? results[0].value.accounts : [];
      const directory = results[1].status === "fulfilled" ? results[1].value : null;
      const rows = [...accounts, ...(directory?.enabled ? directory.accounts : [])];
      setAccountLabels(Object.fromEntries(rows.filter((row) => row.teamId && actor.teamIds.includes(row.teamId)).map((row) => [row.id, row.wechatId])));
    });
    return () => { active = false; };
  }, []);

  const customers = new Map(state.customers.filter((customer) => actor.teamIds.includes(customer.teamId)).map((customer) => [customer.id, customer]));
  const reviews = state.reviews.filter((review) => actor.teamIds.includes(review.teamId) && customers.has(review.customerId));
  const rows: ReviewRow[] = reviews.map((review) => {
    const customer = customers.get(review.customerId)!;
    return {
      id: review.id, status: review.status, name: customer.name, customerRef: customer.customerRef,
      employeeId: customer.employeeId, employeeName: customer.employeeName, teamName: customer.teamName,
      accountLabel: accountLabels[customer.accountId] || customer.accountId, source: customer.source,
      createdOn: customer.createdOn, reason: invalidReasons[review.reason], note: review.note, need: customer.need,
      reviewNote: review.reviewNote || "", requestedAt: review.requestedAt, dealt: customerStatus(state, customer) === "dealt"
    };
  });

  return <InvalidReviewDesk rows={rows} demo loadError={storeError}
    employeeOptions={[...new Map([...customers.values()].map((customer) => [customer.employeeId, customer.employeeName])).entries()]}
    rule="客服提交无效申请后仍为待复核，由主管确认后才计入正式无效客资。退回或恢复必须填写原因，已有客户资料和订单保留。"
    onCommit={(id, decision, note) => dispatch({ type: "reviewInvalid", actor, reviewId: id, decision, note })}
    renderAudit={(id) => {
      const selected = reviews.find((review) => review.id === id);
      if (!selected) return null;
      const audit = reviews.filter((review) => review.customerId === selected.customerId);
      return <details className="cir-audit">
        <summary>该客户的复核历史 · {audit.length} 次</summary>
        {audit.map((review) => <article key={review.id}>
          <strong>{auditLabels[review.status]} · {invalidReasons[review.reason]}</strong>
          <small>申请 {reviewStamp(review.requestedAt)}{review.reviewedAt ? " · 处理 " + reviewStamp(review.reviewedAt) : ""}{review.reviewer ? " · " + review.reviewer : ""}</small>
          <p>{review.note || "无申请备注"}</p>
          {review.reviewNote && <p>处理意见：{review.reviewNote}</p>}
        </article>)}
      </details>;
    }} />;
}

export default function CustomerInvalidReview({ today }: { today: string }) {
  return import.meta.env.MODE === "production" ? <ProductionInvalidReview /> : <DemoCustomerInvalidReview today={today} />;
}
