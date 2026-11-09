-- 日报明细：客服按主页拆 Ms/Ws，运营增加美元投放指标，拍剪按人设拆分。
-- 不修改 001_init.sql / 002_review.sql。已有行保留，新字段为 NULL 表示历史未分类，不自动改写成渠道或美元。

ALTER TABLE fan_reports
  ADD COLUMN IF NOT EXISTS page_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ms_today INTEGER,
  ADD COLUMN IF NOT EXISTS ws_today INTEGER,
  ADD COLUMN IF NOT EXISTS ms_month INTEGER,
  ADD COLUMN IF NOT EXISTS ws_month INTEGER,
  ADD COLUMN IF NOT EXISTS valid_today INTEGER,
  ADD COLUMN IF NOT EXISTS comm_replied INTEGER,
  ADD COLUMN IF NOT EXISTS comm_read_no_reply INTEGER,
  ADD COLUMN IF NOT EXISTS comm_unread INTEGER,
  ADD COLUMN IF NOT EXISTS comm_invalid INTEGER,
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_user_id_business_date_key;
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_user_date_page_key;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_user_date_page_key UNIQUE (user_id, business_date, page_name);

ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_ms_today_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_ms_today_check CHECK (ms_today IS NULL OR (ms_today >= 0 AND ms_today <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_ws_today_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_ws_today_check CHECK (ws_today IS NULL OR (ws_today >= 0 AND ws_today <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_ms_month_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_ms_month_check CHECK (ms_month IS NULL OR (ms_month >= 0 AND ms_month <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_ws_month_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_ws_month_check CHECK (ws_month IS NULL OR (ws_month >= 0 AND ws_month <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_valid_today_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_valid_today_check CHECK (valid_today IS NULL OR (valid_today >= 0 AND valid_today <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_comm_replied_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_comm_replied_check CHECK (comm_replied IS NULL OR (comm_replied >= 0 AND comm_replied <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_comm_read_no_reply_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_comm_read_no_reply_check CHECK (comm_read_no_reply IS NULL OR (comm_read_no_reply >= 0 AND comm_read_no_reply <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_comm_unread_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_comm_unread_check CHECK (comm_unread IS NULL OR (comm_unread >= 0 AND comm_unread <= 1000000));
ALTER TABLE fan_reports DROP CONSTRAINT IF EXISTS fan_reports_comm_invalid_check;
ALTER TABLE fan_reports ADD CONSTRAINT fan_reports_comm_invalid_check CHECK (comm_invalid IS NULL OR (comm_invalid >= 0 AND comm_invalid <= 1000000));

ALTER TABLE ops_reports
  ADD COLUMN IF NOT EXISTS persona_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS spend_usd NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS consult_count INTEGER,
  ADD COLUMN IF NOT EXISTS consult_cost_usd NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS click_count INTEGER,
  ADD COLUMN IF NOT EXISTS ctr_percent NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS balance_usd NUMERIC(14, 2);

UPDATE ops_reports
   SET persona_name = platform
 WHERE persona_name = '' AND platform <> '';

ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_user_id_business_date_platform_key;
ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_user_date_persona_key;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_user_date_persona_key UNIQUE (user_id, business_date, persona_name);

ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_spend_usd_check;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_spend_usd_check CHECK (spend_usd IS NULL OR spend_usd >= 0);
ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_consult_count_check;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_consult_count_check CHECK (consult_count IS NULL OR (consult_count >= 0 AND consult_count <= 1000000));
ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_consult_cost_usd_check;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_consult_cost_usd_check CHECK (consult_cost_usd IS NULL OR consult_cost_usd >= 0);
ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_click_count_check;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_click_count_check CHECK (click_count IS NULL OR (click_count >= 0 AND click_count <= 100000000));
ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_ctr_percent_check;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_ctr_percent_check CHECK (ctr_percent IS NULL OR (ctr_percent >= 0 AND ctr_percent <= 100));
ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_balance_usd_check;
ALTER TABLE ops_reports ADD CONSTRAINT ops_reports_balance_usd_check CHECK (balance_usd IS NULL OR balance_usd >= 0);

ALTER TABLE editor_reports
  ADD COLUMN IF NOT EXISTS persona_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS edit_count INTEGER,
  ADD COLUMN IF NOT EXISTS sent_to_ops_count INTEGER;

ALTER TABLE editor_reports DROP CONSTRAINT IF EXISTS editor_reports_user_id_business_date_key;
ALTER TABLE editor_reports DROP CONSTRAINT IF EXISTS editor_reports_user_date_persona_key;
ALTER TABLE editor_reports ADD CONSTRAINT editor_reports_user_date_persona_key UNIQUE (user_id, business_date, persona_name);

ALTER TABLE editor_reports DROP CONSTRAINT IF EXISTS editor_reports_edit_count_check;
ALTER TABLE editor_reports ADD CONSTRAINT editor_reports_edit_count_check CHECK (edit_count IS NULL OR (edit_count >= 0 AND edit_count <= 1000000));
ALTER TABLE editor_reports DROP CONSTRAINT IF EXISTS editor_reports_sent_to_ops_count_check;
ALTER TABLE editor_reports ADD CONSTRAINT editor_reports_sent_to_ops_count_check CHECK (sent_to_ops_count IS NULL OR (sent_to_ops_count >= 0 AND sent_to_ops_count <= 1000000));
