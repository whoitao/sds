-- 0019_customer_profile.sql
-- 个人信息页：顾客「重置密码」需要落一个密码哈希。
-- 顾客端登录仍走手机号 + 验证码，这里只是保存密码字段，便于后续密码登录；
-- avatar_url 已存在于 users 表，无需新增。

alter table users add column if not exists password_hash text;
