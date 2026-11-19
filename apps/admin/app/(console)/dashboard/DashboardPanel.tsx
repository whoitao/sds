'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Col, Empty, Row, Select, Skeleton, Space, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  FileExclamationOutlined,
  FileTextOutlined,
  InboxOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  SwapOutlined,
  UndoOutlined,
  UnorderedListOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { AdminListPage } from '../../../components/AdminListPage';
import { ADMIN_FILTER_FIELD_WIDTH } from '../../../lib/table';
import { adminColors as colors } from '../../../lib/theme';

interface SalesBlock {
  orderCount: number;
  salesAmount: number;
  avgOrderValue: number;
  previous: {
    orderCount: number;
    salesAmount: number;
    avgOrderValue: number;
  };
  orderChangePct: number | null;
  salesChangePct: number | null;
}

interface DashboardData {
  generatedAt: string;
  timezone: string;
  range: {
    todayStart: string;
    yesterdayStart: string;
    yesterdayEnd: string;
    last7Start: string;
    prev7Start: string;
    prev7End: string;
    now: string;
  };
  scope: {
    allShops: boolean;
    shopCount: number | null;
    selectedShopId: string | null;
    allWarehouses: boolean;
    warehouseCount: number | null;
  };
  sales: {
    today: SalesBlock;
    last7: SalesBlock;
  };
  todos: {
    pendingOrders: number;
    refundPendingOrders: number;
    pendingRequisitions: number;
    pendingPurchases: number;
    pendingTransfers: number;
    pendingDamageReports: number;
    lowStockShopSkus: number;
    lowStockWarehouseSkus: number;
  };
  inventory: {
    warehouseAmount: number;
    warehouseSkuCount: number;
    shopAmount: number;
    shopSkuCount: number;
    lowStockShopSkus: number;
    lowStockWarehouseSkus: number;
  };
  trend: Array<{ date: string; orderCount: number; salesAmount: number }>;
  topSkus: Array<{
    skuId: string;
    name: string;
    specName: string | null;
    quantity: number;
    amount: number;
  }>;
  shopRanking: Array<{
    shopId: string;
    shopName: string;
    orderCount: number;
    salesAmount: number;
  }>;
  loss: {
    damageAmount: number;
    transferLossAmount: number;
    amount: number;
    salesAmount: number;
    ratioPct: number | null;
  };
}

/** 字号跟随后台三档密度（--admin-display-font-size），避免写死 px */
const fontSize = {
  small: 'calc(var(--admin-display-font-size) - 1px)',
  base: 'var(--admin-display-font-size)',
  section: 'calc(var(--admin-display-font-size) + 1px)',
  metric: 'calc(var(--admin-display-font-size) * 1.6)'
} as const;

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const quantityFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const countFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

function safeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatMoney(value: number | null | undefined) {
  return `¥${moneyFormatter.format(safeNumber(value))}`;
}

function formatCount(value: number | null | undefined) {
  return countFormatter.format(safeNumber(value));
}

function formatQuantity(value: number | null | undefined) {
  return quantityFormatter.format(safeNumber(value));
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN');
}

function Surface({
  children,
  style
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        ...style
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '9px 12px',
        borderBottom: `1px solid ${colors.border}`
      }}
    >
      <span style={{ fontSize: fontSize.section, fontWeight: 600, color: colors.text }}>{title}</span>
      {extra ? <span style={{ fontSize: fontSize.small, color: colors.textTertiary }}>{extra}</span> : null}
    </div>
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span style={{ fontSize: fontSize.small, color: colors.textTertiary }}>暂无对比基数</span>;
  }
  const positive = value >= 0;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: fontSize.small,
        color: positive ? colors.accentStrong : colors.danger
      }}
    >
      {positive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {formatPct(value)}
      <span style={{ color: colors.textTertiary }}>较上期</span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  change,
  hint
}: {
  label: string;
  value: string;
  change?: number | null;
  hint?: string;
}) {
  return (
    <Surface style={{ padding: '12px 14px', flex: 1 }}>
      <div style={{ fontSize: fontSize.small, color: colors.textSecondary, marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: fontSize.metric,
          fontWeight: 600,
          color: colors.text,
          lineHeight: 1.25,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 6, minHeight: 18 }}>
        {change !== undefined ? <ChangeBadge value={change} /> : null}
        {!change && hint ? (
          <span style={{ fontSize: fontSize.small, color: colors.textTertiary }}>{hint}</span>
        ) : null}
      </div>
    </Surface>
  );
}

