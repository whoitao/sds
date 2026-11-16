# 多店商品 / 分类维护成本降低方案

> 范围：只出方案。本文件不修改代码、表结构与 `docs/prd/SDS-PRD.md`。
> 现状基线：`categories` 两级树（`shop_id` 必填、`(id, shop_id)` 复合外键、同级名唯一）、`products` 商品级单规格（`shop_id` 必填、`category_id` 可空、`price/unit/stockType/isAvailable/sortOrder`）、权限码 `products.read / products.write` + ABAC resource（`shopId / categoryId / productId`）。
> 目前**没有库存表**，`stock_type` 只是「是否追踪库存」的标记。

---

## 1. 问题定义

现状是「每店一套分类树 + 每店一套商品行」。加盟场景下各店商品高度一致，导致：

1. 新增 1 个商品要在 N 个店各录一次，N 店 × M 商品；
2. 总部改一次描述/图片，N 店要重复操作 N 次，且容易漏改、产生不一致；
3. 分类树同样重复：同名分类在每店各有一份 `categories` 行，改层级/改名要逐店做；
4. 现有 `categories` 树迁移、`reorder`、`DELETE /categories/:id` 的成功率取决于各店数据完全一致，一旦漂移就出现「A 店删得掉、B 店删不掉」。

目标：**总部维护一份标准商品/分类，门店只维护「必须因店而异」的部分**（价格、上下架、库存、排序），且不破坏现有 `shop_id` 归属与 ABAC 权限模型。

---

## 2. 可选路径与数据模型改动

### 方案 A：复制实例 + 一次性铺货（snapshot）

新店开业时把总部模板复制成该店自己的 `categories` / `products` 行，之后各自独立。

- 数据模型：新增 `catalog_products` / `catalog_categories` 作为模板源 + `catalog_push_logs`；`products` 增加 `source_catalog_id` 便于追溯。
- 改价：各店自己改，天然支持差异化。
- 下架：各店自己改，总部无法统一。
- 库存：各店自己维护，无跨店口径问题。
- 统计：`products` 行数即门店商品数，简单。
- 致命问题：复制后即漂移。总部改描述/图片要再推一次，而「推了之后门店又改过」的冲突无法判定（除非再加 `overrides` 字段，那就退化成方案 C）。

### 方案 B：纯引用（共享商品，门店无实例行）

`products` 去掉 `shop_id`，改为全平台共用；门店维度的上下架放 `shop_product_status`。

- 改价：需要 `shop_prices` 表，否则无法差异化。
- 下架：必须靠 `shop_product_status`，等于还是要有门店行。
- 破坏面大：`products.shop_id` 是现有 ABAC 的 resource 锚点，删除会牵动所有路由守卫与 admin 页面。
- 结论：改动最大、收益与方案 C 相同，不做。

### 方案 C：总部商品库 + 门店关联行 + 字段级覆盖（推荐）

保留 `products` 表（门店商品，继续承载 `shop_id`、价格、上下架），新增总部商品库，门店行通过外键「引用」总部商品，未覆盖的字段从总部读取。

**新增表**

```sql
-- 总部分类树（结构同现有 categories，去掉 shop_id）
catalog_categories (
  id uuid pk,
  parent_id uuid null references catalog_categories(id),
  level smallint not null default 1 check (level in (1,2)),
  name varchar(50) not null,
  sort_order int not null default 0,
  icon_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (parent_id, name)  -- 同级唯一（NULLS NOT DISTINCT）
)

-- 总部商品（标准字段）
catalog_products (
  id uuid pk,
  category_id uuid null references catalog_categories(id) on delete set null,
  name varchar(100) not null,
  description text,
  image_url text,
  unit varchar(20) not null,
  default_price numeric(10,2) not null,   -- 建议价
  stock_type product_stock_type not null default 'tracked',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

-- 门店商品 = 对总部商品的引用 + 本地覆盖（可以就在现有 products 上加列）
alter table products add column catalog_product_id uuid references catalog_products(id);
alter table products add column is_blocked boolean not null default false;
alter table products add column blocked_reason text;
-- price 改为可空：null = 跟随总部 default_price
alter table products alter column price drop not null;
create unique index products_shop_catalog_uniq on products(shop_id, catalog_product_id)
  where catalog_product_id is not null;
```

