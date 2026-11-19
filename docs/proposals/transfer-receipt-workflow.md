# 分拨单「收货」责任到人方案

> 状态：待评审（本轮只出方案，不改代码、不改数据）
> 范围：仓库 → 门店分拨单的最后一步「收货」，以及是否引入审批流与到人通知
> 结论摘要：
> 1. **收货本来就该由店长做**，但店长现在连入口都没有（缺 `warehouse.read`），这是第一道障碍；
> 2. **不要引入通用审批流**，分拨是物流交接而不是审批决策，投入产出比很差；
> 3. 采用「收货责任人字段 + 站内待办 + 站内提示 + 超时展示」的轻量方案，先解决「谁该收、在哪收」；
> 4. 通知渠道本期只做站内待办，外部通道（飞书/企微/短信/邮件）放到二期，且需要先给管理员补联系方式字段。

---

## 1. 流程与责任现状

### 1.1 状态机与操作人

`warehouse_transfers.status` 取值：`draft` 草稿 / `allocated` 已分配 / `shipped` 已发出 / `received` 已收货 / `cancelled` 已取消；差异通过 `difference_closed_at` 记录，不新增状态。

| 步骤 | 状态变化 | 谁在执行（现状） | 权限码 | 数据范围校验 | 事件 |
|---|---|---|---|---|---|
| 新建 / 从要货生成 | → `draft` | 总部运营、仓库管理员 | `warehouse.write` | 来源仓库在可见范围 | `document_events` |
| 分配 | `draft` → `allocated` | 仓库管理员 | `warehouse.write` | 来源仓库 | 同上 |
| 发货 | `allocated` → `shipped` | 仓库管理员 | `warehouse.write` | 来源仓库 | 同上 |
| **收货** | `shipped` → `received` | **门店侧（理论上店长）** | **`inventory.write`** | **目标门店 `canAccessShop`** | 同上 |
| 差异关闭 | `received` 补记差异 | **门店侧** | **`inventory.write`** | **目标门店** | 同上 |
| 取消 | `draft`/`allocated` → `cancelled` | 仓库管理员 | `warehouse.write` | 来源仓库 | 同上 |
| 列表 / 详情 | — | 仓库侧或门店侧 | `warehouse.read` **或** `inventory.read` | 仓库范围 ∪ 门店范围 | — |

代码位置：`packages/api/src/routes/warehouse-transfers.ts`（收货 1836 起、差异关闭 2134 起、取消 2380 起），列表/详情读权限 `guardTransferRead`（153 起）。

要点：

- 收货**已经是门店侧的写操作**：权限是 `inventory.write`，并强制 `canAccessShop(admin, toShopId)`。也就是说「收货责任在门店」在权限模型上已经成立，缺的是**责任人和入口**。
- 分拨单已有 `requested_by_admin_id`、`handled_by_admin_id`（仓库处理人）、`received_at`，但**没有 `received_by_admin_id`**，也没有「应收货人」字段。实际谁点的收货只能翻 `document_events.payload`，无法用于待办和统计。
- 每个写操作都有幂等键（`idempotency_keys`，scope 形如 `warehouse_transfer_receive`），重复提交已经能正确返回 409。

### 1.2 店长现在能不能访问分拨页面：不能

实测 `store_manager` 角色当前权限码：

```
inventory.read, inventory.write, orders.read, orders.write,
products.catalog_visibility, products.off_shelf, products.read,
reports.read, requisitions.read, requisitions.write,
shops.catalog_push, shops.read
```

- **没有 `warehouse.read`**，因此侧边栏「仓库管理」不渲染（`apps/admin/components/AdminSidebar.tsx` 该条目权限为 `warehouse.read`）；分拨页签已经并入 `/warehouses`，店长自然连页签都看不到。
- 后端读接口其实放行 `inventory.read`，并且列表按「仓库范围 ∪ 门店范围」取并集（无仓库绑定的店长只会拿到 `to_shop_id` 属于自己的单）。所以**直接访问 `/warehouses?tab=transfers` 是能看、能收的**，只是产品上没有入口。
- 控制面板「待收货分拨单」卡片对店长是**有数字的**（`dashboard.ts` 的 `pending_transfers` 用 `status='shipped'` + `anyScope(to_shop_id, from_warehouse_id)`），点进去靠 `/warehouse-transfers` 重定向到分拨页签，属于「能到达但不可发现」。

