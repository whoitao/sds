# 库存（进销存）开发方案

> 范围：只出方案。本文件不修改代码、不执行迁移、不改 `docs/prd/SDS-PRD.md`。
> 日期：2026-11-16
> 版本：v0.2（按评审决策更新）
>
> **本轮已拍板：**
> 1. 库存直接按 **SKU** 管理，不按 SPU/商品行管理；
> 2. 数量统一精确到小数点后两位，并用 `quantity_mode` 区分「必须整数」和「允许两位小数」；
> 3. 库存与采购的操作主体是 **平台运营**，本期不做店长自助维护。

---

## 0. 结论先行

### 0.1 库存和采购协同吗？

**协同，但单据解耦。**

- 采购单是“入库来源”，库存流水是“唯一写入口”；采购单本身不改库存，只有**确认收货**才生成 `purchase_in` 流水并增加 SKU 库存。
- 库存预警只负责**建议**生成采购草稿，不自动下单、不自动改库存。
- 销售订单（后续模块）是“出库来源”，售后退货是“入库来源”；采购、销售、退货共用同一套 SKU 库存流水。
- 库存模块也可以独立上线（期初 + 调整 + 盘点），采购模块随后接入。

### 0.2 商品库存怎么维护？

先区分三层，避免把“总部商品”“门店商品”“库存”混在一起：

| 层级 | 表 | 是否持有库存 | 说明 |
| --- | --- | --- | --- |
| 总部商品（SPU） | `catalog_products` | **不持有** | 名称、描述、图片、分类、发布状态 |
| 总部规格（SKU） | `catalog_skus` | **不持有** | 规格名、条码、单位、建议价、库存追踪策略、数量模式 |
| 门店商品（SPU） | `products` | **不持有** | 门店对总部商品的引用 + 本地上下架/排序 |
| 门店规格（SKU） | `product_skus` | **不持有** | 门店可售规格，价格可覆盖、上下架可自主 |
| 门店 SKU 库存 | `product_sku_stocks` | **持有** | 每店每个 SKU 一条库存余额 |
| 库存流水 | `stock_movements` | 事实来源 | 所有数量变化的唯一写入记录 |

所以：

- **库存的最小单位是 SKU**，不是商品；
- 同一总部商品在 A 店、B 店各有自己的门店 SKU 和库存；
- 总部商品/规格永远不持有库存；
- 平台看到的“商品库存”只是各门店 SKU 库存的汇总视图，不是一份独立库存。

### 0.3 店铺中的 SKU 库存怎么维护？

**所有数量变化都走流水，不再直接改数字。**

1. 采购收货 → `purchase_in`
2. 销售出库 → `sale_out`（订单模块接入后）
3. 售后退货 → `order_return`
4. 报损/过期/破损 → `waste`
5. 盘盈/盘亏/手工调整 → `adjustment`
6. 期初库存 → `initial`

`product_sku_stocks.quantity` 只是流水累计后的余额；任何 `PATCH quantity = N` 的入口都要下线，改成带原因、带操作人、可追溯的调整/盘点。

### 0.4 数量精度怎么定？

- 所有数量字段统一 `numeric(12,2)`：库存、阈值、采购数量、实收数量、流水变动、购物车数量、后续订单数量。
- 每个 SKU 增加 `quantity_mode`：

| `quantity_mode` | 含义 | 校验 | 前端步长 |
| --- | --- | --- | --- |
| `integer` | 必须整数（个、袋、箱、份等） | 不允许小数 | 1 |
| `decimal_2` | 允许两位小数（斤、kg、L 等） | 最多两位小数，超出拒绝 | 0.01（UI 可用 0.1 方便输入） |

- 金额仍然是 `numeric(10,2)`；数量与金额分开，不混用浮点累加。

### 0.5 操作主体

- **平台运营统一维护**：`super_admin` / `ops_manager` 在 admin 后台操作所有门店的库存与采购。
- `ops_manager` 本轮补 `inventory.write`、`purchases.write`（当前只有 read）。
- 不做店长/店员自助维护；`shop_members` 保留给未来移动端员工端，不接入本期库存。
- 所有库存变动、采购单都记录操作管理员；页面必须有明确的“当前门店”上下文。

### 0.6 推荐落地顺序

| 阶段 | 内容 |
| --- | --- |
| P0-0 | SKU 层落地：`catalog_skus` / `product_skus`，存量商品回填“标准装”SKU，购物车切 SKU，铺货补 SKU |
| P0-1 | SKU 库存：`product_sku_stocks` 余额迁移、流水、调整/损耗、低库存、期初、对账 |
| P0-2 | 采购：供应商、采购单、收货入库、幂等 |
| P0-3 | 后台：库存页、采购页、商品页 SKU 管理、仪表盘 |
| P0-4 | C 端：商品/SKU 展示、售罄、加购校验、购物车按 SKU |
| P1 | 盘点单、采购退货、部分收货、移动加权成本/毛利、通知、报表 |

---