`products` 现有字段的语义在新模型下：

| 字段 | 归属 | 说明 |
| --- | --- | --- |
| `name / description / image_url / unit / category_id` | **总部锁定** | 门店界面只读，值来自 `catalog_products`；允许门店写「本地别名」时另设 `local_name`（默认不做） |
| `price` | **门店可改，可空** | `null` = 跟随 `default_price`；有值 = 本地定价（含促销） |
| `is_available` | **门店可改** | 门店自主上下架 |
| `is_blocked / blocked_reason` | **总部专属** | 总部强制下架（食品安全、资质过期），门店不可覆盖 |
| `sort_order` | **门店可改** | 店内排序 |
| `stock_type` | 总部默认 + 门店可改 | 门店可把某商品改为不追踪库存 |

**门店分类怎么做（两种）**

- C1（推荐）：门店直接用 `catalog_categories`，不再有自己的 `categories`。门店仅能「隐藏某分类」：`shop_hidden_categories(shop_id, catalog_category_id)`。
- C2（兼容历史）：保留 `categories` 作为门店分类，新增 `shop_category_links(shop_id, shop_category_id, catalog_category_id)` 做映射，商品按映射归到总部分类。

C1 的理由：分类树在加盟场景「高度一致」是需求本身；C2 会长期维护两棵树 + 映射，且商品移动分类要同时改两处。C2 只在「必须允许某店自建独有分类」时才需要。

### 引用 vs 复制：口径对照

| 维度 | 引用（方案 C） | 复制（方案 A） |
| --- | --- | --- |
| 总部改描述/图片 | 即时生效，0 成本 | 需要再推一次，可能产生冲突 |
| 门店改价 | `products.price` 覆盖，未改则跟随建议价 | 各店独立，无「跟随」概念 |
| 下架 | 门店 `is_available`，总部 `is_blocked` 双开关 | 各自独立，总部无法统一 |
| 库存 | 门店级；总部无库存概念 | 门店级 |
| 售罄 | 依赖库存表（尚未落地）；过渡期用 `is_available` | 同左 |
| 统计口径 | 门店商品数 = 本店 `products` 行数且 `catalog.status='published'`；总部看 `catalog_products` | 两边行数都会漂移 |
| 数据一致性 | 单源，天然一致 | 需要同步任务与冲突解决 |

---

## 3. 加盟场景的字段归属边界

| 字段 | 总部 | 门店 | 规则 |
| --- | --- | --- | --- |
| 商品名称 | 写 | 只读 | 门店不可改，避免同一商品多名字 |
| 描述 / 图片 / 单位 | 写 | 只读 | 同上 |
| 所属分类 | 写 | 只读 | 分类树共享 |
| 默认价（建议价） | 写 | 只读 | 只在门店未定价时生效 |
| 实际售价 | — | 写 | 覆盖建议价；后台标记「已本地改价」 |
| 上下架 | 可强制下架 | 写 | 门店开关；总部 `is_blocked` 优先级最高 |
| 店内排序 | — | 写 | |
| 库存 / 售罄 | — | 写 | 门店级，总部只看报表 |
| 分类名称 / 层级 / 图标 | 写 | 只读 | 门店只能隐藏分类 |

价格边界建议：**总部只能设「建议价 + 价格区间上下限（可选）」**。硬性统一价在加盟场景容易引发争议（各店成本不同），且会与促销冲突。若业务确实要求统一价，用 `catalog_products.price_locked boolean` 表达，门店端价格输入框禁用。

---

## 4. 初始化新门店与总部下发

### 4.1 一键铺货

```
POST /api/admin/shops/:shopId/catalog/import
body: { mode: 'all' | 'category', categoryIds?: string[], includeUnpublished?: false }
```

实现（单事务、幂等）：

