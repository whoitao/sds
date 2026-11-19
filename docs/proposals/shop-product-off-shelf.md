# 门店商品下架与总部下架铺货过滤方案

- 状态：待评审
- 范围：admin（店铺商品 / 总部商品库）、API、web 顾客端
- 结论：**总部状态与店铺状态分开存、读时合并判定**；店长沿用 `products.is_available` 控制本店上下架，总部下架/归档用 `catalog_products.status` 在顾客端实时过滤；店长下架使用新的窄权限 `products.off_shelf`，不授予 `products.write`。

---

## 0. 结论摘要

1. **不新增 `shop_off_shelf` 字段**，店长下架复用 `products.is_available`。
2. **总部下架不写门店行**，只把 `catalog_products.status != 'published'` 加进顾客端、购物车、下单的读路径。
3. 现有门店商品在总部下架/归档后**自动不可见**，总部重新发布后**恢复门店原来的上下架状态**，无需数据回填。
4. 店长下架本店商品：新增权限码 `products.off_shelf`（窄权限），接口校验 `canAccessShop`，后台行操作 + 危险确认弹窗。
5. 强制下架 `products.is_blocked` 保持现状，优先级高于店长；建议二期把“强制下架”提升为总部商品级标记，解决新铺货门店漏带 blocked 的问题。

---

## 1. 现状盘点

### 1.1 字段与语义

| 层级 | 表 / 字段 | 取值 | 语义 |
|---|---|---|---|
| 总部商品 | `catalog_products.status` | `draft` / `published` / `archived` | 草稿 / 已发布（可铺货）/ 已归档 |
| 总部商品 | `catalog_products.published_at` | 时间戳 | 首次发布时间 |
| 总部规格 | `catalog_skus.status` | `active` / `disabled` | 规格启用 / 停用 |
| 门店商品 | `products.is_available` | boolean | **本店是否上架**（店长维护） |
| 门店商品 | `products.is_blocked` | boolean | 总部强制下架标记（总部写） |
| 门店商品 | `products.blocked_reason` | text | 强制下架原因 |
| 门店商品 | `products.catalog_product_id` | uuid / null | 非空 = 共享总部商品；null = 门店自建 |
| 门店规格 | `product_skus.is_available` | boolean | 本店规格是否可售 |
| 门店规格 | `product_skus.catalog_sku_id` | uuid / null | 共享规格 / 门店自建 |
| 库存 | `product_sku_stocks.quantity` | numeric | 门店可售库存 |

> 注意：总部侧没有“published → draft 的直接下架按钮”，现有“下架”实际有三条路径：**归档**（`archived`）、**恢复草稿**（`draft`）、**强制下架**（写门店行 `is_blocked`）。方案中统一把 `status != 'published'` 视为“总部已下架”。

### 1.2 顾客端可见性判定链（现状）

菜单 / 分类计数（`packages/api/src/routes/mobile.ts`）：

1. 门店营业：`shops.status = 'open'`
2. 分类可见：`catalog_categories.is_active` + 父分类可见 + 未被 `shop_hidden_categories` 隐藏
3. 门店商品上架：`products.is_available = true`
4. 未被强制下架：`products.is_blocked = false`
5. 至少一个可售规格：`product_skus.is_available = true` 且（本地规格 或 `catalog_skus.status = 'active'`）

商品列表 / SKU 列表（`mobile.ts` 的 `/shops/:shopId/products`）重复上述 3–5。

购物车（`packages/api/src/routes/mobile-cart.ts`）：

- 返回 `offShelf` 时判定：`!sku_available || !product_available || product_blocked || (catalog_sku.status !== 'active')`
- **没有判断总部商品状态**。

下单（`packages/api/src/routes/mobile-orders.ts`）：

- `ensureBuyable` 判定：`!skuAvailable || !productAvailable || productBlocked || (catalogStatus && catalogStatus !== 'active')`
- 这里 `catalogStatus` 是 **`catalog_skus.status`**，同样**没有判断 `catalog_products.status`**。

### 1.3 现状结论

- 顾客端 6 个可见性条件里，**缺了总部商品级 `status`**。
- 总部归档/草稿只影响“之后新铺货”和“总部列表”，**不影响已铺到门店的商品**：页面上写“归档后门店侧不再显示”，实际不成立。
- 门店商品列表（`GET /products`）返回了 `isBlocked`，但没有返回总部商品状态，后台无法提示“总部已下架”。

---

## 2. 铺货逻辑现状

