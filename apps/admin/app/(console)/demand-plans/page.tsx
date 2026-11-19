'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckOutlined,
  ContainerOutlined,
  EyeOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { getAdminTableProps } from '../../../lib/table';
import {
  AdminFilterField,
  AdminListPage
} from '../../../components/AdminListPage';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

type PlanStatus = 'collecting' | 'decided' | 'superseded';
type PurchasePath = 'centralized' | 'central_kitchen' | 'regional_whitelist';

interface WarehouseOption {
  id: string;
  name: string;
  status: string;
}

interface PlanRow {
  id: string;
  planNo: string;
  deliveryDate: string;
  warehouseId: string;
  warehouseName: string;
  version: number;
  status: PlanStatus;
  isCurrent: boolean;
  totalSkus: number;
  totalRequestedQty: string;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ShopBreakdown {
  shopId: string;
  shopName: string;
  requisitionId: string;
  requisitionNo: string;
  requestedQty: string;
  approvedQty: string;
}

interface PlanItem {
  id: string;
  catalogSkuId: string;
  itemName: string;
  specName: string | null;
  unit: string;
  categoryName: string | null;
  totalRequestedQty: string;
  finalQty: string;
  purchasePath: PurchasePath;
  shopBreakdown: ShopBreakdown[];
  decisionNote: string | null;
}

interface PlanEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  operatorName: string | null;
  createdAt: string;
}

interface PlanDetail extends PlanRow {
  statusLabel: string;
  items: PlanItem[];
  referencedOrders: { id: string; poNo: string; shopId: string }[];
  referenced: boolean;
  events: PlanEvent[];
}

interface ItemDraft {
  finalQty?: number;
  purchasePath?: PurchasePath;
}

const STATUS_META: Record<PlanStatus, { label: string; color: string }> = {
  collecting: { label: '汇总中', color: 'processing' },
  decided: { label: '已定稿', color: 'success' },
  superseded: { label: '已被新版本替代', color: 'default' }
};