1. `insert into products (shop_id, catalog_product_id, price, is_available, sort_order)`
   `select :shopId, id, null, true, row_number() over (order by sort_order, name)` 
   `from catalog_products where status = 'published'`
   `on conflict (shop_id, catalog_product_id) do nothing`；
2. 分类为 C1 共享，无需复制；C2 时才需要复制分类树 + 建立映射；
3. 返回 `{ created, skipped }`，前端展示「本次铺货 N 个，已存在 M 个被跳过」；
4. 权限：`products.write` + `shops.write` 且 resource 为该公司/该店；总部角色才能给别的店铺货。

### 4.2 总部改动的下发策略

**推荐：共享字段实时生效（引用），不做快照下发**。理由：加盟的核心诉求就是「总部改一次，全部门店一致」，快照下发等于把方案 A 的漂移问题搬回来。

配套需要三件事，否则实时生效会变成「总部误操作全店翻车」：

1. **草稿 / 发布**：`catalog_products.status` 从 `draft` 改为 `published` 才进门店视图；发布是一次显式动作（`PATCH /api/admin/catalog/products/:id/publish`），可批量。
2. **影响面提示**：发布前返回「将影响 N 个门店 / M 个在售商品」，前端二次确认。
3. **审计**：`catalog_change_logs(id, catalog_product_id, actor_id, diff jsonb, created_at)`，至少记录发布与强制下架。

**门店侧不接受的场景**：

- 门店希望「晚一点再跟总部的新图」→ 实时引用做不到延迟。如果需要，就得走快照（每店一份副本 + 定向推送），属于方案 A，需明确取舍。
- 总部强制下架：`is_blocked=true` 后门店无法自行上架，只能看到原因；解除需总部操作。
- 门店已本地改价，总部改建议价：不覆盖门店价，只在门店端显示「建议价 ¥X，本店 ¥Y」的差异提示。

**新增商品是否自动进店**：两种策略，需拍板。

- 自动进店（默认）：`published` 即对所有门店可见可售（前提是门店已有该分类）；
- 手动领取：门店在「商品库」页自行「领取」，未领取不出现。适合总部商品池大、各店只卖子集的情况。

---

## 5. 对现有 admin 与接口的影响面

### 5.1 新增（总部侧）

| 页面 | 路由 | 内容 |
| --- | --- | --- |
| 总部商品库 | `/catalog/products` | 列表（分类树筛选、状态草稿/已发布）、新建/编辑、批量发布、强制下架、影响面提示 |
| 总部分类 | `/catalog/categories` | 复用现有分类树表格交互（两级、reorder、迁移商品），但资源是 `catalog_categories` |
| 门店铺货 | `/shops` 行内「铺货」+ 弹窗 | 选择分类/全量、预览影响数量、执行 |

### 5.2 改造（门店侧）

- `/products`：列表增加「来源」列（总部商品 / 本地独有）；名称/图片/分类只读，价格旁显示建议价与「已本地改价」标记；上下架仍可切；被总部强制下架时开关禁用并显示原因。
- `/products` 表单：名称/描述/图片/单位/分类只读（展示即可），只留价格、库存策略、排序、状态。
- `/categories`：C1 下改为「分类可见性」页（只有隐藏/显示），不再有新建/改名/删除；若保留 C2，则需要「映射到总部分类」的交互。
- 店铺管理页几乎不变。

### 5.3 接口影响

- 现有 `GET /products`、`POST /products`、`PATCH /products/:id` 保持可用，语义收窄：共享字段写入返回 `403 FIELD_LOCKED`；`price` 传 `null` 表示跟随总部。
- 新增 `/api/admin/catalog/*`（分类、商品、发布、强制下架、铺货）。
- 权限码新增：`catalog.read`、`catalog.write`、`catalog.publish`、`catalog.force_offline`、`shops.catalog_push`，复用现有 RBAC 表结构（`0004_admin_rbac.sql` 插入即可）。
- 统计类 SQL（商品数、分类商品数）需要改为 `join catalog_products` 过滤 `status='published'`；`category-scope.ts` 的子树展开在 C1 下改为遍历 `catalog_categories`。

---

## 6. 迁移与分期

