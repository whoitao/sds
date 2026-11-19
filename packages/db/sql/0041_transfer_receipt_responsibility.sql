-- 0041_transfer_receipt_responsibility.sql
-- 分拨收货责任到人（最小可行版）：
-- 1) 分拨单新增建议收货人、实际收货人、应收货时间；
-- 2) 新增窄权限 warehouse.transfer_read 并授予店长，只用于放行分拨页签，不打开仓库/库存页签。
-- 加法迁移，可重复执行；不新建表。

BEGIN;

alter table warehouse_transfers
  add column if not exists receiver_admin_id uuid references admin_users(id) on delete set null,
  add column if not exists received_by_admin_id uuid references admin_users(id) on delete set null,
  add column if not exists receive_due_at timestamptz;

-- 「待我收货」与超期扫描：收货人 + 状态 + 截止时间
create index if not exists warehouse_transfers_receiver_idx
  on warehouse_transfers (receiver_admin_id, status, receive_due_at);

comment on column warehouse_transfers.receiver_admin_id is '建议收货责任人（发货时按目标门店店长自动带出，可修改；为空表示未指派）';
comment on column warehouse_transfers.received_by_admin_id is '实际收货人（代收时与建议责任人不一致）';
comment on column warehouse_transfers.receive_due_at is '应收货截止时间（全部发出时按 SLA 写入）';

INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('warehouse.transfer_read', 'warehouse', 'transfer_read', '分拨单查看')
ON CONFLICT (code) DO NOTHING;

-- 只授予店长；不授予 warehouse.read，避免店长进入空的仓库/库存页签
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'warehouse.transfer_read'
WHERE r.code = 'store_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行；只丢责任记录，不影响单据与库存）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id = (SELECT id FROM admin_permissions WHERE code = 'warehouse.transfer_read');
-- DELETE FROM admin_permissions WHERE code = 'warehouse.transfer_read';
-- DROP INDEX IF EXISTS warehouse_transfers_receiver_idx;
-- ALTER TABLE warehouse_transfers
--   DROP COLUMN IF EXISTS receiver_admin_id,
--   DROP COLUMN IF EXISTS received_by_admin_id,
--   DROP COLUMN IF EXISTS receive_due_at;
-- COMMIT;
