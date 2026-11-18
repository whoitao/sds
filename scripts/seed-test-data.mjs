#!/usr/bin/env node
/**
 * 测试/演示数据种子（可重复执行、幂等）
 *
 * 用法：
 *   pnpm seed:test
 *
 * 行为：
 * - 只在本地/测试库执行，所有写入行 is_test = true；
 * - 固定 UUID + 固定编号（TEST- 前缀），重复执行不会产生重复数据；
 * - 生成 1 个总部仓、2 家门店、3 个供应商（含供货关系）、5 个总部商品与门店 SKU 库存、
 *   门店要货单、需求计划、门店采购单、顾客订单与库存流水；
 * - 清理：admin 各业务列表页的「清理测试数据」按钮，或 DELETE /api/admin/test-data。
 *
 * 安全：
 * - 默认拒绝在 NODE_ENV=production 下执行；
 * - 脚本只插入 is_test = true 的行，不修改任何正式数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(path.join(rootDir, '.env.example')), ...loadEnv(path.join(rootDir, '.env')) };
if (process.env.DATABASE_URL) env.DATABASE_URL = process.env.DATABASE_URL;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL 未配置：请在根目录 .env 中提供连接串');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('拒绝在生产环境写入演示数据（NODE_ENV=production）');
  process.exit(1);
}

const { Client } = pg;
const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

// ---------- 固定 ID ----------
const HQ_WAREHOUSE = '11111111-1111-4111-8111-111111111111';
const SHOPS = [
  '22222222-2222-4222-8222-222222222201',
  '22222222-2222-4222-8222-222222222202'
];
const SUPPLIERS = [
  '33333333-3333-4333-8333-333333333301',
  '33333333-3333-4333-8333-333333333302',
  '33333333-3333-4333-8333-333333333303'
];
const linkId = (s, n) => `4444440${s}-0000-4000-8000-00000000000${n}`;
const catalogProductId = (p) => `55555555-5555-4555-8555-00000000000${p}`;
const catalogSkuId = (p) => `66666666-6666-4666-8666-00000000000${p}`;
const productId = (s, p) => `7700000${s}-0000-4000-8000-00000000000${p}`;
const productSkuId = (s, p) => `8800000${s}-0000-4000-8000-00000000000${p}`;
const initialMovementId = (s, p) => `aa00000${s}-0000-4000-8000-00000000000${p}`;
const purchaseMovementId = (s, p) => `ab00000${s}-0000-4000-8000-00000000000${p}`;
const warehouseInitialMovementId = (p) => `ac00000${p}-0000-4000-8000-000000000001`;
const RQ = [1, 2, 3].map((n) => `dd000000-0000-4000-8000-00000000000${n}`);
const rqItemId = (r, m) => `de00000${r}-0000-4000-8000-00000000000${m}`;
const DEMAND_PLAN = 'ee000000-0000-4000-8000-000000000001';
const demandItemId = (m) => `ef00000${m}-0000-4000-8000-00000000000${m}`;
const PO = [1, 2, 3].map((n) => `ff000000-0000-4000-8000-00000000000${n}`);
const poItemId = (n, m) => `f100000${n}-0000-4000-8000-00000000000${m}`;
const ORDER_IDS = [1, 2, 3, 4, 5, 6].map(
  (n) => `cc000000-0000-4000-8000-00000000000${n}`
);
const orderItemId = (n, m) => `cd00000${n}-0000-4000-8000-00000000000${m}`;
const orderPaymentId = (n) => `ce00000${n}-0000-4000-8000-000000000001`;

const today = new Date();
const day = (offset) => {
  const date = new Date(today.getTime() + offset * 86400000);
  return date.toISOString().slice(0, 10);
};

const CATALOG = [
  { name: '测试番茄', unit: '斤', price: '3.50', quantityMode: 'decimal_2', spec: '500g/份' },
  { name: '测试猪五花', unit: '斤', price: '16.00', quantityMode: 'decimal_2', spec: '1kg/份' },
  { name: '测试东北大米', unit: '袋', price: '45.00', quantityMode: 'integer', spec: '5kg/袋' },
  { name: '测试鲜鸡蛋', unit: '盒', price: '12.00', quantityMode: 'integer', spec: '10 枚/盒' },
  { name: '测试菜籽油', unit: '桶', price: '88.00', quantityMode: 'integer', spec: '5L/桶' }
];

const SHOP_STOCK = [
  ['80.50', '50.00', '30', '24', '18'],
  ['55.00', '35.00', '26', '20', '15']
];

// 已入库采购单：门店 1 的番茄 +20、猪肉 +10（库存余额已包含这两笔）
const RECEIVED_QTY = { 1: '20', 2: '10' };

// 已入库采购单：门店 1 的番茄 +20、猪肉 +10
const RECEIVED_PO_LINES = [
  { sku: 1, qty: '20', cost: '3.20', amount: '64.00' },
  { sku: 2, qty: '10', cost: '11.50', amount: '115.00' }
];

async function insertRow(table, conflictColumns, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  await client.query(
    `insert into ${table} (${columns.join(', ')})
     values (${placeholders.join(', ')})
     on conflict (${conflictColumns}) do nothing`,
    columns.map((column) => row[column])
  );
}

async function main() {
  await client.connect();
  await client.query('begin');

  // 总部仓
  await insertRow('warehouses', 'id', {
    id: HQ_WAREHOUSE,
    code: 'TEST-HQ-01',
    name: '测试总部仓',
    type: 'hq',
    address: '测试市测试区总部仓 1 号',
    cold_zone_supported: true,
    status: 'active',
    remark: '演示数据，可一键清理',
    is_test: true
  });

  // 门店
  for (const [index, shopId] of SHOPS.entries()) {
    await insertRow('shops', 'id', {
      id: shopId,
      name: index === 0 ? '测试门店·春熙店' : '测试门店·高新店',
      address: index === 0 ? '测试市春熙路 1 号' : '测试市高新区天府大道 2 号',
      longitude: index === 0 ? '104.0800000' : '104.0600000',
      latitude: index === 0 ? '30.6500000' : '30.5700000',
      phone: index === 0 ? '13800000001' : '13800000002',
      status: 'open',
      announcement: '演示门店，可一键清理',
      is_test: true
    });
  }

  // 供应商 + 供货关系（3 个供应商都供 2 家门店）
  const suppliers = [
    { name: '测试供应商·鲜丰蔬菜', code: 'TEST-SUP-01', contact: '王蔬菜', phone: '13900000001' },
    { name: '测试供应商·牧原肉品', code: 'TEST-SUP-02', contact: '李肉品', phone: '13900000002' },
    { name: '测试供应商·粮油商贸', code: 'TEST-SUP-03', contact: '赵粮油', phone: '13900000003' }
  ];
  for (const [index, supplier] of suppliers.entries()) {
    await insertRow('suppliers', 'id', {
      id: SUPPLIERS[index],
      code: supplier.code,
      name: supplier.name,
      contact_name: supplier.contact,
      phone: supplier.phone,
      address: '测试市供应商园区',
      settlement_method: 'monthly',
      status: 'active',
      remark: '演示数据，可一键清理',
      is_test: true
    });
    for (const [shopIndex, shopId] of SHOPS.entries()) {
      await insertRow('supplier_scopes', 'id', {
        id: linkId(shopIndex + 1, index + 1),
        supplier_id: SUPPLIERS[index],
        subject_type: 'shop',
        subject_id: shopId,
        status: 'active',
        is_test: true
      });
    }
  }

  // 总部商品 + 规格
  for (const [index, item] of CATALOG.entries()) {
    const productKey = index + 1;
    await insertRow('catalog_products', 'id', {
      id: catalogProductId(productKey),
      name: item.name,
      unit: item.unit,
      default_price: item.price,
      stock_type: 'tracked',
      status: 'published',
      published_at: new Date(),
      is_test: true
    });
    await insertRow('catalog_skus', 'id', {
      id: catalogSkuId(productKey),
      catalog_product_id: catalogProductId(productKey),
      spec_name: item.spec,
      unit: item.unit,
      default_price: item.price,
      stock_type: 'tracked',
      quantity_mode: item.quantityMode,
      is_default: true,
      status: 'active',
      is_test: true,
      sort_order: productKey
    });
  }

  // 门店商品 + 门店 SKU + 门店库存 + 初始库存流水
  for (const [shopIndex, shopId] of SHOPS.entries()) {
    for (const [index, item] of CATALOG.entries()) {
      const productKey = index + 1;
      const queue = SHOP_STOCK[shopIndex];
      const stock = queue[index];
      const receivedQty = shopIndex === 0 ? (RECEIVED_QTY[productKey] ?? '0') : '0';
      const initialQty = (Number(stock) - Number(receivedQty)).toFixed(2);
      await insertRow('products', 'id', {
        id: productId(shopIndex + 1, productKey),
        shop_id: shopId,
        catalog_product_id: catalogProductId(productKey),
        name: item.name,
        unit: item.unit,
        stock_type: 'tracked',
        is_available: true,
        is_test: true,
        sort_order: productKey
      });
      await insertRow('product_skus', 'id', {
        id: productSkuId(shopIndex + 1, productKey),
        shop_id: shopId,
        product_id: productId(shopIndex + 1, productKey),
        catalog_sku_id: catalogSkuId(productKey),
        spec_name: item.spec,
        unit: item.unit,
        price: null,
        stock_type: 'tracked',
        quantity_mode: item.quantityMode,
        is_available: true,
        is_default: true,
        is_test: true,
        sort_order: productKey
      });
      await insertRow('product_sku_stocks', 'product_sku_id', {
        product_sku_id: productSkuId(shopIndex + 1, productKey),
        shop_id: shopId,
        quantity: stock,
        min_threshold: '10',
        is_test: true
      });
      await insertRow('stock_movements', 'id', {
        id: initialMovementId(shopIndex + 1, productKey),
        shop_id: shopId,
        location_type: 'shop',
        location_id: shopId,
        product_sku_id: productSkuId(shopIndex + 1, productKey),
        movement_type: 'initial',
        quantity_change: initialQty,
        balance_after: initialQty,
        reference_type: 'seed',
        reference_id: null,
        remark: '演示数据初始库存',
        is_test: true
      });
    }
  }

  // 总部仓库存 + 初始库存流水
  for (const [index] of CATALOG.entries()) {
    const quantity = index === 0 ? '200.00' : String((5 - index) * 40);
    await insertRow('warehouse_stocks', 'warehouse_id, sku_id', {
      warehouse_id: HQ_WAREHOUSE,
      sku_id: catalogSkuId(index + 1),
      quantity,
      is_test: true
    });
    await insertRow('stock_movements', 'id', {
      id: warehouseInitialMovementId(index + 1),
      shop_id: null,
      location_type: 'warehouse',
      location_id: HQ_WAREHOUSE,
      product_sku_id: null,
      catalog_sku_id: catalogSkuId(index + 1),
      movement_type: 'initial',
      quantity_change: quantity,
      balance_after: quantity,
      reference_type: 'seed',
      reference_id: null,
      remark: '演示数据总部仓初始库存',
      is_test: true
    });
  }

  // 门店采购单：1 张已入库（门店 1），1 张已提交（门店 2）
  const receivedAmount = RECEIVED_PO_LINES.reduce((sum, line) => sum + Number(line.amount), 0);
  await insertRow('purchase_orders', 'id', {
    id: PO[0],
    shop_id: SHOPS[0],
    po_no: 'TEST-PO-S001',
    supplier_id: SUPPLIERS[0],
    supplier_name: suppliers[0].name,
    supplier_phone: suppliers[0].phone,
    status: 'received',
    ordered_amount: receivedAmount.toFixed(2),
    received_amount: receivedAmount.toFixed(2),
    expected_at: new Date(today.getTime() - 86400000),
    submitted_at: new Date(today.getTime() - 2 * 86400000),
    received_at: new Date(today.getTime() - 86400000),
    remark: '演示采购单，可一键清理',
    is_test: true
  });
  for (const [index, line] of RECEIVED_PO_LINES.entries()) {
    const key = index + 1;
    await insertRow('purchase_order_items', 'id', {
      id: poItemId(1, key),
      purchase_order_id: PO[0],
      product_sku_id: productSkuId(1, line.sku),
      item_name: CATALOG[line.sku - 1].name,
      unit: CATALOG[line.sku - 1].unit,
      quantity_mode: CATALOG[line.sku - 1].quantityMode,
      quantity: line.qty,
      unit_cost: line.cost,
      received_quantity: line.qty,
      amount: line.amount,
      is_test: true
    });
    const stock = Number(SHOP_STOCK[0][line.sku - 1]);
    await insertRow('stock_movements', 'id', {
      id: purchaseMovementId(1, line.sku),
      shop_id: SHOPS[0],
      location_type: 'shop',
      location_id: SHOPS[0],
      product_sku_id: productSkuId(1, line.sku),
      movement_type: 'purchase_in',
      quantity_change: line.qty,
      balance_after: stock.toFixed(2),
      unit_cost: line.cost,
      reference_type: 'purchase_order',
      reference_id: PO[0],
      remark: '演示采购入库',
      is_test: true
    });
  }
  await insertRow('purchase_orders', 'id', {
    id: PO[1],
    shop_id: SHOPS[1],
    po_no: 'TEST-PO-S002',
    supplier_id: SUPPLIERS[2],
    supplier_name: suppliers[2].name,
    supplier_phone: suppliers[2].phone,
    status: 'submitted',
    ordered_amount: '1008.00',
    received_amount: '0',
    expected_at: new Date(today.getTime() + 2 * 86400000),
    submitted_at: new Date(today.getTime() - 86400000),
    remark: '演示采购单，可一键清理',
    is_test: true
  });
  await insertRow('purchase_order_items', 'id', {
    id: poItemId(2, 1),
    purchase_order_id: PO[1],
    product_sku_id: productSkuId(2, 3),
    item_name: CATALOG[2].name,
    unit: CATALOG[2].unit,
    quantity_mode: CATALOG[2].quantityMode,
    quantity: '24',
    unit_cost: '42.00',
    received_quantity: '0',
    amount: '1008.00',
    is_test: true
  });

  // 总部仓采购单（待入库，按总部规格下单）
  await insertRow('purchase_orders', 'id', {
    id: PO[2],
    shop_id: null,
    warehouse_id: HQ_WAREHOUSE,
    po_no: 'TEST-PO-WH01',
    supplier_id: SUPPLIERS[0],
    supplier_name: suppliers[0].name,
    supplier_phone: suppliers[0].phone,
    status: 'submitted',
    ordered_amount: '412.00',
    received_amount: '0',
    expected_at: new Date(today.getTime() + 2 * 86400000),
    submitted_at: new Date(today.getTime() - 3600000),
    remark: '演示总部仓采购单，可一键清理',
    is_test: true
  });
  await insertRow('purchase_order_items', 'id', {
    id: poItemId(3, 1),
    purchase_order_id: PO[2],
    product_sku_id: null,
    catalog_sku_id: catalogSkuId(1),
    item_name: CATALOG[0].name,
    unit: CATALOG[0].unit,
    quantity_mode: CATALOG[0].quantityMode,
    quantity: '80',
    unit_cost: '3.40',
    received_quantity: '0',
    amount: '272.00',
    is_test: true
  });
  await insertRow('purchase_order_items', 'id', {
    id: poItemId(3, 2),
    purchase_order_id: PO[2],
    product_sku_id: null,
    catalog_sku_id: catalogSkuId(3),
    item_name: CATALOG[2].name,
    unit: CATALOG[2].unit,
    quantity_mode: CATALOG[2].quantityMode,
    quantity: '4',
    unit_cost: '35.00',
    received_quantity: '0',
    amount: '140.00',
    is_test: true
  });

  // 门店要货单
  await insertRow('shop_requisitions', 'id', {
    id: RQ[0],
    requisition_no: 'TEST-RQ-0001',
    shop_id: SHOPS[0],
    expected_date: day(1),
    status: 'approved',
    remark: '演示要货单，可一键清理',
    submitted_at: new Date(today.getTime() - 86400000),
    reviewed_at: new Date(today.getTime() - 43200000),
    review_note: '同意，按审批数量备货',
    is_test: true
  });
  const rq1Lines = [
    { sku: 1, request: '10', approved: '10' },
    { sku: 2, request: '5', approved: '5' },
    { sku: 4, request: '8', approved: '6' }
  ];
  for (const [index, line] of rq1Lines.entries()) {
    await insertRow('shop_requisition_items', 'id', {
      id: rqItemId(1, index + 1),
      requisition_id: RQ[0],
      product_sku_id: productSkuId(1, line.sku),
      catalog_sku_id: catalogSkuId(line.sku),
      item_name: CATALOG[line.sku - 1].name,
      spec_name: CATALOG[line.sku - 1].spec,
      category_name: line.sku === 2 ? '肉类' : line.sku === 4 ? '蛋品' : '蔬菜',
      unit: CATALOG[line.sku - 1].unit,
      requested_qty: line.request,
      approved_qty: line.approved,
      is_test: true
    });
  }
  await insertRow('shop_requisitions', 'id', {
    id: RQ[1],
    requisition_no: 'TEST-RQ-0002',
    shop_id: SHOPS[1],
    expected_date: day(1),
    status: 'submitted',
    remark: '演示要货单，可一键清理',
    submitted_at: new Date(today.getTime() - 7200000),
    is_test: true
  });
  for (const [index, line] of [
    { sku: 1, request: '8' },
    { sku: 3, request: '12' }
  ].entries()) {
    await insertRow('shop_requisition_items', 'id', {
      id: rqItemId(2, index + 1),
      requisition_id: RQ[1],
      product_sku_id: productSkuId(2, line.sku),
      catalog_sku_id: catalogSkuId(line.sku),
      item_name: CATALOG[line.sku - 1].name,
      spec_name: CATALOG[line.sku - 1].spec,
      category_name: line.sku === 3 ? '米面粮油' : '蔬菜',
      unit: CATALOG[line.sku - 1].unit,
      requested_qty: line.request,
      is_test: true
    });
  }
  await insertRow('shop_requisitions', 'id', {
    id: RQ[2],
    requisition_no: 'TEST-RQ-0003',
    shop_id: SHOPS[0],
    expected_date: day(3),
    status: 'draft',
    remark: '演示草稿，可一键清理',
    is_test: true
  });
  await insertRow('shop_requisition_items', 'id', {
    id: rqItemId(3, 1),
    requisition_id: RQ[2],
    product_sku_id: productSkuId(1, 5),
    catalog_sku_id: catalogSkuId(5),
    item_name: CATALOG[4].name,
    spec_name: CATALOG[4].spec,
    category_name: '米面粮油',
    unit: CATALOG[4].unit,
    requested_qty: '4',
    is_test: true
  });

  // 需求计划（已定稿）
  const planLines = [
    {
      sku: 1,
      request: '18',
      final: '18',
      category: '蔬菜',
      breakdown: [
        ['1', '测试门店·春熙店', RQ[0], 'TEST-RQ-0001', '10', '10'],
        ['2', '测试门店·高新店', RQ[1], 'TEST-RQ-0002', '8', '8']
      ]
    },
    {
      sku: 2,
      request: '5',
      final: '5',
      category: '肉类',
      breakdown: [['1', '测试门店·春熙店', RQ[0], 'TEST-RQ-0001', '5', '5']]
    },
    {
      sku: 4,
      request: '6',
      final: '6',
      category: '蛋品',
      breakdown: [['1', '测试门店·春熙店', RQ[0], 'TEST-RQ-0001', '8', '6']]
    }
  ];
  const totalRequested = planLines.reduce((sum, line) => sum + Number(line.request), 0);
  await insertRow('demand_plans', 'id', {
    id: DEMAND_PLAN,
    plan_no: 'TEST-DP-0001',
    delivery_date: day(1),
    warehouse_id: HQ_WAREHOUSE,
    version: 1,
    status: 'decided',
    is_current: true,
    total_skus: planLines.length,
    total_requested_qty: totalRequested.toFixed(2),
    remark: '演示需求计划，可一键清理',
    decided_at: new Date(today.getTime() - 3600000),
    is_test: true
  });
  for (const [index, line] of planLines.entries()) {
    await insertRow('demand_plan_items', 'id', {
      id: demandItemId(index + 1),
      demand_plan_id: DEMAND_PLAN,
      catalog_sku_id: catalogSkuId(line.sku),
      item_name: CATALOG[line.sku - 1].name,
      spec_name: CATALOG[line.sku - 1].spec,
      unit: CATALOG[line.sku - 1].unit,
      category_name: line.category,
      total_requested_qty: line.request,
      final_qty: line.final,
      purchase_path: 'centralized',
      shop_breakdown: JSON.stringify(
        line.breakdown.map(([shopIndex, shopName, requisitionId, requisitionNo, requestedQty, approvedQty]) => ({
          shopId: SHOPS[Number(shopIndex) - 1],
          shopName,
          requisitionId,
          requisitionNo,
          requestedQty,
          approvedQty
        }))
      ),
      is_test: true
    });
  }

  // 顾客与顾客订单（身份表不加 is_test，订单与明细可清理）
  const customers = [];
  const demoCustomers = [
    { phone: '19900000001', name: '测试顾客·张一' },
    { phone: '19900000002', name: '测试顾客·李二' }
  ];
  for (const demo of demoCustomers) {
    const user = await client.query(
      `insert into users (phone, name, role) values ($1, $2, 'customer')
       on conflict (phone) do update set name = excluded.name
       returning id`,
      [demo.phone, demo.name]
    );
    const customer = await client.query(
      `insert into customers (user_id, nickname, phone) values ($1, $2, $3)
       on conflict (user_id) do update set nickname = excluded.nickname
       returning id`,
      [user.rows[0].id, demo.name.replace('测试顾客·', ''), demo.phone]
    );
    customers.push(customer.rows[0].id);
  }

  const orderPlans = [
    { shop: 0, status: 'completed', payment: 'wechat', paymentStatus: 'paid', lines: [[1, '2.50', '3.50'], [4, '2', '12.00']] },
    { shop: 0, status: 'completed', payment: 'cash', paymentStatus: 'offline', lines: [[2, '1.50', '16.00'], [3, '1', '45.00']] },
    { shop: 1, status: 'preparing', payment: 'wechat', paymentStatus: 'paid', lines: [[1, '3.00', '3.50'], [5, '1', '88.00']] },
    { shop: 1, status: 'paid', payment: 'cash', paymentStatus: 'offline', lines: [[3, '2', '45.00']] },
    { shop: 0, status: 'delivering', payment: 'wechat', paymentStatus: 'paid', lines: [[5, '2', '88.00']] },
    { shop: 1, status: 'completed', payment: 'cash', paymentStatus: 'offline', lines: [[4, '3', '12.00'], [2, '1', '16.00']] }
  ];
  for (const [index, plan] of orderPlans.entries()) {
    const orderId = ORDER_IDS[index];
    const shopId = SHOPS[plan.shop];
    const itemCount = plan.lines.reduce((sum, [, qty]) => sum + Number(qty), 0);
    const subtotal = plan.lines.reduce(
      (sum, [, qty, price]) => sum + Number(qty) * Number(price),
      0
    );
    const total = subtotal.toFixed(2);
    await insertRow('orders', 'id', {
      id: orderId,
      order_no: `TEST-ORD-000${index + 1}`,
      shop_id: shopId,
      customer_id: customers[index % customers.length],
      status: plan.status,
      fulfillment_type: index % 2 === 0 ? 'delivery' : 'pickup',
      contact_name: demoCustomers[index % 2].name,
      contact_phone: demoCustomers[index % 2].phone,
      address_text: index % 2 === 0 ? '测试市春熙路 1 号' : null,
      item_count: String(itemCount),
      subtotal: total,
      total_amount: total,
      payment_method: plan.payment,
      paid_at: new Date(today.getTime() - (index + 1) * 3600000),
      remark: '演示订单，可一键清理',
      is_test: true
    });
    for (const [lineIndex, [sku, qty, price]] of plan.lines.entries()) {
      await insertRow('order_items', 'id', {
        id: orderItemId(index + 1, lineIndex + 1),
        order_id: orderId,
        product_id: productId(plan.shop + 1, sku),
        product_sku_id: productSkuId(plan.shop + 1, sku),
        name: CATALOG[sku - 1].name,
        spec_name: CATALOG[sku - 1].spec,
        unit: CATALOG[sku - 1].unit,
        quantity_mode: CATALOG[sku - 1].quantityMode,
        unit_price: price,
        quantity: qty,
        subtotal: (Number(qty) * Number(price)).toFixed(2),
        is_test: true
      });
    }
    await insertRow('order_payments', 'id', {
      id: orderPaymentId(index + 1),
      order_id: orderId,
      method: plan.payment,
      provider: 'seed',
      amount: total,
      status: plan.paymentStatus,
      paid_at: new Date(today.getTime() - (index + 1) * 3600000),
      is_test: true
    });
  }

  await client.query('commit');

  // 汇总输出
  const tables = [
    ['warehouses', '总部仓'],
    ['shops', '门店'],
    ['suppliers', '供应商'],
    ['supplier_scopes', '供货范围'],
    ['catalog_products', '总部商品'],
    ['catalog_skus', '总部规格'],
    ['products', '门店商品'],
    ['product_skus', '门店 SKU'],
    ['product_sku_stocks', '门店库存'],
    ['warehouse_stocks', '仓库库存'],
    ['stock_movements', '库存流水'],
    ['shop_requisitions', '要货单'],
    ['shop_requisition_items', '要货明细'],
    ['demand_plans', '需求计划'],
    ['demand_plan_items', '计划明细'],
    ['purchase_orders', '采购单'],
    ['purchase_order_items', '采购明细'],
    ['orders', '顾客订单'],
    ['order_items', '订单明细'],
    ['order_payments', '支付流水']
  ];
  console.log('测试数据种子执行完成：');
  for (const [table, label] of tables) {
    const result = await client.query(
      `select count(*)::int as count from ${table} where is_test = true`
    );
    console.log(`  ${label.padEnd(10, ' ')} ${String(result.rows[0].count).padStart(4, ' ')} 条`);
  }
}

main()
  .catch((error) => {
    console.error('种子执行失败：', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.query('rollback');
    } catch {
      // 已提交或连接已断开时忽略
    }
    await client.end();
  });
