ALTER TABLE orders ADD COLUMN customer_lead_id UUID REFERENCES fan_leads(id);
CREATE INDEX orders_customer_lead ON orders(customer_lead_id) WHERE customer_lead_id IS NOT NULL;

-- A name match is ambiguous. Only an exact, unique historical identifier within
-- the same owner can be linked automatically.
WITH matches AS (
  SELECT o.id AS order_id, (array_agg(l.id))[1] AS lead_id
  FROM orders o
  JOIN order_details d ON d.order_id=o.id
  JOIN fan_leads l ON l.user_id=o.user_id
    AND lower(btrim(l.customer_ref))=lower(btrim(d.customer_code))
    AND l.voided_at IS NULL AND l.received_on<=o.business_date
  WHERE btrim(d.customer_code)<>'' AND btrim(l.customer_ref)<>''
  GROUP BY o.id
  HAVING count(*)=1
), linked AS (
  UPDATE orders o SET customer_lead_id=m.lead_id
  FROM matches m WHERE o.id=m.order_id AND o.customer_lead_id IS NULL
  RETURNING o.id,o.customer_lead_id
)
INSERT INTO audit_logs(action,entity_type,entity_id,after_data)
SELECT 'order_customer_link','order',id::text,
       jsonb_build_object('customerLeadId',customer_lead_id,'reason','历史客户标识唯一匹配')
FROM linked;
