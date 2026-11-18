-- 0028 总部仓采购单与仓库入库
-- 采购主体从门店扩展到仓库：shop_id 与 warehouse_id 二选一；
-- 采购明细与库存流水增加 catalog_sku_id，仓库流水不再要求 shop_id / product_sku_id。

begin;

-- 1. 采购单主体
alter table purchase_orders add column if not exists warehouse_id uuid;
alter table purchase_orders
  drop constraint if exists purchase_orders_warehouse_id_fkey;
alter table purchase_orders
  add constraint purchase_orders_warehouse_id_fkey
  foreign key (warehouse_id) references warehouses(id) on delete restrict;

alter table purchase_orders alter column shop_id drop not null;

alter table purchase_orders drop constraint if exists purchase_orders_subject_check;
alter table purchase_orders
  add constraint purchase_orders_subject_check
  check (num_nonnulls(shop_id, warehouse_id) = 1);

create index if not exists purchase_orders_warehouse_status_idx
  on purchase_orders (warehouse_id, status, created_at desc);

-- 2. 采购明细：门店 SKU 或总部规格二选一
alter table purchase_order_items add column if not exists catalog_sku_id uuid;
alter table purchase_order_items
  drop constraint if exists purchase_order_items_catalog_sku_id_fkey;
alter table purchase_order_items
  add constraint purchase_order_items_catalog_sku_id_fkey
  foreign key (catalog_sku_id) references catalog_skus(id) on delete restrict;

alter table purchase_order_items
  drop constraint if exists purchase_order_items_sku_subject_check;
alter table purchase_order_items
  add constraint purchase_order_items_sku_subject_check
  check (num_nonnulls(product_sku_id, catalog_sku_id) <= 1);

create unique index if not exists purchase_order_items_catalog_sku_unique
  on purchase_order_items (purchase_order_id, catalog_sku_id)
  where catalog_sku_id is not null;

-- 3. 库存流水：支持仓库主体
alter table stock_movements add column if not exists catalog_sku_id uuid;
alter table stock_movements
  drop constraint if exists stock_movements_catalog_sku_id_fkey;
alter table stock_movements
  add constraint stock_movements_catalog_sku_id_fkey
  foreign key (catalog_sku_id) references catalog_skus(id) on delete restrict;

alter table stock_movements alter column shop_id drop not null;
alter table stock_movements alter column product_sku_id drop not null;

alter table stock_movements
  drop constraint if exists stock_movements_subject_check;
alter table stock_movements
  add constraint stock_movements_subject_check
  check (
    (location_type = 'shop' and shop_id is not null and product_sku_id is not null)
    or (location_type = 'warehouse' and catalog_sku_id is not null)
  );

create index if not exists stock_movements_warehouse_idx
  on stock_movements (location_id, catalog_sku_id, created_at desc);

create unique index if not exists stock_movements_warehouse_biz_unique
  on stock_movements (
    location_type,
    location_id,
    catalog_sku_id,
    movement_type,
    reference_type,
    reference_id
  )
  where location_type = 'warehouse'
    and catalog_sku_id is not null
    and reference_id is not null;

create unique index if not exists stock_movements_warehouse_initial_unique
  on stock_movements (location_type, location_id, catalog_sku_id)
  where location_type = 'warehouse'
    and catalog_sku_id is not null
    and movement_type = 'initial';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（如需回退 0028，按顺序执行；仓库采购单与仓库流水会一并删除）
-- ---------------------------------------------------------------------------
-- begin;
-- delete from stock_movements where location_type = 'warehouse';
-- delete from purchase_order_items where catalog_sku_id is not null;
-- delete from purchase_orders where warehouse_id is not null;
--
-- drop index if exists stock_movements_warehouse_initial_unique;
-- drop index if exists stock_movements_warehouse_biz_unique;
-- drop index if exists stock_movements_warehouse_idx;
-- alter table stock_movements drop constraint if exists stock_movements_subject_check;
-- alter table stock_movements drop constraint if exists stock_movements_catalog_sku_id_fkey;
-- alter table stock_movements drop column if exists catalog_sku_id;
-- alter table stock_movements alter column product_sku_id set not null;
-- alter table stock_movements alter column shop_id set not null;
--
-- drop index if exists purchase_order_items_catalog_sku_unique;
-- alter table purchase_order_items drop constraint if exists purchase_order_items_sku_subject_check;
-- alter table purchase_order_items drop constraint if exists purchase_order_items_catalog_sku_id_fkey;
-- alter table purchase_order_items drop column if exists catalog_sku_id;
--
-- drop index if exists purchase_orders_warehouse_status_idx;
-- alter table purchase_orders drop constraint if exists purchase_orders_subject_check;
-- alter table purchase_orders alter column shop_id set not null;
-- alter table purchase_orders drop constraint if exists purchase_orders_warehouse_id_fkey;
-- alter table purchase_orders drop column if exists warehouse_id;
-- commit;