> 结论：这是「收货责任到人」的第一道障碍，必须先解决入口，否则后面所有责任和通知都没有落点。

---

## 2. 责任模型

**结论：按目标门店绑定自动推导，发货时确认并允许修改；不新建角色关系、不强制指派。**

### 2.1 责任人怎么定

- 责任人来源：`admin_user_shops` 中绑定该 `to_shop_id`、账号 `status=1`、且拥有 `inventory.write` 的管理员（通常就是 `store_manager`）。
- 默认值：发货弹窗自动带出候选责任人，单候选直接预选；多候选默认「最近一次处理分拨/库存的人」，没有历史则按绑定时间取第一个。
- 发货人**可以改**：总部可能知道「今天王店长休息、李店长代班」。改动要落到字段并写 `document_events`。
- 不引入「必须选择责任人才能发货」的硬阻断：仓库不应该被门店排班问题卡住。未指定时按门店推导出「候选责任人」，待办对全店可见，责任人字段置空。

### 2.2 一家店多个店长谁负责

- 字段只记录**建议责任人**；待办同时按「我的」和「本店」两个维度统计：
  - 「待我收货」：`receiver_admin_id = 我`；
  - 「本店待收货」：`to_shop_id ∈ 我的门店` 且 `status='shipped'`。
- 授权只看 `inventory.write` + 门店范围，不把 `receiver_admin_id` 当成唯一授权，避免「不是指定人就不能收」导致业务停滞。

### 2.3 店长缺位谁代收

优先级：

1. 同店其他绑定店长（`admin_user_shops` + `inventory.write`）；
2. 总部/运营 `inventory.write` 且能访问该门店的人兜底代收；
3. 都不存在时，单据停在 `shipped` 并在控制面板显示超时。

代收必须记录**实际收货人**（`received_by_admin_id`），与「建议责任人」分开，事后可追责。不做「必须重新指派才能收货」的流程。

---

## 3. 审批流 vs 待办：明确不建议引入审批流

### 3.1 现有能力盘点

| 能力 | 现状 | 可否复用 |
|---|---|---|
| 单据状态机 | 有，分拨 5 态 + 差异关闭 | 直接复用 |
| 单据事件流水 | `document_events`（`document_type` / `document_id` / from-to / operator / payload / is_test） | 直接复用，责任变更写这里 |
| 幂等 | `idempotency_keys`，收货/关闭/取消都有 scope | 直接复用 |
| 测试数据隔离 | 各表与事件都有 `is_test` | 复用（注意统计口径目前有漏，见第 7 节） |
| 待办统计 | 控制面板 8 个卡片，其中「待收货分拨单」已存在 | 复用并按人细分 |
| 通用审批引擎 | **没有**。要货单只有单步 `submitted → approved`，不是可配置流程 | 需从零建设 |
| 站内消息 / 通知表 | **没有** | 需新建（MVP 不需要） |

### 3.2 两条路对比

| 维度 | A. 通用审批流 | B. 责任字段 + 待办 + 通知 |
|---|---|---|
| 解决的问题 | 可配置多级审批、会签、条件分支 | 谁负责、在哪看到、超时怎么办 |
| 与分拨业务契合度 | 低。收货是「货到了，点确认」，不是「申请-批准」；硬加一步会多一次无意义点击 | 高，贴合仓库作业节奏 |
| 工程量 | 流程定义/实例/节点/任务/审批记录 5 张表 + 权限 + 配置 UI + 运行时 + 迁移，至少 3～4 个迭代 | 1 个字段组 + 3 处接口 + 2 处 UI，1～2 个迭代 |
| 风险 | 流程配置错误会直接卡住履约；权限与数据范围叠加复杂 | 改动面小，可回滚 |
| 收益 | 未来采购、报损、要货可统一 | 仅解决分拨，但分拨本身也不需要多级审批 |

### 3.3 结论