代码：`packages/api/src/lib/catalog-fanout.ts`

| 流程 | 读取条件 | 是否覆盖门店已有状态 | 总部下架后表现 |
|---|---|---|---|
| 单店铺货 `fanOutCatalogProductsToShop` | `cp.status = 'published'`，可选分类范围 | `on conflict ... do nothing`，只补缺 | 不会再新增；**已存在的门店商品仍可见** |
| 批量发布 `fanOutCatalogProductsToAllShops` | `cp.status = 'published'` | 同上，只补缺 | 同上 |
| 总部新增规格 `fanOutNewCatalogSku` | 商品 `published` + 规格 `active` | 只补缺，新规格默认下架 | 不影响门店原商品 |
| 共享字段同步 | 按 `catalog_product_id` 直接更新门店副本 | 覆盖名称/图片等共享字段 | 不触碰上下架 |

**关键缺口**

1. 铺货过滤只发生在“插入新行”，已存在的门店商品从不联动总部状态。
2. 强制下架 `is_blocked` 是逐门店写行；**之后新开的门店或新铺的货不会携带 blocked**，强制下架会漏。
3. 总部 `status` 变更没有审计/影响面预览，改成读时过滤后会“突然消失”，需要提前给出影响清单。

---

## 3. 状态优先级组合矩阵

说明：`总部正常` = `published` 且未强制下架；`店铺上架` = `products.is_available = true`。

| # | 总部商品状态 | 强制下架 `is_blocked` | 店铺 `is_available` | 顾客端可见 | 店长能否自行恢复 | 铺货是否带入 |
|---|---|---|---|---|---|---|
| 1 | published | false | true | ✅ 可见 | —（已可见） | 已存在不重复；新店带入 |
| 2 | published | false | false | ❌ 不可见 | ✅ 可直接上架 | 已存在不覆盖；新店带入 |
| 3 | draft（总部下架） | false | true | ❌ 不可见（**本次修复**） | ❌ 不能；需总部发布 | 不新增；已存在保留但不可见 |
| 4 | draft | false | false | ❌ 不可见 | ❌ 不能；需总部发布 | 不新增 |
| 5 | archived（归档） | false | true | ❌ 不可见 | ❌ 不能；需总部恢复草稿并发布 | 不新增 |
| 6 | archived | false | false | ❌ 不可见 | ❌ 不能 | 不新增 |
| 7 | published | true | true | ❌ 不可见 | ❌ 需总部解除强制下架 | 不新增；新店当前会漏 blocked（缺口） |
| 8 | published | true | false | ❌ 不可见 | ❌ 需总部解除后再自行上架 | 同上 |
| 9 | draft/archived | true | 任意 | ❌ 不可见 | ❌ 总部状态与强制下架需同时解除 | 不新增 |

**优先级**：`总部 status = published` > `is_blocked = false` > `products.is_available = true` > 可售 SKU / 库存。
即：总部状态是一票否决，强制下架是第二道否决，店长只能在两者都放行时控制本店开关。

---

## 4. 实现方案（建议决策）

### 4.1 字段承载：复用 `is_available`，总部状态不落门店行

**建议**

- 店铺级下架：继续用 `products.is_available`，不新增 `shop_off_shelf`。
- 总部下架：使用 `catalog_products.status`，**不写入门店行**。
- 强制下架：继续用 `products.is_blocked`。

**理由**

1. `is_available` 的现有语义就是“本店是否上架”，门店商品列表开关、C 端 `productAvailable`、后台筛选都围绕它；再建 `shop_off_shelf` 会出现两个店铺级标记，必须定义谁优先、谁同步谁，纯增复杂度。
2. 总部下架是“一个总部商品对 N 家门店”的状态，落在总部行天然唯一；写入门店 `is_available` 会把“总部原因”和“店长原因”混在一个布尔值里，总部重新上架时无法判断该不该恢复。
3. 两者分属不同表，**天然可以分别恢复、互不覆盖**：总部发布后，门店行 `is_available` 保持原值，店长之前的操作自动生效。

**没有采用**：新增 `shop_off_shelf`。它与 `is_available` 语义重叠；若为了区分“谁下架”而拆字段，仍需处理两字段组合与历史数据迁移，收益低。

### 4.2 统一可见性表达式

所有 C 端读路径统一补一个条件（共享商品才判断，门店自建商品 `catalog_product_id is null` 视为正常）：

```sql
and (p.catalog_product_id is null or cp.status = 'published')
```

落地位置：

