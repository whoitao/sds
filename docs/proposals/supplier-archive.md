# 供应商档案改造方案（先建档案，再用于采购）

> 状态：方案讨论稿，未改代码  
> 范围：admin 端供应商主体、门店供货关系、采购管理选供应商  
> 数据口径：2026-11-18 本地开发库实测（非生产）

---

## 1. 结论摘要

1. 现状的 `suppliers` 是**门店附属表**：`shop_id NOT NULL`，供应商只能在某个门店下创建，采购单也强制按门店查询。
2. 采购单已保存 `supplier_id` 与 `supplier_name / supplier_phone` 快照（`ON DELETE SET NULL`），所以**历史单据本身不会因为改造丢供应商信息**，这是本次迁移最大的有利条件。
3. 建议把 `suppliers` 升级为**平台级供应商主体**，新增 `shop_suppliers` 表达「供应商—门店」多对多供货关系；`purchase_orders` 继续同时保留 `shop_id` 与 `supplier_id`，不改历史语义。
4. 迁移是**加法为主**：新增关联表、新字段、放宽 `shop_id` 约束并回填关系；采购单只需补索引，不重写历史快照。
5. 本地库规模很小：4 个门店、10 个供应商（全部属于 1 个门店）、50 张采购单（20 草稿 / 14 待入库 / 9 已入库 / 7 已取消），且 50 张单都带 `supplier_id`，没有「只填名字」的单据，迁移风险低；生产库需按同样口径重新盘点。

---

## 2. 现状梳理

### 2.1 数据层

