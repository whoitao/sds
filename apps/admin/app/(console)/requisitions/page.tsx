'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
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
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  UndoOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

type RequisitionStatus = 'draft' | 'submitted' | 'approved' | 'withdrawn';

interface ShopOption {
  id: string;
  name: string;
  status: string;
}

interface RequisitionRow {
  id: string;
  requisitionNo: string;
  shopId: string;
  shopName: string;
  expectedDate: string;
  timeWindow: 'morning' | 'afternoon' | 'all_day';
  status: RequisitionStatus;
  remark: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

interface RequisitionItem {
  id: string;
  productSkuId: string;
  catalogSkuId: string | null;
  itemName: string;
  specName: string | null;
  categoryName: string | null;
  unit: string;
  requestedQty: string;
  approvedQty: string | null;
  remark: string | null;
}

interface RequisitionEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  operatorName: string | null;
  reason: string | null;
  createdAt: string;
}

interface RequisitionDetail extends RequisitionRow {
  items: RequisitionItem[];
  events: RequisitionEvent[];
  reviewNote: string | null;
}

interface SkuOption {
  skuId: string;
  productName: string;
  specName: string | null;
  unit: string;
  catalogSkuId: string | null;
  stockType: string;
  quantity: string | number;
}

interface SuggestionRow {
  skuId: string;
  catalogSkuId: string;
  productName: string;
  specName: string | null;
  unit: string;
  suggestedQuantity: string | number;
}

interface DraftItem {
  key: string;
  skuId?: string;
  quantity: number;
}

interface ScopeData {
  admins: { id: string; username: string; displayName: string }[];
  shops: { id: string; name: string; status: string }[];
  items: { adminUserId: string; username: string; displayName: string; shopIds: string[] }[];
}

const STATUS_META: Record<RequisitionStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  submitted: { label: '已提交', color: 'processing' },
  approved: { label: '已审核', color: 'success' },
  withdrawn: { label: '已撤回', color: 'default' }
};

const TIME_WINDOW_LABELS: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  all_day: '全天'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

let draftKeySeed = 0;
function nextDraftKey() {
  draftKeySeed += 1;
  return `draft-${draftKeySeed}`;
}

