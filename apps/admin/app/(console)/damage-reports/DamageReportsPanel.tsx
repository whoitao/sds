'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { getAdminTableProps } from '../../../lib/table';
import {
  AdminFilterDateRange,
  AdminFilterField,
  AdminListPage
} from '../../../components/AdminListPage';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

type SubjectType = 'shop' | 'warehouse';
/** 页签：仓库报损 / 门店报损，与 URL 的 ?tab= 同步 */
type DamageTab = 'warehouse' | 'shop';
type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
type ReasonCategory = 'expired' | 'damaged' | 'spoiled' | 'other';

interface ShopOption {
  id: string;
  name: string;
}

interface WarehouseOption {
  id: string;
  name: string;
  status?: string;
}

interface ReportRow {
  id: string;
  reportNo: string;
  subjectType: SubjectType;
  subjectTypeLabel: string;
  shopId: string | null;
  warehouseId: string | null;
  subjectName: string | null;
  status: ReportStatus;
  statusLabel: string;
  reasonCategory: ReasonCategory;
  reasonLabel: string;
  remark: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  totalQuantity: string;
  totalAmount: string;
}

interface ReportItem {
  id: string;
  productSkuId: string | null;
  catalogSkuId: string | null;
  itemName: string;
  specName: string | null;
  unit: string;
  quantity: string;
  unitCost: string;
  amount: string;
  remark: string | null;
}

interface ReportEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  operatorName: string | null;
  reason: string | null;
  createdAt: string;
}

interface ReportDetail extends ReportRow {
  items: ReportItem[];
  events: ReportEvent[];
}

interface StockOption {
  skuId: string;
  productName: string;
  specName: string | null;
  unit: string;
  availableQuantity: number;
  avgUnitCost: string;
  lowStock: boolean;
}

const STATUS_META: Record<ReportStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  submitted: { label: '已提交', color: 'processing' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' }
};

const SUBJECT_OPTIONS: Array<{ value: SubjectType; label: string }> = [
  { value: 'shop', label: '门店' },
  { value: 'warehouse', label: '仓库' }
];

const REASON_OPTIONS: Array<{ value: ReasonCategory; label: string }> = [
  { value: 'expired', label: '过期' },
  { value: 'damaged', label: '破损' },
  { value: 'spoiled', label: '变质' },
  { value: 'other', label: '其他' }
];