| 阶段 | 内容 | 相对规模 |
| --- | --- | --- |
| P0 | 决策点拍板 + 数据现状摸底（各店分类/商品差异清单、同名合并候选） | S |
| P1 | 迁移 `0008`：`catalog_categories`、`catalog_products`、`products` 加列（可空，无破坏）；drizzle schema + relations；`catalog` 只读接口 | M |
| P2 | 数据迁移脚本：各店分类按「路径名」去重合并到 `catalog_categories`，各店商品按「名称+单位」匹配到 catalog，未匹配的标 `catalog_product_id = null`（本地独有）；输出人工核对清单 | M |
| P3 | 总部商品库页面 + 发布流 + 强制下架；权限码 | M |
| P4 | 门店商品页只读化 + 一键铺货 + 价格覆盖/差异提示 | M |
| P5 | 分类切换（C1 可见性模型）+ 下线门店分类写接口 | S |
| P6 | 清理：历史 `source` 表字段、双读开关下线 | S |

迁移注意：

- `products.price` 改可空是**向后兼容**的（现有接口仍可写数值），但所有读价格的地方要改成 `coalesce(price, catalog.default_price)`；
- 迁移期保留开关 `CATALOG_MODE=legacy|linked`，读路径双支持，便于回滚；
- 分类合并是本方案唯一不可自动化的部分：同名不同语义、同语义不同名需要人工确认，脚本只产出「建议合并」报告。

---

## 7. 不适用 / 不建议的做法

1. **复制实例 + 定时全量同步**：N 份副本必然漂移，且「门店改过 vs 总部改过」无法区分，冲突解决成本高于收益。
2. **用 JSONB 存 `local_overrides`**：查「哪些店改了价」「售价低于某值」都要全表扫 JSONB，且无法建约束。用显式列（`price` 可空）表达覆盖。
3. **去掉 `products.shop_id` 完全中心化**：会破坏 ABAC 的 resource 锚点和现有所有守卫，收益与方案 C 相同。
4. **`shop_id` 数组 / 关联到多店**：无法表达各店独立价格与上下架，且索引与权限判断都变复杂。
5. **自建消息队列做「异步推送」**：当前体量（几十家店）用同步 SQL + 事务足够，引入队列只增加运维面。
6. **门店自定义分类（保留两棵树）作为默认方案**：加盟场景分类一致是前提，双树只会增加维护成本；确有需要时再启用 C2 映射。

---

## 8. 推荐结论

采用**方案 C（总部商品库 + 门店关联行 + 字段级覆盖）+ 分类 C1（共享分类树，门店只能隐藏）**：

- 共享字段单源实时生效，总部改一次全店一致；
- 门店只保留价格、上下架、排序、库存四类真正因店而异的字段；
- 通过「草稿/发布 + 影响面提示 + 强制下架 + 审计」控制实时生效的风险；
- 现有 `products` 表结构增量改造，接口与权限模型不推翻。

---

## 9. 需要拍板的决策点

1. **分类模型**：C1 共享分类（推荐）还是 C2 门店分类 + 映射？
2. **价格策略**：总部建议价 + 门店可覆盖（推荐）；还是总部锁价（`price_locked`）；还是完全放开？
3. **上下架边界**：门店自主 + 总部可强制下架（推荐）；还是只有总部能下架？
4. **新增商品**：发布即自动进所有店（推荐）还是门店手动领取？
5. **门店能否改名称/图片**：默认不允许（推荐）；若业务需要「本地化命名」，是否加 `local_name` 覆盖字段？
6. **是否需要发布审批**（草稿 → 已发布之间加一道审核）：单人可以不做，多人运营建议做。
7. **历史数据合并口径**：同名不同分类、同分类不同名，按「名称+单位」自动匹配 + 人工核对清单，是否接受？
8. **库存是否本轮一起做**：若本轮补库存表，售罄口径可在 P1 就定；否则过渡期用 `is_available` 表达售罄。
9. **兼容开关保留多久**：`CATALOG_MODE` 双读保留到哪个版本下线？
10. **权限拆分粒度**：`catalog.write` 是否按分类再细分（大商品库需要），还是先用整体权限。