function TodoItem({
  label,
  count,
  href,
  icon
}: {
  label: string;
  count: number;
  href: string;
  icon: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <Link
      href={href}
      className="admin-dashboard-todo"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        color: colors.text,
        textDecoration: 'none',
        minWidth: 0
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 8,
          flex: 'none',
          color: active ? colors.accentStrong : colors.textTertiary,
          background: active ? colors.accentLight : colors.subtle
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: fontSize.base,
          color: colors.textSecondary,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 'none',
          fontSize: 'calc(var(--admin-display-font-size) + 4px)',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: active ? colors.text : colors.textTertiary
        }}
      >
        {formatCount(count)}
      </span>
    </Link>
  );
}

function TrendChart({ data }: { data: DashboardData['trend'] }) {
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 20, bottom: 30, left: 64 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxSales = Math.max(...data.map((item) => safeNumber(item.salesAmount)), 0);
  const maxOrders = Math.max(...data.map((item) => safeNumber(item.orderCount)), 0);

  if (data.length === 0 || (maxSales === 0 && maxOrders === 0)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="近 7 天暂无成交数据" />
      </div>
    );
  }

  const step = plotWidth / data.length;
  const barWidth = Math.min(38, step * 0.44);
  const gridLines = 4;

  const salesY = (value: number) =>
    maxSales > 0 ? padding.top + plotHeight - (value / maxSales) * plotHeight : padding.top + plotHeight;
  const ordersY = (value: number) =>
    maxOrders > 0 ? padding.top + plotHeight - (value / maxOrders) * plotHeight : padding.top + plotHeight;

  const points = data.map((item, index) => {
    const x = padding.left + step * index + step / 2;
    return { x, y: ordersY(safeNumber(item.orderCount)) };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="近 7 天销售额与订单量趋势"
        style={{ width: '100%', height: 240, display: 'block' }}
      >
        {Array.from({ length: gridLines + 1 }, (_, index) => {
          const ratioValue = index / gridLines;
          const y = padding.top + plotHeight * ratioValue;
          return (
            <g key={`grid-${index}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke={colors.border}
                strokeWidth={1}
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill={colors.textTertiary}>
                {maxSales > 0 ? `¥${countFormatter.format(Math.round(maxSales * (1 - ratioValue)))}` : '—'}
              </text>
            </g>
          );
        })}

        {data.map((item, index) => {
          const sales = safeNumber(item.salesAmount);
          const x = padding.left + step * index + (step - barWidth) / 2;
          const y = salesY(sales);
          return (
            <g key={item.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(padding.top + plotHeight - y, 0)}
                rx={4}
                fill={colors.primary}
                fillOpacity={0.85}
              >
                <title>{`${item.date} 销售额 ${formatMoney(sales)}`}</title>
              </rect>
              <text
                x={padding.left + step * index + step / 2}
                y={height - 10}
                textAnchor="middle"
                fontSize={11}
                fill={colors.textTertiary}
              >
                {item.date.slice(5)}
              </text>
            </g>
          );
        })}

        <path d={linePath} fill="none" stroke={colors.accentStrong} strokeWidth={2} />
        {points.map((point, index) => (
          <g key={`dot-${data[index]?.date ?? index}`}>
            <circle cx={point.x} cy={point.y} r={3.5} fill={colors.surface} stroke={colors.accentStrong} strokeWidth={2}>
              <title>{`${data[index]?.date ?? ''} 订单 ${formatCount(data[index]?.orderCount)} 单`}</title>
            </circle>
          </g>
        ))}
      </svg>

      <div style={{ display: 'flex', gap: 16, padding: '0 12px 12px', fontSize: fontSize.small, color: colors.textTertiary }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: colors.primary, display: 'inline-block' }} />
          销售额
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: 2, background: colors.accentStrong, display: 'inline-block' }} />
          订单量
        </span>
      </div>
    </div>
  );
}

const topSkuColumns: TableColumnsType<DashboardData['topSkus'][number]> = [
  {
    title: '规格',
    dataIndex: 'name',
    render: (_, row) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
        {row.specName ? (
          <div style={{ fontSize: fontSize.small, color: colors.textTertiary }}>{row.specName}</div>
        ) : null}
      </div>
    )
  },
  {
    title: '销量',
    dataIndex: 'quantity',
    width: 90,
    align: 'right',
    render: (value: number) => formatQuantity(value)
  },
  {
    title: '销售额',
    dataIndex: 'amount',
    width: 120,
    align: 'right',
    render: (value: number) => formatMoney(value)
  }
];

const shopRankColumns: TableColumnsType<DashboardData['shopRanking'][number]> = [
  { title: '门店', dataIndex: 'shopName' },
  {
    title: '订单数',
    dataIndex: 'orderCount',
    width: 90,
    align: 'right',
    render: (value: number) => formatCount(value)
  },
  {
    title: '销售额',
    dataIndex: 'salesAmount',
    width: 120,
    align: 'right',
    render: (value: number) => formatMoney(value)
  }
];

interface ShopOption {
  id: string;
  name: string;
}

interface DashboardPanelProps {
  initialIsSuperAdmin: boolean;
}

export function DashboardPanel({ initialIsSuperAdmin }: DashboardPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedShopId = searchParams.get('shopId') ?? undefined;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopsLoaded, setShopsLoaded] = useState(false);

  // 非超管且没有绑定门店：下拉禁用，面板数据为零
  const noBoundShops = shopsLoaded && !initialIsSuperAdmin && shops.length === 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = selectedShopId ? `?shopId=${encodeURIComponent(selectedShopId)}` : '';
      const response = await fetch(`/api/admin/dashboard${query}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        // 分享链接带了范围外门店：退回默认范围，不停留在错误态
        if (payload?.message === '无权查看该门店数据') {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('shopId');
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
          return;
        }
        setForbidden(true);
        setData(null);
        return;
      }
      if (!response.ok) {
        setError(payload?.message ?? '接口不可用');
        return;
      }
      setForbidden(false);
      setData(payload as DashboardData);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, searchParams, pathname, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin/shops?page=1&pageSize=100', {
          cache: 'no-store'
        });
        const payload = await response.json();
        if (!response.ok) return;
        if (active) setShops((payload.items ?? []) as ShopOption[]);
      } catch {
        // 下拉失败不影响面板数据
      } finally {
        if (active) setShopsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const changeShop = useCallback(
    (value?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set('shopId', value);
      else params.delete('shopId');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const selectedShopName = selectedShopId
    ? shops.find((shop) => shop.id === selectedShopId)?.name
    : undefined;

  const scopeText = data
    ? selectedShopId
      ? `当前门店 · ${selectedShopName ?? '—'}`
      : data.scope.allShops
        ? `全部门店 · 全部仓库`
        : `门店 ${data.scope.shopCount ?? 0} 家 · 仓库 ${data.scope.warehouseCount ?? 0} 个`
    : '';

  const body = (() => {
    if (forbidden) {
      return (
        <div style={{ padding: 12 }}>
          <Alert
            type="warning"
            showIcon
            title="当前账号没有查看控制面板的权限"
            description="控制面板需要「报表-查看」（reports.read）权限，请联系超级管理员分配。"
          />
        </div>
      );
    }

    if (!data && loading) {
      return (
        <div style={{ padding: 12 }}>
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      );
    }

    if (!data) {
      return (
        <div style={{ padding: 12 }}>
          <Alert
            type="error"
            showIcon
            title="控制面板数据加载失败"
            description={error || '请稍后重试'}
            action={
              <Button size="small" onClick={() => void load()}>
                重试
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div
        style={{
          padding: 12,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 12
        }}
      >
        {error ? <Alert type="error" showIcon title={`刷新失败：${error}`} /> : null}

        <Row gutter={[12, 12]}>
          <Col xs={12} md={8} xl={4} style={{ display: 'flex', flexDirection: 'column' }}>
            <MetricCard
              label="今日销售额"
              value={formatMoney(data.sales.today.salesAmount)}
              change={data.sales.today.salesChangePct}
            />
          </Col>
          <Col xs={12} md={8} xl={4} style={{ display: 'flex', flexDirection: 'column' }}>
            <MetricCard
              label="今日订单数"
              value={formatCount(data.sales.today.orderCount)}
              change={data.sales.today.orderChangePct}
            />
          </Col>
          <Col xs={12} md={8} xl={4} style={{ display: 'flex', flexDirection: 'column' }}>
            <MetricCard
              label="今日客单价"
              value={formatMoney(data.sales.today.avgOrderValue)}
              hint="按今日有效订单计算"
            />
          </Col>
          <Col xs={12} md={8} xl={4} style={{ display: 'flex', flexDirection: 'column' }}>
            <MetricCard
              label="近 7 天销售额"
              value={formatMoney(data.sales.last7.salesAmount)}
              change={data.sales.last7.salesChangePct}
            />
          </Col>
          <Col xs={12} md={8} xl={4} style={{ display: 'flex', flexDirection: 'column' }}>
            <MetricCard
              label="近 7 天订单数"
              value={formatCount(data.sales.last7.orderCount)}
              change={data.sales.last7.orderChangePct}
            />
          </Col>
          <Col xs={12} md={8} xl={4} style={{ display: 'flex', flexDirection: 'column' }}>
            <MetricCard
              label="近 7 天客单价"
              value={formatMoney(data.sales.last7.avgOrderValue)}
              hint="按近 7 天有效订单计算"
            />
          </Col>
        </Row>

        <Surface>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
              gap: 10,
              padding: 12
            }}
          >
            <TodoItem
              label="待处理订单"
              count={data.todos.pendingOrders}
              href="/orders"
              icon={<FileTextOutlined />}
            />
            <TodoItem
              label="待退款审核"
              count={data.todos.refundPendingOrders}
              href="/orders"
              icon={<UndoOutlined />}
            />
            <TodoItem
              label="待审核要货"
              count={data.todos.pendingRequisitions}
              href="/requisitions"
              icon={<UnorderedListOutlined />}
            />
            <TodoItem
              label="待入库采购单"
              count={data.todos.pendingPurchases}
              href="/purchases"
              icon={<ShoppingOutlined />}
            />
            <TodoItem
              label="待收货分拨单"
              count={data.todos.pendingTransfers}
              href="/warehouse-transfers"
              icon={<SwapOutlined />}
            />
            <TodoItem
              label="待审核报损"
              count={data.todos.pendingDamageReports}
              href="/damage-reports"
              icon={<FileExclamationOutlined />}
            />
            <TodoItem
              label="门店低库存规格"
              count={data.todos.lowStockShopSkus}
              href="/inventory"
              icon={<WarningOutlined />}
            />
            <TodoItem
              label="仓库低库存规格"
              count={data.todos.lowStockWarehouseSkus}
              href="/warehouses?tab=stocks"
              icon={<InboxOutlined />}
            />
          </div>
        </Surface>

        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Surface style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: fontSize.small, color: colors.textSecondary }}>总部仓库存金额</div>
              <div style={{ fontSize: fontSize.metric, fontWeight: 600, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(data.inventory.warehouseAmount)}
              </div>
              <div style={{ marginTop: 6, fontSize: fontSize.small, color: colors.textTertiary }}>
                共 {formatCount(data.inventory.warehouseSkuCount)} 个规格 · 按仓库移动加权均价折算
              </div>
            </Surface>
          </Col>
          <Col xs={24} md={8}>
            <Surface style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: fontSize.small, color: colors.textSecondary }}>门店库存金额</div>
              <div style={{ fontSize: fontSize.metric, fontWeight: 600, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(data.inventory.shopAmount)}
              </div>
              <div style={{ marginTop: 6, fontSize: fontSize.small, color: colors.textTertiary }}>
                共 {formatCount(data.inventory.shopSkuCount)} 个规格 · 按门店移动加权均价折算
              </div>
            </Surface>
          </Col>
          <Col xs={24} md={8}>
            <Surface style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: fontSize.small, color: colors.textSecondary }}>低库存预警</div>
              <div style={{ fontSize: fontSize.metric, fontWeight: 600, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                {formatCount(data.inventory.lowStockShopSkus + data.inventory.lowStockWarehouseSkus)}
              </div>
              <div style={{ marginTop: 6, fontSize: fontSize.small, color: colors.textTertiary }}>
                门店 {formatCount(data.inventory.lowStockShopSkus)} · 仓库{' '}
                {formatCount(data.inventory.lowStockWarehouseSkus)}
              </div>
            </Surface>
          </Col>
        </Row>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={16}>
            <Surface style={{ height: '100%' }}>
              <SectionTitle title="近 7 天销售趋势" extra="自然日 · 含今日进行中" />
              <TrendChart data={data.trend} />
            </Surface>
          </Col>
          <Col xs={24} xl={8}>
            <Surface style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <SectionTitle title="近 7 天损耗" extra="报损 + 分拨差异" />
              <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: fontSize.small, color: colors.textSecondary }}>损耗金额</div>
                  <div
                    style={{
                      fontSize: 'calc(var(--admin-display-font-size) * 1.75)',
                      fontWeight: 600,
                      marginTop: 4,
                      fontVariantNumeric: 'tabular-nums',
                      color: data.loss.amount > 0 ? colors.danger : colors.text
                    }}
                  >
                    {formatMoney(data.loss.amount)}
                  </div>
                </div>
                <div style={{ fontSize: fontSize.base, color: colors.textSecondary }}>
                  占同期销售额{' '}
                  <span style={{ fontWeight: 600, color: colors.text }}>
                    {data.loss.ratioPct === null || data.loss.ratioPct === undefined
                      ? '—'
                      : `${data.loss.ratioPct.toFixed(1)}%`}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    fontSize: fontSize.small,
                    color: colors.textTertiary
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>报损审核通过</span>
                    <span style={{ color: colors.textSecondary }}>{formatMoney(data.loss.damageAmount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>分拨差异关闭</span>
                    <span style={{ color: colors.textSecondary }}>
                      {formatMoney(data.loss.transferLossAmount)}
                    </span>
                  </div>
                  {data.loss.amount === 0 ? <span>近 7 天暂无损耗记录</span> : null}
                </div>
              </div>
            </Surface>
          </Col>
        </Row>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={14}>
            <Surface style={{ height: '100%' }}>
              <SectionTitle title="热销规格 Top 5" extra="近 7 天销售额" />
              <div style={{ padding: 8 }}>
                <Table
                  rowKey="skuId"
                  size="small"
                  sticky
                  columns={topSkuColumns}
                  dataSource={data.topSkus}
                  pagination={false}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无销售数据" /> }}
                />
              </div>
            </Surface>
          </Col>
          <Col xs={24} xl={10}>
            <Surface style={{ height: '100%' }}>
              <SectionTitle title="门店销售排行 Top 5" extra="近 7 天销售额" />
              <div style={{ padding: 8 }}>
                <Table
                  rowKey="shopId"
                  size="small"
                  sticky
                  columns={shopRankColumns}
                  dataSource={data.shopRanking}
                  pagination={false}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无销售数据" /> }}
                />
              </div>
            </Surface>
          </Col>
        </Row>

        <div style={{ padding: '0 2px 4px', fontSize: fontSize.small, color: colors.textTertiary, lineHeight: 1.7 }}>
          口径：订单与销售额按 Asia/Shanghai 自然日统计，排除待支付、已取消、已退款订单；今日环比为昨日同期（相同已过时长），近
          7 天环比为上一个 7 个自然日。库存金额 = 数量 × 移动加权均价；损耗 = 报损审核通过金额 + 分拨差异关闭损耗金额。数据范围：
          {scopeText}。
        </div>
      </div>
    );
  })();

  return (
    <AdminListPage
      title="控制面板"
      description="经营数据与待办指标"
      actions={
        <Space size={8} wrap>
          {noBoundShops ? (
            <span style={{ fontSize: fontSize.small, color: colors.danger }}>
              未绑定门店，暂无数据
            </span>
          ) : null}
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={!shopsLoaded}
            disabled={noBoundShops}
            value={selectedShopId}
            onChange={changeShop}
            placeholder={initialIsSuperAdmin ? '全部门店' : '全部绑定门店'}
            options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
            style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
          />
          <span style={{ fontSize: fontSize.small, color: colors.textTertiary }}>
            {data ? `更新于 ${formatUpdatedAt(data.generatedAt)}` : ''}
          </span>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      }
    >
      {body}
    </AdminListPage>
  );
}
