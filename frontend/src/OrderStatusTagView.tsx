import { classifyOrderStatus, statusFilters, type OrderStatusFacts, type StatusFilter } from "./orderStatusTags";

export function OrderStatusTags({ facts }: { facts: OrderStatusFacts }) {
  const view = classifyOrderStatus(facts);
  return <span className="order-status-tags">{view.tags.map(tag => <em key={tag.key} className={"order-tag tone-" + tag.tone}>{tag.label}</em>)}</span>;
}

export function StatusFilterBar({ value, onChange }: { value: StatusFilter; onChange: (next: StatusFilter) => void }) {
  return <div className="cs-status-filters" role="tablist" aria-label="订单状态筛选">{statusFilters.map(item => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} className={value === item.id ? "is-on" : ""} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>;
}