**选 B。** 只有在出现「分拨需要二级审批 / 大额分拨需要财务会签」这类真实需求时，再评估抽取通用引擎。届时也可以先把本方案的责任字段作为审批节点的输入，不会浪费。

需要保留的「审批流优点」用轻量方式实现：责任人 = 审批人，待办 = 待办任务，超时 = SLA，通知 = 提醒。

---

## 4. 通知渠道

### 4.1 现有能力

| 渠道 | 是否具备 | 说明 |
|---|---|---|
| 控制面板待办卡片 | **有** | `pending_transfers` 已按数据范围统计；卡片链接 `/warehouse-transfers`（现重定向到 `/warehouses?tab=transfers`） |
| 列表内待办过滤 | **有** | 列表支持 `status` 与门店/仓库筛选，可按 `shipped` 过滤 |
| 站内消息表 | **无** | 需要新建才有「未读 / 已读」 |
| 邮件 | **无** | `admin_users` 无邮箱字段，`.env` 无 SMTP 配置 |
| 短信 | **无** | `admin_users` 无手机号字段 |
| 飞书 / 企业微信 | **无** | 无 webhook、无外部账号绑定 |

### 4.2 建议

- **MVP：只做站内待办。** 责任人登录后在控制面板看到「待我收货 N」，进入分拨页签默认「待我收货」，角标随单据状态自然消减。这套不需要任何新基础设施，且对店长来说就是「轮到我了」。
- **二期：飞书/企业微信机器人 webhook。** 需要新增「管理员外部账号绑定」（工号/open_id）与 webhook 配置，发送发货通知与超时提醒。这是国内门店场景到达率最高的通道。
- **三期：短信/邮件。** 需要先给 `admin_users` 补 `phone`/`email`，并接入服务商。仅作为兜底，不建议首发。
- 通知的「已读/已处理」在 MVP 里由**单据状态**承载：收货即从待办消失，不单独维护已读状态。二期做消息表时再补 `read_at`。

---

## 5. 数据模型与接口改动

### 5.1 字段（`warehouse_transfers`）

| 字段 | 类型 | 用途 | 是否必须 |
|---|---|---|---|
| `receiver_admin_id` | uuid, null, FK admin_users, `on delete set null` | 建议收货责任人（发货时确认） | P2 |
| `received_by_admin_id` | uuid, null, FK admin_users, `on delete set null` | 实际收货人（代收时与责任人不同） | P2 |
| `receive_due_at` | timestamptz, null | 收货截止时间，发货时按 SLA（如 24h）写入 | P2 |
| `reminded_at` | timestamptz, null | 最近一次催办时间 | P3 |
| `remind_count` | smallint not null default 0 | 催办次数，用于升级策略 | P3 |

索引：`(to_shop_id, status)` 已有 `warehouse_transfers_shop_idx`；新增 `(receiver_admin_id, status, receive_due_at)` 供「待我收货」与超时扫描。

明细表 `warehouse_transfer_items` **不需要改**：部分收货与差异已经由 `received_quantity` / `difference_reason` / `loss_*` 表达。

**不需要新表。** 消息表、流程表都不在 MVP 范围内。

### 5.2 迁移思路（加法 + 回滚）

- 新增 `packages/db/sql/00xx_transfer_receiver.sql`：
  - `alter table warehouse_transfers add column if not exists ...`（全部可空或带默认值，不重写大表）；
  - `create index if not exists ...`；
  - 回填：`received_by_admin_id` 可从 `document_events` 的 `operator_admin_id`（`document_type='warehouse_transfer'`、`to_status='received'`）取最近一条回填；`receiver_admin_id` 不回填，保持空。
  - 文件末尾附回滚 SQL：`drop index`、`alter table ... drop column`。回滚不丢业务数据，只丢责任记录。
- 同步更新 `packages/db/src/schema/transfers.ts` 与类型导出。

### 5.3 权限码

| 需求 | 建议 |
|---|---|
| 店长能看到分拨页签 | **新增 `warehouse.transfer_read`**，授予 `store_manager`；侧边栏与页签按 `warehouse.read OR warehouse.transfer_read` 判断 |
| 店长收货 | 沿用 `inventory.write` + `canAccessShop`，**不新增** `warehouse.receive` |
| 差异关闭 | 同样沿用 `inventory.write`（与现在一致） |
| 总部代收 | 沿用 `inventory.write` + 门店范围 |