**供应商表 `suppliers`**（[packages/db/src/schema/purchases.ts L17-L36](file:///Users/whoitao/cyber/github/sds/packages/db/src/schema/purchases.ts#L17-L36)，DDL 见 [0016_inventory.sql L81-L94](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0016_inventory.sql#L80-L94)）

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | uuid | PK |
| `shop_id` | uuid | **NOT NULL**，FK `shops(id) ON DELETE CASCADE` |
| `name` | varchar(100) | NOT NULL，无唯一约束 |
| `contact_name` | varchar(50) | 可空 |
| `phone` | varchar(20) | 可空（接口允许 30 位） |
| `status` | varchar(16) | 默认 `active`，CHECK `active/disabled` |
| `remark` | text | 可空 |
| `created_at` / `updated_at` | timestamptz | 默认 now() |

索引只有 `suppliers_shop_idx (shop_id, status)`（[0016 L94](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0016_inventory.sql#L94)）。  
没有编码、地址、税号、结算方式；没有跨门店供货关系；同名供应商不拦截。

**采购单 `purchase_orders`**（[purchases.ts L38-L84](file:///Users/whoitao/cyber/github/sds/packages/db/src/schema/purchases.ts#L38-L84)，DDL 见 [0016 L97-L123](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0016_inventory.sql#L96-L123)）

- `shop_id NOT NULL`，FK `shops(id) ON DELETE CASCADE`；
- `supplier_id` 可空，FK `suppliers(id) ON DELETE SET NULL`；
- 同时冗余 `supplier_name`、`supplier_phone` 作为**下单时快照**；
- 仅有 `po_no` 唯一索引与 `(shop_id, status, created_at)` 索引，**没有 `supplier_id` 索引**。

**采购明细** `purchase_order_items` 与供应商无直接关系（[purchases.ts L90-L117](file:///Users/whoitao/cyber/github/sds/packages/db/src/schema/purchases.ts#L90-L117)）；入库写库存流水时也不带供应商维度（[purchases.ts L828-L863](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L828-L863)）。

**当前数据量（本地库实测）**

| 指标 | 数值 |
|---|---|
| 门店总数 | 4 |
| 门店状态 | 全部 `open` |
| 供应商总数 | 10 |
| 有供应商的门店数 | 1（该门店 10 个，其余 3 个为 0） |
| 停用供应商 | 0 |
| 跨门店同名供应商组 | 0 |
| 采购单总数 | 50 |
| 带 `supplier_id` 的采购单 | 50（100%） |
| 仅手填名称、无 `supplier_id` | 0 |
| 无门店的供应商 / 悬挂 `supplier_id` | 0 / 0 |

> 生产环境可能不同，迁移前需在生产只读库重复这组统计（SQL 见 4.1）。

### 2.2 接口层

全部位于 [packages/api/src/routes/purchases.ts](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts)，权限统一 `purchases.read / purchases.write`：

| 接口 | 行号 | 约束 |
|---|---|---|
| `GET /api/admin/suppliers` | [L87-L128](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L87-L128) | **必须传 `shopId`**，只返回该门店供应商；关键词/状态筛选；分页上限 100 |
| `POST /api/admin/suppliers` | [L130-L151](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L130-L151) | body 必须含 `shopId`，校验 `purchases.write` 的门店范围 |
| `PATCH /api/admin/suppliers/:id` | [L153-L183](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L153-L183) | 名称/联系人/电话/备注/状态；**无删除接口** |
| `POST /api/admin/purchases` | [L494-L560](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L494-L560) | 供应商必须属于当前 `shopId`（见下） |
| `PATCH /api/admin/purchases/:id` | [L574-L668](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L574-L668) | 仅草稿可改，换供应商同样走同门店校验 |
| `GET /api/admin/purchases` | [L344-L410](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L344-L410) | **必须传 `shopId`** |

关键校验 `resolveSupplierSnapshot`（[L297-L328](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L297-L328)）：

```ts
.where(and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shopId)))
```

即供应商跨门店不可用；不传 `supplierId` 时允许手填 `supplierName` 作为无档案供应商（[L304-L308](file:///Users/whoitao/cyber/github/sds/packages/api/src/routes/purchases.ts#L304-L308)）。

权限定义：`purchases.read/write`（[0004_admin_rbac.sql L73-L76](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0004_admin_rbac.sql#L73-L76)）；`viewer` 自动获得全部 read（[L88-L94](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0004_admin_rbac.sql#L88-L94)）；`ops_manager` 只读（[L96-L110](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0004_admin_rbac.sql#L96-L110)），写权限在 0016 追加（[0016 L170-L176](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0016_inventory.sql#L170-L176)）。

管理端代理：`GET/POST /api/admin/suppliers` 与 `PATCH /api/admin/suppliers/:id`（[route.ts](file:///Users/whoitao/cyber/github/sds/apps/admin/app/api/admin/suppliers/route.ts)、[[id]/route.ts](file:///Users/whoitao/cyber/github/sds/apps/admin/app/api/admin/suppliers/[id]/route.ts)）。

### 2.3 admin 界面

入口不在独立菜单，而在**采购管理页的第二个 Tab**（[purchases/page.tsx L767-L806](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L767-L806>)）：

- 页头先选门店（[L728-L741](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L728-L741>)），默认没有门店时两个 Tab 都是空的；
- 「供应商」Tab 列出当前门店的供应商：名称、联系人、电话、状态、编辑（[L566-L598](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L566-L598>)）；
- 「新建供应商」弹窗只有名称、联系人、电话、备注，编辑时才出现启停（[L1014-L1063](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L1014-L1063>)）；
- 新建采购单时，供应商下拉来自 `/api/admin/suppliers?shopId=...`（[L212-L230](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L212-L230)、[L819-L844](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L819-L844>)），只展示 `active`；选不到时可直接手填供应商名称+电话。

### 2.4 迁移会涉及什么

- 代码：`suppliers` 的 schema、3 个供应商接口、采购创建/编辑的供应商校验、管理端两个页面 + 代理路由；
- 数据：`suppliers.shop_id` 的去约束/回填、`purchase_orders.supplier_id` 去重重指向（如有重复）；
- 语义：删除门店时的行为要从「级联删供应商」改为「删供货关系，不删主体」；这是**必须处理的数据安全点**（当前 FK 为 `ON DELETE CASCADE`，[0016 L83](file:///Users/whoitao/cyber/github/sds/packages/db/sql/0016_inventory.sql#L83)）。

---

## 3. 目标模型

### 3.1 实体关系

```
suppliers (主体, 平台级)
   │ 1
   │
   ├──< shop_suppliers (供货关系, 多对多) >── shops
   │
   └──< purchase_orders (shop_id + supplier_id + 快照)
```

- 供应商主体只存一次，可被多个门店使用；
- 某门店能选哪些供应商 = `shop_suppliers` 中 `status='active'` 的关系；
- 采购单仍记录实际收货门店 `shop_id`，并记录下单时的供应商 `supplier_id` 与名称/电话快照。

### 3.2 表结构建议

#### A. 升级 `suppliers`（复用现有表）

```sql
ALTER TABLE suppliers
  ADD COLUMN code varchar(32),                 -- 供应商编码，如 SUP-0001
  ADD COLUMN address varchar(200),
  ADD COLUMN settlement_method varchar(24),    -- cash / monthly / weekly / other
  ADD COLUMN tax_no varchar(32),
  ADD COLUMN email varchar(120),
  ADD COLUMN last_purchase_at timestamptz,     -- 可选，冗余展示
  ADD COLUMN created_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  ADD COLUMN updated_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL;

-- 历史来源门店：保留一版用于追溯，不再参与业务判断
ALTER TABLE suppliers RENAME COLUMN shop_id TO legacy_shop_id;
ALTER TABLE suppliers ALTER COLUMN legacy_shop_id DROP NOT NULL;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_shop_id_fkey;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_legacy_shop_fk
  FOREIGN KEY (legacy_shop_id) REFERENCES shops (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX suppliers_code_unique
  ON suppliers (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX suppliers_name_normalized_unique
  ON suppliers (lower(btrim(name)));           -- 见开放问题 4：是否允许同名不同法人
CREATE INDEX suppliers_status_name_idx ON suppliers (status, name);
```

字段说明：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `code` | varchar(32) | 部分唯一 | 用于采购单/对账展示，建议后端自动生成 `SUP-000001`，也允许手工填 |
| `name` | varchar(100) | NOT NULL，归一化唯一 | 沿用现有 |
| `contact_name` / `phone` | varchar | 可空 | 沿用现有（接口 phone 放宽到 30 位，建议统一为 32） |
| `address` | varchar(200) | 可空 | 送货地址/主体地址 |
| `settlement_method` | varchar(24) | CHECK | `cash / weekly / monthly / other`，结算周期可放后续 |
| `tax_no` | varchar(32) | 可空 | 开票/对账用 |
| `email` | varchar(120) | 可空 | 可选 |
| `remark` | text | 可空 | 沿用现有 |
| `status` | varchar(16) | `active/disabled` | 沿用现有，不新增 `archived`，停用即不可选 |
| `legacy_shop_id` | uuid | 可空 | 仅记录迁移来源；新数据为空；第三阶段可删 |
| `created_at/updated_at` | timestamptz | 默认 now() | 现有 PATCH 未更新 `updated_at`，改造时补上 |

> 如果不想改列名，也可保留 `shop_id` 名称但改为可空并标注废弃；推荐重命名，避免新代码误用。

#### B. 新增 `shop_suppliers`（供货关系）

```sql
CREATE TABLE shop_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'active',
  note text,
  created_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_suppliers_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT shop_suppliers_unique UNIQUE (supplier_id, shop_id)
);

CREATE INDEX shop_suppliers_shop_idx ON shop_suppliers (shop_id, status);
CREATE INDEX shop_suppliers_supplier_idx ON shop_suppliers (supplier_id);
```

- 关系级启停：供应商全局停用（`suppliers.status=disabled`）或关系停用（`shop_suppliers.status=disabled`）任一命中，该门店不可选；
- 删除供应商主体时关系级联删除；删除门店时只删关系，不动主体（与现状相反，需在迁移中显式修正）。

#### C. `purchase_orders` 调整

```sql
CREATE INDEX purchase_orders_supplier_idx
  ON purchase_orders (supplier_id, created_at DESC);

-- 可选：记录下单时供应商编码快照，便于历史导出
ALTER TABLE purchase_orders ADD COLUMN supplier_code_snapshot varchar(32);
```

`shop_id`、`supplier_id`、`supplier_name`、`supplier_phone` 全部保留：
- `supplier_id` 指向主体（改主体名称不回写历史）；
- 历史展示优先用快照，详情页可跳转档案；两者不一致时提示「档案名称已变更」。

**不建议**把供应商信息塞进采购单作为唯一来源（无法复用、无法做供货门店约束），也不建议只在采购单上同时记录两个 ID 而不建关系表（无法维护「某供应商给哪些门店供货」）。

---

## 4. 迁移方案

### 4.1 迁移前盘点 SQL（生产只读执行）

```sql
-- 规模
SELECT count(*) shops FROM shops;
SELECT count(*) total,
       count(DISTINCT shop_id) shops,
       count(*) FILTER (WHERE status='disabled') disabled
FROM suppliers;

-- 跨门店同名（候选合并组）
SELECT lower(btrim(name)) k, count(*) c, count(DISTINCT shop_id) shop_cnt,
       array_agg(DISTINCT name) names, array_agg(shop_id) shop_ids
FROM suppliers GROUP BY 1 HAVING count(*) > 1 ORDER BY c DESC;

-- 采购单关联情况
SELECT count(*) total,
       count(supplier_id) with_supplier,
       count(*) FILTER (WHERE supplier_id IS NULL AND supplier_name IS NOT NULL) name_only,
       count(*) FILTER (WHERE supplier_id IS NULL AND supplier_name IS NULL) none
FROM purchase_orders;
```

### 4.2 迁移步骤（建议一个迁移文件 `0020_supplier_archive.sql`）

1. **备份**（迁移脚本内建审计表，保留一个版本周期）
   ```sql
   CREATE TABLE suppliers_backup_2026xxxx AS SELECT * FROM suppliers;
   CREATE TABLE purchase_orders_backup_2026xxxx AS
     SELECT id, shop_id, supplier_id, supplier_name, supplier_phone FROM purchase_orders;
   ```
2. 创建 `shop_suppliers`。
3. 扩展 `suppliers` 字段；`shop_id` 改名为 `legacy_shop_id` 并放宽为非空约束（先 `DROP NOT NULL`，再换 FK 为 `ON DELETE SET NULL`）。
4. **回填供货关系**（一店一供应商 → 一条关系）
   ```sql
   INSERT INTO shop_suppliers (supplier_id, shop_id)
   SELECT id, legacy_shop_id FROM suppliers
   WHERE legacy_shop_id IS NOT NULL
   ON CONFLICT (supplier_id, shop_id) DO NOTHING;
   ```
5. **去重合并**（仅对 4.1 查出的候选组执行，先出报告再执行）
   - 规则：`lower(btrim(name))` 相同，且电话相同或一方为空；
   - 每组选主：优先 `status='active'`、优先采购单最多、再优先创建最早；
   - 重指采购单与供货关系：
     ```sql
     UPDATE purchase_orders SET supplier_id = :canonical WHERE supplier_id = :duplicate;
     UPDATE shop_suppliers SET supplier_id = :canonical WHERE supplier_id = :duplicate
       ON CONFLICT DO NOTHING;  -- 同店关系合并
     ```
   - 被合并行不直接删除：新增 `merged_into_id uuid REFERENCES suppliers(id)`，置 `status='disabled'`、`merged_into_id=canonical`，UI 隐藏；确认一个版本后再清理。
6. 补 `purchase_orders` 供应商索引、`suppliers` 编码和名称索引。
7. 代码切换后回填 `code`（按创建时间生成 `SUP-000001` 起）。
8. 校验：
   ```sql
   -- 每个原供应商都能在新模型找到
   SELECT count(*) FROM suppliers WHERE legacy_shop_id IS NOT NULL AND id NOT IN (SELECT supplier_id FROM shop_suppliers);
   -- 采购单无悬挂
   SELECT count(*) FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id
    WHERE po.supplier_id IS NOT NULL AND s.id IS NULL;
   -- 供货关系无明显重复
   SELECT shop_id, supplier_id, count(*) FROM shop_suppliers GROUP BY 1,2 HAVING count(*)>1;
   ```

### 4.3 风险与回滚

| 风险 | 影响 | 应对 |
|---|---|---|
| 删门店级联删主体 | 历史供应商消失 | 迁移中先改 FK 为 `SET NULL`，代码上线前禁止删门店 |
| 同名不同法人被误合并 | 采购/对账串账 | 默认**只出报告不自动合并**；合并需人工确认清单 |
| 旧代码仍按 `suppliers.shop_id` 过滤 | 新主体查不到 | 第二阶段前保留 `legacy_shop_id`；接口先做兼容读（见 6） |
| 采购单供应商快照与主体不一致 | 展示歧义 | 快照优先展示，详情给「档案已更新」提示 |
| 权限范围变化 | 运营越权看到其他门店供应商 | 门店级接口只返回 `shop_suppliers` 关联数据；全局接口用新权限点 |

**可回滚性**：
- 结构变更以「加表 + 加列 + 改可空」为主，回滚脚本可 `DROP TABLE shop_suppliers`、恢复 `shop_id NOT NULL`（需先把 `NULL` 回填）、删除新列；
- **数据合并不可逆**，必须靠备份表/`merged_into_id` 恢复；
- 建议迁移与代码分两次发布，先迁移后切读，保留一个版本的旧字段写入（双写 `legacy_shop_id`：仅当供应商只绑定一个门店时写入）。

---

## 5. 接口与权限

### 5.1 接口设计（新增，保持旧接口兼容）

| 方法/路径 | 说明 | 权限 |
|---|---|---|
| `GET /api/admin/suppliers` | 不传 `shopId` 时为档案全局列表（关键词/状态/供货门店/分页）；传 `shopId` 时仍返回该门店可选供应商（内部改查 `shop_suppliers`） | `suppliers.read`（门店范围时同时校验门店权限） |
| `GET /api/admin/suppliers/:id` | 主体详情 + 供货门店列表 + 最近采购单摘要 | `suppliers.read` |
| `POST /api/admin/suppliers` | 新建主体；body 可带 `shopIds[]` 直接建关系 | `suppliers.write` |
| `PATCH /api/admin/suppliers/:id` | 编辑名称/编码/联系人/电话/地址/结算/税号/备注 | `suppliers.write` |
| `PATCH /api/admin/suppliers/:id/status` | 启停主体（或复用 PATCH 的 `status`） | `suppliers.write` |
| `PUT /api/admin/suppliers/:id/shops` | 覆盖式绑定供货门店（`[{shopId,status}]`），事务内 diff | `suppliers.write` + 目标门店权限 |
| `POST /api/admin/suppliers/:id/merge` | 可选：合并重复供应商（管理员） | `suppliers.write` + `super_admin` |
| `GET /api/admin/purchases` | 不变，仍按 `shopId` 查询 | `purchases.read` |
| `POST/PATCH /api/admin/purchases` | 供应商校验从 `suppliers.shop_id` 改为 `shop_suppliers` 且两边都 `active` | `purchases.write` |

**旧接口兼容**：
- `GET /suppliers?shopId=` 查询逻辑切换为 join，返回结构保持 `id/name/contactName/phone/status/remark`，前端无需改；
- `POST /suppliers` 仍接受 `shopId`：等价于「新建主体 + 建立该门店供货关系」，响应保持 `{ item: { id, shopId, name } }`；
- `PATCH /suppliers/:id` 不再要求门店归属，按主体权限校验；
- 保留「手填供应商名称」能力作为过渡（采购单 `supplier_id=null` + 快照），第三阶段再决定是否下线。

### 5.2 权限设计

新增两个权限点（迁移中插入 `admin_permissions` 并授予角色）：

```sql
INSERT INTO admin_permissions (code, resource, action, name) VALUES
  ('suppliers.read',  'suppliers', 'read',  '供应商-查看'),
  ('suppliers.write', 'suppliers', 'write', '供应商-维护');
```

角色映射：

| 角色 | suppliers.read | suppliers.write | 说明 |
|---|---|---|---|
| `super_admin` | 自动 | 自动 | 现有 CROSS JOIN 全量授权会覆盖新权限 |
| `ops_manager` | 是 | 是 | 建议与 `purchases.write` 同步 |
| `viewer` | 是 | 否 | 现有 `action='read'` 规则自动覆盖 |

与现有权限的关系：
- **档案维护**用 `suppliers.*`，不再借用 `purchases.write`（避免「只能开单的人」顺手改档案）；
- **采购单**继续用 `purchases.*`；
- **入库/调整库存**继续用 `inventory.*`，本次不改；
- 门店级供货关系绑定需同时具备 `suppliers.write` 和目标门店的可见权限（`guardPermission(c, 'suppliers.write', { shopId })`），防止跨店绑定；
- 查看供应商详情不要求 `purchases.read`，但详情里的采购记录区块按 `purchases.read` 二次裁剪。

可复用：`guardPermission`（[admin-access.ts L65-L72](file:///Users/whoitao/cyber/github/sds/packages/api/src/lib/admin-access.ts#L65-L72)）、Hono 路由与 zod 校验、分页 `parsePaging`、代理 `proxyToApi`。需要新增：全局作用域权限校验（不传 `shopId` 时按角色权限判断）。

---

## 6. admin 界面

### 6.1 新增「供应商档案」页（`/suppliers`）

- 入口：侧边栏放在「采购管理」之后，作为独立一级菜单（或采购管理下的二级项，按现有扁平菜单风格选一级更简单）；
- 列表：编码、名称、联系人、电话、供货门店数、状态、更新时间、操作（编辑/启停/绑定门店）；
- 筛选：关键词（名称/编码/联系人/电话）、状态、供货门店（多选/单选）；
- 新建/编辑用 Drawer（字段多，Modal 会拥挤）：名称*、编码（可自动生成）、联系人、电话、地址、结算方式、税号、邮箱、备注、状态、供货门店多选（门店下拉来自 `/shops`）；
- 详情抽屉：基本信息 + 供货门店 + 最近采购单（复用采购单跳转）；
- 交互约束：停用前提示「停用后采购单不能再选择该供应商」；解绑门店前提示历史采购单不受影响。

### 6.2 改造采购管理

**推荐流程（档案优先）**：
1. 列表页仍保留顶部门店筛选（现有页面结构不变）；
2. 新建采购单弹窗改为两步：先选供应商（全局搜索，显示编码/联系人/电话），选定后门店下拉只显示该供应商**供货且启用**的门店；
3. 如果用户先选了门店，则供应商下拉只显示该门店的供货供应商；切换门店时若已选供应商不供货则清空并提示；
4. 选不到供应商时给「去供应商档案创建/绑定」链接，过渡期保留手填名称入口（加提示「未建档」）。

**旧 Tab 处理**：
- 第二阶段把采购页的「供应商」Tab 改为只读列表 + 「前往供应商档案」按钮，不再在此新建；
- 第三阶段彻底移除该 Tab（或保留为「本店供货商」视图，仅做绑定管理）。

### 6.3 历史采购单展示

- 有 `supplier_id`：显示快照名称 + 电话；详情提供「查看供应商档案」；档案当前名称与快照不同时加 tooltip「下单时名称：XXX」；
- 无 `supplier_id` 但有名称：显示名称 + 标签「未建档供应商」；
- 已合并供应商的旧单：迁移时已重指到主档案，列表仍显示原快照名称，详情可跳主档案；
- 采购单详情/导出继续使用快照字段，保证历史可追溯（[purchases.ts L489-L495](<file:///Users/whoitao/cyber/github/sds/apps/admin/app/(console)/purchases/page.tsx#L489-L498>)）。

---

## 7. 兼容与灰度

1. **双读期**：供应商接口先兼容两种数据来源——`shop_suppliers` 关联 + `legacy_shop_id` 旧数据，保证旧页面可用；新建数据同时写关系，单店供应商可临时双写 `legacy_shop_id`。
2. **开关**：在 admin 设置或环境变量增加 `SUPPLIER_ARCHIVE_MODE=off|shadow|on`：
   - `shadow`：新档案页可写，但采购页仍走旧逻辑，便于校验数据；
   - `on`：采购页切换为关系校验，关闭手填入口（或降级提示）。
3. **不破坏历史**：采购单快照字段、`po_no`、入库流程、库存流水均不改。
4. **异常兜底**：供应商被停用/解绑后，历史草稿采购单仍可查看与取消；提交时再次校验关系，失败给出明确文案（「供应商已停止向该门店供货」）。
5. **回退**：保留旧接口语义与 `legacy_shop_id` 一个版本；关闭 `SUPPLIER_ARCHIVE_MODE` 即回到旧交互。

---

## 8. 分阶段实施

| 阶段 | 内容 | 可独立上线 | 验证点 |
|---|---|---|---|
| P1 数据与接口底座 | `0020` 迁移：新表、新字段、回填关系、采购单索引；供应商接口读写全局主体，旧 `shopId` 语义兼容；新权限点 | 是（纯后端，UI 不变） | 列表数量与迁移前一致；采购单创建/编辑不受影响；停用门店不删供应商；回滚脚本演练通过 |
| P2 供应商档案页 | 新增 `/suppliers` 列表/筛选/抽屉表单/供货门店绑定；采购页供应商 Tab 改只读入口 | 是 | 新建/编辑/启停/绑定；一家供应商绑定多门店后各店可见；停用后采购页不可选 |
| P3 采购流程切换 | 新建采购单改为档案优先；供应商校验改为 `shop_suppliers`；手填入口降级；历史单展示优化 | 是 | 跨店供货可选；未绑定门店不可选；历史 50 单展示正确；草稿换供应商成功 |
| P4 数据治理 | 同名供应商合并（人工确认清单 + merge 接口/脚本）；补 `code`；去掉手填供应商（如决定） | 是（可与 P3 并行） | 合并后采购单指向主档案；无重复关系；导出/对账名称一致 |
| P5 清理 | 删除采购页供应商 Tab；删除 `legacy_shop_id` 与旧接口分支 | 收尾 | 全量回归 + 备份保留 |

每阶段建议附：迁移 dry-run 报告、旧/新数据对账 SQL、至少一条 Playwright/CDP 冒烟（登录 → 档案新建 → 绑定两店 → 两店各建一单）。

---

## 9. 明确不做什么

- 不做供应商登录端、供应商自主报价/接单；
- 不做账期、应付账款、结算单、发票管理（只存 `settlement_method` 文本）；
- 不做供应商资质/证照附件与到期提醒（列入开放问题）；
- 不做供应商分级、评价、黑名单流程；
- 不做采购退货（`purchase_return`）与供应商关联，除非开放问题确认要一起做；
- 不改库存/入库流程、不改采购单状态机、不改历史采购单金额与明细；
- 不做多租户隔离（当前系统是单平台多门店，无 tenant 概念）。

---

## 10. 需要拍板的开放问题

1. **共享范围**：供应商档案是平台级（所有门店共享），还是未来要按品牌/租户隔离？当前 schema 无 tenant，建议平台级。
2. **名称唯一性**：是否允许同名不同法人？建议 `code` 唯一、名称做「疑似重复」提醒而不强唯一；若强唯一需先确认合并规则。
3. **证照附件**：是否需要营业执照/食品经营许可证等附件与到期提醒？需要则 P2 增加附件表与上传复用（现有 `/api/admin/uploads`）。
4. **采购退货**：是否本次一起让退货单关联供应商并写 `purchase_return`？建议单独排期，避免范围膨胀。
5. **手填供应商**：切换后是否彻底禁止无档案采购？建议保留一个版本过渡，并在报表中标记「未建档」。
6. **供应商删除**：只允许停用（推荐），还是允许删除无采购记录的档案？删除涉及历史快照与关系清理。
7. **权限归属**：`ops_manager` 是否应拥有全部供应商写权限，还是只允许总部角色维护档案、门店运营仅绑定？
8. **历史单重指**：迁移时是否把历史 50 单（生产按实际数量）统一重指到合并后的主档案，还是保留原 `supplier_id` 仅做展示？建议重指并保留快照。
9. **编码规则**：`SUP-000001` 自动生成，还是对接外部供应商编码？是否需要导入？
