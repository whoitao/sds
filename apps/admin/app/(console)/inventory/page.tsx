'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getAdminTableProps } from '../../../lib/table';

interface ShopOption {
  id: string;
  name: string;
}

interface InventoryRow {
  skuId: string;
  productId: string;
  shopId: string;
  productName: string;
  imageUrl: string | null;
  specName: string;
  barcode: string | null;
  unit: string;
  stockType: 'tracked' | 'untracked';
  quantityMode: 'integer' | 'decimal_2';
  isAvailable: boolean;
  isDefault: boolean;
  catalogSkuId: string | null;
  catalogStatus: string | null;
  price: string | null;
  catalogPrice: string | null;
  effectivePrice: string | null;
  quantity: string;
  minThreshold: string;
  maxThreshold: string | null;
  stockUpdatedAt: string | null;
  lowStock: boolean;
}

interface MovementRow {
  id: string;
  productSkuId: string;
  productName: string | null;
  specName: string | null;
  unit: string | null;
  movementType: string;
  quantityChange: string;
  balanceAfter: string;
  unitCost: string | null;
  referenceType: string | null;
  referenceId: string | null;
  operatorName: string | null;
  remark: string | null;
  createdAt: string;
}

const movementLabels: Record<string, string> = {
  purchase_in: '采购入库',
  purchase_return: '采购退货',
  sale_out: '销售出库',
  order_return: '订单退货',
  adjustment: '手工调整',
  waste: '报损',
  initial: '初始化'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function quantityModeLabel(mode: InventoryRow['quantityMode']) {
  return mode === 'integer' ? '整数' : '两位小数';
}

export default function InventoryPage() {
  const [mounted, setMounted] = useState(false);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string | undefined>();
  const [tab, setTab] = useState('stock');
  const [error, setError] = useState('');

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [alerts, setAlerts] = useState<InventoryRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementPage, setMovementPage] = useState(1);
  const [movementLoading, setMovementLoading] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null);
  const [adjustMode, setAdjustMode] = useState<'delta' | 'target'>('delta');
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustReason, setAdjustReason] = useState('manual');
  const [adjustRemark, setAdjustRemark] = useState('');
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const [thresholdTarget, setThresholdTarget] = useState<InventoryRow | null>(null);
  const [thresholdMin, setThresholdMin] = useState('');
  const [thresholdMax, setThresholdMax] = useState('');
  const [thresholdSubmitting, setThresholdSubmitting] = useState(false);

  const [movementTarget, setMovementTarget] = useState<InventoryRow | null>(null);
  const [skuMovements, setSkuMovements] = useState<MovementRow[]>([]);
  const [skuMovementLoading, setSkuMovementLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadShops() {
      try {
        const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
        const payload = await response.json();
        const items: ShopOption[] = response.ok ? (payload.items ?? []) : [];
        setShops(items);
        setShopId(items[0]?.id);
      } catch {
        setError('接口不可用');
      }
    }
    void loadShops();
  }, []);

  const loadInventory = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      shopId,
      page: String(page),
      pageSize: String(pageSize)
    });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (lowStockOnly) params.set('lowStock', 'true');

    try {
      const response = await fetch(`/api/admin/inventory?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '库存加载失败');
        return;
      }
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [shopId, page, pageSize, keyword, lowStockOnly]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const loadAlerts = useCallback(async () => {
    if (!shopId) return;
    setAlertsLoading(true);
    try {
      const response = await fetch(
        `/api/admin/inventory/alerts?shopId=${encodeURIComponent(shopId)}&limit=200`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '预警加载失败');
        return;
      }
      setAlerts(payload.items ?? []);
    } catch {
      setError('接口不可用');
    } finally {
      setAlertsLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    if (tab === 'alerts') void loadAlerts();
  }, [tab, loadAlerts]);

  const loadMovements = useCallback(async () => {
    if (!shopId) return;
    setMovementLoading(true);
    const params = new URLSearchParams({
      shopId,
      page: String(movementPage),
      pageSize: '20'
    });
    try {
      const response = await fetch(`/api/admin/inventory/movements?${params}`, {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '流水加载失败');
        return;
      }
      setMovements(payload.items ?? []);
      setMovementTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setMovementLoading(false);
    }
  }, [shopId, movementPage]);

  useEffect(() => {
    if (tab === 'movements') void loadMovements();
  }, [tab, loadMovements]);

  function openAdjust(row: InventoryRow) {
    setAdjustTarget(row);
    setAdjustMode('delta');
    setAdjustQuantity('');
    setAdjustReason('manual');
    setAdjustRemark('');
  }

  async function submitAdjust() {
    if (!adjustTarget || !shopId) return;
    const quantity = adjustQuantity.trim();
    if (!quantity) {
      setError('请输入调整数量');
      return;
    }
    setAdjustSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/inventory/adjustments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shopId,
          operationId: crypto.randomUUID(),
          items: [
            {
              skuId: adjustTarget.skuId,
              mode: adjustMode,
              quantity,
              reason: adjustReason,
              remark: adjustRemark.trim() || null
            }
          ]
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '调整失败');
        return;
      }
      setAdjustTarget(null);
      void loadInventory();
    } catch {
      setError('调整失败');
    } finally {
      setAdjustSubmitting(false);
    }
  }

  function openThreshold(row: InventoryRow) {
    setThresholdTarget(row);
    setThresholdMin(row.minThreshold);
    setThresholdMax(row.maxThreshold ?? '');
  }

  async function submitThreshold() {
    if (!thresholdTarget) return;
    setThresholdSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/inventory/skus/${thresholdTarget.skuId}/threshold`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            minThreshold: thresholdMin,
            maxThreshold: thresholdMax.trim() ? thresholdMax : null
          })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '阈值保存失败');
        return;
      }
      setThresholdTarget(null);
      void loadInventory();
    } catch {
      setError('阈值保存失败');
    } finally {
      setThresholdSubmitting(false);
    }
  }

  async function openMovements(row: InventoryRow) {
    setMovementTarget(row);
    setSkuMovementLoading(true);
    try {
      const response = await fetch(
        `/api/admin/inventory/skus/${row.skuId}/movements?page=1&pageSize=50`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '流水加载失败');
        return;
      }
      setSkuMovements(payload.items ?? []);
    } catch {
      setError('接口不可用');
    } finally {
      setSkuMovementLoading(false);
    }
  }

  const columns: TableColumnsType<InventoryRow> = [
    {
      title: '商品 / 规格',
      key: 'product',
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {row.productName}
            {row.isDefault ? (
              <Tag style={{ marginLeft: 6 }} color="blue">
                默认
              </Tag>
            ) : null}
          </div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            {row.specName} · {row.unit}
            {row.catalogStatus === 'disabled' ? ' · 总部停用' : ''}
          </div>
        </div>
      )
    },
    {
      title: '条码',
      dataIndex: 'barcode',
      width: 150,
      render: (value: string | null) => value || '—'
    },
    {
      title: '计量',
      dataIndex: 'quantityMode',
      width: 100,
      render: (value: InventoryRow['quantityMode']) => quantityModeLabel(value)
    },
    {
      title: '库存',
      key: 'quantity',
      width: 130,
      render: (_, row) =>
        row.stockType === 'untracked' ? (
          <Tag>不追踪</Tag>
        ) : (
          <Space size={4}>
            <span style={{ fontWeight: 600 }}>{row.quantity}</span>
            <span style={{ opacity: 0.6 }}>{row.unit}</span>
            {row.lowStock ? <Tag color="red">低</Tag> : null}
          </Space>
        )
    },
    {
      title: '安全库存',
      key: 'threshold',
      width: 130,
      render: (_, row) =>
        row.stockType === 'untracked'
          ? '—'
          : `${row.minThreshold}${row.maxThreshold ? ` ~ ${row.maxThreshold}` : ''}`
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, row) => (
        <Tag color={row.isAvailable ? 'success' : 'default'}>
          {row.isAvailable ? '上架' : '下架'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            disabled={row.stockType === 'untracked'}
            onClick={() => openAdjust(row)}
          >
            调整
          </Button>
          <Button
            size="small"
            disabled={row.stockType === 'untracked'}
            onClick={() => openThreshold(row)}
          >
            阈值
          </Button>
          <Button size="small" onClick={() => void openMovements(row)}>
            流水
          </Button>
        </Space>
      )
    }
  ];

  const movementColumns: TableColumnsType<MovementRow> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value)
    },
    {
      title: '商品 / 规格',
      key: 'product',
      render: (_, row) => `${row.productName ?? '—'} ${row.specName ?? ''}`
    },
    {
      title: '类型',
      dataIndex: 'movementType',
      width: 100,
      render: (value: string) => movementLabels[value] ?? value
    },
    {
      title: '变动',
      dataIndex: 'quantityChange',
      width: 110,
      render: (value: string) => (
        <span style={{ color: Number(value) < 0 ? '#cf1322' : '#3f8600' }}>
          {Number(value) > 0 ? `+${value}` : value}
        </span>
      )
    },
    {
      title: '结存',
      dataIndex: 'balanceAfter',
      width: 100
    },
    {
      title: '操作人',
      dataIndex: 'operatorName',
      width: 110,
      render: (value: string | null) => value || '系统'
    },
    {
      title: '备注',
      dataIndex: 'remark',
      render: (value: string | null) => value || '—'
    }
  ];

  if (!mounted) return null;

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 220 }}
          placeholder="选择门店"
          value={shopId}
          onChange={(value) => {
            setShopId(value);
            setPage(1);
            setMovementPage(1);
          }}
          options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
        />
        <Input.Search
          allowClear
          style={{ width: 260 }}
          placeholder="商品名 / 规格 / 条码"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Space>
          <span>仅看低库存</span>
          <Switch
            checked={lowStockOnly}
            onChange={(checked) => {
              setLowStockOnly(checked);
              setPage(1);
            }}
          />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => void loadInventory()}>
          刷新
        </Button>
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setError('')}
        />
      ) : null}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'stock',
            label: `库存明细 (${total})`,
            children: (
              <Table
                rowKey="skuId"
                size="middle"
                loading={loading}
                {...getAdminTableProps(columns)}
                dataSource={rows}
                pagination={{
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  onChange: (nextPage, nextPageSize) => {
                    setPage(nextPage);
                    setPageSize(nextPageSize);
                  }
                }}
              />
            )
          },
          {
            key: 'alerts',
            label: `缺货预警 (${alerts.length})`,
            children: (
              <Table
                rowKey="skuId"
                size="middle"
                loading={alertsLoading}
                {...getAdminTableProps(columns)}
                dataSource={alerts}
                pagination={false}
              />
            )
          },
          {
            key: 'movements',
            label: '库存流水',
            children: (
              <Table
                rowKey="id"
                size="middle"
                loading={movementLoading}
                {...getAdminTableProps(movementColumns)}
                dataSource={movements}
                pagination={{
                  current: movementPage,
                  pageSize: 20,
                  total: movementTotal,
                  onChange: setMovementPage
                }}
              />
            )
          }
        ]}
      />

      <Modal
        title={adjustTarget ? `库存调整 · ${adjustTarget.productName} ${adjustTarget.specName}` : '库存调整'}
        open={Boolean(adjustTarget)}
        onCancel={() => setAdjustTarget(null)}
        onOk={() => void submitAdjust()}
        confirmLoading={adjustSubmitting}
        okText="提交调整"
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4 }}>调整方式</div>
            <Select
              style={{ width: '100%' }}
              value={adjustMode}
              onChange={setAdjustMode}
              options={[
                { value: 'delta', label: '增减数量（可填负数）' },
                { value: 'target', label: '直接改为目标库存' }
              ]}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>
              数量（{adjustTarget ? quantityModeLabel(adjustTarget.quantityMode) : ''}，单位{' '}
              {adjustTarget?.unit}）
            </div>
            <Input
              value={adjustQuantity}
              onChange={(event) => setAdjustQuantity(event.target.value)}
              placeholder={adjustMode === 'delta' ? '如 -2 或 1.5' : '如 20 或 3.25'}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>原因</div>
            <Select
              style={{ width: '100%' }}
              value={adjustReason}
              onChange={setAdjustReason}
              options={[
                { value: 'manual', label: '手工盘点调整' },
                { value: 'waste', label: '报损' },
                { value: 'damage', label: '损坏' },
                { value: 'expired', label: '过期' },
                { value: 'other', label: '其他' }
              ]}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>备注</div>
            <Input
              value={adjustRemark}
              onChange={(event) => setAdjustRemark(event.target.value)}
              maxLength={200}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title={
          thresholdTarget
            ? `安全库存 · ${thresholdTarget.productName} ${thresholdTarget.specName}`
            : '安全库存'
        }
        open={Boolean(thresholdTarget)}
        onCancel={() => setThresholdTarget(null)}
        onOk={() => void submitThreshold()}
        confirmLoading={thresholdSubmitting}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4 }}>最低库存（低于等于时预警）</div>
            <Input value={thresholdMin} onChange={(event) => setThresholdMin(event.target.value)} />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>最高库存（可选，采购建议参考）</div>
            <Input
              value={thresholdMax}
              onChange={(event) => setThresholdMax(event.target.value)}
              placeholder="留空表示不设上限"
            />
          </div>
        </div>
      </Modal>

      <Modal
        title={
          movementTarget
            ? `库存流水 · ${movementTarget.productName} ${movementTarget.specName}`
            : '库存流水'
        }
        open={Boolean(movementTarget)}
        onCancel={() => setMovementTarget(null)}
        footer={null}
        width={960}
      >
        <Table
          rowKey="id"
          size="small"
          loading={skuMovementLoading}
          {...getAdminTableProps(movementColumns.filter((column) => column.key !== 'product'))}
          dataSource={skuMovements}
          pagination={false}
        />
      </Modal>
    </div>
  );
}