为什么不直接把 `warehouse.read` 给店长：

- 会同时打开「仓库管理」「仓库库存」两个页签。店长没有 `admin_user_warehouses` 绑定，仓库维度的可见范围是**空数组**（`accessibleWarehouseIds` 对非超管返回绑定列表），页面会是空列表，体验混乱；
- 分拨是门店侧唯一需要的仓库能力，用一个只覆盖分拨的窄权限语义更清楚。
- 落地时页面按权限裁剪页签：只有 `transfer_read` 的人只看到「分拨管理」一个页签，且默认落在该页签。

### 5.4 接口改动

| 接口 | 改动 |
|---|---|
| `GET /warehouse-transfers` | 返回 `receiverAdminId/Name`、`receivedByAdminId/Name`、`receiveDueAt`、`overdue`；新增 `receiptScope=mine\|shop\|all` 过滤；`is_test` 默认排除 |
| `POST /warehouse-transfers/:id/ship` | 请求体增加可选 `receiverAdminId`；缺省时按门店推导候选人；写入 `receive_due_at`；写 `document_events` payload（责任人、截止时间） |
| `POST /warehouse-transfers/:id/receive` | 记录 `received_by_admin_id`；校验仍为 `inventory.write` + 门店范围；若该单已指定责任人且操作人不同，允许但记录「代收」 |
| `GET /warehouse-transfers/options` | 增加「该门店候选收货人」列表，供发货弹窗选择 |
| `GET /dashboard` | `pending_transfers` 增加按 `receiver_admin_id = 我` 的计数（`my_pending_transfers`）；所有待办统计补 `is_test = false` |
| 新增 `GET /warehouse-transfers/receipt-summary`（可选） | 店长角标用的轻量计数，避免拉整页 |

错误码沿用现有风格：`TRANSFER_ALREADY_RECEIVED`、`TRANSFER_NOT_SHIPPED`、`FORBIDDEN`；超时只是展示态，不阻断收货。

---

## 6. UI

### 6.1 店长侧入口

- 侧边栏「仓库管理」可见条件改为 `warehouse.read || warehouse.transfer_read`，名称不变。
- `/warehouses` 页签按权限裁剪：
  - 有 `warehouse.read`：三个页签（仓库管理 / 仓库库存 / 分拨管理）；
  - 只有 `warehouse.transfer_read`：只显示「分拨管理」，URL 用 `?tab=transfers`。
- 分拨页签默认筛选 `status=shipped` + 「待我收货」（`receiver_admin_id=我`）；提供切换「本店全部 / 待我收货 / 全部（按范围）」。
- 列表增加「收货责任人」「收货截止」「超时」三列（责任人、截止可只在 ≥1280px 显示）。
- 详情抽屉底部主按钮按状态与权限渲染：`shipped` + 有 `inventory.write` → 「确认收货」；有差异 → 「差异关闭」。

### 6.2 仓库侧

- 发货弹窗新增「收货责任人」下拉：默认自动带出该门店候选人，可改，可留空（留空表示全店待办）。
- 发货成功后提示「已通知 XX 收货」，并在详情里显示责任人。
- 列表增加按责任人筛选（可选）。

### 6.3 控制面板

- 「待收货分拨单」卡片：对有 `inventory.write` 且绑定门店的人，标题改为「待我收货」并只统计 `receiver_admin_id=我`；对仓库侧仍统计其仓库发出的 `shipped` 单。
- 卡片链接改为 `/warehouses?tab=transfers`，避免一次重定向。
- 角标：左侧菜单「仓库管理」上显示待办数（读同一统计接口，节流刷新）。

---

## 7. 异常与边界

