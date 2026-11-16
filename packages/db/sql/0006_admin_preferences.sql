-- 0006_admin_preferences.sql
-- 后台界面偏好（主题 / 每页条数）按管理员账号持久化，新增列，不改动已有列。
-- 幂等写法，可重复执行。

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
