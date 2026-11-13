-- 接待账号当前负责人。更换姓名不改变账号主体，历史业务仍归原账号。
ALTER TABLE users ADD COLUMN holder_name TEXT;