## 1. 现状核对（以代码为准）

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 库存余额 | 已有 `product_stocks`，**商品级**、`quantity int >= 0` | [packages/db/src/schema/products.ts:91](file:///Users/whoitao/cyber/github/sds/packages/db/src/schema/products.ts#L91)；[packages/db/sql/0008_catalog.sql:82](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0008_catalog.sql#L82) |
| 库存写入 | 直接覆盖 `quantity`，无流水、无原因、无操作人 | [packages/api/src/routes/products.ts:766](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/products.ts#L766) |
| 商品表单 | 商品编辑里直接填“库存数量” | [apps/admin/app/(console)/products/page.tsx:467](file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/products/page.tsx#L467) |
| SKU | **没有 SKU 表**，`products` 是商品级单规格 | `packages/db/src/schema/products.ts` |
| 购物车 | `cart_items.product_id`，商品级 | [packages/db/src/schema/carts.ts:41](file:///Users/whoitao/cyber/github/sds/packages/db/src/schema/carts.ts#L41) |
| 总部发布/铺货 | 只铺 `products` 行，不铺 SKU | [packages/api/src/routes/catalog.ts:332](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/catalog.ts#L332)；[packages/api/src/routes/shops.ts:91](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/shops.ts#L91) |
| 库存/采购页面 | 均为占位页 | [inventory/page.tsx:1](file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/inventory/page.tsx#L1)；[purchases/page.tsx:1](file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L1) |
| 权限码 | `inventory.read/write`、`purchases.read/write` 已存在 | [packages/db/sql/0004_admin_rbac.sql:73](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0004_admin_rbac.sql#L73) |
| 采购/SKU 流水 | 未建表、未建接口 | `packages/db/src/schema/` 无对应文件 |
| 订单模块 | 未建表、未建接口 | `packages/db/src/schema/` 无 `orders.ts` |
| C 端商品列表 | 未返回库存/SKU，不区分售罄 | [packages/api/src/routes/mobile.ts:184](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/mobile.ts#L184) |
| 加购物车 | 只校验上下架/强制下架，不校验库存 | [packages/api/src/routes/mobile-cart.ts:151](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/mobile-cart.ts#L151) |

### 与 PRD 的差异

PRD 里设计的是 `inventory`（带 `raw_material_name`）+ `stock_movements`，实际代码是 `product_stocks`（商品级）。本方案按已拍板决策再往前走一步：

- **不复活 `inventory` + `raw_material_name`**；
- **不保留商品级库存作为长期模型**；
- 以 `product_sku_stocks` 作为唯一库存表，`product_stocks` 只作为迁移过渡；
- 非售卖物料（包装袋、清洁用品）不建 SKU、不建库存，只作为采购单行计入采购金额。

---

## 2. 库存模型与口径

### 2.1 统一恒等式

```text
门店 SKU 期末库存
  = 期初库存
  + 采购入库
  + 售后退货入库
  − 销售出库
  − 损耗
  ± 盘点/手工调整
```

对应到表：

```text
product_sku_stocks.quantity = Σ stock_movements.quantity_change
```

这条恒等式是验收和对账的硬标准。`product_sku_stocks` 是余额缓存，`stock_movements` 是唯一事实来源。

### 2.2 三条原则

1. **SKU 级、门店级**：库存只属于 `shop_id + product_sku_id`；总部 SPU/SKU 不持有库存。
2. **流水唯一写入口**：任何数量变化必须同时写一条 `stock_movements`，并与余额更新在同一事务。
3. **禁止负库存**：数据库 `CHECK (quantity >= 0)` 兜底，业务层用条件更新先判断。

### 2.3 数量模式

- `quantity_mode` 是 SKU 固有属性：总部 SKU 由总部维护，门店 SKU 继承；本地 SKU 由门店 SKU 管理页维护。
- `integer` 模式：库存、阈值、采购数量、实收数量、购物车数量都必须是整数。
- `decimal_2` 模式：允许两位小数；超过两位直接拒绝，不静默四舍五入。
- 建议采购数量：`integer` 向上取整；`decimal_2` 保留两位小数。
- 金额计算：行金额 = `round(数量 × 单价, 2)`，采购单总额 = 各行金额之和，避免数量小数与金额小数相互污染。

### 2.4 追踪策略

| `stock_type` | 行为 |
| --- | --- |
| `tracked` | 有 `product_sku_stocks` 行；参与售罄、低库存、采购、盘点、流水 |
| `untracked` | 不建库存行；不参与预警与出库扣减；C 端始终可售 |

`stock_type` 是 SKU 级属性。商品从 `untracked` 切到 `tracked` 时，为每个 SKU 建 0 库存行并要求期初登记；从 `tracked` 切到 `untracked` 时保留历史流水，但库存行不再参与业务。

---

## 3. 数据模型

### 3.1 总部 SKU：`catalog_skus`

```sql
create type quantity_mode as enum ('integer', 'decimal_2');

create table catalog_skus (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references catalog_products (id) on delete cascade,
  spec_name varchar(50) not null,              -- "500g/袋"、"1kg/份"、"标准装"
  barcode varchar(64),
  unit varchar(20) not null,                   -- 斤 / kg / 个 / 袋 / 箱
  default_price numeric(10, 2) not null check (default_price >= 0),
  stock_type product_stock_type not null default 'tracked',
  quantity_mode quantity_mode not null default 'integer',
  is_default boolean not null default false,
  status varchar(16) not null default 'active' check (status in ('active', 'disabled')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_product_id, spec_name)
);

create unique index catalog_skus_default_unique
  on catalog_skus (catalog_product_id) where is_default;
create index catalog_skus_product_idx
  on catalog_skus (catalog_product_id, status, sort_order);
```

- 一个总部商品至少一个 SKU；`is_default` 用于商品卡片默认展示和单规格兼容。
- `quantity_mode` 在这里定义，门店 SKU 继承。
- 总部商品原有的 `unit/default_price/stock_type` 在过渡期保留，作为默认 SKU 的镜像；P1 清理。

### 3.2 门店 SKU：`product_skus`

```sql
create table product_skus (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  product_id uuid not null,
  catalog_sku_id uuid references catalog_skus (id) on delete restrict,  -- null = 门店本地 SKU
  spec_name varchar(50) not null,
  barcode varchar(64),
  unit varchar(20) not null,
  price numeric(10, 2),                          -- null = 跟随 catalog_skus.default_price
  stock_type product_stock_type not null default 'tracked',
  quantity_mode quantity_mode not null default 'integer',
  is_available boolean not null default true,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, spec_name),
  unique (id, shop_id),
  constraint product_skus_product_fk
    foreign key (product_id, shop_id) references products (id, shop_id) on delete cascade,
  constraint product_skus_price_required_for_local
    check (catalog_sku_id is not null or price is not null)
);

create unique index product_skus_shop_catalog_sku_unique
  on product_skus (shop_id, catalog_sku_id) where catalog_sku_id is not null;
create unique index product_skus_default_unique
  on product_skus (product_id) where is_default;
create index product_skus_product_idx
  on product_skus (product_id, is_available, sort_order);
create index product_skus_barcode_idx
  on product_skus (shop_id, barcode) where barcode is not null;
```

字段归属：

| 字段 | 总部 SKU（`catalog_sku_id` 非空） | 本地 SKU（`catalog_sku_id` 为空） |
| --- | --- | --- |
| `spec_name / barcode / unit / quantity_mode / stock_type` | 总部维护，门店只读 | 门店维护 |
| `price` | 可空；`null` 跟随建议价，有值表示本店改价 | 必须填 |
| `is_available` | 门店维护 | 门店维护 |
| `is_default` | 门店维护（每个商品唯一） | 门店维护（每个商品唯一） |
| `sort_order` | 门店维护 | 门店维护 |

SPU 级 `products.is_available` 仍然保留；SKU 最终可售条件：

```text
products.is_available = true
  and products.is_blocked = false
  and product_skus.is_available = true
  and catalog_skus.status = 'active'（关联总部 SKU 时）
```

### 3.3 门店 SKU 库存：`product_sku_stocks`

```sql
create table product_sku_stocks (
  product_sku_id uuid primary key,
  shop_id uuid not null references shops (id) on delete cascade,
  quantity numeric(12, 2) not null default 0 check (quantity >= 0),
  min_threshold numeric(12, 2) not null default 0 check (min_threshold >= 0),
  max_threshold numeric(12, 2) check (max_threshold >= 0),
  updated_at timestamptz not null default now(),
  constraint product_sku_stocks_sku_fk
    foreign key (product_sku_id, shop_id) references product_skus (id, shop_id) on delete cascade
);

create index product_sku_stocks_shop_idx
  on product_sku_stocks (shop_id);
```

- `quantity`：账面现存量，`numeric(12,2)`。
- `min_threshold`：安全库存/预警线，`quantity <= min_threshold` 触发低库存。
- `max_threshold`：补货上限，用于建议采购数量。
- P1 订单模块落地时再增量加 `reserved_quantity numeric(12,2)`，口径为 `可用 = quantity - reserved_quantity`。
- 历史表 `product_stocks` 在迁移完成后只读，P1 删除。

### 3.4 库存流水：`stock_movements`

```sql
create type stock_movement_type as enum (
  'purchase_in',      -- 采购入库
  'purchase_return',  -- 采购退货（P1）
  'sale_out',         -- 销售出库
  'order_return',     -- 售后退货入库
  'adjustment',       -- 盘盈/盘亏/手工调整
  'waste',            -- 损耗报损
  'initial'           -- 期初库存
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete restrict,
  product_sku_id uuid not null,
  movement_type stock_movement_type not null,
  quantity_change numeric(12, 2) not null check (quantity_change <> 0),
  balance_after numeric(12, 2) not null check (balance_after >= 0),
  unit_cost numeric(10, 2),
  reference_type varchar(24),   -- purchase_order / order / after_sale / stock_count / manual / initial
  reference_id uuid,
  operator_admin_id uuid references admin_users (id) on delete set null,
  operator_user_id uuid references users (id) on delete set null,  -- 预留：未来移动端员工
  remark text,
  created_at timestamptz not null default now(),
  constraint stock_movements_sku_fk
    foreign key (product_sku_id, shop_id) references product_skus (id, shop_id) on delete restrict
);
```

关键索引与约束：

```sql
-- 同一业务单据 + 同一 SKU + 同一动作只能记一次，防重复入库/重复出库
create unique index stock_movements_biz_unique
  on stock_movements (shop_id, product_sku_id, movement_type, reference_type, reference_id)
  where reference_id is not null;

-- 每个门店 SKU 只允许一次期初登记
create unique index stock_movements_initial_unique
  on stock_movements (shop_id, product_sku_id) where movement_type = 'initial';

create index stock_movements_sku_idx
  on stock_movements (shop_id, product_sku_id, created_at desc);
create index stock_movements_type_idx
  on stock_movements (shop_id, movement_type, created_at desc);
```

`reference_type = 'manual'` 时，`reference_id` 用客户端生成的 `operationId`（一次调整/盘点一个 UUID），保证重试幂等。

### 3.5 供应商与采购

#### `suppliers`

```sql
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  name varchar(100) not null,
  contact_name varchar(50),
  phone varchar(20),
  status varchar(16) not null default 'active' check (status in ('active', 'disabled')),
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_shop_idx on suppliers (shop_id, status);
```

供应商按门店维护，平台运营为各门店录入；不做供应商端登录、账期、结算。采购单保存/提交时校验 `supplier_id` 属于同一 `shop_id`，供应商删除用停用而非硬删。

#### `purchase_orders` / `purchase_order_items`

```sql
create type purchase_order_status as enum ('draft', 'submitted', 'received', 'cancelled');

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  po_no varchar(32) not null unique,
  supplier_id uuid references suppliers (id) on delete set null,
  supplier_name varchar(100),          -- 快照
  supplier_phone varchar(20),          -- 快照
  status purchase_order_status not null default 'draft',
  ordered_amount numeric(12, 2) not null default 0,
  received_amount numeric(12, 2) not null default 0,
  expected_at timestamptz,
  submitted_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by_admin_id uuid references admin_users (id) on delete set null,
  submitted_by_admin_id uuid references admin_users (id) on delete set null,
  received_by_admin_id uuid references admin_users (id) on delete set null,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders (id) on delete cascade,
  product_sku_id uuid references product_skus (id) on delete restrict,  -- 可空：非售卖物料
  item_name varchar(100) not null,                                     -- 快照：商品名 + 规格
  unit varchar(20) not null,                                           -- 快照
  quantity_mode quantity_mode not null default 'integer',              -- 下单时快照
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_cost numeric(10, 2) not null check (unit_cost >= 0),
  received_quantity numeric(12, 2) not null default 0 check (received_quantity >= 0),
  amount numeric(12, 2) not null,
  difference_reason text
);

-- 商品行：同一采购单同一 SKU 只一行；非售卖物料（SKU 为空）可多行
create unique index purchase_order_items_sku_unique
  on purchase_order_items (purchase_order_id, product_sku_id)
  where product_sku_id is not null;
```

**为什么 `product_sku_id` 可空**：门店会采购包装袋、清洁用品等非售卖物料。它们计入采购金额，但不产生 SKU 库存流水。只有 `product_sku_id` 非空的行参与收货入库。

`quantity_mode` 在采购行做快照，避免 SKU 后续改模式影响历史单据的校验语义。

### 3.6 P1：盘点单

P0 先做“批量调整”（见 4.4），P1 再补正式盘点单：

- `stock_counts`：盘点单头（shop_id、count_no、status、created_by_admin_id、confirmed_at、remark）
- `stock_count_items`：product_sku_id、book_quantity、actual_quantity、diff_quantity，全部 `numeric(12,2)`

确认盘点时逐项生成 `adjustment` 流水；如果确认时发现当前库存已不同于账面快照，标记冲突并要求复盘，避免把盘点期间的销售差异算进盘盈亏。

### 3.7 迁移与回填

建议拆成两个迁移，降低风险：

#### `0015_sku.sql`：SKU 层

1. 建 `quantity_mode` 枚举、`catalog_skus`、`product_skus`。
2. 为每个 `catalog_products` 建一个默认 SKU：
   - `spec_name = '标准装'`
   - `unit / default_price / stock_type` 从总部商品复制
   - `quantity_mode` 按单位推断：`斤 / kg / L / 升` → `decimal_2`，其余 → `integer`；生成“待确认清单”，由平台运营复核
   - `is_default = true`，`status = 'active'`
3. 为每个 `products` 建一个默认 SKU：
   - 关联总部商品的：`catalog_sku_id` 指向对应默认 SKU，复制 `spec_name / unit / stock_type / quantity_mode`，`price = products.price`（可为 null，表示跟随）
   - 本地商品：`catalog_sku_id = null`，复制 `unit / price / stock_type`，`quantity_mode` 按单位推断
   - `is_available = products.is_available`
4. 旧 `product_stocks` 本迁移不动，余额留到 `0016` 迁移，避免 SKU 表与库存表同时大改。
5. 购物车切 SKU：
   - `cart_items` 增加 `product_sku_id`，按商品默认 SKU 回填；
   - `cart_items.quantity` 从 `integer` 改为 `numeric(12,2)`；
   - 删除旧唯一索引 `cart_items_cart_product_unique`，改为 `(cart_id, product_sku_id)`；
   - 代码切换完成后删除 `cart_items.product_id`。
6. 更新总部发布/铺货逻辑（见 6.5），保证新门店/新商品都能生成 SKU。

#### `0016_inventory.sql`：库存与采购

1. 建 `product_sku_stocks`、`stock_movements`、`suppliers`、`purchase_orders`、`purchase_order_items`。
2. 从 `product_stocks` 回填 `product_sku_stocks`：
   ```sql
   insert into product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
   select sku.id, ps.shop_id, ps.quantity::numeric(12,2), 0
   from product_stocks ps
   join product_skus sku on sku.product_id = ps.product_id and sku.is_default
   on conflict (product_sku_id) do nothing;
   ```
   `is_default` 保证每个商品只命中一条默认 SKU；本地商品同样适用。
3. 对已有 `product_sku_stocks.quantity > 0` 补一条 `initial` 期初流水，`balance_after = quantity`，操作人记系统，备注“系统初始化”。
4. 生成 `quantity_mode` 复核清单，重点列出按单位推断为 `decimal_2` 的 SKU（斤/kg/L 等），由运营确认是否确实允许小数。
5. 权限：给 `ops_manager` 补 `inventory.write`、`purchases.write`。

#### `0017_cleanup.sql`：清理过渡

- 删除 `product_stocks`；
- 删除 `cart_items.product_id`；
- 逐步移除 `catalog_products.unit/default_price/stock_type`、`products.price/unit/stock_type` 的写入口；
- 保留一版兼容读，确认无调用后删除。

### 3.8 兼容策略（重要）

为了不一次性推翻现有商品/铺货/购物车代码，P0 采用“**SKU 原生数据 + SPU 字段镜像**”：

- `catalog_skus` / `product_skus` 是事实来源；
- `catalog_products.unit/default_price/stock_type`、`products.price/unit/stock_type` 作为默认 SKU 的镜像字段保留；
- 写默认 SKU 时同步写镜像字段；读旧页面时仍可读镜像；
- 库存、采购、购物车、订单全部只认 SKU；
- P1 再清理镜像字段。

这样既能“直接上 SKU”，又不需要在一个版本里重写所有商品页面。

### 3.9 删除策略

- `stock_movements` 对 `product_skus` 用 `on delete restrict`：有流水的 SKU 不能硬删除。
- 有库存或流水的 SKU 只能停用/下架；删除接口返回 `409 SKU_HAS_STOCK_HISTORY`。
- 本地 SKU 无库存、无流水、无采购引用时可删除；总部 SKU 被门店引用时不可删除，只能停用。
- 商品删除同理：有 SKU/流水/采购引用时拒绝，建议下架或归档。

### 3.10 代码层同步

- 新增 `packages/db/src/schema/skus.ts`、`inventory.ts`、`purchases.ts`、`suppliers.ts`，并在 `schema/index.ts` 导出；
- `packages/db/drizzle.config.ts` 的 schema 列表现只包含 `shops.ts`、`admin-users.ts`，需要补齐，否则 `drizzle-kit` 看不到新表；
- `packages/db/src/client.ts` 的 `getDb()` 类型目前只声明了 `adminUsers`、`shops`，新表要么补全泛型，要么沿用现有 cast 方式，避免类型和运行时不一致；
- 新枚举 `quantity_mode`、`stock_movement_type`、`purchase_order_status` 在 `schema/enums.ts` 定义并导出；
- `apps/admin/lib/proxy.ts` 只负责转发，新增 BFF Route Handler 时保持与现有商品/店铺接口一致。

---

## 4. 库存维护机制

### 4.1 唯一写入口

| 场景 | `movement_type` | 方向 | 触发 |
| --- | --- | --- | --- |
| 采购收货 | `purchase_in` | + | 采购单确认收货 |
| 采购退货 | `purchase_return` | − | P1 采购退货单 |
| 销售出库 | `sale_out` | − | 订单支付/占用（订单模块） |
| 售后退货 | `order_return` | + | 售后同意并入库 |
| 盘盈/盘亏/手工调整 | `adjustment` | ± | 调整接口 |
| 报损/过期/破损 | `waste` | − | 损耗登记 |
| 期初库存 | `initial` | + | SKU 首次启用库存 |

### 4.2 直接改数字下线

- 现状 `PATCH /api/admin/products/:id/stock` 直接覆盖商品级库存，必须下线。
- 新后台不再在商品表单里直接填库存；商品/规格管理只负责“卖什么、多少钱、上不上架”，库存管理负责“有多少”。
- 商品编辑里的库存字段改为“查看库存 + 去库存管理调整”的入口，避免两个页面同时写库存。
- 新接口只接受 SKU 维度：`/api/admin/inventory/skus/:skuId/...`。

### 4.3 库存调整

统一接口，支持单 SKU 和批量（批量即轻量盘点）：

```json
POST /api/admin/inventory/adjustments
{
  "shopId": "shop-uuid",
  "operationId": "客户端生成的 uuid，用于幂等",
  "items": [
    {
      "skuId": "sku-uuid",
      "mode": "delta",
      "quantityChange": "-4.00",
      "reason": "waste",
      "remark": "破损"
    },
    {
      "skuId": "sku-uuid-2",
      "mode": "target",
      "targetQuantity": "18.00",
      "reason": "stocktake_loss",
      "remark": "盘点差异"
    }
  ],
  "remark": "8 月盘点"
}
```

规则：

- `reason` 枚举：`stocktake_gain` 盘盈、`stocktake_loss` 盘亏、`waste` 报损、`damage` 破损、`expired` 过期、`other` 其他；
- `waste/damage/expired` 写 `waste` 流水，其余写 `adjustment` 流水；
- `mode = target` 时，服务端在锁内计算 `delta = targetQuantity - quantity`；
- 任何一项会导致负库存，整批回滚；
- `operationId` 作为 `reference_id`，同一批重试不会重复写流水；
- 同一批内同一 SKU 只允许出现一次，重复项合并或直接拒绝（与幂等唯一索引口径一致）；
- 每个 SKU 按 `quantity_mode` 校验：`integer` 模式拒绝小数，`decimal_2` 模式拒绝超过两位小数；
- 返回每项“调整前 → 调整后”。

### 4.4 盘点

- **P0**：批量调整实现“轻量盘点”。库存页勾选多个 SKU，录入实盘数量，提交后一次性生成调整流水。每行流水都有 `operationId`、操作人、原因、备注，足够追溯。
- **P1**：正式盘点单，支持账面快照、实盘录入、差异复核、确认后生成流水、盘点期间冲突检测。

### 4.5 低库存预警

- 条件：`stock_type = 'tracked'` 且 `quantity <= min_threshold`；
- 默认只看上架 SKU（`product_skus.is_available = true`），提供“包含下架 SKU”开关；
- 展示：库存页顶部“低库存 N / 缺货 M”，仪表盘 `low_stock_count`；
- 通知：P1 再做站内/短信提醒；
- 不做“自动补货下单”，只提供“生成采购草稿”。

### 4.6 期初库存

- 新 SKU 首次启用 `tracked` 时，允许一次“期初登记”，写 `initial` 流水；
- 期初登记之后，任何变化都必须走调整/采购/销售，不能再次“期初覆盖”；
- 迁移时对已有余额自动补 `initial` 流水，保证对账从第一天起成立。

### 4.7 并发与幂等

- 余额更新用条件更新，避免超卖/负库存：
  ```sql
  update product_sku_stocks
     set quantity = quantity + $delta::numeric(12,2), updated_at = now()
   where product_sku_id = $skuId
     and shop_id = $shopId
     and quantity + $delta::numeric(12,2) >= 0
  returning quantity;
  ```
  影响行数为 0 即库存不足，整单回滚。
- 多 SKU 批量操作按 `product_sku_id` 升序处理，降低死锁概率。
- 采购收货、销售出库依赖 `stock_movements` 唯一索引保证幂等；重复收货返回 `409 PURCHASE_ALREADY_RECEIVED`，库存不变。
- 手工调整依赖客户端 `operationId` 保证幂等。
- 余额累加必须在 SQL 内完成，禁止先读后写；数量参数以 `numeric` 传入，避免浮点误差。

### 4.8 数量校验

统一在服务层做，所有入口共用：

- `integer`：解析后必须是整数（`1.00` 视为整数，`1.50` 拒绝）；
- `decimal_2`：最多两位小数；超过两位拒绝，不静默四舍五入；
- API 接受 `number | string`，写入前规范化为两位小数字符串；
- 返回给前端时建议用两位小数字符串（如 `"12.00"`），前端按 `quantity_mode` 决定是否展示小数；
- 采购单行金额按 `round(quantity × unit_cost, 2)`，采购单总额按行金额求和。

### 4.9 对账

提供一个对账 SQL/测试：

```sql
select ps.shop_id,
       ps.product_sku_id,
       ps.quantity as balance,
       coalesce(sum(m.quantity_change), 0) as ledger
from product_sku_stocks ps
left join stock_movements m
  on m.shop_id = ps.shop_id and m.product_sku_id = ps.product_sku_id
group by ps.shop_id, ps.product_sku_id, ps.quantity
having ps.quantity <> coalesce(sum(m.quantity_change), 0);
```

结果应为空。P1 可做成后台“库存对账”页面。

---

## 5. 采购协同

### 5.1 协同链路

```text
低库存 SKU 列表 ──建议──> 采购草稿 ──提交──> 已提交 ──收货──> 已入库
                                                          │
                                                          └─> purchase_in 流水 ─> SKU 库存增加

销售订单 ──支付/占用──> sale_out 流水 ─> SKU 库存减少
售后退货 ──同意入库──> order_return 流水 ─> SKU 库存增加
```

### 5.2 协同边界

| 协同点 | 做法 |
| --- | --- |
| 采购收货 → 库存 | 确认收货是唯一入库动作，事务内更新 SKU 余额 + 写 `purchase_in` + 更新采购单状态 |
| 低库存 → 采购 | 提供“生成采购草稿”，预填建议数量，人工确认后提交 |
| 采购明细 → 成本 | `unit_cost` 写入流水，P1 用于移动加权成本/毛利 |
| 库存流水 → 采购单 | 流水带 `reference_type = 'purchase_order'` + `reference_id`，可反查 |
| 供应商 → 采购单 | 门店级供应商，采购单存名称/电话快照 |

**不自动做的事：**

- 提交采购单不改库存；
- 低库存不自动创建/提交采购单；
- 总部不替门店采购（本期门店自采自存）；
- 销售订单不自动生成采购单（P1 可做补货建议）。

### 5.3 采购单状态机

```text
draft（草稿，可编辑）
  ├─ submit ─> submitted（已提交，锁定明细）
  │              ├─ receive ─> received（已入库，终态）
  │              └─ cancel  ─> cancelled
  └─ cancel ─> cancelled
```

规则：

- `draft` 可改明细、可删除；
- `submitted` 不可改明细，只能收货或取消；
- `received` 不可编辑，修正只能走采购退货（P1）或库存调整；
- 收货时允许按项填写实收数量，少于订购数量必须填差异原因；P0 一次收完，少收部分视为放弃、不保留待收，采购单直接进入 `received`；P1 才支持部分收货/多次收货。

### 5.4 采购行模型

- `product_sku_id` 非空：门店 SKU，收货后进 SKU 库存；
- `product_sku_id` 为空：包装袋、清洁用品等非售卖物料，只计入采购金额，不动 SKU 库存；
- `item_name`、`unit`、`quantity_mode` 做快照，SKU 改名/改单位/改模式不影响历史采购单；
- 同一采购单同一 SKU 只允许一行，便于收货流水幂等；
- 保存/提交时必须校验 `product_sku_id` 属于该采购单的 `shop_id`，不能跨店引用 SKU。

### 5.5 收货事务

```text
BEGIN
  锁采购单（select ... for update），校验 status = 'submitted' 且 shop_id 匹配
  读取明细，按 product_sku_id 升序
  for 每条 product_sku_id 非空且 received_quantity > 0 的明细：
    校验 received_quantity 符合该 SKU 的 quantity_mode
    update product_sku_stocks
       set quantity = quantity + received_quantity
     where product_sku_id = ? and shop_id = ?
    returning quantity
    如果无行 → 报 STOCK_ROW_MISSING，回滚
    插入 stock_movements(purchase_in, +received_quantity, balance_after, unit_cost,
                        reference_type='purchase_order', reference_id=po.id)
  更新明细 received_quantity / difference_reason
  更新采购单 status='received'、received_at、received_by_admin_id、received_amount
COMMIT
```

关键点：

- 余额更新和流水插入必须同一事务；
- 唯一索引 `(shop_id, product_sku_id, purchase_in, purchase_order, po_id)` 防止重复收货；
- 重复调用返回 409，不重复加库存；
- 如果采购单里有 SKU 行但 `product_sku_stocks` 行缺失，先补 0 行再收货，或直接报错让运营检查 SKU 追踪策略。

### 5.6 建议采购数量

低库存页“生成采购草稿”时：

```text
建议数量 = max_threshold 存在 ? max(max_threshold - quantity, 最小步长)
                              : max(quantity <= min_threshold ? min_threshold * 2 - quantity : 最小步长, 最小步长)
```

- `integer` 模式向上取整；
- `decimal_2` 模式保留两位小数；
- 这是启发式，最终数量由运营改，不自动下单。

### 5.7 多店与统采统配

- 本期：**门店自采自存**。每个门店自己的供应商、采购单、SKU 库存；总部只维护商品库和看汇总报表。
- 如果未来要“总部统一采购 + 总仓 + 调拨到店”，需要新增 `warehouses`、`stock_transfers`、总部采购单，属于另一套模型，不在本期。
- 不建议在 `catalog_products` / `catalog_skus` 上加库存字段。

---

## 6. 门店 SKU 库存如何维护

### 6.1 SKU 生命周期

| 时点 | 动作 |
| --- | --- |
| 新建门店商品且 `tracked` | 为每个 SKU 创建 `product_sku_stocks` 行，`quantity = 0` |
| 总部商品发布/铺货 | 为门店商品创建对应 `product_skus` + 0 库存行 |
| 总部新增 SKU | 给已铺该 SPU 的门店补 `product_skus`，默认 `is_available = false`，库存 0；运营确认后上架 |
| `untracked → tracked` | 为每个 SKU 创建 0 行，提示做期初登记 |
| `tracked → untracked` | 保留行和历史流水，停止参与预警/扣减 |
| SKU 删除 | 有库存/流水/采购引用则拒绝，改用停用 |
| 商品删除 | 有 SKU/流水/采购引用则拒绝，改用下架/归档 |
| 门店删除 | 级联删除库存与采购数据（门店停用优先，不建议硬删） |

### 6.2 操作主体与权限

已拍板：**平台运营维护**。

| 角色 | 权限 |
| --- | --- |
| `super_admin` | 全部权限 |
| `ops_manager` | 现有商品/总部商品权限 + 补 `inventory.write`、`purchases.write`（按最小授权，发布/强制下架是否保留给超管可另定） |
| `viewer` | 只读 |

落地要点：

- 给 `ops_manager` 补 `inventory.write`、`purchases.write`（写在 `0016_inventory.sql`）：
  ```sql
  insert into admin_role_permissions (role_id, permission_id)
  select r.id, p.id
  from admin_roles r
  join admin_permissions p on p.code in ('inventory.write', 'purchases.write')
  where r.code = 'ops_manager'
  on conflict (role_id, permission_id) do nothing;
  ```
- 库存/采购页面必须有**门店选择器**；运营可以选择任意门店，但页面要持续显示“当前门店”，避免误操作。
- 所有写操作记录 `operator_admin_id`；采购单记录 `created_by_admin_id/submitted_by_admin_id/received_by_admin_id`。
- 本期不做店长/店员自助；`shop_members` 不接入库存。
- 平台运营可操作所有门店，P1 可补“库存阈值/供应商变更”的独立审计日志。

### 6.3 后台页面

#### 库存管理（替换占位页）

- 顶部：门店选择、分类筛选、关键词、条码搜索、低库存开关、数量模式筛选；
- 汇总：SKU 数、库存总量、低库存数、缺货数（P1 加库存金额）；
- 列表按 SKU 展示：商品、规格、条码、单位、数量模式、当前库存、安全库存、状态（正常/低库存/缺货/不追踪）、最近变动、操作；
- 支持按商品分组折叠；
- 操作：调整库存、查看流水、设置预警线；
- 调整弹窗：原因、方式（增减/设为）、数量（按 `quantity_mode` 控制步长与校验）、备注、调整前后预览；
- 批量盘点：勾选 SKU → 录入实盘 → 一次提交（P0 轻量盘点）。

#### 采购管理（替换占位页）

- Tab：采购单 / 供应商；
- 采购单列表：单号、供应商、状态、下单金额、实收金额、预计到货、创建人、创建时间；
- 新建：选供应商（可内联新建）、加 SKU 行（显示商品/规格/条码/当前库存/数量模式）、数量、进价、预计到货、备注；保存草稿 / 提交；
- 非售卖物料：允许新增自由文本行，不选 SKU，不计库存；
- 详情：明细、状态时间线、操作（提交、收货、取消）；
- 收货弹窗：逐项实收数量、实收单价、差异原因；数量按 `quantity_mode` 校验；确认后展示库存变化；
- 供应商：名称、联系人、电话、状态、备注；停用而非删除。

#### 商品/规格管理页调整

- 商品列表保留“SKU 数、总库存、价格区间”汇总；
- 商品编辑增加“规格”区域：规格名、条码、单位、建议价/本店价、库存追踪、数量模式、上下架、排序；
- 单规格商品默认一个“标准装”SKU，原有单规格表单字段映射到该 SKU；
- 新建商品若 `tracked`，创建后自动生成 0 库存行；
- 商品表单不再直接写库存，只提供“查看库存/去调整”入口。

#### 仪表盘

- `low_stock_count` 按 SKU 统计；
- P1 增加“近 7 天出库/入库”“库存金额”“损耗金额”。

### 6.4 C 端（移动端/Web）

- 商品列表返回 SPU + `skus` 数组：
  ```json
  {
    "id": "product-uuid",
    "name": "猪肉",
    "skus": [
      {
        "id": "sku-uuid",
        "specName": "500g/份",
        "unit": "份",
        "price": "28.00",
        "quantityMode": "decimal_2",
        "stockQuantity": "6.50",
        "soldOut": false
      }
    ]
  }
  ```
- 单 SKU 商品：卡片保持“直接加购”，自动使用默认 SKU；
- 多 SKU 商品：点击弹出规格选择，售罄规格禁用；
- 商品卡片价格：默认 SKU 价或价格区间；
- 商品级库存状态：全部 SKU 售罄 → “已售完”；部分售罄 → “部分缺货”；`untracked` → 始终可售且不返回 `stockQuantity`；
- 加购/改数量必须传 `skuId`，服务端校验库存和 `quantity_mode`；
- 库存不足返回 `INSUFFICIENT_STOCK`（附可用数量），前端收敛数量或提示；
- 下单/结算校验在订单模块接入时补。

### 6.5 总部 SKU 的铺货规则

现有逻辑：

- 总部商品发布时，自动给所有门店补 `products` 行；
- 新门店创建时，自动铺全部已发布商品。

SKU 化后需要同步扩展：

1. **发布总部商品**：除了补 `products`，还要为每个已发布 SPU 下的 `active` SKU 补 `product_skus` + 0 库存行。
2. **新建门店**：铺货时同样补 `product_skus` + 0 库存行。
3. **总部新增 SKU**：
   - 给已铺该 SPU 的门店补 `product_skus`；
   - 默认 `is_available = false`，避免新规格自动出现在 C 端；
   - 运营在门店商品页确认后上架。
4. **总部停用 SKU**：
   - `catalog_skus.status = 'disabled'`，门店 SKU 不可售；
   - 门店已有库存保留，可做清仓/报损；
   - 停用默认 SKU 前必须先指定另一个默认 SKU。
5. **总部修改共享字段**：
   - `spec_name / barcode / unit / stock_type / quantity_mode` 同步到关联门店 SKU；
   - `quantity_mode` 从 `decimal_2` 改为 `integer` 时，若该 SKU 的库存、阈值、采购待收/已收数量存在小数，拒绝修改并返回受影响门店清单，先清理再切换。
6. **幂等**：所有铺货用 `on conflict do nothing`，不覆盖门店已改的价格、上下架、排序：
   ```sql
   insert into product_skus (...)
   select ...
   on conflict (shop_id, catalog_sku_id) where catalog_sku_id is not null do nothing;

   insert into product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
   select sku.id, sku.shop_id, 0, 0
   from product_skus sku
   join products p on p.id = sku.product_id
   where p.catalog_product_id = $catalogProductId
   on conflict (product_sku_id) do nothing;
   ```
7. **实现提示**：发布/铺货的 `insert into products ... returning id, shop_id` 之后，用同一次请求补 `product_skus`；不要在应用层按门店循环查询，避免 N+1。

### 6.6 数据隔离与操作上下文

- 所有库存/采购查询强制带 `shop_id`；
- 通过 `skuId` 反查 `shop_id` 后再做权限判断，不能信任请求体里的 `shopId`；
- 平台运营可以切换门店，但一次操作只能作用于一个门店；
- 跨店汇总走单独的只读报表接口（P2），不在操作页面混排。

---

## 7. API 设计

沿用现有 `/api/admin/*` 风格和统一响应。

### 7.1 SKU 管理

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/admin/catalog/products/:productId/skus` | 总部商品规格列表 | `catalog.read` |
| POST | `/api/admin/catalog/products/:productId/skus` | 新增总部规格 | `catalog.write` |
| PATCH | `/api/admin/catalog/skus/:id` | 编辑总部规格 | `catalog.write` |
| GET | `/api/admin/products/:productId/skus` | 门店商品规格列表 | `products.read` |
| POST | `/api/admin/products/:productId/skus` | 新增本地规格 | `products.write` |
| PATCH | `/api/admin/product-skus/:id` | 编辑门店规格（价格/上下架/排序） | `products.write` |
| PATCH | `/api/admin/product-skus/:id/availability` | 上架/下架 | `products.write` |
| DELETE | `/api/admin/product-skus/:id` | 删除本地规格（无库存/流水/采购引用） | `products.write` |

### 7.2 库存

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/admin/inventory?shopId=&categoryId=&keyword=&barcode=&lowStock=&quantityMode=&page=&pageSize=` | SKU 库存列表 | `inventory.read` |
| GET | `/api/admin/inventory/alerts?shopId=&includeUnavailable=` | 低库存/缺货 SKU 列表 | `inventory.read` |
| GET | `/api/admin/inventory/skus/:skuId` | 单个 SKU 库存详情 | `inventory.read` |
| GET | `/api/admin/inventory/skus/:skuId/movements?page=` | 该 SKU 流水 | `inventory.read` |
| GET | `/api/admin/inventory/movements?shopId=&type=&from=&to=&page=` | 全店流水 | `inventory.read` |
| POST | `/api/admin/inventory/adjustments` | 调整/损耗/轻量盘点（批量） | `inventory.write` |
| PATCH | `/api/admin/inventory/skus/:skuId/threshold` | 设置安全库存/补货上限 | `inventory.write` |

### 7.3 供应商与采购

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/admin/suppliers?shopId=&keyword=` | 供应商列表 | `purchases.read` |
| POST | `/api/admin/suppliers` | 新建供应商 | `purchases.write` |
| PATCH | `/api/admin/suppliers/:id` | 编辑/停用 | `purchases.write` |
| GET | `/api/admin/purchases?shopId=&status=&page=` | 采购单列表 | `purchases.read` |
| GET | `/api/admin/purchases/:id` | 采购单详情 | `purchases.read` |
| POST | `/api/admin/purchases` | 创建草稿 | `purchases.write` |
| PATCH | `/api/admin/purchases/:id` | 编辑草稿 | `purchases.write` |
| POST | `/api/admin/purchases/:id/submit` | 提交 | `purchases.write` |
| POST | `/api/admin/purchases/:id/receive` | 确认收货 | `purchases.write` |
| POST | `/api/admin/purchases/:id/cancel` | 取消 | `purchases.write` |
| POST | `/api/admin/purchases/from-alerts` | 按低库存生成草稿（可选） | `purchases.write` |

### 7.4 收货请求示例

```json
POST /api/admin/purchases/:id/receive
{
  "items": [
    {
      "id": "item-uuid-1",
      "receivedQuantity": "48.00",
      "unitCost": 28.0,
      "differenceReason": "少收 2kg"
    },
    {
      "id": "item-uuid-2",
      "receivedQuantity": "30.00",
      "unitCost": 12.0
    }
  ],
  "remark": "供应商送货"
}
```

### 7.5 购物车与 C 端

- `POST /api/mobile/cart/items`：body 改为 `{ "skuId": "...", "quantity": "1.00" }`；
- 过渡期可兼容 `productId`：服务端解析默认 SKU，并标记 deprecated；
- 购物车返回规格名、单位、数量模式、当前库存；
- 商品列表返回 `skus` 数组（见 6.4）。

### 7.6 错误码

| 错误码 | 场景 |
| --- | --- |
| `STOCK_NOT_TRACKED` | 对 `untracked` SKU 做库存操作 |
| `STOCK_INSUFFICIENT` | 出库/调整后为负 |
| `STOCK_ROW_MISSING` | 收货时 SKU 库存行缺失 |
| `SKU_NOT_IN_SHOP` | SKU 不属于该门店 |
| `INVALID_QUANTITY_MODE` | 数量模式不合法 |
| `INVALID_QUANTITY_PRECISION` | 数量小数位超出模式限制 |
| `PURCHASE_NOT_EDITABLE` | 非草稿状态编辑 |
| `PURCHASE_ALREADY_RECEIVED` | 重复收货 |
| `PURCHASE_ITEM_MISMATCH` | 收货明细与采购单不匹配 |
| `SKU_HAS_STOCK_HISTORY` | 有流水/库存的 SKU 被删除 |
| `FORBIDDEN` | 缺少权限 |

### 7.7 BFF 与路由注册

- `packages/api/src/routes/skus.ts`、`inventory.ts`、`purchases.ts`、`suppliers.ts`；
- `app.route('/api/admin', skuRoutes)` 等，与现有 products/catalog 路由一致；
- admin 端为每个接口补 `apps/admin/app/api/admin/inventory/**`、`purchases/**`、`suppliers/**`、`product-skus/**` 的 Route Handler，复用 `lib/proxy.ts`。

---

## 8. 与订单模块的衔接

订单模块尚未实现，但库存按 SKU 后，订单契约必须提前定好。

### 8.1 占用与扣减时机

两份 PRD 口径不一致：

- `PRD-捎点啥-sds-v0.1.md` R-04：下单提交时校验并占用库存，支付超时/取消回补；
- `SDS-PRD.md` 5.15：支付成功时扣减库存。

建议采用**下单占用 + 支付扣减**：

```text
提交订单：reserved_quantity += n（可用 = quantity - reserved）
支付成功：reserved_quantity -= n；quantity -= n；写 sale_out
取消/超时：reserved_quantity -= n
售后退货：quantity += n；写 order_return
```

订单模块落地时给 `product_sku_stocks` 增量加 `reserved_quantity` 即可，本期不预埋。

### 8.2 订单侧需要调用的库存能力

- `reserve(orderId, items)`：按 SKU 条件更新占用，失败返回缺货 SKU；
- `release(orderId)`：取消/超时释放；
- `commit(orderId)`：支付成功转扣减 + `sale_out`；
- `return(orderId/afterSaleId, items)`：售后退货入库 + `order_return`；
- 所有方法在同一数据库事务内被订单服务调用，幂等键用订单/售后 ID；
- 订单项必须快照 `product_sku_id / spec_name / unit / quantity_mode / unit_price`。

---

## 9. 分阶段落地

| 阶段 | 内容 | 规模 |
| --- | --- | --- |
| P0-0 | `0015` SKU 层、存量回填默认 SKU、购物车切 SKU、总部发布/铺货补 SKU | M/L |
| P0-1 | `0016` 库存表、期初流水、对账 SQL | S/M |
| P0-2 | 库存 API（SKU 列表/详情/流水/预警/调整/阈值）+ 权限守卫 | M |
| P0-3 | 库存后台页（SKU 列表、调整、流水、预警、轻量盘点、门店选择） | M |
| P0-4 | 供应商 + 采购单 API（草稿/提交/收货/取消）+ 收货事务与幂等 | M |
| P0-5 | 采购后台页（列表、新建、详情、收货、供应商） | M |
| P0-6 | 商品/规格管理页 SKU 化、C 端 SKU 展示与加购校验、仪表盘低库存 | M |
| P1 | `0017` 清理过渡字段、盘点单、采购退货、部分收货、移动加权成本/毛利、通知、报表 | L |
| P2 | 总仓/调拨、跨店采购汇总、自动补货建议、条码/扫码 | L |

粗略投入：P0 约 12–18 人日（1 名全栈），其中 SKU 回填/铺货改造、采购收货事务、后台 SKU 表单占大头。

### 9.1 P0 验收标准

1. 存量商品全部有且仅有一个默认 SKU；库存余额迁移后与旧 `product_stocks` 一致。
2. 新建 `tracked` SKU 后库存为 0，C 端显示售罄且不能加购。
3. 采购单提交后库存不变；收货 10.00 后库存 10.00，流水 `+10.00 / balance 10.00`，采购单变 `received`。
4. 重复收货返回 409，库存仍为 10.00。
5. `integer` 模式 SKU 收货 1.50 被拒绝；`decimal_2` 模式 SKU 收货 1.50 成功。
6. `decimal_2` 模式 SKU 收货 1.234 被拒绝；库存不被静默四舍五入。
7. 报损 3.00 后库存 7.00，流水 `-3.00 / balance 7.00`；再报损 8.00 被拒绝，库存不变。
8. 调整/盘点批量提交后，每项都有流水，且 `quantity = Σ quantity_change`。
9. 库存 7.00、阈值 8.00 时进入低库存列表；`untracked` SKU 不进入。
10. 加购物车必须传 `skuId`；库存不足返回 `INSUFFICIENT_STOCK`。
11. 跨店访问 SKU 库存返回 403/404。
12. 有流水/库存的 SKU 删除被拒绝，提示改用停用。
13. 对账 SQL 结果为空。
14. `ops_manager` 能维护库存/采购；`viewer` 只能查看。

---

## 10. 不做清单

1. **不复活 PRD 的 `inventory` + `raw_material_name` 模型**。
2. **不保留商品级库存作为长期模型**：`product_stocks` 只做迁移过渡，最终删除。
3. **不在 `catalog_products` / `catalog_skus` 上放库存**。
4. **不允许商品编辑直接改库存**：所有数量变化走调整/流水。
5. **不做低库存自动下单**：只生成采购草稿，人工确认。
6. **不做总部统采统配/总仓/调拨**：本期门店自采自存。
7. **不做移动加权成本/毛利**：P1 再上；但 `unit_cost` 先写进流水。
8. **不做店长/店员自助库存**：本期只做平台运营。
9. **不做库存通知/短信**：P0 先列表和角标。

---

## 11. 剩余待拍板事项

| # | 事项 | 选项 | 建议 |
| --- | --- | --- | --- |
| 1 | 存量 SKU 的 `quantity_mode` 默认值 | 全部 `integer` / 按单位推断 | 按单位推断（斤/kg/L → decimal_2，其余 integer），生成复核清单 |
| 2 | 总部新增 SKU 是否自动铺到门店 | 自动 `is_available=false` / 自动 `true` / 手动领取 | 自动创建但默认下架，运营确认后上架 |
| 3 | 多 SKU 商品的 C 端交互 | P0 就做规格选择 / 先单 SKU | 数据/API 先 SKU 化；有多 SKU 商品时 P0 做规格选择，否则先用默认 SKU |
| 4 | 采购是否支持部分收货 | P0 / P1 | P0 一次收完（可按项少收并填原因），P1 部分收货 |
| 5 | 盘点 | 轻量批量调整 / 正式盘点单 | P0 轻量，P1 正式盘点单 |
| 6 | 成本核算 | 不做 / 移动加权 | P1 做；P0 先存 `unit_cost` |
| 7 | 商品/SKU 删除 | 有历史禁止 / 软删除 | 有历史禁止；本地商品/SKU 用下架/停用 |
| 8 | 兼容镜像字段保留多久 | 一个版本 / 长期 | 一个版本，`0017` 清理 |

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| SKU 回填不完整 | 商品无法售卖/库存丢失 | 迁移脚本对每个商品保证至少一个默认 SKU，迁移后跑校验 SQL |
| 总部发布/铺货未补 SKU | 新门店商品没有可售规格 | 发布、建店、一键铺货三处统一调用 SKU 铺货逻辑，幂等 |
| 购物车仍按商品 | 同一商品多规格无法区分 | P0 同步把 `cart_items` 切到 `product_sku_id`，过渡期兼容默认 SKU |
| 数量浮点误差 | 账实不符 | 金额/数量都用 `numeric`，累加在 SQL 内完成，API 写入前校验两位小数 |
| `integer` 模式被写入小数 | 库存出现不该有的零头 | 服务层统一校验；测试覆盖调整/收货/加购/改数量 |
| 重复收货 | 库存虚增 | 流水唯一索引 + 采购单状态校验 |
| 并发调整/出库 | 负库存、覆盖写 | 条件更新 + 按 SKU 排序 + 事务 |
| 平台运营误操作他店 | 数据被改错 | 页面持续显示当前门店；所有接口校验 SKU 归属；操作人留痕 |
| 删除有历史 SKU | 流水断链 | `on delete restrict`，返回 409，改用停用 |
| 兼容镜像字段长期漂移 | 新旧口径不一致 | 写默认 SKU 时同步镜像；`0017` 清理 |
| 总部新增 SKU 默认自动上架 | C 端出现意外规格 | 默认 `is_available=false`，运营确认后上架 |

---

## 13. 一页流程总结

```text
总部商品 catalog_products（SPU）
        │ 发布
        ▼
总部规格 catalog_skus（SKU：规格/条码/单位/建议价/数量模式）
        │ 铺货
        ▼
门店商品 products（SPU，每店一行）
        │
        ▼
门店规格 product_skus（每店每个 SKU 一行，价格/上下架可覆盖）
        │ 1:1
        ▼
product_sku_stocks（SKU 库存余额 + 预警线）
        ▲
        │ 流水累计
stock_movements（唯一事实来源）
        ▲
        ├── 采购单 purchase_orders ──收货──┘ purchase_in
        ├── 销售订单（后续）────────支付───┘ sale_out
        ├── 售后退货（后续）────────入库───┘ order_return
        ├── 报损/损耗 ─────────────────────┘ waste
        └── 盘点/手工调整 ─────────────────┘ adjustment
```

一句话：**库存按门店 SKU 记账，流水是唯一写入口；采购是入库来源，订单是出库来源；总部只管商品与规格，不管库存；数量统一两位小数，但每个 SKU 自己声明是否必须整数。**