const PATH_META: Record<PurchasePath, { label: string; color: string }> = {
  centralized: { label: '集采', color: 'blue' },
  central_kitchen: { label: '中央厨房', color: 'purple' },
  regional_whitelist: { label: '区域外采白名单', color: 'orange' }
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function DemandPlansPage() {
  const router = useRouter();
  const { pageSize } = useAdminSettings();
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [deliveryDate, setDeliveryDate] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mounted, setMounted] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);

  const [collectOpen, setCollectOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState('');
  const [collectForm] = Form.useForm();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const canWrite = permissions.includes('demand.write');

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
      // 权限探测失败时保持只读展示，写操作仍由服务端兜底
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
      // 仓库下拉失败不影响已有列表查询
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (deliveryDate) params.set('deliveryDate', deliveryDate);
    if (status) params.set('status', status);
    if (includeSuperseded) params.set('includeSuperseded', 'true');

    try {
      const response = await fetch(`/api/admin/demand-plans?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '加载失败');
        return;
      }
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [warehouseId, deliveryDate, status, includeSuperseded, page, pageSize]);

  useEffect(() => {
    setMounted(true);
    void loadPermissions();
    void loadWarehouses();
  }, [loadPermissions, loadWarehouses]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (planId: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/demand-plans/${planId}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setDetailError(payload?.message ?? '加载失败');
        return;
      }
      setDetail(payload.item as PlanDetail);
      setDrafts({});
    } catch {
      setDetailError('接口不可用');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function openWorkbench(row: PlanRow) {
    setDetailOpen(true);
    setDetail(null);
    await loadDetail(row.id);
  }

  async function submitCollect() {
    setCollectError('');
    const values = await collectForm.validateFields().catch(() => null);
    if (!values) return;
    setCollecting(true);
    try {
      const response = await fetch('/api/admin/demand-plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values)
      });
      const payload = await response.json();
      if (!response.ok) {
        setCollectError(payload?.message ?? '汇总失败');
        return;
      }
      setCollectOpen(false);
      collectForm.resetFields();
      setNotice('汇总完成，已生成新的需求计划版本');
      await load();
      if (payload.item?.id) {
        setDetailOpen(true);
        setDetail(payload.item as PlanDetail);
        setDrafts({});
      }
    } catch {
      setCollectError('接口不可用');
    } finally {
      setCollecting(false);
    }
  }

  const editable = Boolean(detail?.isCurrent && detail?.status === 'collecting' && !detail?.referenced);

  function updateDraft(itemId: string, patch: ItemDraft) {
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], ...patch }
    }));
  }

  async function saveDrafts() {
    if (!detail) return;
    const entries = Object.entries(drafts);
    if (entries.length === 0) return;
    setSaving(true);
    setDetailError('');
    try {
      for (const [itemId, draft] of entries) {
        const body: Record<string, unknown> = {};
        if (draft.finalQty !== undefined) body.finalQty = draft.finalQty;
        if (draft.purchasePath !== undefined) body.purchasePath = draft.purchasePath;
        const response = await fetch(`/api/admin/demand-plans/${detail.id}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) {
          setDetailError(payload?.message ?? '保存失败');
          await loadDetail(detail.id);
          return;
        }
      }
      setNotice(`已保存 ${entries.length} 条调整`);
      await loadDetail(detail.id);
    } catch {
      setDetailError('接口不可用');
    } finally {
      setSaving(false);
    }
  }

  async function decidePlan() {
    if (!detail) return;
    setDeciding(true);
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/demand-plans/${detail.id}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) {
        setDetailError(payload?.message ?? '定稿失败');
        return;
      }
      setNotice(`计划 ${detail.planNo} 已定稿`);
      setDetail(payload.item as PlanDetail);
      setDrafts({});
      await load();
    } catch {
      setDetailError('接口不可用');
    } finally {
      setDeciding(false);
    }
  }

  const columns: TableColumnsType<PlanRow> = [
    { title: '计划号', dataIndex: 'planNo', width: 180 },
    { title: '交付日期', dataIndex: 'deliveryDate', width: 120 },
    { title: '仓库', dataIndex: 'warehouseName', width: 140 },
    {
      title: '版本',
      dataIndex: 'version',
      width: 80,
      render: (value: number, row) => (
        <span>
          v{value}
          {row.isCurrent ? null : (
            <Tag style={{ marginLeft: 4 }} color="default">
              历史
            </Tag>
          )}
        </span>
      )
    },
    { title: 'SKU 数', dataIndex: 'totalSkus', width: 90 },
    {
      title: '申请合计',
      dataIndex: 'totalRequestedQty',
      width: 110,
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 140,
      render: (value: PlanStatus) => (
        <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.label ?? value}</Tag>
      )
    },
    {
      title: '定稿时间',
      dataIndex: 'decidedAt',
      width: 170,
      render: (value: string | null) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      render: (_value, row) => (
        <Button
          variant="text"
          color="primary"
          size="small"
          icon={<EyeOutlined />}
          title="进入汇总工作台"
          aria-label="进入汇总工作台"
          onClick={() => void openWorkbench(row)}
        />
      )
    }
  ];

  const groupedItems = useMemo(() => {
    const groups = new Map<string, PlanItem[]>();
    for (const item of detail?.items ?? []) {
      const key = item.categoryName || '未分类';
      const list = groups.get(key);
      if (list) list.push(item);
      else groups.set(key, [item]);
    }
    return [...groups.entries()].map(([categoryName, items]) => ({
      categoryName,
      items,
      requestedTotal: items.reduce((sum, item) => sum + toNumber(item.totalRequestedQty), 0)
    }));
  }, [detail]);

  const dirtyCount = Object.keys(drafts).length;

  function renderItemSection(categoryName: string, items: PlanItem[], requestedTotal: number) {
    const itemColumns: TableColumnsType<PlanItem> = [
      {
        title: '商品',
        dataIndex: 'itemName',
        width: 220,
        render: (_value, row) => (
          <span>
            {row.itemName}
            {row.specName ? (
              <span style={{ color: colors.textSecondary }}> / {row.specName}</span>
            ) : null}
          </span>
        )
      },
      { title: '单位', dataIndex: 'unit', width: 70 },
      {
        title: '门店申请合计',
        dataIndex: 'totalRequestedQty',
        width: 120,
        render: (value: string) => toNumber(value).toFixed(2)
      },
      {
        title: '采纳数量',
        dataIndex: 'finalQty',
        width: 130,
        render: (value: string, row) => {
          const draftValue = drafts[row.id]?.finalQty;
          if (!editable) return toNumber(value).toFixed(2);
          return (
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              value={draftValue ?? toNumber(value)}
              onChange={(next) => updateDraft(row.id, { finalQty: Number(next) || 0 })}
            />
          );
        }
      },
      {
        title: '差异',
        key: 'diff',
        width: 90,
        render: (_value, row) => {
          const finalQty = drafts[row.id]?.finalQty ?? toNumber(row.finalQty);
          const diff = finalQty - toNumber(row.totalRequestedQty);
          const text = `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`;
          return (
            <span style={{ color: diff === 0 ? colors.textSecondary : colors.danger }}>{text}</span>
          );
        }
      },
      {
        title: '采购路径',
        dataIndex: 'purchasePath',
        width: 160,
        render: (value: PurchasePath, row) => {
          if (!editable) {
            return (
              <Tag color={PATH_META[value]?.color}>{PATH_META[value]?.label ?? value}</Tag>
            );
          }
          return (
            <Select
              style={{ width: '100%' }}
              value={drafts[row.id]?.purchasePath ?? value}
              options={Object.entries(PATH_META).map(([path, meta]) => ({
                value: path,
                label: meta.label
              }))}
              onChange={(next) => updateDraft(row.id, { purchasePath: next as PurchasePath })}
            />
          );
        }
      },
      {
        title: '门店明细',
        key: 'breakdown',
        width: 100,
        render: (_value, row) => <span>{row.shopBreakdown.length} 家</span>
      }
    ];

    return (
      <div key={categoryName} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 0',
            fontSize: 13,
            fontWeight: 600,
            color: colors.text
          }}
        >
          <span>{categoryName}</span>
          <span style={{ fontWeight: 400, color: colors.textSecondary }}>
            {items.length} 个 SKU · 申请合计 {requestedTotal.toFixed(2)}
          </span>
        </div>
        <Table<PlanItem>
          rowKey="id"
          size="small"
          pagination={false}
          {...getAdminTableProps(itemColumns)}
          dataSource={items}
          expandable={{
            expandedRowRender: (row) => (
              <Table<ShopBreakdown>
                rowKey={(breakdown) => `${breakdown.requisitionId}-${breakdown.shopId}`}
                size="small"
                sticky
                pagination={false}
                dataSource={row.shopBreakdown}
                columns={[
                  { title: '门店', dataIndex: 'shopName', width: 160 },
                  { title: '要货单号', dataIndex: 'requisitionNo', width: 180 },
                  {
                    title: '申请数量',
                    dataIndex: 'requestedQty',
                    width: 100,
                    render: (value: string) => toNumber(value).toFixed(2)
                  },
                  {
                    title: '审核数量',
                    dataIndex: 'approvedQty',
                    width: 100,
                    render: (value: string) => toNumber(value).toFixed(2)
                  }
                ]}
              />
            )
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminListPage
        title="需求汇总"
        actions={
          <Space size={8}>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            {canWrite ? (
              <Button
                type="primary"
                icon={<ContainerOutlined />}
                onClick={() => {
                  setCollectError('');
                  setCollectOpen(true);
                }}
              >
                新建汇总
              </Button>
            ) : null}
            <TestDataCleanupButton onCleaned={() => void load()} />
          </Space>
        }
        filters={
          <>
            <AdminFilterField>
              <Input
                type="date"
                aria-label="交付日期"
                value={deliveryDate}
                onChange={(event) => {
                  setDeliveryDate(event.target.value);
                  setPage(1);
                }}
              />
            </AdminFilterField>
            <AdminFilterField>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="全部仓库"
                value={warehouseId}
                onChange={(value) => {
                  setWarehouseId(value);
                  setPage(1);
                }}
                options={warehouses.map((item) => ({
                  value: item.id,
                  label: item.status === 'active' ? item.name : `${item.name}（停用）`
                }))}
              />
            </AdminFilterField>
            <AdminFilterField>
              <Select
                allowClear
                placeholder="全部状态"
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                options={Object.entries(STATUS_META).map(([value, meta]) => ({
                  value,
                  label: meta.label
                }))}
              />
            </AdminFilterField>
            <AdminFilterField>
              <Checkbox
                checked={includeSuperseded}
                onChange={(event) => {
                  setIncludeSuperseded(event.target.checked);
                  setPage(1);
                }}
              >
                含历史版本
              </Checkbox>
            </AdminFilterField>
            <Button
              icon={<SearchOutlined />}
              onClick={() => {
                setPage(1);
                void load();
              }}
            >
              查询
            </Button>
          </>
        }
        notice={
          <>
            {error ? (
              <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>
                {error}
              </div>
            ) : null}
            {notice && !error ? (
              <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>
                {notice}
              </div>
            ) : null}
          </>
        }
      >

        <Table<PlanRow>
          rowKey="id"
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
      </AdminListPage>

      {mounted ? (
        <Modal
          open={collectOpen}
          title="新建需求汇总"
          okText="汇总"
          cancelText="取消"
          confirmLoading={collecting}
          onOk={() => void submitCollect()}
          onCancel={() => setCollectOpen(false)}
          width={560}
          forceRender
        >
          {collectError ? (
            <Alert type="error" showIcon title={collectError} style={{ marginBottom: 12 }} />
          ) : null}
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="按交付日 + 仓库汇总该范围内已审核的门店要货，生成当前版本；再次汇总会生成新版本替代旧版本。"
          />
          <Form form={collectForm} layout="vertical">
            <Form.Item
              name="deliveryDate"
              label="交付日期"
              rules={[{ required: true, message: '请选择交付日期' }]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item
              name="warehouseId"
              label="仓库"
              rules={[{ required: true, message: '请选择仓库' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择仓库"
                options={warehouses.map((item) => ({
                  value: item.id,
                  label: item.status === 'active' ? item.name : `${item.name}（停用）`
                }))}
              />
            </Form.Item>
            <Form.Item name="remark" label="备注" rules={[{ max: 500, message: '最多 500 字' }]}>
              <Input.TextArea rows={2} maxLength={500} placeholder="选填" />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}

      {mounted ? (
        <Modal
          open={detailOpen}
          title={detail ? `需求汇总 · ${detail.planNo}（v${detail.version}）` : '需求汇总工作台'}
          onCancel={() => setDetailOpen(false)}
          width={1080}
          footer={
            <Space>
              <Button onClick={() => setDetailOpen(false)}>关闭</Button>
              {detail?.isCurrent ? (
                <Button onClick={() => router.push(`/purchases?demandPlanId=${detail.id}`)}>
                  去采购下单
                </Button>
              ) : null}
              {editable && dirtyCount > 0 ? (
                <Button icon={<SaveOutlined />} loading={saving} onClick={() => void saveDrafts()}>
                  保存调整（{dirtyCount}）
                </Button>
              ) : null}
              {canWrite && editable ? (
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={deciding}
                  onClick={() => void decidePlan()}
                >
                  定稿
                </Button>
              ) : null}
            </Space>
          }
        >
          {detailLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: colors.textSecondary }}>
              加载中…
            </div>
          ) : null}
          {detailError ? (
            <Alert type="error" showIcon title={detailError} style={{ marginBottom: 12 }} />
          ) : null}
          {detail ? (
            <>
              <Space size={16} wrap style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>
                  交付日期：{detail.deliveryDate}
                </span>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>
                  仓库：{detail.warehouseName}
                </span>
                <Tag color={STATUS_META[detail.status]?.color}>{detail.statusLabel}</Tag>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>
                  SKU {detail.totalSkus} · 申请合计 {toNumber(detail.totalRequestedQty).toFixed(2)}
                </span>
              </Space>
              {detail.referenced ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title="该计划已被采购单引用，不能再调整，也不能被重新汇总覆盖。"
                  description={detail.referencedOrders.map((order) => order.poNo).join('、')}
                />
              ) : null}
              {!detail.isCurrent ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title="这是历史版本，仅供查看。"
                />
              ) : null}
              {canWrite && detail.isCurrent && detail.status === 'collecting' ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title="可直接修改采纳数量与采购路径，保存后生效；确认无误后点「定稿」。"
                />
              ) : null}

              <div style={{ maxHeight: '58vh', overflow: 'auto', paddingRight: 4 }}>
                {groupedItems.length === 0 ? (
                  <Empty description="没有明细" />
                ) : (
                  groupedItems.map((group) =>
                    renderItemSection(group.categoryName, group.items, group.requestedTotal)
                  )
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
                  状态流水
                </div>
                {detail.events.length === 0 ? (
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>暂无记录</span>
                ) : (
                  <Space orientation="vertical" size={4}>
                    {detail.events.map((event) => (
                      <span key={event.id} style={{ fontSize: 13, color: colors.textSecondary }}>
                        {formatTime(event.createdAt)} · {event.fromStatus ?? '新建'} → {event.toStatus}
                        {event.operatorName ? ` · ${event.operatorName}` : ''}
                      </span>
                    ))}
                  </Space>
                )}
              </div>
            </>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