- 菜单分类计数：`listVisibleCategoryCounts`
- 商品列表 + 计数 + SKU 列表：`/shops/:shopId/products`
- 购物车 payload / 加购校验：`mobile-cart.ts`
- 下单校验：`ensureBuyable`（需要把 `catalog_products.status` 查出来，字段可与现有 `catalogStatus` 并存，如 `catalogProductStatus`）

错误文案区分：

- 总部下架/归档：`「xx」已下架，暂不可购买`
- 强制下架：保留“门店暂时无法购买”
- 售罄/库存不足：沿用现状

### 4.3 门店上下架写规则

`PATCH /products/:id/status`（或现有 availability 接口）：

- **下架**（true → false）：只要门店范围通过即可，不要求总部发布。
- **上架**（false → true）：
  - `is_blocked = true` → 409，提示需总部解除强制下架（现有逻辑保留）。
  - 总部 `status != 'published'` → 409，提示“总部已下架/归档，需总部重新发布”。
- 不修改总部表，不做反向联动。

### 4.4 强制下架的持久化缺口（建议二期）

建议在 `catalog_products` 增加 `force_offline boolean` + `force_offline_reason`，铺货时带入 `products.is_blocked`；现有 `products.is_blocked` 保留为“当前门店生效值”。这样新开门店、新铺货不会漏掉强制下架。最小可行版可以先不做，用“变更时批量写现有门店 + 运维巡检”兜底。

### 4.5 历史数据

无需回填：总部状态已在库中，读路径生效后，历史 `draft/archived` 商品自动不可见；门店 `is_available` 原值保留。上线前用审计 SQL 预览影响面（见 §8）。

---

## 5. 权限与入口

### 5.1 权限码

- 新增：`products.off_shelf`，模块 `products`，名称「门店商品上下架」。
- 授予：`store_manager`（默认）、`ops_manager`、`super_admin`。
- **不复用 `products.write`**：后者还包含改价、SKU 编辑；店长当前没有该权限（见 0039 迁移），不应为了下架重新放开。
- 接口除权限码外必须校验 `canAccessShop(adminId, shopId)`，范围外 403；与门店分类可见性一致。

### 5.2 后台入口与交互

- 位置：`/products` 店铺商品列表，行操作列「下架 / 上架」。
- 下架：危险样式 + 二次确认（复用 `useConfirmDanger`），文案写清“顾客在本店将看不到该商品，已加购顾客将无法结算；可随时重新上架”。
- 上架：总部未发布/强制下架时禁用并给 Tooltip 原因。
- 列表新增派生状态列/Tag：`总部已下架`、`总部已归档`、`强制下架`；总部状态不占门店 `is_available` 的展示值。
- 搜索筛选可加“仅看总部不可售”，一期可不做。

---

## 6. 联动点

| 联动点 | 是否需要改 | 说明 |
|---|---|---|
| 门店商品列表（admin `/products`） | ✅ | 返回 `catalogStatus`，展示总部状态 Tag；上架按钮禁用逻辑 |
| 顾客端菜单 / 分类计数 / 商品列表 | ✅ | 补 `cp.status = 'published'` |
| 商品详情 / SKU 列表 | ✅ | 同一条 SQL 路径，随列表生效 |
| 购物车列表 | ✅ | `offShelf` 增加总部商品状态；web 端 `offShelf` 展示逻辑无需改 |
| 加购接口 | ✅ | 拒绝总部未发布商品，避免加入后立刻失效 |
| 下单 `ensureBuyable` | ✅ | 增加总部商品状态判断，防止绕过前端 |
| 库存数量 / 库存流水 | ❌ | 库存是物理量，不随上下架变化 |
| 低库存预警 / 控制面板统计 | ⚠️ 待定 | 当前 `dashboard.ts` 统计所有 tracked SKU，总部下架商品仍会计入预警；建议二期排除不可售商品，避免噪音 |
| 订单 / 报损 / 采购历史 | ❌ | 历史单据口径不变 |
| 铺货（单店 / 批量发布 / 新规格） | ⚠️ | 已过滤 `published`，无需改；强制下架持久化见 §4.4 |

---

## 7. 改动清单与分档

### 7.1 数据库

- **P0**：新增权限码迁移（加法 + 回滚），不建表、不加列。

```sql
-- 0040_products_off_shelf.sql（示意）
INSERT INTO admin_permissions (code, module, action, name)
VALUES ('products.off_shelf', 'products', 'off_shelf', '门店商品上下架')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'products.off_shelf'
WHERE r.code IN ('store_manager', 'ops_manager', 'super_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
```

