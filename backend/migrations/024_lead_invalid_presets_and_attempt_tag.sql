ALTER TABLE fan_leads
  ADD COLUMN IF NOT EXISTS invalid_reason_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attempt_contact BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE fan_leads DROP CONSTRAINT IF EXISTS fan_leads_invalid_reason_code_check;
ALTER TABLE fan_leads ADD CONSTRAINT fan_leads_invalid_reason_code_check
  CHECK (invalid_reason_code IN ('', 'no_chinese', 'misclick', 'obscene', 'custom'));

UPDATE fan_leads
   SET invalid_reason_code = CASE
         WHEN invalid_reason IN ('语言不通（未能取得正常沟通）', '非中文客户') THEN 'no_chinese'
         WHEN invalid_reason IN ('误点咨询/不感兴趣', '误点咨询') THEN 'misclick'
         WHEN invalid_reason IN ('色粉', '淫秽、色情类') THEN 'obscene'
         WHEN invalid_reason <> '' THEN 'custom'
         ELSE ''
       END,
       invalid_review_status = CASE
         WHEN invalid_reason <> '' AND invalid_review_status = '' THEN 'pending'
         ELSE invalid_review_status
       END
 WHERE invalid_reason_code = '' AND (invalid_reason <> '' OR invalid_review_status <> '');

UPDATE fan_leads
   SET attempt_contact = TRUE
 WHERE invalid_review_status IN ('rejected', 'restored')
   AND qualified_on IS NULL;