const ERROR_HINTS: Record<string, string> = {
  FORBIDDEN: '当前账号没有该主体或该操作的权限',
  NOT_FOUND: '报损单不存在或已被删除',
  SHOP_NOT_FOUND: '门店不存在',
  WAREHOUSE_NOT_FOUND: '仓库不存在',
  WAREHOUSE_DISABLED: '仓库已停用，不能报损',
  INVALID_SUBJECT: '请选择门店或仓库（二选一）',
  DUPLICATE_SKU: '同一规格不能重复添加',
  SKU_NOT_FOUND: '包含不存在的商品规格',
  SKU_NOT_IN_SHOP: '商品规格不属于该门店',
  SKU_NOT_TRACKED: '只有库存规格才能报损',
  DAMAGE_INSUFFICIENT_STOCK: '可用量不足，请调低报损数量',
  INVALID_DOCUMENT_TRANSITION: '当前状态不允许该操作，请刷新后重试',
  REASON_REQUIRED: '请填写驳回原因',
  DAMAGE_ACTION_IN_PROGRESS: '上一次请求正在处理，请稍后刷新',
  IDEMPOTENCY_CONFLICT: '重复提交的内容不一致，请刷新后重试',
  TEST_DATA_MISMATCH: '测试数据与正式数据混用，请检查数据标记',
  INVALID_BODY: '提交内容不合法，请检查主体与数量',
  INVALID_QUANTITY: '数量不合法'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemLabel(item: { itemName: string; specName: string | null }) {
  return item.specName ? `${item.itemName} · ${item.specName}` : item.itemName;
}

function errorMessage(payload: { code?: string; message?: string } | null) {
  const code = payload?.code;
  if (code && ERROR_HINTS[code]) return ERROR_HINTS[code];
  return payload?.message ?? '操作失败';
}

function newIdempotencyKey(action: string, id: string) {
  return `${action}-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


interface DamageReportsPanelProps {
  /** 服务端首帧读到的权限，避免页签/按钮先出现后消失 */
  initialPermissions: string[];
  initialIsSuperAdmin: boolean;
}

export function DamageReportsPanel({
  initialPermissions,
  initialIsSuperAdmin
}: DamageReportsPanelProps) {
  const { pageSize } = useAdminSettings();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const permissions = initialPermissions;
  const isSuperAdmin = initialIsSuperAdmin;
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopsLoaded, setShopsLoaded] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

  const [shopId, setShopId] = useState<string>();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [status, setStatus] = useState<ReportStatus>();
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  // 有仓库读权限（超管、运营）才能看到「仓库报损」页签；店长只有门店报损
  const canWarehouseRead = isSuperAdmin || permissions.includes('warehouse.read');
  const warehouseTabVisible = canWarehouseRead;
  const activeTab: DamageTab = warehouseTabVisible
    ? searchParams.get('tab') === 'shop'
      ? 'shop'
      : 'warehouse'
    : 'shop';

  // 店长的门店范围来自 /api/admin/shops（后端已按 admin_user_shops 过滤）
  const shopScoped = !canWarehouseRead;
  const lockedShopId = shopScoped && shops.length === 1 ? shops[0].id : undefined;
  const noBoundShops = shopScoped && shopsLoaded && shops.length === 0;

  const canInventoryWrite = permissions.includes('inventory.write');
  const canWarehouseWrite = permissions.includes('warehouse.write');
  const canCreate = canInventoryWrite || canWarehouseWrite;

  const canWriteSubject = useCallback(
    (type: SubjectType) =>
      type === 'shop'
        ? permissions.includes('inventory.write')
        : permissions.includes('warehouse.write'),
    [permissions]
  );

  /* ------------------------------------------------------------ 基础数据 */
  const loadShops = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) return;
      setShops((payload.items ?? []) as ShopOption[]);
    } catch {
      // 下拉失败不影响列表
    } finally {
      setShopsLoaded(true);
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
    // 店长未绑定任何门店：不请求列表，直接空态并给出提示
    if (noBoundShops) {
      setRows([]);
      setTotal(0);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      subjectType: activeTab
    });
    if (activeTab === 'shop') {
      const effectiveShopId = lockedShopId ?? shopId;
      if (effectiveShopId) params.set('shopId', effectiveShopId);
    } else if (warehouseId) {
      params.set('warehouseId', warehouseId);
    }
    if (status) params.set('status', status);
    if (reasonCategory) params.set('reasonCategory', reasonCategory);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (keyword) params.set('keyword', keyword);
    try {
      const response = await fetch(`/api/admin/damage-reports?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(errorMessage(payload));
        return;
      }
      setRows((payload.items ?? []) as ReportRow[]);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    lockedShopId,
    noBoundShops,
    shopId,
    warehouseId,
    status,
    reasonCategory,
    dateFrom,
    dateTo,
    keyword,
    page,
    pageSize
  ]);

  useEffect(() => {
    void loadShops();
    void loadWarehouses();
  }, [loadShops, loadWarehouses]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetPage() {
    setPage(1);
  }

  /** 页签切换写入 ?tab=，刷新、分享链接后保持同一页签 */
  const changeTab = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      // 主体、筛选与分页都属于当前页签，切换时不带到另一页签
      setShopId(undefined);
      setWarehouseId(undefined);
      setStatus(undefined);
      setReasonCategory(undefined);
      setDateFrom('');
      setDateTo('');
      setKeywordInput('');
      setKeyword('');
      setError('');
      setNotice('');
      setPage(1);
    },
    [pathname, router, searchParams]
  );

  // 店长只有门店报损页签：把旧的 ?tab=warehouse 链接收敛到 shop
  useEffect(() => {
    if (warehouseTabVisible) return;
    if (searchParams.get('tab') === 'shop') return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'shop');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [warehouseTabVisible, searchParams, pathname, router]);

  /* ------------------------------------------------------------ 新建报损单 */
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubject, setCreateSubject] = useState<SubjectType>('shop');
  const [createShopId, setCreateShopId] = useState<string>();
  const [createWarehouseId, setCreateWarehouseId] = useState<string>();
  const [createReason, setCreateReason] = useState<ReasonCategory>('damaged');
  const [createRemark, setCreateRemark] = useState('');
  const [options, setOptions] = useState<StockOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number | null>>({});
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [filling, setFilling] = useState(false);

  const createSubjectId = createSubject === 'shop' ? createShopId : createWarehouseId;

  useEffect(() => {
    if (!createOpen || !createSubjectId) {
      setOptions([]);
      setQtyDraft({});
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setCreateError('');
    async function loadOptions() {
      try {
        if (createSubject === 'shop') {
          const params = new URLSearchParams({ shopId: createSubjectId!, page: '1', pageSize: '100' });
          const response = await fetch(`/api/admin/inventory?${params}`, { cache: 'no-store' });
          const payload = await response.json();
          if (cancelled) return;
          if (!response.ok) {
            setOptions([]);
            setCreateError(errorMessage(payload));
            return;
          }
          setOptions(
            ((payload.items ?? []) as Array<Record<string, unknown>>)
              .filter((row) => row.stockType === 'tracked')
              .map((row) => ({
                skuId: String(row.skuId),
                productName: String(row.productName ?? ''),
                specName: (row.specName as string | null) ?? null,
                unit: String(row.unit ?? ''),
                availableQuantity: toNumber(row.quantity as string),
                avgUnitCost: String(row.avgUnitCost ?? '0'),
                lowStock: Boolean(row.lowStock)
              }))
          );
        } else {
          const params = new URLSearchParams({
            warehouseId: createSubjectId!,
            page: '1',
            pageSize: '100'
          });
          const response = await fetch(`/api/admin/warehouse-stocks?${params}`, {
            cache: 'no-store'
          });
          const payload = await response.json();
          if (cancelled) return;
          if (!response.ok) {
            setOptions([]);
            setCreateError(errorMessage(payload));
            return;
          }
          setOptions(
            ((payload.items ?? []) as Array<Record<string, unknown>>)
              .filter((row) => row.stockType === 'tracked')
              .map((row) => ({
                skuId: String(row.catalogSkuId),
                productName: String(row.productName ?? ''),
                specName: (row.specName as string | null) ?? null,
                unit: String(row.unit ?? ''),
                availableQuantity: toNumber(row.availableQuantity as string),
                avgUnitCost: String(row.avgUnitCost ?? '0'),
                lowStock: Boolean(row.lowStock)
              }))
          );
        }
        setQtyDraft({});
      } catch {
        if (!cancelled) setCreateError('规格与库存加载失败');
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [createOpen, createSubject, createSubjectId]);

  function openCreate() {
    if (!canCreate) {
      Modal.warning({
        title: '权限不足',
        content: '当前账号没有 inventory.write 或 warehouse.write 权限，无法新建报损单。'
      });
      return;
    }
    setCreateOpen(true);
    setCreateSubject(canInventoryWrite ? 'shop' : 'warehouse');
    setCreateShopId(undefined);
    setCreateWarehouseId(undefined);
    setCreateReason('damaged');
    setCreateRemark('');
    setOptions([]);
    setQtyDraft({});
    setCreateError('');
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
  }

  const selectedItems = useMemo(
    () =>
      options
        .map((option) => ({ option, quantity: Number(qtyDraft[option.skuId] ?? 0) }))
        .filter((row) => row.quantity > 0),
    [options, qtyDraft]
  );

  const selectedTotal = useMemo(
    () => selectedItems.reduce((acc, row) => acc + row.quantity, 0),
    [selectedItems]
  );

  /** 从低库存清单带入：默认每个规格 1，可再手工调整 */
  async function fillLowStock() {
    if (!createSubjectId) {
      setCreateError('请先选择门店或仓库');
      return;
    }
    setFilling(true);
    setCreateError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      const path =
        createSubject === 'shop'
          ? `/api/admin/inventory/alerts?${params.set('shopId', createSubjectId)}`
          : `/api/admin/warehouse-stocks/alerts?${params.set('warehouseId', createSubjectId)}`;
      const response = await fetch(path, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setCreateError(errorMessage(payload));
        return;
      }
      const alerts = (payload.items ?? []) as Array<Record<string, unknown>>;
      const alertIds = new Set(
        alerts.map((row) => String(createSubject === 'shop' ? row.skuId : row.catalogSkuId))
      );
      let filled = 0;
      const next: Record<string, number | null> = {};
      for (const option of options) {
        if (!alertIds.has(option.skuId) || option.availableQuantity <= 0) continue;
        next[option.skuId] = 1;
        filled += 1;
      }
      setQtyDraft(next);
      setNotice(
        filled > 0
          ? `已从低库存清单带入 ${filled} 个规格，请确认报损数量`
          : '低库存清单里没有可直接带入的规格'
      );
    } catch {
      setCreateError('低库存清单加载失败');
    } finally {
      setFilling(false);
    }
  }

  async function submitCreate() {
    setCreateError('');
    if (!createSubjectId) {
      setCreateError(createSubject === 'shop' ? '请选择门店' : '请选择仓库');
      return;
    }
    if (selectedItems.length === 0) {
      setCreateError('请至少填写一条规格的报损数量');
      return;
    }
    for (const row of selectedItems) {
      if (row.quantity > row.option.availableQuantity) {
        setCreateError(
          `${itemLabel({ itemName: row.option.productName, specName: row.option.specName })} 的报损数量超过可用量 ${row.option.availableQuantity.toFixed(2)}`
        );
        return;
      }
    }

    setCreating(true);
    try {
      const response = await fetch('/api/admin/damage-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectType: createSubject,
          shopId: createSubject === 'shop' ? createSubjectId : null,
          warehouseId: createSubject === 'warehouse' ? createSubjectId : null,
          reasonCategory: createReason,
          remark: createRemark.trim() || null,
          items: selectedItems.map((row) => ({
            skuId: row.option.skuId,
            quantity: String(row.quantity)
          }))
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setCreateError(errorMessage(payload));
        return;
      }
      setCreateOpen(false);
      setNotice(`报损单 ${payload.item?.reportNo ?? ''} 已保存为草稿`);
      await load();
      if (payload.item?.id) {
        setDetailOpen(true);
        setDetail(payload.item as ReportDetail);
      }
    } catch {
      setCreateError('接口不可用');
    } finally {
      setCreating(false);
    }
  }

  /* ------------------------------------------------------------ 详情与审核 */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionBusy, setActionBusy] = useState('');

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/damage-reports/${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setDetailError(errorMessage(payload));
        return;
      }
      setDetail(payload.item as ReportDetail);
    } catch {
      setDetailError('接口不可用');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openDetail(row: ReportRow) {
    setDetailOpen(true);
    setDetail(row as ReportDetail);
    void loadDetail(row.id);
  }

  async function submitReport() {
    if (!detail) return;
    setActionBusy('submit');
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/damage-reports/${detail.id}/submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': newIdempotencyKey('submit', detail.id)
        },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) {
        setDetailError(errorMessage(payload));
        return;
      }
      setDetail(payload.item as ReportDetail);
      setNotice(`报损单 ${payload.item?.reportNo ?? ''} 已提交，等待审核`);
      await load();
    } catch {
      setDetailError('接口不可用');
    } finally {
      setActionBusy('');
    }
  }

  const [reviewOpen, setReviewOpen] = useState<'approve' | 'reject' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewing, setReviewing] = useState(false);

  function openReview(kind: 'approve' | 'reject') {
    setReviewOpen(kind);
    setReviewReason('');
    setReviewError('');
  }

  async function submitReview() {
    if (!detail || !reviewOpen) return;
    if (reviewOpen === 'reject' && !reviewReason.trim()) {
      setReviewError('请填写驳回原因');
      return;
    }
    setReviewing(true);
    setReviewError('');
    try {
      const response = await fetch(
        `/api/admin/damage-reports/${detail.id}/${reviewOpen}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': newIdempotencyKey(reviewOpen, detail.id)
          },
          body: JSON.stringify({ reason: reviewReason.trim() || null })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setReviewError(errorMessage(payload));
        return;
      }
      setReviewOpen(null);
      setDetail(payload.item as ReportDetail);
      setNotice(
        reviewOpen === 'approve'
          ? `报损单 ${payload.item?.reportNo ?? ''} 已通过，库存已扣减`
          : `报损单 ${payload.item?.reportNo ?? ''} 已驳回`
      );
      await load();
    } catch {
      setReviewError('接口不可用');
    } finally {
      setReviewing(false);
    }
  }

  /* ------------------------------------------------------------ 列定义 */
  const columns: TableColumnsType<ReportRow> = [
    {
      title: '单号',
      dataIndex: 'reportNo',
      width: 190,
      render: (value: string, row) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openDetail(row)}>
          {value}
        </Button>
      )
    },
    {
      title: '门店 / 仓库',
      dataIndex: 'subjectName',
      width: 180,
      render: (value: string | null) => value ?? '—'
    },
    { title: '报损原因', dataIndex: 'reasonLabel', width: 90 },
    { title: '规格数', dataIndex: 'itemCount', width: 76, align: 'right' },
    {
      title: '数量合计',
      dataIndex: 'totalQuantity',
      width: 96,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '金额合计',
      dataIndex: 'totalAmount',
      width: 106,
      align: 'right',
      render: (value: string) => `¥${toNumber(value).toFixed(2)}`
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 92,
      render: (value: ReportStatus) => (
        <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.label ?? value}</Tag>
      )
    },
    {
      title: '提交时间',
      dataIndex: 'submittedAt',
      width: 170,
      render: (value: string | null) => formatTime(value)
    },
    {
      title: '审核时间',
      dataIndex: 'reviewedAt',
      width: 170,
      render: (value: string | null) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      render: (_value, row) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>
          详情
        </Button>
      )
    }
  ];

  const createColumns: TableColumnsType<StockOption> = [
    {
      title: '商品 / 规格',
      dataIndex: 'skuId',
      render: (_value, row) => (
        <div>
          <div style={{ color: colors.text }}>
            {itemLabel({ itemName: row.productName, specName: row.specName })}
          </div>
          {row.lowStock ? (
            <Tag color="orange" style={{ marginTop: 2 }}>
              低库存
            </Tag>
          ) : null}
        </div>
      )
    },
    { title: '单位', dataIndex: 'unit', width: 64 },
    {
      title: '可用量',
      dataIndex: 'availableQuantity',
      width: 96,
      align: 'right',
      render: (value: number) => value.toFixed(2)
    },
    {
      title: '成本单价',
      dataIndex: 'avgUnitCost',
      width: 100,
      align: 'right',
      render: (value: string) => `¥${toNumber(value).toFixed(2)}`
    },
    {
      title: '报损数量',
      dataIndex: 'skuId',
      width: 150,
      render: (_value, row) => (
        <InputNumber
          min={0}
          max={row.availableQuantity}
          precision={2}
          value={qtyDraft[row.skuId] ?? null}
          onChange={(value) =>
            setQtyDraft((prev) => ({ ...prev, [row.skuId]: value ?? null }))
          }
          style={{ width: '100%' }}
          placeholder="0"
        />
      )
    }
  ];

  const detailItemColumns: TableColumnsType<ReportItem> = [
    {
      title: '商品 / 规格',
      dataIndex: 'itemName',
      render: (_value, row) => itemLabel(row)
    },
    { title: '单位', dataIndex: 'unit', width: 64 },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 90,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '成本单价',
      dataIndex: 'unitCost',
      width: 100,
      align: 'right',
      render: (value: string) => `¥${toNumber(value).toFixed(2)}`
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 100,
      align: 'right',
      render: (value: string) => `¥${toNumber(value).toFixed(2)}`
    },
    { title: '备注', dataIndex: 'remark', render: (value: string | null) => value || '—' }
  ];

  const canReviewDetail = detail ? canWriteSubject(detail.subjectType) : false;

  return (
    <AdminListPage
      header={
        <Tabs
          activeKey={activeTab}
          onChange={changeTab}
          tabBarStyle={{ margin: 0 }}
          items={
            warehouseTabVisible
              ? [
                  { key: 'warehouse', label: '仓库报损' },
                  { key: 'shop', label: '门店报损' }
                ]
              : [{ key: 'shop', label: '门店报损' }]
          }
        />
      }
      actions={
        <Space size={8}>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          {canInventoryWrite || canWarehouseWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建报损单
            </Button>
          ) : null}
          <TestDataCleanupButton
            onCleaned={load}
            initialAllowed={permissions.includes('test_data.cleanup')}
          />
        </Space>
      }
      filters={
        <>
          {activeTab === 'warehouse' ? (
            <AdminFilterField>
              <Select
                allowClear
                placeholder="仓库"
                value={warehouseId}
                onChange={(value) => {
                  setWarehouseId(value);
                  resetPage();
                }}
                options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
              />
            </AdminFilterField>
          ) : (
            <AdminFilterField>
              <Select
                allowClear={!lockedShopId}
                disabled={Boolean(lockedShopId) || noBoundShops}
                placeholder={noBoundShops ? '未绑定门店' : '门店'}
                value={lockedShopId ?? shopId}
                onChange={(value) => {
                  setShopId(value);
                  resetPage();
                }}
                options={shops.map((row) => ({ value: row.id, label: row.name }))}
              />
            </AdminFilterField>
          )}
          <AdminFilterField>
            <Select
              allowClear
              placeholder="状态"
              value={status}
              onChange={(value) => {
                setStatus(value);
                resetPage();
              }}
              options={Object.entries(STATUS_META).map(([value, meta]) => ({
                value,
                label: meta.label
              }))}
            />
          </AdminFilterField>
          <AdminFilterField>
            <Select
              allowClear
              placeholder="报损原因"
              value={reasonCategory}
              onChange={(value) => {
                setReasonCategory(value);
                resetPage();
              }}
              options={REASON_OPTIONS}
            />
          </AdminFilterField>
          <AdminFilterDateRange
            start={dateFrom}
            end={dateTo}
            onChange={(start, end) => {
              setDateFrom(start);
              setDateTo(end);
              resetPage();
            }}
          />
          <AdminFilterField>
            <Input
              allowClear
              placeholder="单据号"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onPressEnter={() => {
                setKeyword(keywordInput.trim());
                resetPage();
              }}
            />
          </AdminFilterField>
          <Button
            icon={<SearchOutlined />}
            onClick={() => {
              setKeyword(keywordInput.trim());
              resetPage();
            }}
          >
            查询
          </Button>
        </>
      }
      notice={
        <>
          {noBoundShops ? (
            <Alert
              type="warning"
              showIcon
              title="当前账号未绑定任何门店，暂无门店报损数据。请联系超级管理员在「用户管理」中为该账号绑定门店。"
              style={{ margin: '0 12px 8px' }}
            />
          ) : null}
          {error ? (
            <div style={{ padding: '0 12px', fontSize: 13, color: colors.danger }}>{error}</div>
          ) : null}
          {notice && !error ? (
            <div style={{ padding: '0 12px', fontSize: 13, color: colors.textSecondary }}>
              {notice}
            </div>
          ) : null}
        </>
      }
    >
      <Table<ReportRow>
        rowKey="id"
        loading={loading}
        {...getAdminTableProps(columns)}
        dataSource={rows}
        locale={{
          emptyText: <Empty description={noBoundShops ? '未绑定门店，暂无数据' : '暂无报损单'} />
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (count) => `共 ${count} 条`,
          onChange: setPage
        }}
      />

      <Modal
        title="新建报损单"
        open={createOpen}
        onCancel={closeCreate}
        onOk={submitCreate}
        okText="保存草稿"
        confirmLoading={creating}
        width={880}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {createError ? (
            <div style={{ color: colors.danger, fontSize: 13 }}>{createError}</div>
          ) : null}

          <Space size={12} wrap>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={createSubject}
              onChange={(event) => {
                setCreateSubject(event.target.value);
                setOptions([]);
                setQtyDraft({});
              }}
              options={SUBJECT_OPTIONS}
            />
            {createSubject === 'shop' ? (
              <Select
                placeholder="选择门店"
                style={{ width: 220 }}
                value={createShopId}
                onChange={setCreateShopId}
                showSearch
                optionFilterProp="label"
                options={shops.map((row) => ({ value: row.id, label: row.name }))}
              />
            ) : (
              <Select
                placeholder="选择仓库"
                style={{ width: 220 }}
                value={createWarehouseId}
                onChange={setCreateWarehouseId}
                showSearch
                optionFilterProp="label"
                options={warehouses
                  .filter((row) => !row.status || row.status === 'active')
                  .map((row) => ({ value: row.id, label: row.name }))}
              />
            )}
            <Select<ReasonCategory>
              value={createReason}
              onChange={setCreateReason}
              style={{ width: 140 }}
              options={REASON_OPTIONS}
            />
            <Input
              placeholder="备注（可选）"
              style={{ width: 220 }}
              value={createRemark}
              onChange={(event) => setCreateRemark(event.target.value)}
              maxLength={500}
            />
            <Button loading={filling} disabled={!createSubjectId} onClick={() => void fillLowStock()}>
              从低库存带入
            </Button>
          </Space>

          {createSubject === 'shop' && !canInventoryWrite ? (
            <div style={{ fontSize: 13, color: colors.danger }}>
              当前账号没有 inventory.write 权限，不能提交门店报损。
            </div>
          ) : null}
          {createSubject === 'warehouse' && !canWarehouseWrite ? (
            <div style={{ fontSize: 13, color: colors.danger }}>
              当前账号没有 warehouse.write 权限，不能提交仓内报损。
            </div>
          ) : null}

          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            草稿不扣库存；审核通过后才按当前均价扣减
            {createSubject === 'shop' ? '门店库存' : '仓库可用库存（数量 - 预留）'}并写损耗流水。
          </div>

          <Table<StockOption>
            rowKey="skuId"
            size="small"
            loading={optionsLoading}
            {...getAdminTableProps(createColumns)}
            dataSource={options}
            pagination={false}
            scroll={{ x: 'max-content', y: 320 }}
            locale={{
              emptyText: (
                <Empty description={createSubjectId ? '该主体暂无库存规格' : '请先选择门店或仓库'} />
              )
            }}
          />

          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            已选 <b style={{ color: colors.text }}>{selectedItems.length}</b> 个规格，数量合计{' '}
            <b style={{ color: colors.text }}>{selectedTotal.toFixed(2)}</b>
          </div>
        </Space>
      </Modal>

      <Drawer
        title={detail ? `报损单 ${detail.reportNo}` : '报损单详情'}
        size={920}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        destroyOnHidden
      >
        {detailError ? (
          <div style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{detailError}</div>
        ) : null}

        {detail ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Space size={8} wrap>
              <Tag color={STATUS_META[detail.status]?.color}>
                {STATUS_META[detail.status]?.label ?? detail.status}
              </Tag>
              {detail.status === 'draft' && canReviewDetail ? (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={actionBusy === 'submit'}
                  onClick={() => void submitReport()}
                >
                  提交
                </Button>
              ) : null}
              {detail.status === 'submitted' && canReviewDetail ? (
                <>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={() => openReview('approve')}
                  >
                    审核通过
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => openReview('reject')}>
                    驳回
                  </Button>
                </>
              ) : null}
              <Button loading={detailLoading} onClick={() => void loadDetail(detail.id)}>
                刷新
              </Button>
            </Space>

            <Descriptions
              size="small"
              column={3}
              items={[
                { key: 'subjectType', label: '主体类型', children: detail.subjectTypeLabel },
                { key: 'subjectName', label: '门店 / 仓库', children: detail.subjectName ?? '—' },
                { key: 'reason', label: '报损原因', children: detail.reasonLabel },
                { key: 'created', label: '创建时间', children: formatTime(detail.createdAt) },
                { key: 'submitted', label: '提交时间', children: formatTime(detail.submittedAt) },
                { key: 'reviewed', label: '审核时间', children: formatTime(detail.reviewedAt) },
                { key: 'remark', label: '备注', children: detail.remark || '—', span: 2 },
                {
                  key: 'reviewNote',
                  label: detail.status === 'rejected' ? '驳回原因' : '审核意见',
                  children: detail.reviewNote || '—'
                }
              ]}
            />

            <Space size={20} wrap style={{ fontSize: 13, color: colors.textSecondary }}>
              <span>
                规格数 <b style={{ color: colors.text }}>{detail.items.length}</b>
              </span>
              <span>
                数量合计{' '}
                <b style={{ color: colors.text }}>
                  {toNumber(detail.totalQuantity).toFixed(2)}
                </b>
              </span>
              <span>
                金额合计{' '}
                <b style={{ color: colors.text }}>¥{toNumber(detail.totalAmount).toFixed(2)}</b>
              </span>
              {detail.status === 'approved' ? (
                <Tag color="green">已按均价扣减库存并记损耗流水</Tag>
              ) : null}
            </Space>

            <Table<ReportItem>
              rowKey="id"
              size="small"
              {...getAdminTableProps(detailItemColumns)}
              dataSource={detail.items}
              pagination={false}
            />

            {detail.events.length > 0 ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, color: colors.text }}>审核记录</div>
                <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                  {detail.events
                    .slice()
                    .reverse()
                    .map((event) => (
                      <div
                        key={event.id}
                        style={{ fontSize: 13, color: colors.textSecondary }}
                      >
                        {formatTime(event.createdAt)} · {event.operatorName ?? '系统'} ·{' '}
                        {STATUS_META[event.toStatus as ReportStatus]?.label ?? event.toStatus}
                        {event.reason ? ` · ${event.reason}` : ''}
                      </div>
                    ))}
                </Space>
              </div>
            ) : null}
          </Space>
        ) : (
          <Empty description={detailLoading ? '加载中' : '暂无数据'} />
        )}
      </Drawer>

      <Modal
        title={reviewOpen === 'approve' ? '审核通过' : '驳回报损单'}
        open={Boolean(reviewOpen)}
        onCancel={() => {
          if (!reviewing) setReviewOpen(null);
        }}
        onOk={submitReview}
        okText={reviewOpen === 'approve' ? '确认通过' : '确认驳回'}
        okButtonProps={{ danger: reviewOpen === 'reject' }}
        confirmLoading={reviewing}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {reviewError ? (
            <div style={{ color: colors.danger, fontSize: 13 }}>{reviewError}</div>
          ) : null}
          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            {reviewOpen === 'approve'
              ? '通过后立即按当前均价扣减库存，并写一条 waste 损耗流水；该操作不可撤销。'
              : '驳回后单据进入终态，不能再审批，库存不变。'}
          </div>
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder={reviewOpen === 'approve' ? '审核意见（可选）' : '驳回原因（必填）'}
            value={reviewReason}
            onChange={(event) => setReviewReason(event.target.value)}
          />
        </Space>
      </Modal>
    </AdminListPage>
  );
}
