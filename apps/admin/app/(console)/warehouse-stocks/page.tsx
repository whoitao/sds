'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip
} from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface WarehouseStockRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  catalogSkuId: string;
  catalogProductId: string;
  productName: string;
  specName: string;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  quantity: string;
  reservedQty: string;
  availableQuantity: string;
  avgUnitCost: string;
  minThreshold: string;
  maxThreshold: string | null;
  lowStock: boolean;
  isTest: boolean;
  updatedAt: string;
}

const ERROR_HINTS: Record<string, string> = {
  FORBIDDEN: '当前账号没有该仓库的维护权限',
  INVALID_THRESHOLD: '库存上限不能小于下限',
  INVALID_QUANTITY_PRECISION: '阈值精度不符合该规格的数量模式（整数或两位小数）',
  NOT_FOUND: '仓库或规格不存在',
  INVALID_BODY: '阈值参数不合法'
};

function toNumber(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatQty(value: string | number | null | undefined, mode: WarehouseStockRow['quantityMode']) {
  const numeric = toNumber(value);
  return mode === 'integer' ? String(Math.round(numeric)) : numeric.toFixed(2);
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function errorMessage(payload: { code?: string; message?: string } | null) {
  const code = payload?.code;
  if (code && ERROR_HINTS[code]) return ERROR_HINTS[code];
  return payload?.message ?? '操作失败';
}

export default function WarehouseStocksPage() {
  const { pageSize } = useAdminSettings();
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [tab, setTab] = useState<'stock' | 'alerts'>('stock');

  const [rows, setRows] = useState<WarehouseStockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [alerts, setAlerts] = useState<WarehouseStockRow[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const [permissions, setPermissions] = useState<string[]>([]);
  const [thresholdTarget, setThresholdTarget] = useState<WarehouseStockRow | null>(null);
  const [thresholdMin, setThresholdMin] = useState('');
  const [thresholdMax, setThresholdMax] = useState('');
  const [thresholdSubmitting, setThresholdSubmitting] = useState(false);
  const [thresholdError, setThresholdError] = useState('');

  const canWrite = permissions.includes('warehouse.write');

  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  const loadPermissions = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/me/permissions', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) return;
      setPermissions(payload.permissions ?? []);
    } catch {
      // 探测失败保持只读，写操作由服务端兜底
    }
  }, []);

  const loadWarehouses = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/warehouses?page=1&pageSize=100', {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) return;
      setWarehouses((payload.items ?? []) as WarehouseOption[]);
    } catch {
      // 下拉失败不影响列表
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (keyword) params.set('keyword', keyword);
    if (lowStockOnly) params.set('lowStock', 'true');
    try {
      const response = await fetch(`/api/admin/warehouse-stocks?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(errorMessage(payload));
        return;
      }
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [warehouseId, keyword, lowStockOnly, page, pageSize]);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (warehouseId) params.set('warehouseId', warehouseId);
    try {
      const response = await fetch(`/api/admin/warehouse-stocks/alerts?${params}`, {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) {
        setAlerts([]);
        setAlertsTotal(0);
        return;
      }
      setAlerts(payload.items ?? []);
      setAlertsTotal(payload.total ?? 0);
    } catch {
      setAlerts([]);
      setAlertsTotal(0);
    } finally {
      setAlertsLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    void loadPermissions();
    void loadWarehouses();
  }, [loadPermissions, loadWarehouses]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  function openThreshold(row: WarehouseStockRow) {
    if (!canWrite) {
      Modal.warning({
        title: '没有维护权限',
        content: '当前账号缺少 warehouse.write 权限，无法修改仓库安全库存阈值。'
      });
      return;
    }
    setThresholdTarget(row);
    setThresholdMin(row.minThreshold);
    setThresholdMax(row.maxThreshold ?? '');
    setThresholdError('');
  }

  async function submitThreshold() {
    if (!thresholdTarget) return;
    setThresholdSubmitting(true);
    setThresholdError('');
    try {
      const response = await fetch(
        `/api/admin/warehouse-stocks/${thresholdTarget.warehouseId}/${thresholdTarget.catalogSkuId}/threshold`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            minThreshold: thresholdMin.trim(),
            maxThreshold: thresholdMax.trim() ? thresholdMax.trim() : null
          })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setThresholdError(errorMessage(payload));
        return;
      }
      setThresholdTarget(null);
      setNotice(
        `「${thresholdTarget.productName} ${thresholdTarget.specName}」安全库存已更新`
      );
      void load();
      void loadAlerts();
    } catch {
      setThresholdError('保存失败');
    } finally {
      setThresholdSubmitting(false);
    }
  }

  const columns: TableColumnsType<WarehouseStockRow> = [
    {
      title: '仓库',
      dataIndex: 'warehouseName',
      width: 140,
      render: (value: string, row) => (
        <div>
          <div style={{ color: colors.text }}>{value}</div>
          <div style={{ color: colors.textSecondary, fontSize: 12 }}>{row.warehouseCode}</div>
        </div>
      )
    },
    {
      title: '商品 / 规格',
      key: 'product',
      render: (_value, row) => (
        <div>
          <div style={{ color: colors.text }}>{row.productName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 12 }}>
            {row.specName} · {row.unit}
          </div>
        </div>
      )
    },
    {
      title: '库存',
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      render: (value: string, row) => formatQty(value, row.quantityMode)
    },
    {
      title: '预留',
      dataIndex: 'reservedQty',
      width: 110,
      align: 'right',
      render: (value: string, row) => formatQty(value, row.quantityMode)
    },
    {
      title: '可用',
      dataIndex: 'availableQuantity',
      width: 140,
      align: 'right',
      render: (value: string, row) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{formatQty(value, row.quantityMode)}</span>
          {row.lowStock ? <Tag color="red">低</Tag> : null}
        </Space>
      )
    },
    {
      title: '平均成本',
      dataIndex: 'avgUnitCost',
      width: 110,
      align: 'right',
      render: (value: string) => `¥${toNumber(value).toFixed(2)}`
    },
    {
      title: '安全库存',
      key: 'threshold',
      width: 130,
      render: (_value, row) =>
        `${formatQty(row.minThreshold, row.quantityMode)}${
          row.maxThreshold ? ` ~ ${formatQty(row.maxThreshold, row.quantityMode)}` : ''
        }`
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_value, row) =>
        row.lowStock ? <Tag color="red">低库存</Tag> : <Tag color="success">正常</Tag>
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (value: string) => formatTime(value)
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value, row) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openThreshold(row)}>
          阈值
        </Button>
      )
    }
  ];

  const alertColumns: TableColumnsType<WarehouseStockRow> = [
    ...columns.filter((column) => column.key !== 'status' && column.key !== 'actions'),
    {
      title: '缺口',
      key: 'shortage',
      width: 120,
      align: 'right',
      render: (_value, row) => (
        <Tooltip title="下限 - 可用量">
          <span style={{ color: colors.danger, fontWeight: 600 }}>
            {formatQty(
              toNumber(row.minThreshold) - toNumber(row.availableQuantity),
              row.quantityMode
            )}
          </span>
        </Tooltip>
      )
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value, row) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openThreshold(row)}>
          阈值
        </Button>
      )
    }
  ];

  return (
    <div>
      <div style={{ background: colors.surface, minHeight: '100vh' }}>
        <div className="admin-page-bar">
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>仓库库存</span>
          <Space size={8}>
            <TestDataCleanupButton
              onCleaned={() => {
                void load();
                void loadAlerts();
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void load();
                void loadAlerts();
              }}
            >
              刷新
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 12px 8px',
            flexWrap: 'wrap'
          }}
        >
          <Select
            allowClear
            placeholder="全部仓库"
            style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
            value={warehouseId}
            onChange={(value) => {
              setWarehouseId(value);
              setPage(1);
            }}
            options={warehouses.map((row) => ({
              value: row.id,
              label: `${row.name}（${row.code}）`
            }))}
          />
          <Space.Compact style={{ width: ADMIN_FILTER_FIELD_WIDTH }}>
            <Input
              allowClear
              value={searchText}
              placeholder="按商品/规格/条码搜索…"
              style={{ flex: 1, minWidth: 0 }}
              onChange={(event) => {
                const value = event.target.value;
                setSearchText(value);
                if (!value) {
                  setKeyword('');
                  setPage(1);
                }
              }}
              onPressEnter={() => {
                setKeyword(searchText.trim());
                setPage(1);
              }}
            />
            <Button
              icon={<SearchOutlined />}
              style={{
                background: colors.subtle,
                borderColor: colors.border,
                color: colors.textSecondary
              }}
              onClick={() => {
                setKeyword(searchText.trim());
                setPage(1);
              }}
            />
          </Space.Compact>
          <Space size={8}>
            <span style={{ fontSize: 12, color: colors.textSecondary }}>仅看低库存</span>
            <Switch
              checked={lowStockOnly}
              onChange={(checked) => {
                setLowStockOnly(checked);
                setPage(1);
              }}
            />
          </Space>
        </div>

        <div style={{ padding: '0 12px 8px', fontSize: 12, color: colors.textSecondary }}>
          仓库预警只看可用量（库存 - 预留），与门店库存按库存数量判断的口径互不影响。
        </div>

        {error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
        ) : null}
        {notice && !error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>
            {notice}
          </div>
        ) : null}

        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'stock' | 'alerts')}
          tabBarStyle={{ padding: '0 12px' }}
          items={[
            {
              key: 'stock',
              label: `库存明细 (${total})`,
              children: (
                <Table<WarehouseStockRow>
                  rowKey={(row) => `${row.warehouseId}:${row.catalogSkuId}`}
                  loading={loading}
                  {...getAdminTableProps(columns)}
                  dataSource={rows}
                  pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: false,
                    showTotal: (count) => `共 ${count} 条`,
                    onChange: setPage
                  }}
                />
              )
            },
            {
              key: 'alerts',
              label: `低库存预警 (${alertsTotal})`,
              children: (
                <Table<WarehouseStockRow>
                  rowKey={(row) => `${row.warehouseId}:${row.catalogSkuId}`}
                  loading={alertsLoading}
                  {...getAdminTableProps(alertColumns)}
                  dataSource={alerts}
                  pagination={false}
                />
              )
            }
          ]}
        />
      </div>

      <Modal
        title={
          thresholdTarget
            ? `安全库存 · ${thresholdTarget.productName} ${thresholdTarget.specName}`
            : '安全库存'
        }
        open={Boolean(thresholdTarget)}
        onCancel={() => setThresholdTarget(null)}
        onOk={() => void submitThreshold()}
        okText="保存"
        cancelText="取消"
        confirmLoading={thresholdSubmitting}
        destroyOnHidden
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, color: colors.textSecondary }}>
            {thresholdTarget
              ? `${thresholdTarget.warehouseName} · 当前可用 ${formatQty(
                  thresholdTarget.availableQuantity,
                  thresholdTarget.quantityMode
                )} ${thresholdTarget.unit}`
              : null}
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>安全库存下限（可用量小于等于时预警）</div>
            <Input
              value={thresholdMin}
              onChange={(event) => setThresholdMin(event.target.value)}
              placeholder="如 0 或 5"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>库存上限（可选，采购建议参考）</div>
            <Input
              value={thresholdMax}
              onChange={(event) => setThresholdMax(event.target.value)}
              placeholder="留空表示不设上限"
            />
          </div>
          {thresholdError ? (
            <div style={{ fontSize: 13, color: colors.danger }}>{thresholdError}</div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
