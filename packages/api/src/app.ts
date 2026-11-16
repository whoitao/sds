import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { nearbyShopQuerySchema, ROLES, ORDER_STATUS_LABELS } from '@sds/shared';
import { registerHealthRoutes } from './routes/health';
import { adminAuthRoutes } from './routes/admin-auth';
import { adminAccountRoutes } from './routes/admin-accounts';
import { adminRbacRoutes } from './routes/admin-rbac';
import { adminPreferenceRoutes } from './routes/admin-preferences';
import { shopRoutes } from './routes/shops';
import { productRoutes } from './routes/products';
import { catalogRoutes } from './routes/catalog';
import { mobileRoutes } from './routes/mobile';
import { cartRoutes } from './routes/mobile-cart';
import { adminCartRoutes } from './routes/admin-carts';
import { authRoutes } from './routes/auth';
import { addressRoutes } from './routes/addresses';
import { regionRoutes } from './routes/regions';
import { uploadRoutes } from './routes/uploads';

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

app.get('/', (c) =>
  c.json({
    service: 'sds-api',
    message: 'Hello 捎点啥（sds）',
    roles: Object.values(ROLES),
    orderStatusSample: ORDER_STATUS_LABELS.pending_payment
  })
);

app.get('/api/hello', (c) => c.text('Hello from Hono API'));

app.get('/api/shops/nearby', (c) => {
  const parsed = nearbyShopQuerySchema.safeParse({
    lat: c.req.query('lat'),
    lng: c.req.query('lng'),
    radius: c.req.query('radius'),
    keyword: c.req.query('keyword')
  });

  if (!parsed.success) {
    return c.json({ code: 'INVALID_QUERY', details: parsed.error.issues }, 400);
  }

  // 本轮不连接数据库，返回示例数据
  return c.json({
    items: [
      { id: 'demo-shop-1', name: '示例生鲜店（不接数据库）', distanceMeters: 860 }
    ],
    query: parsed.data
  });
});

app.route('/api/admin/auth', adminAuthRoutes);
app.route('/api/admin', adminAccountRoutes);
app.route('/api/admin', adminRbacRoutes);
app.route('/api/admin/auth', adminPreferenceRoutes);
app.route('/api/admin/shops', shopRoutes);
app.route('/api/admin/uploads', uploadRoutes);
app.route('/api/admin', productRoutes);
app.route('/api/admin', catalogRoutes);
app.route('/api/admin/carts', adminCartRoutes);
// 顾客端：移动端首页使用，独立于 admin 路径与权限
app.route('/api/mobile', mobileRoutes);
// 顾客购物车：需登录（Bearer 会话），与后台共享同一份 carts / cart_items
app.route('/api/mobile/cart', cartRoutes);
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
