-- 客户线索独立留档；不从旧日报推断客户或转化结果，不改写原日报。
CREATE TABLE fan_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  received_on DATE NOT NULL,
  page_name TEXT NOT NULL CHECK(length(page_name) BETWEEN 1 AND 128),
  persona_code TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL CHECK(length(operator_name) BETWEEN 1 AND 128),
  channel TEXT NOT NULL CHECK(channel IN ('ms','ws')),
  customer_label TEXT NOT NULL CHECK(length(customer_label) BETWEEN 1 AND 128),
  customer_ref TEXT NOT NULL DEFAULT '' CHECK(length(customer_ref)<=128),
  contact_status TEXT NOT NULL CHECK(contact_status IN ('unread','read_no_reply','replied')),
  replied_on DATE,
  qualified_on DATE,
  need_summary TEXT NOT NULL DEFAULT '' CHECK(length(need_summary)<=1000),
  invalid_reason TEXT NOT NULL DEFAULT '' CHECK(length(invalid_reason)<=500),
  loss_reason TEXT NOT NULL DEFAULT '' CHECK(length(loss_reason)<=500),
  next_followup DATE,
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),
  version INTEGER NOT NULL DEFAULT 1,
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(replied_on IS NULL OR replied_on>=received_on),
  CHECK(qualified_on IS NULL OR (replied_on IS NOT NULL AND qualified_on>=replied_on AND length(trim(need_summary))>0)),
  CHECK(invalid_reason='' OR qualified_on IS NULL),
  CHECK(contact_status<>'replied' OR replied_on IS NOT NULL)
);
CREATE UNIQUE INDEX fan_leads_customer_ref ON fan_leads(user_id,channel,lower(customer_ref)) WHERE customer_ref<>'' AND voided_at IS NULL;
CREATE INDEX fan_leads_account_date ON fan_leads(user_id,received_on);
CREATE INDEX fan_leads_team_date ON fan_leads(team_id,received_on);
