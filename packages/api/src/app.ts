import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { ROLES, ORDER_STATUS_LABELS } from '@sds/shared';
import { publicShopRoutes } from './routes/public-shops.js';
import { registerHealthRoutes } from './routes/health.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { adminAccountRoutes } from './routes/admin-accounts.js';
import { adminRbacRoutes } from './routes/admin-rbac.js';
import { adminPreferenceRoutes } from './routes/admin-preferences.js';
import { shopRoutes } from './routes/shops.js';
import { productRoutes } from './routes/products.js';
import { catalogRoutes } from './routes/catalog.js';
import { inventoryRoutes } from './routes/inventory.js';
import { purchaseRoutes } from './routes/purchases.js';
import { mobileRoutes } from './routes/mobile.js';
import { cartRoutes } from './routes/mobile-cart.js';
import { adminCartRoutes } from './routes/admin-carts.js';
import { mobileOrderRoutes } from './routes/mobile-orders.js';
import { customerSummaryRoutes } from './routes/customer-summary.js';
import { adminOrderRoutes } from './routes/admin-orders.js';
import { authRoutes } from './routes/auth.js';
import { addressRoutes } from './routes/addresses.js';
import { regionRoutes } from './routes/regions.js';
import { uploadRoutes } from './routes/uploads.js';

/**
 * API 装配入口：认证中间件、RBAC、店铺隔离等按 PRD 4.5 分层逐步接入。
 */
export const app = new Hono();

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(',');

app.use(
  '/api/*',
  cors({
    origin: corsOrigins,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'If-None-Match'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // 区划接口用 ETag 做协商缓存，浏览器端需要能读到该响应头
    exposeHeaders: ['ETag']
  })
);

// 响应压缩：JSON 体积明显下降；前面有代理重复压缩时，代理会看到已带编码的响应而跳过
app.use('/api/*', compress());

app.get('/', (c) =>
  c.json({
    service: 'sds-api',
    message: 'Hello 捎点啥（sds）',
    roles: Object.values(ROLES),
    orderStatusSample: ORDER_STATUS_LABELS.pending_payment
  })
);

app.get('/api/hello', (c) => c.text('Hello from Hono API'));

app.route('/api/shops', publicShopRoutes);
app.route('/api/mobile/shops', publicShopRoutes);

app.route('/api/admin/auth', adminAuthRoutes);
app.route('/api/admin', adminAccountRoutes);
app.route('/api/admin', adminRbacRoutes);
app.route('/api/admin/auth', adminPreferenceRoutes);
app.route('/api/admin/shops', shopRoutes);
app.route('/api/admin/uploads', uploadRoutes);
app.route('/api/admin', productRoutes);
app.route('/api/admin', catalogRoutes);
app.route('/api/admin', inventoryRoutes);
app.route('/api/admin', purchaseRoutes);
app.route('/api/admin/carts', adminCartRoutes);
app.route('/api/admin/orders', adminOrderRoutes);
// 顾客端：移动端首页使用，独立于 admin 路径与权限
app.route('/api/mobile', mobileRoutes);
// 顾客购物车：需登录（Bearer 会话），与后台共享同一份 carts / cart_items
app.route('/api/mobile/cart', cartRoutes);
// 顾客订单：下单即扣库存，与后台订单管理共享同一份 orders / order_items
app.route('/api/mobile/orders', mobileOrderRoutes);
// 顾客顶栏计数：订单进行中数量 + 地址数量，只返回数字
app.route('/api/mobile/summary', customerSummaryRoutes);
// 顾客认证：PRD 6.2，公开接口 + Bearer 会话
app.route('/api/auth', authRoutes);
app.route('/api/addresses', addressRoutes);
// 行政区划字典：公开，各端三级联动共用；数据来自 regions 表
app.route('/api/regions', regionRoutes);

// 统一兜底：避免把堆栈直接返回给前端
app.onError((err, c) => {
  console.error('[sds-api] 未处理异常:', err);
  return c.json({ code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后再试' }, 500);
});

registerHealthRoutes(app);

export default app;