| 场景 | 现状 | 方案 |
|---|---|---|
| 重复收货 | 已有 `TRANSFER_ALREADY_RECEIVED` 409 + 幂等键回放 | 保持，不新增逻辑 |
| 部分收货 | 支持实收 ≤ 发出，整单直接进入 `received`，差额靠差异关闭 | 保持；责任人=店长，差异关闭仍 `inventory.write` |
| 差异处理 | `close` 记录原因、损耗数量与金额，冻结后不再改门店库存 | 保持；建议把「实际收货人」同时作为差异关闭的默认操作人 |
| 超时未收 | 无任何概念 | 展示「超时 N 小时」；P3 加定时扫描与催办，不自动取消单据 |
| 责任人离职 / 换绑门店 | 无字段，无影响 | 授权不绑定责任人，离职后同店其他店长或总部可代收；待办按**当前** `admin_user_shops` 实时推导，`receiver_admin_id` 只作建议值，失效时回落到「本店待收货」 |
| 店长不在该店绑定 | 已有 `canAccessShop` 403 | 保持，错误文案明确「没有该门店的收货权限」 |
| 测试数据 | 表与事件都有 `is_test`，但**控制面板 8 个待办统计目前都没过滤 `is_test`** | P1 顺手在控制面板统计里补 `is_test = false`；新增的「待我收货」统计同样排除；`is_test` 单据不参与超时与催办 |
| 并发收货 | 行锁 `for update` + 幂等 | 保持 |
| 多门店店长一次收多单 | 无批量能力 | MVP 不做批量；列表可逐单收 |

---

## 8. 分阶段落地

| 阶段 | 内容 | 改动面 | 验证方式 |
|---|---|---|---|
| **P1 店长能收货（MVP）** | 新增 `warehouse.transfer_read` 并授予店长；侧边栏与页签按权限裁剪；分拨页签默认「待我收货」；控制面板卡片按人统计；顺手修 `is_test` 统计口径 | 1 个迁移 + `AdminSidebar` + `/warehouses` 页签裁剪 + 分拨面板默认筛选 + `dashboard.ts` 统计 | 店长账号：菜单可见、只有分拨页签、只看到本店 `shipped` 单、能收货；跨店 403；总部账号三个页签不变 |
| **P2 责任到人 + 通知** | 新增 `receiver_admin_id` / `received_by_admin_id` / `receive_due_at`；发货弹窗选责任人；待办按人；列表与详情展示责任人与截止；菜单角标 | 迁移 + `ship`/`receive`/`list` 接口 + 发货弹窗 + 详情 | 发货后责任人可见「待我收货 1」；他人只在本店列表看到；代收记录实际收货人；责任人字段在历史单据为空时不影响使用 |
| **P3 超时升级** | 定时任务扫描 `shipped` 且超 `receive_due_at` 的单据，写 `reminded_at` / `remind_count`，站内提示并升级到运营；飞书/企微 webhook（若已接入外部账号） | 新增调度任务（当前仓库无定时任务基础设施，需要引入）+ 通知通道 | 构造超时单，确认提醒只发一次、次数递增、收货后停止 |
| **P4 通用审批流（可选）** | 仅当出现多级审批/会签真实需求时，抽取流程定义、实例、任务表 | 大改 | 不排期 |

> P1 单独上线就能解决用户提出的「店长收不了货」问题；P2 才真正实现「到人」。P3 依赖定时任务能力，是当前基础设施缺口。

---

## 9. 待决问题（需要产品拍板）

1. 收货 SLA 定为多久（24h / 48h / 按门店配置）？超时是先提示还是直接升级到运营？
2. 发货时**是否允许不指定责任人**？如果允许，店长侧默认落在「本店待收货」，是否满足「责任到人」的表达？
3. 一家店多个店长时，是否要求「必须由被指定的人收货」？本方案建议不强制，只做提示与记录。
4. 总部/运营代收是否需要单独留痕说明（例如必填代收原因）？
5. 店长是否需要在分拨页签看到**仓库库存**相关信息（当前不可见），还是只需要单据与收货？
6. 通知二期选飞书还是企业微信（取决于公司实际使用）？管理员外部账号从哪里维护（后台账号页 or 组织架构同步）？
7. 差异关闭是否也纳入「责任人」体系（即由同一店长完成收货 + 差异关闭），还是允许仓库侧关闭？
8. 是否接受「控制面板待办不计测试数据」的口径变更（现有测试单会从卡片上消失）？
