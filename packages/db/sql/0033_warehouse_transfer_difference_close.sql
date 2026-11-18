-- 0033 分拨单差异关闭（损耗记账）
-- 加法迁移：仅新增列，不删列不删表。
-- 说明：本文件同时配套 packages/api/src/lib/shop-scope.ts 的门店范围收紧
--      （未绑定门店不再视为全部门店可见，super_admin 不受限），该变更不涉及表结构。
-- 1) 明细新增 loss_quantity / loss_amount：差异关闭时把「发出 - 实收」的差额按损耗冻结，
--    数量与金额落库便于报表与对账；门店库存不因损耗再变动（收货时只加实收数量）。
-- 2) 表头新增 difference_closed_at / difference_close_reason：标记「差异关闭」，
--    与「全部收满」区分开（两者都会把状态推进到 received）。

begin;

alter table warehouse_transfer_items
  add column if not exists loss_quantity numeric(12, 2) not null default 0,
  add column if not exists loss_amount numeric(12, 2) not null default 0;

alter table warehouse_transfer_items
  drop constraint if exists warehouse_transfer_items_loss_check;
alter table warehouse_transfer_items
  add constraint warehouse_transfer_items_loss_check check (
    loss_quantity >= 0 and loss_amount >= 0
  );

alter table warehouse_transfers
  add column if not exists difference_closed_at timestamptz,
  add column if not exists difference_close_reason text;

-- 3) 差异关闭的损耗流水：
--    货物在仓库发出时已扣减仓库库存，门店从未收到差额部分，因此门店库存不能再次扣减。
--    这里允许写一条 quantity_change = 0 的 waste 备忘流水（门店维度、带成本与备注），
--    既保留可追溯的损耗流水，又不破坏「门店库存 = Σ quantity_change」的账实一致。
--    仅放行 reference_type = 'warehouse_transfer' 的 waste，其余流水仍禁止 0 数量。
alter table stock_movements
  drop constraint if exists stock_movements_quantity_change_check;
alter table stock_movements
  add constraint stock_movements_quantity_change_check check (
    quantity_change <> 0
    or (movement_type = 'waste' and reference_type = 'warehouse_transfer')
  );

comment on column warehouse_transfer_items.loss_quantity is '差异关闭时确认放弃的未收数量（发出 - 实收）';
comment on column warehouse_transfer_items.loss_amount is '差异关闭时的损耗金额 = 损耗数量 × 发货时点成本';
comment on column warehouse_transfers.difference_closed_at is '门店确认差异关闭的时间；为空表示未关闭差异';
comment on column warehouse_transfers.difference_close_reason is '差异关闭备注（差异原因枚举记录在明细 difference_reason）';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（仅删除本轮新增列与 0 数量豁免，不影响已收货数量与库存）
-- ---------------------------------------------------------------------------
-- begin;
-- alter table stock_movements drop constraint if exists stock_movements_quantity_change_check;
-- alter table stock_movements add constraint stock_movements_quantity_change_check check (quantity_change <> 0);
-- alter table warehouse_transfer_items drop constraint if exists warehouse_transfer_items_loss_check;
-- alter table warehouse_transfer_items drop column if exists loss_quantity, drop column if exists loss_amount;
-- alter table warehouse_transfers drop column if exists difference_closed_at, drop column if exists difference_close_reason;
-- commit;
