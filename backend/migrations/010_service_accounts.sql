-- 通用客服接待账号。保留历史wechat_id列/主体ID/业务外键，旧主体保持历史类型。
ALTER TABLE users ADD COLUMN service_platform TEXT NOT NULL DEFAULT 'legacy_wechat';
ALTER TABLE users ADD CONSTRAINT users_service_platform_check CHECK(service_platform IN ('whatsapp','messenger','legacy_wechat'));
ALTER TABLE users DROP CONSTRAINT users_account_kind_check;
ALTER TABLE users ADD CONSTRAINT users_account_kind_check CHECK(account_kind IN ('employee','cs_wechat','cs_service'));
ALTER TABLE users DROP CONSTRAINT users_cs_wechat_check;
ALTER TABLE users ADD CONSTRAINT users_service_identity_check CHECK(
 (account_kind='employee' AND wechat_id IS NULL) OR
 (account_kind='cs_wechat' AND role='cs' AND service_platform='legacy_wechat' AND wechat_id IS NOT NULL AND char_length(wechat_id) BETWEEN 6 AND 64) OR
 (account_kind='cs_service' AND role='cs' AND service_platform IN ('whatsapp','messenger') AND wechat_id IS NOT NULL AND char_length(wechat_id) BETWEEN 3 AND 128)
);
DROP INDEX users_wechat_id_unique;
CREATE UNIQUE INDEX users_service_identity_unique ON users(service_platform,lower(wechat_id)) WHERE wechat_id IS NOT NULL;
ALTER TABLE users ADD COLUMN service_account_label TEXT GENERATED ALWAYS AS
 (CASE service_platform WHEN 'whatsapp' THEN 'WhatsApp · '||wechat_id WHEN 'messenger' THEN 'Messenger · '||wechat_id ELSE wechat_id END) STORED;