回滚：

```sql
DELETE FROM admin_role_permissions
 WHERE permission_id = (SELECT id FROM admin_permissions WHERE code = 'products.off_shelf');
DELETE FROM admin_permissions WHERE code = 'products.off_shelf';
```

- **P1（可选）**：`catalog_products.force_offline` / `force_offline_reason`。
- 无历史数据回填。

### 7.2 API

- `packages/api/src/routes/mobile.ts`：3 处 SQL 补总部状态。
- `packages/api/src/routes/mobile-cart.ts`：加购校验 + 购物车 payload 补总部状态。
- `packages/api/src/routes/mobile-orders.ts`：`ensureBuyable` 与取数补 `catalog_products.status`。
- `packages/api/src/routes/products.ts`：
  - `GET /products` 返回 `catalogStatus`；
  - availability 接口权限由 `products.write` 改为 `products.off_shelf`，上架增加总部状态 409；
  - 门店范围校验。
- BFF：`apps/admin/app/api/admin/products/[id]/status/route.ts` 已存在则无需改（透传）。

### 7.3 admin 前端

- `apps/admin/app/(console)/products/page.tsx`：
  - 开关权限改用新权限码；
  - 下架确认弹窗；
  - 总部状态 Tag 与上架禁用提示；
  - 类型补 `catalogStatus`。

### 7.4 web 顾客端

- 无需改逻辑：菜单/详情/购物车都由 API 过滤，`cart-model.ts` 已按 `offShelf` 展示“已下架”。
- 可选：错误文案区分“总部下架”。

### 7.5 分档建议

**最小可行版（建议本次上线）**

- P0 权限迁移
- `mobile.ts` 3 处 + `mobile-cart.ts` + `ensureBuyable` 的总部状态过滤
- 门店 availability 接口换权限 + 上架 409
- admin 列表 Tag、下架确认、上架禁用

**可延后**

- 强制下架总部级持久化（§4.4）
- 低库存/控制面板统计口径调整
- 门店列表“总部不可售”筛选、批量下架

**不做也能上线**

- 新增 `shop_off_shelf` 字段
- 总部下架时反向写门店行
- web 端改动

---

## 8. 风险与待决问题

1. **上线即“消失”**：历史 `draft/archived` 商品会立刻从顾客端消失。上线前用审计 SQL 预览：
   ```sql
   select count(distinct p.shop_id) as shops, count(*) as products
     from products p
     join catalog_products cp on cp.id = p.catalog_product_id
    where cp.status <> 'published' and p.is_available and not p.is_blocked;
   ```
   结果同步给运营确认。
2. **总部状态语义**：`draft` 与 `archived` 在顾客端都应不可见；是否允许 `published → draft` 直接下架，需要总部后台补一个明确动作（当前主要靠归档/强制下架）。
3. **强制下架覆盖范围**：`is_blocked` 只覆盖现有门店行，新铺货会漏；建议尽快做 §4.4。
4. **总部重新上架后的门店状态**：按本方案保持门店原 `is_available`，不自动恢复；若运营希望“重新发布即全店恢复”，需要另行定义，但不建议默认覆盖店长操作。
5. **店长权限边界**：只给 `products.off_shelf`，不给 `products.write`；否则店长可改价/改规格。
6. **并发**：总部改状态与顾客下单同时发生时，`ensureBuyable` 在提交事务内读取最新状态即可；无需额外锁。
7. **统计口径**：低库存预警是否排除不可售商品需产品确认；不影响本方案主链路。
8. **门店范围**：所有门店维度写接口统一走 `canAccessShop`，避免改 shopId 越权。

---

## 附：关键代码位置

- 铺货：`packages/api/src/lib/catalog-fanout.ts`
- 菜单/列表：`packages/api/src/routes/mobile.ts`（`listVisibleCategoryCounts`、`/shops/:shopId/products`）
- 购物车：`packages/api/src/routes/mobile-cart.ts`
- 下单校验：`packages/api/src/routes/mobile-orders.ts`（`ensureBuyable`）
- 门店商品与上下架：`packages/api/src/routes/products.ts`
- 总部状态与强制下架：`packages/api/src/routes/catalog.ts`
- 门店范围：`packages/api/src/lib/shop-scope.ts`（`canAccessShop`）
- admin：`apps/admin/app/(console)/products/page.tsx`、`apps/admin/app/(console)/catalog/page.tsx`