export default function RequisitionsPage() {
  const { pageSize } = useAdminSettings();
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [expectedDate, setExpectedDate] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RequisitionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mounted, setMounted] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<{ code: string }[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RequisitionRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [draftShopId, setDraftShopId] = useState<string | undefined>();
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [skuOptions, setSkuOptions] = useState<SkuOption[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeData, setScopeData] = useState<ScopeData | null>(null);
  const [scopeAdminId, setScopeAdminId] = useState<string | undefined>();
  const [scopeShopIds, setScopeShopIds] = useState<string[]>([]);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeError, setScopeError] = useState('');

  const isSuperAdmin = roles.some((role) => role.code === 'super_admin');
  const canReview = permissions.includes('requisitions.review');

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
      setRoles(payload.roles ?? []);
    } catch {
      // 权限探测失败时保持只读展示，具体操作仍由服务端兜底
    }
  }, []);

  const loadShops = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) return;
      const items = (payload.items ?? []) as ShopOption[];
      setShops(items);
      setShopId((current) => current ?? items[0]?.id);
    } catch {
      // 门店下拉失败时列表仍可按全部门店查询
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (shopId) params.set('shopId', shopId);
    if (status) params.set('status', status);
    if (expectedDate) params.set('expectedDate', expectedDate);
    if (keyword.trim()) params.set('keyword', keyword.trim());

    try {
      const response = await fetch(`/api/admin/requisitions?${params}`, { cache: 'no-store' });
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
  }, [shopId, status, expectedDate, keyword, page, pageSize]);

  useEffect(() => {
    setMounted(true);
    void loadPermissions();
    void loadShops();
  }, [loadPermissions, loadShops]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadSkuOptions(targetShopId: string) {
    setSkuLoading(true);
    try {
      const response = await fetch(
        `/api/admin/inventory?shopId=${encodeURIComponent(targetShopId)}&page=1&pageSize=100`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setSkuOptions([]);
        return;
      }
      setSkuOptions(
        (payload.items ?? []).filter(
          (item: SkuOption) => item.catalogSkuId && item.stockType === 'tracked'
        )
      );
    } catch {
      setSkuOptions([]);
    } finally {
      setSkuLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    const targetShopId = shopId ?? shops[0]?.id;
    form.resetFields();
    form.setFieldsValue({ timeWindow: 'all_day' });
    setDraftShopId(targetShopId);
    setDraftItems([{ key: nextDraftKey(), quantity: 1 }]);
    setError('');
    setNotice('');
    setFormOpen(true);
    if (targetShopId) void loadSkuOptions(targetShopId);
  }

  async function openEdit(row: RequisitionRow) {
    setEditing(row);
    setError('');
    setNotice('');
    form.resetFields();
    setDraftItems([]);
    setFormOpen(true);
    setDraftShopId(row.shopId);
    void loadSkuOptions(row.shopId);
    try {
      const response = await fetch(`/api/admin/requisitions/${row.id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '加载要货单失败');
        return;
      }
      const item = payload.item as RequisitionDetail;
      form.setFieldsValue({
        expectedDate: item.expectedDate,
        timeWindow: item.timeWindow,
        remark: item.remark ?? ''
      });
      setDraftItems(
        item.items.map((line) => ({
          key: nextDraftKey(),
          skuId: line.productSkuId,
          quantity: Number(line.requestedQty)
        }))
      );
    } catch {
      setError('接口不可用');
    }
  }

  async function openDetail(row: RequisitionRow) {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    await refreshDetail(row.id);
    setDetailLoading(false);
  }

  async function refreshDetail(id: string) {
    try {
      const response = await fetch(`/api/admin/requisitions/${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '加载详情失败');
        return;
      }
      setDetail(payload.item);
    } catch {
      setError('接口不可用');
    }
  }

  async function pullSuggestions() {
    if (!draftShopId) {
      setError('请先选择门店');
      return;
    }
    setSuggestionLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/requisitions/suggestions?shopId=${encodeURIComponent(draftShopId)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '带出低库存失败');
        return;
      }
      const suggestions = (payload.items ?? []) as SuggestionRow[];
      const existing = new Set(draftItems.map((item) => item.skuId).filter(Boolean));
      const additions: DraftItem[] = suggestions
        .filter((item) => !existing.has(item.skuId))
        .map((item) => ({
          key: nextDraftKey(),
          skuId: item.skuId,
          quantity: Math.max(1, Math.ceil(Number(item.suggestedQuantity) || 1))
        }));
      if (additions.length === 0) {
        setNotice('没有可带出的低库存规格（或已在明细中）');
        return;
      }
      setDraftItems((current) => [
        ...current.filter((item) => item.skuId || item.quantity !== 1),
        ...additions
      ]);
      setNotice(`已带出 ${additions.length} 条低库存建议，可继续调整数量`);
    } catch {
      setError('接口不可用');
    } finally {
      setSuggestionLoading(false);
    }
  }

  async function submitForm() {
    const values = await form.validateFields();
    const targetShopId = editing ? editing.shopId : draftShopId;
    if (!targetShopId) {
      setError('请选择门店');
      return;
    }
    const validItems = draftItems.filter(
      (item) => item.skuId && Number.isFinite(item.quantity) && item.quantity > 0
    );
    if (validItems.length === 0) {
      setError('至少需要一条有效的要货明细');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editing ? `/api/admin/requisitions/${editing.id}` : '/api/admin/requisitions',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            shopId: targetShopId,
            expectedDate: values.expectedDate,
            timeWindow: values.timeWindow,
            remark: values.remark || null,
            items: validItems.map((item) => ({
              productSkuId: item.skuId,
              requestedQty: item.quantity
            }))
          })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '保存失败');
        return;
      }
      setFormOpen(false);
      setNotice(editing ? '要货单已更新' : '要货单已创建');
      void load();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(row: RequisitionRow, action: 'submit' | 'withdraw' | 'review') {
    const labels = { submit: '提交', withdraw: '撤回', review: '审核通过' } as const;
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `确认${labels[action]}要货单 ${row.requisitionNo}？`,
        okText: labels[action],
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
    if (!confirmed) return;

    setError('');
    try {
      const response = await fetch(`/api/admin/requisitions/${row.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '操作失败');
        return;
      }
      setNotice(
        payload.deduplicated
          ? `同门店同交付日已有生效要货单：${payload.item?.requisitionNo ?? ''}`
          : `要货单已${labels[action]}`
      );
      void load();
      if (detailOpen) void refreshDetail(row.id);
    } catch {
      setError('操作失败');
    }
  }

  async function openScope() {
    setScopeOpen(true);
    setScopeLoading(true);
    setScopeError('');
    try {
      const response = await fetch('/api/admin/requisitions/shop-scope', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setScopeError(payload?.message ?? '加载失败');
        return;
      }
      setScopeData(payload);
      const first = payload.items?.find((item: { shopIds: string[] }) => item.shopIds.length > 0);
      const target = first ?? payload.items?.[0];
      if (target) {
        setScopeAdminId(target.adminUserId);
        setScopeShopIds(target.shopIds);
      }
    } catch {
      setScopeError('接口不可用');
    } finally {
      setScopeLoading(false);
    }
  }

  function selectScopeAdmin(adminId: string) {
    setScopeAdminId(adminId);
    const target = scopeData?.items.find((item) => item.adminUserId === adminId);
    setScopeShopIds(target?.shopIds ?? []);
  }

  async function saveScope() {
    if (!scopeAdminId) return;
    setScopeSaving(true);
    setScopeError('');
    try {
      const response = await fetch(`/api/admin/requisitions/shop-scope/${scopeAdminId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shopIds: scopeShopIds })
      });
      const payload = await response.json();
      if (!response.ok) {
        setScopeError(payload?.message ?? '保存失败');
        return;
      }
      setScopeData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.adminUserId === scopeAdminId
                  ? { ...item, shopIds: scopeShopIds }
                  : item
              )
            }
          : current
      );
      setNotice('门店范围已更新');
    } catch {
      setScopeError('保存失败');
    } finally {
      setScopeSaving(false);
    }
  }

  const columns: TableColumnsType<RequisitionRow> = [
    { title: '要货单号', dataIndex: 'requisitionNo', width: 190 },
    { title: '门店', dataIndex: 'shopName', width: 160 },
    { title: '交付日期', dataIndex: 'expectedDate', width: 120 },
    {
      title: '期望时段',
      dataIndex: 'timeWindow',
      width: 100,
      render: (value: string) => TIME_WINDOW_LABELS[value] ?? value
    },
    { title: '明细数', dataIndex: 'itemCount', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: RequisitionStatus) => (
        <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
      )
    },
    {
      title: '提交时间',
      dataIndex: 'submittedAt',
      width: 170,
      render: (value: string | null) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: unknown, row: RequisitionRow) => (
        <Space size={0}>
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<EyeOutlined />}
            title="查看"
            aria-label="查看"
            onClick={() => void openDetail(row)}
          />
          {row.status === 'draft' ? (
            <>
              <Button
                variant="text"
                color="primary"
                size="small"
                icon={<EditOutlined />}
                title="编辑"
                aria-label="编辑"
                onClick={() => void openEdit(row)}
              />
              <Button
                variant="text"
                color="primary"
                size="small"
                icon={<SendOutlined />}
                title="提交"
                aria-label="提交"
                onClick={() => void runAction(row, 'submit')}
              />
            </>
          ) : null}
          {row.status === 'submitted' ? (
            <>
              {canReview ? (
                <Button
                  variant="text"
                  color="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  title="审核通过"
                  aria-label="审核通过"
                  onClick={() => void runAction(row, 'review')}
                />
              ) : null}
              <Button
                variant="text"
                color="primary"
                size="small"
                icon={<UndoOutlined />}
                title="撤回"
                aria-label="撤回"
                onClick={() => void runAction(row, 'withdraw')}
              />
            </>
          ) : null}
        </Space>
      )
    }
  ];

  const detailColumns: TableColumnsType<RequisitionItem> = [
    { title: '品类', dataIndex: 'categoryName', width: 110, render: (v) => v || '未分类' },
    {
      title: '商品',
      dataIndex: 'itemName',
      width: 200,
      render: (_v, row) => (
        <span>
          {row.itemName}
          {row.specName ? (
            <span style={{ color: colors.textSecondary }}> / {row.specName}</span>
          ) : null}
        </span>
      )
    },
    { title: '单位', dataIndex: 'unit', width: 70 },
    { title: '申请数量', dataIndex: 'requestedQty', width: 100 },
    {
      title: '审核数量',
      dataIndex: 'approvedQty',
      width: 100,
      render: (value: string | null) => value ?? '—'
    },
    { title: '备注', dataIndex: 'remark', render: (value: string | null) => value || '—' }
  ];

  const skuSelectOptions = useMemo(
    () =>
      skuOptions.map((item) => ({
        value: item.skuId,
        label: `${item.productName}${item.specName ? ` / ${item.specName}` : ''}（${item.unit}）`
      })),
    [skuOptions]
  );

  return (
    <div>
      <div style={{ background: colors.surface, minHeight: '100vh' }}>
        <div className="admin-page-bar">
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>门店要货</span>
          <Space size={8}>
            {isSuperAdmin ? (
              <Button icon={<SettingOutlined />} onClick={() => void openScope()}>
                门店范围
              </Button>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建要货单
            </Button>
            <TestDataCleanupButton onCleaned={() => void load()} />
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
            showSearch
            optionFilterProp="label"
            placeholder="全部门店"
            style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
            value={shopId}
            onChange={(value) => {
              setShopId(value);
              setPage(1);
            }}
            options={shops.map((item) => ({
              value: item.id,
              label: item.status === 'active' ? item.name : `${item.name}（停用）`
            }))}
          />
          <Input
            type="date"
            aria-label="交付日期"
            style={{ width: 160 }}
            value={expectedDate}
            onChange={(event) => {
              setExpectedDate(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
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
          <Space.Compact style={{ width: ADMIN_FILTER_FIELD_WIDTH }}>
            <Input
              allowClear
              value={searchText}
              placeholder="按单号/门店搜索…"
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
        </div>

        {error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
        ) : null}
        {notice && !error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>
            {notice}
          </div>
        ) : null}

        <Table<RequisitionRow>
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
      </div>

      {mounted ? (
        <Modal
          open={formOpen}
          title={editing ? `编辑要货单 · ${editing.requisitionNo}` : '新建要货单'}
          okText="保存"
          cancelText="取消"
          confirmLoading={submitting}
          onOk={() => void submitForm()}
          onCancel={() => setFormOpen(false)}
          width={820}
          forceRender
        >
          {error ? (
            <div style={{ marginBottom: 8, fontSize: 13, color: colors.danger }}>{error}</div>
          ) : null}
          <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Form.Item label="门店" required>
                <Select
                  disabled={Boolean(editing)}
                  value={editing ? editing.shopId : draftShopId}
                  onChange={(value) => {
                    setDraftShopId(value);
                    setDraftItems([{ key: nextDraftKey(), quantity: 1 }]);
                    void loadSkuOptions(value);
                  }}
                  options={shops.map((item) => ({
                    value: item.id,
                    label: item.status === 'active' ? item.name : `${item.name}（停用）`
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="expectedDate"
                label="交付日期"
                rules={[{ required: true, message: '请选择交付日期' }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item name="timeWindow" label="期望到货时段">
                <Select
                  options={[
                    { value: 'morning', label: '上午' },
                    { value: 'afternoon', label: '下午' },
                    { value: 'all_day', label: '全天' }
                  ]}
                />
              </Form.Item>
            </div>
            <Form.Item name="remark" label="备注" rules={[{ max: 500, message: '最多 500 字' }]}>
              <Input.TextArea rows={2} maxLength={500} placeholder="选填" />
            </Form.Item>
          </Form>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>要货明细</span>
            <Space size={8}>
              <Button
                size="small"
                loading={suggestionLoading}
                onClick={() => void pullSuggestions()}
              >
                从库存预警带出
              </Button>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  setDraftItems((current) => [...current, { key: nextDraftKey(), quantity: 1 }])
                }
              >
                添加商品
              </Button>
            </Space>
          </div>

          {draftItems.length === 0 ? (
            <Alert type="info" showIcon message="还没有明细，请添加商品或从库存预警带出" />
          ) : null}

          {draftItems.map((item, index) => {
            const sku = skuOptions.find((option) => option.skuId === item.skuId);
            return (
              <div
                key={item.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(260px, 1fr) 120px 70px 40px',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 8
                }}
              >
                <Select
                  showSearch
                  loading={skuLoading}
                  optionFilterProp="label"
                  placeholder="选择门店商品规格"
                  value={item.skuId}
                  options={skuSelectOptions}
                  onChange={(value) =>
                    setDraftItems((current) =>
                      current.map((line, lineIndex) =>
                        lineIndex === index ? { ...line, skuId: value } : line
                      )
                    )
                  }
                />
                <InputNumber
                  min={0.01}
                  precision={2}
                  style={{ width: '100%' }}
                  value={item.quantity}
                  onChange={(value) =>
                    setDraftItems((current) =>
                      current.map((line, lineIndex) =>
                        lineIndex === index ? { ...line, quantity: Number(value) || 0 } : line
                      )
                    )
                  }
                />
                <span style={{ fontSize: 13, color: colors.textSecondary }}>{sku?.unit ?? '—'}</span>
                <Button
                  variant="text"
                  color="primary"
                  size="small"
                  onClick={() =>
                    setDraftItems((current) => current.filter((_, lineIndex) => lineIndex !== index))
                  }
                >
                  删除
                </Button>
              </div>
            );
          })}
        </Modal>
      ) : null}

      <Modal
        open={detailOpen}
        title={detail ? `要货单 · ${detail.requisitionNo}` : '要货单详情'}
        footer={null}
        onCancel={() => setDetailOpen(false)}
        width={960}
        forceRender
      >
        {detailLoading || !detail ? (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textSecondary }}>加载中…</div>
        ) : (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="门店">{detail.shopName}</Descriptions.Item>
              <Descriptions.Item label="交付日期">{detail.expectedDate}</Descriptions.Item>
              <Descriptions.Item label="期望时段">
                {TIME_WINDOW_LABELS[detail.timeWindow] ?? detail.timeWindow}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_META[detail.status].color}>
                  {STATUS_META[detail.status].label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="提交时间">
                {formatTime(detail.submittedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="审核时间">
                {formatTime(detail.reviewedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={3}>
                {detail.remark || '—'}
              </Descriptions.Item>
            </Descriptions>

            <Table<RequisitionItem>
              rowKey="id"
              size="small"
              columns={detailColumns}
              dataSource={detail.items}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />

            <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: colors.text }}>
              状态流水
            </div>
            <div style={{ marginTop: 8 }}>
              {detail.events.length === 0 ? (
                <span style={{ fontSize: 13, color: colors.textSecondary }}>暂无流水</span>
              ) : (
                detail.events.map((event) => (
                  <div
                    key={event.id}
                    style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}
                  >
                    {formatTime(event.createdAt)} · {event.operatorName || '系统'} ·{' '}
                    {STATUS_META[event.toStatus as RequisitionStatus]?.label ?? event.toStatus}
                    {event.reason ? ` · ${event.reason}` : ''}
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              {detail.status === 'draft' ? (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => void runAction(detail, 'submit')}
                >
                  提交
                </Button>
              ) : null}
              {detail.status === 'submitted' && canReview ? (
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => void runAction(detail, 'review')}
                >
                  审核通过
                </Button>
              ) : null}
              {detail.status === 'submitted' ? (
                <Button
                  icon={<UndoOutlined />}
                  onClick={() => void runAction(detail, 'withdraw')}
                >
                  撤回
                </Button>
              ) : null}
              <Button onClick={() => setDetailOpen(false)}>关闭</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={scopeOpen}
        title="门店范围"
        okText="保存"
        cancelText="取消"
        confirmLoading={scopeSaving}
        onOk={() => void saveScope()}
        onCancel={() => setScopeOpen(false)}
        width={640}
        forceRender
      >
        {scopeError ? (
          <div style={{ marginBottom: 8, fontSize: 13, color: colors.danger }}>{scopeError}</div>
        ) : null}
        <div style={{ marginBottom: 8, fontSize: 13, color: colors.textSecondary }}>
          绑定后，该管理员在要货与需求汇总里只能看到所选门店；不绑定则保持“全部门店”。
          超级管理员始终不受限制。
        </div>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={scopeLoading}
            placeholder="选择管理员"
            style={{ width: '100%' }}
            value={scopeAdminId}
            onChange={selectScopeAdmin}
            options={(scopeData?.items ?? []).map((item) => ({
              value: item.adminUserId,
              label: `${item.displayName}（${item.username}）`
            }))}
          />
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="选择门店；留空表示全部门店"
            style={{ width: '100%' }}
            value={scopeShopIds}
            onChange={setScopeShopIds}
            options={(scopeData?.shops ?? []).map((shop) => ({
              value: shop.id,
              label: shop.status === 'active' ? shop.name : `${shop.name}（停用）`
            }))}
          />
          <div style={{ fontSize: 12, color: colors.textSecondary }}>
            留空 = 全部门店（适合总部运营）；勾选门店 = 只允许这些门店（适合店长）。
          </div>
        </Space>
      </Modal>
    </div>
  );
}
