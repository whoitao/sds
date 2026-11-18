'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

type TransferStatus = 'draft' | 'allocated' | 'shipped' | 'received' | 'cancelled';
type DifferenceReason = 'shortage' | 'damaged' | 'expired' | 'spec_mismatch' | 'other';
type ActionKind = 'allocate' | 'ship' | 'receive' | 'cancel' | 'close';

interface WarehouseOption {
  id: string;
  name: string;
  status?: string;
}

interface ShopOption {
  id: string;
  name: string;
  status?: string;
}

interface TransferRow {
  id: string;
  transferNo: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toShopId: string;
  toShopName: string;
  status: TransferStatus;
  statusLabel: string;
  deliveryDate: string | null;
  itemCount: number;
  requestedTotal: string;
  shippedTotal: string;
  receivedTotal: string;
  lossTotal: string;
  lossAmountTotal: string;
  differenceClosedAt: string | null;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  remark: string | null;
}

interface TransferItem {
  id: string;
  catalogSkuId: string;
  catalogProductName: string;
  catalogSpecName: string | null;
  productSkuSpecName: string | null;
  unit: string;
  requestedQuantity: string;
  allocatedQuantity: string;
  shippedQuantity: string;
  receivedQuantity: string;
  differenceReason: DifferenceReason | null;
  differenceReasonLabel: string | null;
  lossQuantity: string;
  lossAmount: string;
  unitCost: string;
  amount: string;
  mapped: boolean;
  pendingShipQuantity: string;
  pendingReceiveQuantity: string;
  remark: string | null;
}

interface TransferEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  operatorName: string | null;
  reason: string | null;
  createdAt: string;
}

interface TransferDetail extends TransferRow {
  differenceClosed: boolean;
  differenceCloseReason: string | null;
  cancelReason: string | null;
  fullyAllocated: boolean;
  fullyShipped: boolean;
  fullyReceived: boolean;
  partialShipped: boolean;
  partialReceived: boolean;
  hasDifference: boolean;
  totals: {
    requestedQuantity: string;
    allocatedQuantity: string;
    shippedQuantity: string;
    receivedQuantity: string;
    lossQuantity: string;
    lossAmount: string;
  };
  items: TransferItem[];
  events: TransferEvent[];
}

interface TransferOption {
  catalogSkuId: string;
  catalogProductId: string;
  productName: string;
  specName: string | null;
  unit: string;
  quantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  avgUnitCost: string;
  minThreshold: string;
  maxThreshold: string | null;
  /** 可用量 <= 下限；只提示，不阻断下单 */
  lowStock: boolean;
  productSkuId: string | null;
  mapped: boolean;
}

type FromDemandAction = 'created' | 'reused' | 'skipped';

interface FromDemandLine {
  catalogSkuId: string;
  productSkuId: string;
  productName: string;
  specName: string | null;
  unit: string;
  requestedQuantity: string;
  availableQuantity: string;
  gapQuantity: string;
  hasGap: boolean;
  stockMissing: boolean;
}

interface FromDemandUnmappable {
  productSkuId: string;
  itemName: string;
  specName: string | null;
  unit: string;
  requestedQuantity: string;
  reasonCode: string;
  reason: string;
}

interface FromDemandShopPlan {
  shopId: string;
  shopName: string;
  action: FromDemandAction;
  transferId: string | null;
  transferNo: string | null;
  reasonCode: string | null;
  reason: string | null;
  requisitionNos: string[];
  lines: FromDemandLine[];
  unmappable: FromDemandUnmappable[];
  lineCount: number;
  requestedTotal: string;
  availableTotal: string;
  gapTotal: string;
}

interface FromDemandResult {
  preview: boolean;
  warehouse: { id: string; name: string };
  deliveryDate: string;
  onlyApproved: boolean;
  summary: {
    shopCount: number;
    createdCount: number;
    reusedCount: number;
    skippedCount: number;
    lineCount: number;
    gapLineCount: number;
    unmappableCount: number;
    requestedTotal: string;
    gapTotal: string;
  };
  shops: FromDemandShopPlan[];
}

interface ActionLine {
  itemId: string;
  quantity: number | null;
  reason: DifferenceReason | '';
  /** 当前值 / 上限，用于展示与校验 */
  current: number;
  max: number;
  unit: string;
}
const STATUS_META: Record<TransferStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  allocated: { label: '已分配', color: 'processing' },
  shipped: { label: '已发出', color: 'gold' },
  received: { label: '已收货', color: 'success' },
  cancelled: { label: '已取消', color: 'default' }
};

const DIFFERENCE_REASON_OPTIONS: Array<{ value: DifferenceReason; label: string }> = [
  { value: 'shortage', label: '短装' },
  { value: 'damaged', label: '破损' },
  { value: 'expired', label: '过期' },
  { value: 'spec_mismatch', label: '规格不符' },
  { value: 'other', label: '其他' }
];

const ACTION_META: Record<ActionKind, { title: string; okText: string }> = {
  allocate: { title: '分配库存', okText: '确认分配' },
  ship: { title: '确认发货', okText: '确认发货' },
  receive: { title: '门店收货', okText: '确认收货' },
  cancel: { title: '取消分拨单', okText: '确认取消' },
  close: { title: '差异关闭（按损耗处理）', okText: '确认关闭差异' }
};

const FROM_DEMAND_META: Record<FromDemandAction, { label: string; color: string }> = {
  created: { label: '新建草稿', color: 'green' },
  reused: { label: '复用草稿', color: 'orange' },
  skipped: { label: '跳过', color: 'default' }
};

const ERROR_HINTS: Record<string, string> = {
  FORBIDDEN: '当前账号没有该操作权限，请联系超级管理员',
  NOT_FOUND: '分拨单不存在或已被删除',
  TRANSFER_NOT_ALLOCATABLE: '只有草稿分拨单可以分配',
  TRANSFER_ALLOCATE_EXCEEDS_REQUEST: '分配数量不能超过申请数量',
  TRANSFER_ALLOCATE_UNCHANGED: '分配数量没有变化，请调整后再提交',
  WAREHOUSE_STOCK_INSUFFICIENT: '仓库可用库存不足，请调低分配数量',
  WAREHOUSE_STOCK_MISSING: '仓库没有该规格的库存记录',
  TRANSFER_NOT_ALLOCATED: '请先完成分配再发货',
  TRANSFER_ALREADY_SHIPPED: '该分拨单已全部发出，请勿重复发货',
  TRANSFER_SHIP_QUANTITY_DECREASED: '发出数量不能小于已发出数量',
  TRANSFER_SHIP_EXCEEDS_ALLOCATED: '发出数量不能超过已分配数量',
  TRANSFER_SHIP_QUANTITY_UNCHANGED: '发出数量没有变化，请调整后再提交',
  TRANSFER_ALREADY_RECEIVED: '该分拨单已收货，不能重复操作',
  TRANSFER_NOT_SHIPPED: '分拨单尚未全部发出，不能收货',
  TRANSFER_RECEIVE_QUANTITY_DECREASED: '实收数量不能小于已收数量',
  TRANSFER_RECEIVE_EXCEEDS_SHIPPED: '实收数量不能超过发出数量',
  TRANSFER_DIFFERENCE_REASON_REQUIRED: '少收时必须选择差异原因',
  TRANSFER_RECEIVE_QUANTITY_UNCHANGED: '实收数量没有变化，请调整后再提交',
  TRANSFER_SKU_UNMAPPED: '存在未映射到门店 SKU 的规格，不能操作',
  TRANSFER_ALREADY_CANCELLED: '该分拨单已取消，请勿重复操作',
  TRANSFER_PARTIALLY_SHIPPED: '已部分或全部发出，不能取消，请走差异关闭',
  TRANSFER_CANCELLED: '该分拨单已取消，不能操作',
  TRANSFER_DIFFERENCE_ALREADY_CLOSED: '该分拨单的差异已关闭，请勿重复操作',
  TRANSFER_NO_DIFFERENCE: '该分拨单已全部收满，没有需要关闭的差异',
  TRANSFER_SHIP_IN_PROGRESS: '上一次发货请求正在处理，请稍后刷新',
  TRANSFER_RECEIVE_IN_PROGRESS: '上一次收货请求正在处理，请稍后刷新',
  TRANSFER_CLOSE_IN_PROGRESS: '上一次差异关闭请求正在处理，请稍后刷新',
  IDEMPOTENCY_CONFLICT: '重复提交的内容不一致，请刷新后重试',
  INVALID_BODY: '提交内容不合法，请检查数量与原因',
  INVALID_QUANTITY: '数量不合法',
  WAREHOUSE_NOT_FOUND: '仓库不存在',
  WAREHOUSE_DISABLED: '仓库已停用，不能生成分拨单',
  TRANSFER_DRAFT_CONFLICT: '该门店当日草稿已存在，请刷新后重试',
  FROM_DEMAND_IN_PROGRESS: '上一次生成请求正在处理，请稍后刷新',
  TEST_DATA_MISMATCH: '测试数据与正式数据混用，请检查数据标记'
};

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemLabel(item: { catalogProductName: string; catalogSpecName: string | null }) {
  return item.catalogSpecName
    ? `${item.catalogProductName} · ${item.catalogSpecName}`
    : item.catalogProductName;
}

function errorMessage(payload: { code?: string; message?: string } | null) {
  const code = payload?.code;
  if (code && ERROR_HINTS[code]) return ERROR_HINTS[code];
  return payload?.message ?? '操作失败';
}

export default function WarehouseTransfersPage() {
  const { pageSize } = useAdminSettings();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);

  const [warehouseId, setWarehouseId] = useState<string>();
  const [shopId, setShopId] = useState<string>();
  const [status, setStatus] = useState<TransferStatus | undefined>();
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  const canWarehouseWrite = permissions.includes('warehouse.write');
  const canInventoryWrite = permissions.includes('inventory.write');

  /* ------------------------------------------------------------ 基础数据 */
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

  const loadShops = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) return;
      setShops((payload.items ?? []) as ShopOption[]);
    } catch {
      // 下拉失败不影响列表
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (shopId) params.set('shopId', shopId);
    if (status) params.set('status', status);
    if (keyword) params.set('keyword', keyword);
    try {
      const response = await fetch(`/api/admin/warehouse-transfers?${params}`, {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(errorMessage(payload));
        return;
      }
      setRows((payload.items ?? []) as TransferRow[]);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [warehouseId, shopId, status, keyword, page, pageSize]);

  useEffect(() => {
    void loadPermissions();
    void loadWarehouses();
    void loadShops();
  }, [loadPermissions, loadWarehouses, loadShops]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------ 新建分拨单 */
  const [createOpen, setCreateOpen] = useState(false);
  const [createWarehouseId, setCreateWarehouseId] = useState<string>();
  const [createShopId, setCreateShopId] = useState<string>();
  const [createRemark, setCreateRemark] = useState('');
  const [options, setOptions] = useState<TransferOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number | null>>({});
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!createOpen || !createWarehouseId || !createShopId) {
      setOptions([]);
      setQtyDraft({});
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setCreateError('');
    const params = new URLSearchParams({
      warehouseId: createWarehouseId,
      shopId: createShopId
    });
    fetch(`/api/admin/warehouse-transfers/options?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setOptions([]);
          setCreateError(errorMessage(payload));
          return;
        }
        setOptions((payload.items ?? []) as TransferOption[]);
        setQtyDraft({});
      })
      .catch(() => {
        if (!cancelled) setCreateError('规格与库存加载失败');
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, createWarehouseId, createShopId]);

  function openCreate() {
    if (!canWarehouseWrite) {
      Modal.warning({
        title: '权限不足',
        content: '当前账号没有 warehouse.write 权限，无法新建分拨单。'
      });
      return;
    }
    setCreateOpen(true);
    setCreateWarehouseId(undefined);
    setCreateShopId(undefined);
    setCreateRemark('');
    setOptions([]);
    setQtyDraft({});
    setCreateError('');
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
  }

  const selectedQtyTotal = useMemo(
    () =>
      Object.values(qtyDraft).reduce<number>(
        (acc, value) => acc + (Number(value) > 0 ? Number(value) : 0),
        0
      ),
    [qtyDraft]
  );

  async function submitCreate() {
    setCreateError('');
    if (!createWarehouseId || !createShopId) {
      setCreateError('请选择来源仓库与目标门店');
      return;
    }
    const items = options
      .filter((option) => option.mapped && Number(option.availableQuantity) > 0)
      .map((option) => ({
        catalogSkuId: option.catalogSkuId,
        requestedQuantity: Number(qtyDraft[option.catalogSkuId] ?? 0)
      }))
      .filter((item) => item.requestedQuantity > 0);
    if (items.length === 0) {
      setCreateError('请至少填写一条规格的申请数量');
      return;
    }
    for (const item of items) {
      const option = options.find((row) => row.catalogSkuId === item.catalogSkuId);
      if (option && item.requestedQuantity > Number(option.availableQuantity)) {
        setCreateError(`${option.productName} 的申请数量不能超过可用库存`);
        return;
      }
    }

    setCreating(true);
    try {
      const response = await fetch('/api/admin/warehouse-transfers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromWarehouseId: createWarehouseId,
          toShopId: createShopId,
          remark: createRemark.trim() || null,
          items: items.map((item) => ({
            catalogSkuId: item.catalogSkuId,
            requestedQuantity: String(item.requestedQuantity)
          }))
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setCreateError(errorMessage(payload));
        return;
      }
      setCreateOpen(false);
      setNotice(`分拨单 ${payload.item?.transferNo ?? ''} 已创建`);
      await load();
      if (payload.item?.id) {
        setDetailOpen(true);
        setDetail(payload.item as TransferDetail);
      }
    } catch {
      setCreateError('接口不可用');
    } finally {
      setCreating(false);
    }
  }

  /* ------------------------------------------------------------ 从要货生成 */
  const [fromDemandOpen, setFromDemandOpen] = useState(false);
  const [fdWarehouseId, setFdWarehouseId] = useState<string>();
  const [fdDeliveryDate, setFdDeliveryDate] = useState(localToday());
  const [fdShopId, setFdShopId] = useState<string>();
  const [fdOnlyApproved, setFdOnlyApproved] = useState(true);
  const [fdPreview, setFdPreview] = useState<FromDemandResult | null>(null);
  const [fdPreviewLoading, setFdPreviewLoading] = useState(false);
  const [fdError, setFdError] = useState('');
  const [fdGenerating, setFdGenerating] = useState(false);
  const [fdResult, setFdResult] = useState<FromDemandResult | null>(null);

  function openFromDemand() {
    if (!canWarehouseWrite) {
      Modal.warning({
        title: '权限不足',
        content: '当前账号没有 warehouse.write 权限，无法从要货生成分拨单。'
      });
      return;
    }
    setFromDemandOpen(true);
    setFdWarehouseId(undefined);
    setFdDeliveryDate(localToday());
    setFdShopId(undefined);
    setFdOnlyApproved(true);
    setFdPreview(null);
    setFdError('');
    setFdResult(null);
  }

  function closeFromDemand() {
    if (fdGenerating) return;
    setFromDemandOpen(false);
  }

  useEffect(() => {
    if (!fromDemandOpen || !fdWarehouseId || !/^\d{4}-\d{2}-\d{2}$/.test(fdDeliveryDate)) {
      setFdPreview(null);
      return;
    }
    let cancelled = false;
    setFdPreviewLoading(true);
    setFdError('');
    setFdPreview(null);
    fetch('/api/admin/warehouse-transfers/from-demand/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        warehouseId: fdWarehouseId,
        deliveryDate: fdDeliveryDate,
        shopId: fdShopId ?? null,
        onlyApproved: fdOnlyApproved
      })
    })
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setFdError(errorMessage(payload));
          return;
        }
        setFdPreview(payload as FromDemandResult);
      })
      .catch(() => {
        if (!cancelled) setFdError('预览加载失败');
      })
      .finally(() => {
        if (!cancelled) setFdPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromDemandOpen, fdWarehouseId, fdDeliveryDate, fdShopId, fdOnlyApproved]);

  async function submitFromDemand() {
    if (!fdWarehouseId) {
      setFdError('请选择来源仓库');
      return;
    }
    setFdError('');
    setFdGenerating(true);
    try {
      const response = await fetch('/api/admin/warehouse-transfers/from-demand', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({
          warehouseId: fdWarehouseId,
          deliveryDate: fdDeliveryDate,
          shopId: fdShopId ?? null,
          onlyApproved: fdOnlyApproved
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setFdError(errorMessage(payload));
        return;
      }
      const result = payload as FromDemandResult;
      setFdResult(result);
      setNotice(
        `从要货生成完成：新建 ${result.summary.createdCount}、复用 ${result.summary.reusedCount}、跳过 ${result.summary.skippedCount}`
      );
      await load();
    } catch {
      setFdError('接口不可用');
    } finally {
      setFdGenerating(false);
    }
  }

  /* ------------------------------------------------------------ 详情与动作 */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [action, setAction] = useState<ActionKind | null>(null);
  const [actionLines, setActionLines] = useState<ActionLine[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [closeReason, setCloseReason] = useState<DifferenceReason>('shortage');
  const [closeRemark, setCloseRemark] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/warehouse-transfers/${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setDetailError(errorMessage(payload));
        return;
      }
      setDetail(payload.item as TransferDetail);
    } catch {
      setDetailError('接口不可用');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openDetail(row: TransferRow) {
    setDetailOpen(true);
    setDetail(null);
    setNotice('');
    void loadDetail(row.id);
  }

  function closeDetail() {
    setDetailOpen(false);
    setAction(null);
  }

  function openAction(kind: ActionKind) {
    if (!detail) return;
    if ((kind === 'allocate' || kind === 'ship' || kind === 'cancel') && !canWarehouseWrite) {
      Modal.warning({
        title: '权限不足',
        content: '当前账号没有 warehouse.write 权限，无法执行该操作。'
      });
      return;
    }
    if ((kind === 'receive' || kind === 'close') && !canInventoryWrite) {
      Modal.warning({
        title: '权限不足',
        content: '当前账号没有 inventory.write 权限，无法执行门店侧操作。'
      });
      return;
    }

    const lines: ActionLine[] =
      kind === 'allocate'
        ? detail.items.map((item) => ({
            itemId: item.id,
            quantity:
              toNumber(item.allocatedQuantity) > 0
                ? toNumber(item.allocatedQuantity)
                : toNumber(item.requestedQuantity),
            reason: '',
            current: toNumber(item.allocatedQuantity),
            max: toNumber(item.requestedQuantity),
            unit: item.unit
          }))
        : kind === 'ship'
          ? detail.items.map((item) => ({
              itemId: item.id,
              quantity:
                toNumber(item.shippedQuantity) > 0
                  ? toNumber(item.shippedQuantity)
                  : toNumber(item.allocatedQuantity),
              reason: '',
              current: toNumber(item.shippedQuantity),
              max: toNumber(item.allocatedQuantity),
              unit: item.unit
            }))
          : detail.items
              .filter((item) => toNumber(item.shippedQuantity) > 0)
              .map((item) => ({
                itemId: item.id,
                quantity: toNumber(item.shippedQuantity),
                reason: item.differenceReason ?? '',
                current: toNumber(item.receivedQuantity),
                max: toNumber(item.shippedQuantity),
                unit: item.unit
              }));

    setActionLines(lines);
    setCancelReason('');
    setCloseReason('shortage');
    setCloseRemark('');
    setActionError('');
    setAction(kind);
  }

  function updateLine(itemId: string, patch: Partial<ActionLine>) {
    setActionLines((current) =>
      current.map((line) => (line.itemId === itemId ? { ...line, ...patch } : line))
    );
  }

  const closeLossPreview = useMemo(() => {
    if (!detail) return { quantity: 0, amount: 0 };
    return detail.items.reduce(
      (acc, item) => {
        const pending = toNumber(item.pendingReceiveQuantity);
        acc.quantity += pending;
        acc.amount += pending * toNumber(item.unitCost);
        return acc;
      },
      { quantity: 0, amount: 0 }
    );
  }, [detail]);

  async function submitAction() {
    if (!detail || !action) return;
    setActionError('');

    let body: Record<string, unknown> = {};
    if (action === 'cancel') {
      if (!cancelReason.trim()) {
        setActionError('请填写取消原因');
        return;
      }
      body = { reason: cancelReason.trim() };
    } else if (action === 'close') {
      body = { differenceReason: closeReason, remark: closeRemark.trim() || null };
    } else {
      for (const line of actionLines) {
        const quantity = Number(line.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity < 0) {
          setActionError('数量不合法');
          return;
        }
        if (action !== 'allocate' && quantity < line.current) {
          setActionError(
            action === 'ship' ? '发出数量不能小于已发出数量' : '实收数量不能小于已收数量'
          );
          return;
        }
        if (quantity > line.max) {
          setActionError(
            action === 'allocate'
              ? '分配数量不能超过申请数量'
              : action === 'ship'
                ? '发出数量不能超过已分配数量'
                : '实收数量不能超过发出数量'
          );
          return;
        }
        if (action === 'receive' && quantity < line.max && !line.reason) {
          setActionError('少收时必须选择差异原因');
          return;
        }
      }
      body = {
        items: actionLines.map((line) => ({
          itemId: line.itemId,
          ...(action === 'allocate'
            ? { allocatedQuantity: String(line.quantity ?? 0) }
            : action === 'ship'
              ? { shippedQuantity: String(line.quantity ?? 0) }
              : {
                  receivedQuantity: String(line.quantity ?? 0),
                  ...(line.reason && Number(line.quantity ?? 0) < line.max
                    ? { differenceReason: line.reason }
                    : {})
                })
        }))
      };
    }

    setActionSubmitting(true);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (action === 'ship' || action === 'receive' || action === 'close') {
        headers['idempotency-key'] = crypto.randomUUID();
      }
      const response = await fetch(`/api/admin/warehouse-transfers/${detail.id}/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        setActionError(errorMessage(payload));
        return;
      }
      setAction(null);
      setNotice(
        action === 'close'
          ? `分拨单 ${detail.transferNo} 差异已关闭，差额按损耗处理`
          : `分拨单 ${detail.transferNo} 操作成功`
      );
      await Promise.all([loadDetail(detail.id), load()]);
    } catch {
      setActionError('接口不可用');
    } finally {
      setActionSubmitting(false);
    }
  }

  /* ------------------------------------------------------------ 列表列 */
  const columns: TableColumnsType<TransferRow> = [
    {
      title: '单号',
      dataIndex: 'transferNo',
      width: 190,
      render: (value: string, row) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openDetail(row)}>
          {value}
        </Button>
      )
    },
    { title: '来源仓', dataIndex: 'fromWarehouseName', width: 140 },
    { title: '目标门店', dataIndex: 'toShopName', width: 160 },
    {
      title: '交付日',
      dataIndex: 'deliveryDate',
      width: 110,
      render: (value: string | null) => value ?? '—'
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 130,
      render: (value: TransferStatus, row) => (
        <Space size={4} wrap>
          <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.label ?? value}</Tag>
          {row.differenceClosedAt ? <Tag color="volcano">差异关闭</Tag> : null}
        </Space>
      )
    },
    { title: '明细行数', dataIndex: 'itemCount', width: 90, align: 'right' },
    {
      title: '申请合计',
      dataIndex: 'requestedTotal',
      width: 100,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '发出合计',
      dataIndex: 'shippedTotal',
      width: 100,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '实收合计',
      dataIndex: 'receivedTotal',
      width: 100,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '损耗',
      dataIndex: 'lossTotal',
      width: 110,
      align: 'right',
      render: (value: string, row) =>
        toNumber(value) > 0 ? (
          <Tooltip title={`损耗金额 ¥${toNumber(row.lossAmountTotal).toFixed(2)}`}>
            <Tag color="volcano">{toNumber(value).toFixed(2)}</Tag>
          </Tooltip>
        ) : (
          '—'
        )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value)
    },
    {
      title: '发货时间',
      dataIndex: 'shippedAt',
      width: 170,
      render: (value: string | null) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      render: (_value, row) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>
          详情
        </Button>
      )
    }
  ];

  /* ------------------------------------------------------------ 新建弹窗列 */
  const optionColumns: TableColumnsType<TransferOption> = [
    {
      title: '商品 / 规格',
      dataIndex: 'productName',
      render: (_value, row) => (
        <div>
          <div style={{ color: colors.text }}>{row.productName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 12 }}>
            {row.specName ?? '默认规格'}
          </div>
        </div>
      )
    },
    { title: '单位', dataIndex: 'unit', width: 70 },
    {
      title: '仓库可用',
      dataIndex: 'availableQuantity',
      width: 120,
      align: 'right',
      render: (value: string, row) => (
        <Space size={4}>
          <Tooltip
            title={`库存 ${toNumber(row.quantity).toFixed(2)} / 预留 ${toNumber(
              row.reservedQuantity
            ).toFixed(2)} / 下限 ${toNumber(row.minThreshold).toFixed(2)}`}
          >
            {toNumber(value).toFixed(2)}
          </Tooltip>
          {row.lowStock ? <Tag color="red">低库存</Tag> : null}
        </Space>
      )
    },
    {
      title: '门店 SKU',
      dataIndex: 'mapped',
      width: 130,
      render: (mapped: boolean) =>
        mapped ? <Tag color="green">已映射</Tag> : <Tag color="red">未映射，禁选</Tag>
    },
    {
      title: '申请数量',
      dataIndex: 'catalogSkuId',
      width: 150,
      render: (_value, row) => {
        const disabled = !row.mapped || Number(row.availableQuantity) <= 0;
        return (
          <InputNumber
            min={0}
            max={Number(row.availableQuantity)}
            precision={2}
            disabled={disabled}
            placeholder={disabled ? '不可申请' : '0'}
            value={qtyDraft[row.catalogSkuId] ?? null}
            onChange={(value) =>
              setQtyDraft((current) => ({ ...current, [row.catalogSkuId]: value ?? null }))
            }
            style={{ width: '100%' }}
          />
        );
      }
    }
  ];

  /* ------------------------------------------------------------ 详情明细列 */
  const detailItemColumns: TableColumnsType<TransferItem> = [
    {
      title: '商品 / 规格',
      dataIndex: 'catalogProductName',
      render: (_value, row) => (
        <div>
          <div style={{ color: colors.text }}>{row.catalogProductName}</div>
          <div style={{ color: colors.textSecondary, fontSize: 12 }}>
            {row.catalogSpecName ?? row.productSkuSpecName ?? '默认规格'}
            {!row.mapped ? <Tag color="red" style={{ marginLeft: 6 }}>未映射</Tag> : null}
          </div>
        </div>
      )
    },
    { title: '单位', dataIndex: 'unit', width: 64 },
    {
      title: '申请',
      dataIndex: 'requestedQuantity',
      width: 84,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '分配',
      dataIndex: 'allocatedQuantity',
      width: 84,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '发出',
      dataIndex: 'shippedQuantity',
      width: 84,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '实收',
      dataIndex: 'receivedQuantity',
      width: 84,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '未收',
      dataIndex: 'pendingReceiveQuantity',
      width: 84,
      align: 'right',
      render: (value: string) =>
        toNumber(value) > 0 ? (
          <span style={{ color: colors.danger }}>{toNumber(value).toFixed(2)}</span>
        ) : (
          '0.00'
        )
    },
    {
      title: '差异原因',
      dataIndex: 'differenceReasonLabel',
      width: 110,
      render: (value: string | null) => value ?? '—'
    },
    {
      title: '成本',
      dataIndex: 'unitCost',
      width: 90,
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
    {
      title: '损耗',
      dataIndex: 'lossQuantity',
      width: 150,
      align: 'right',
      render: (value: string, row) =>
        toNumber(value) > 0 ? (
          <span style={{ color: colors.danger }}>
            {toNumber(value).toFixed(2)} / ¥{toNumber(row.lossAmount).toFixed(2)}
          </span>
        ) : (
          '—'
        )
    }
  ];

  /* ------------------------------------------------------------ 动作弹窗列 */
  const actionLineColumns: TableColumnsType<ActionLine> = [
    {
      title: '商品 / 规格',
      dataIndex: 'itemId',
      render: (_value, line) => {
        const item = detail?.items.find((row) => row.id === line.itemId);
        return item ? itemLabel(item) : line.itemId;
      }
    },
    { title: '单位', dataIndex: 'unit', width: 64 },
    {
      title: '当前',
      dataIndex: 'current',
      width: 84,
      align: 'right',
      render: (value: number) => value.toFixed(2)
    },
    {
      title: '上限',
      dataIndex: 'max',
      width: 84,
      align: 'right',
      render: (value: number) => value.toFixed(2)
    },
    {
      title: action === 'receive' ? '累计实收' : action === 'ship' ? '累计发出' : '分配数量',
      dataIndex: 'quantity',
      width: 150,
      render: (_value, line) => (
        <InputNumber
          min={action === 'allocate' ? 0 : line.current}
          max={line.max}
          precision={2}
          value={line.quantity}
          onChange={(value) => updateLine(line.itemId, { quantity: value ?? null })}
          style={{ width: '100%' }}
        />
      )
    },
    ...(action === 'receive'
      ? [
          {
            title: '差异原因',
            dataIndex: 'reason',
            width: 150,
            render: (_value: unknown, line: ActionLine) =>
              Number(line.quantity ?? 0) < line.max ? (
                <Select<DifferenceReason>
                  placeholder="必填"
                  value={line.reason || undefined}
                  options={DIFFERENCE_REASON_OPTIONS}
                  onChange={(value) => updateLine(line.itemId, { reason: value })}
                  style={{ width: '100%' }}
                />
              ) : (
                <span style={{ color: colors.textSecondary }}>无差异</span>
              )
          }
        ]
      : [])
  ];

  const actionItem = detail;
  const actionTitle = action ? ACTION_META[action].title : '';
  const actionOkText = action ? ACTION_META[action].okText : '确定';

  /* ------------------------------------------------------------ 从要货生成视图 */
  const fromDemandView = fdResult ?? fdPreview;
  const fromDemandColumns: TableColumnsType<FromDemandShopPlan> = [
    {
      title: '门店',
      dataIndex: 'shopName',
      render: (value: string, row) => (
        <div>
          <div style={{ color: colors.text }}>{value}</div>
          <div style={{ color: colors.textSecondary, fontSize: 12 }}>
            {row.requisitionNos.join('、')}
          </div>
        </div>
      )
    },
    {
      title: '处理',
      dataIndex: 'action',
      width: 110,
      render: (value: FromDemandAction) => (
        <Tag color={FROM_DEMAND_META[value].color}>{FROM_DEMAND_META[value].label}</Tag>
      )
    },
    {
      title: '单号',
      dataIndex: 'transferNo',
      width: 170,
      render: (value: string | null) => value ?? '—'
    },
    { title: '行数', dataIndex: 'lineCount', width: 70, align: 'right' },
    {
      title: '申请合计',
      dataIndex: 'requestedTotal',
      width: 100,
      align: 'right',
      render: (value: string) => toNumber(value).toFixed(2)
    },
    {
      title: '缺口',
      dataIndex: 'gapTotal',
      width: 90,
      align: 'right',
      render: (value: string) =>
        toNumber(value) > 0 ? (
          <span style={{ color: colors.danger }}>{toNumber(value).toFixed(2)}</span>
        ) : (
          '—'
        )
    },
    {
      title: '无法生成',
      dataIndex: 'unmappable',
      width: 90,
      align: 'right',
      render: (rows: FromDemandUnmappable[]) =>
        rows.length > 0 ? <Tag color="red">{rows.length}</Tag> : '—'
    },
    {
      title: '说明',
      dataIndex: 'reason',
      render: (value: string | null) => value ?? '—'
    }
  ];

  function renderFromDemandDetail(shop: FromDemandShopPlan) {
    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {shop.lines.length > 0 ? (
          <Table<FromDemandLine>
            rowKey="catalogSkuId"
            size="small"
            pagination={false}
            dataSource={shop.lines}
            columns={[
              {
                title: '商品 / 规格',
                dataIndex: 'productName',
                render: (_value, line) => (
                  <span>
                    {line.productName}
                    <span style={{ color: colors.textSecondary, marginLeft: 6 }}>
                      {line.specName ?? '默认规格'}
                    </span>
                  </span>
                )
              },
              { title: '单位', dataIndex: 'unit', width: 60 },
              {
                title: '申请',
                dataIndex: 'requestedQuantity',
                width: 90,
                align: 'right',
                render: (value: string) => toNumber(value).toFixed(2)
              },
              {
                title: '仓库可用',
                dataIndex: 'availableQuantity',
                width: 100,
                align: 'right',
                render: (value: string, line) => (
                  <Space size={4}>
                    {toNumber(value).toFixed(2)}
                    {line.stockMissing ? <Tag color="red">无库存行</Tag> : null}
                  </Space>
                )
              },
              {
                title: '缺口',
                dataIndex: 'gapQuantity',
                width: 90,
                align: 'right',
                render: (value: string, line) =>
                  line.hasGap ? (
                    <span style={{ color: colors.danger }}>{toNumber(value).toFixed(2)}</span>
                  ) : (
                    '—'
                  )
              }
            ]}
          />
        ) : null}
        {shop.unmappable.length > 0 ? (
          <div style={{ fontSize: 13 }}>
            <div style={{ color: colors.danger, marginBottom: 4 }}>无法生成：</div>
            {shop.unmappable.map((row) => (
              <div key={`${row.productSkuId}-${row.reasonCode}`} style={{ color: colors.textSecondary }}>
                {row.itemName}（{row.specName ?? '默认规格'}）申请 {toNumber(row.requestedQuantity).toFixed(2)}
                {' — '}
                {row.reason}
              </div>
            ))}
          </div>
        ) : null}
        {shop.lines.length === 0 && shop.unmappable.length === 0 ? (
          <span style={{ color: colors.textSecondary }}>没有可汇总的要货明细</span>
        ) : null}
      </Space>
    );
  }


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="admin-page-bar admin-page-bar--wrap">
        <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>分拨管理</span>
        <Space size={8} wrap>
          <Select
            allowClear
            placeholder="来源仓"
            style={{ width: 170 }}
            value={warehouseId}
            onChange={(value) => {
              setWarehouseId(value);
              setPage(1);
            }}
            options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
          />
          <Select
            allowClear
            placeholder="目标门店"
            style={{ width: 180 }}
            value={shopId}
            onChange={(value) => {
              setShopId(value);
              setPage(1);
            }}
            options={shops.map((row) => ({ value: row.id, label: row.name }))}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
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
          <Input
            allowClear
            placeholder="单号 / 仓库 / 门店"
            style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onPressEnter={() => {
              setKeyword(keywordInput.trim());
              setPage(1);
            }}
          />
          <Button
            icon={<SearchOutlined />}
            onClick={() => {
              setKeyword(keywordInput.trim());
              setPage(1);
            }}
          >
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建分拨单
          </Button>
          <Button onClick={openFromDemand}>从要货生成</Button>
          <TestDataCleanupButton onCleaned={load} />
        </Space>
      </div>

      {error ? (
        <div style={{ padding: '0 12px', fontSize: 13, color: colors.danger }}>{error}</div>
      ) : null}
      {notice && !error ? (
        <div style={{ padding: '0 12px', fontSize: 13, color: colors.textSecondary }}>{notice}</div>
      ) : null}

      <Table<TransferRow>
        rowKey="id"
        loading={loading}
        {...getAdminTableProps(columns)}
        dataSource={rows}
        locale={{ emptyText: <Empty description="暂无分拨单" /> }}
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
        title="新建分拨单"
        open={createOpen}
        onCancel={closeCreate}
        onOk={submitCreate}
        okText="创建草稿"
        confirmLoading={creating}
        width={860}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Select
              placeholder="选择来源仓库"
              style={{ width: 240 }}
              value={createWarehouseId}
              onChange={setCreateWarehouseId}
              options={warehouses
                .filter((row) => !row.status || row.status === 'active')
                .map((row) => ({ value: row.id, label: row.name }))}
            />
            <Select
              placeholder="选择目标门店"
              style={{ width: 240 }}
              value={createShopId}
              onChange={setCreateShopId}
              options={shops.map((row) => ({ value: row.id, label: row.name }))}
            />
            <Input
              placeholder="备注（可选）"
              style={{ width: 260 }}
              value={createRemark}
              onChange={(event) => setCreateRemark(event.target.value)}
              maxLength={500}
            />
          </Space>

          {createError ? (
            <div style={{ color: colors.danger, fontSize: 13 }}>{createError}</div>
          ) : null}

          {!createWarehouseId || !createShopId ? (
            <Empty description="选择来源仓库与目标门店后，按仓库可用库存选择规格" />
          ) : (
            <Table<TransferOption>
              rowKey="catalogSkuId"
              size="small"
              loading={optionsLoading}
              {...getAdminTableProps(optionColumns)}
              dataSource={options}
              pagination={false}
              locale={{ emptyText: <Empty description="该仓库暂无可用规格" /> }}
            />
          )}

          <div style={{ color: colors.textSecondary, fontSize: 13 }}>
            已填申请合计：{selectedQtyTotal.toFixed(2)}；未映射门店 SKU 或可用库存为 0 的规格不可填写。
          </div>
        </Space>
      </Modal>

      <Modal
        title={fdResult ? '从要货生成结果' : '从要货生成草稿分拨单'}
        open={fromDemandOpen}
        onCancel={closeFromDemand}
        onOk={submitFromDemand}
        okText="确认生成"
        confirmLoading={fdGenerating}
        okButtonProps={{
          disabled: Boolean(fdResult) || !fromDemandView || fromDemandView.summary.lineCount === 0
        }}
        footer={
          fdResult ? (
            <Button type="primary" onClick={() => setFromDemandOpen(false)}>
              查看列表
            </Button>
          ) : undefined
        }
        width={980}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Select
              placeholder="选择来源仓库"
              style={{ width: 220 }}
              value={fdWarehouseId}
              onChange={setFdWarehouseId}
              disabled={Boolean(fdResult)}
              options={warehouses
                .filter((row) => !row.status || row.status === 'active')
                .map((row) => ({ value: row.id, label: row.name }))}
            />
            <Input
              type="date"
              style={{ width: 170 }}
              value={fdDeliveryDate}
              onChange={(event) => setFdDeliveryDate(event.target.value)}
              disabled={Boolean(fdResult)}
            />
            <Select
              allowClear
              placeholder="全部门店"
              style={{ width: 190 }}
              value={fdShopId}
              onChange={setFdShopId}
              disabled={Boolean(fdResult)}
              options={shops.map((row) => ({ value: row.id, label: row.name }))}
            />
            <Select
              style={{ width: 150 }}
              value={fdOnlyApproved ? 'approved' : 'all'}
              onChange={(value) => setFdOnlyApproved(value === 'approved')}
              disabled={Boolean(fdResult)}
              options={[
                { value: 'approved', label: '仅已审核' },
                { value: 'all', label: '含已提交' }
              ]}
            />
          </Space>

          {fdError ? <Alert type="error" showIcon title={fdError} /> : null}

          {fromDemandView ? (
            <Alert
              type={
                fromDemandView.preview
                  ? 'info'
                  : fromDemandView.summary.createdCount + fromDemandView.summary.reusedCount > 0
                    ? 'success'
                    : 'warning'
              }
              showIcon
              title={`${fromDemandView.preview ? '预计' : '已处理'}：新建 ${fromDemandView.summary.createdCount} 张、复用 ${fromDemandView.summary.reusedCount} 张、跳过 ${fromDemandView.summary.skippedCount} 张`}
              description={`明细 ${fromDemandView.summary.lineCount} 行，缺口 ${fromDemandView.summary.gapLineCount} 行，无法生成 ${fromDemandView.summary.unmappableCount} 项；申请合计 ${toNumber(fromDemandView.summary.requestedTotal).toFixed(2)}，缺口合计 ${toNumber(fromDemandView.summary.gapTotal).toFixed(2)}。`}
            />
          ) : null}

          {!fdWarehouseId ? (
            <Empty description="选择来源仓库与交付日后自动预览" />
          ) : (
            <Table<FromDemandShopPlan>
              rowKey="shopId"
              size="small"
              loading={fdPreviewLoading && !fdResult}
              {...getAdminTableProps(fromDemandColumns)}
              dataSource={fromDemandView?.shops ?? []}
              pagination={false}
              expandable={{ expandedRowRender: renderFromDemandDetail }}
              locale={{ emptyText: <Empty description="该仓库与交付日没有可生成的已审核要货单" /> }}
            />
          )}

          <div style={{ color: colors.textSecondary, fontSize: 12 }}>
            生成规则：同一门店 + 同一交付日只生成一张草稿；已存在未分配草稿时复用并更新数量，
            已分配/已发出则跳过以免改动在途数量；仓库可用量不足只标记缺口，不阻断生成。
          </div>
        </Space>
      </Modal>

      <Drawer
        title={
          actionItem ? (
            <Space size={8} wrap>
              <span>{actionItem.transferNo}</span>
              <Tag color={STATUS_META[actionItem.status]?.color}>
                {STATUS_META[actionItem.status]?.label ?? actionItem.status}
              </Tag>
              {actionItem.differenceClosed ? <Tag color="volcano">差异关闭</Tag> : null}
            </Space>
          ) : (
            '分拨单详情'
          )
        }
        size={980}
        open={detailOpen}
        onClose={closeDetail}
        destroyOnHidden
      >
        {detailError ? (
          <div style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{detailError}</div>
        ) : null}

        {detailLoading && !detail ? (
          <div style={{ color: colors.textSecondary }}>加载中…</div>
        ) : detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space size={8} wrap>
              {detail.status === 'draft' ? (
                <Button type="primary" onClick={() => openAction('allocate')}>
                  分配
                </Button>
              ) : null}
              {detail.status === 'allocated' ? (
                <Button type="primary" onClick={() => openAction('ship')}>
                  发货
                </Button>
              ) : null}
              {detail.status === 'shipped' ? (
                <Button type="primary" onClick={() => openAction('receive')}>
                  收货
                </Button>
              ) : null}
              {detail.status === 'shipped' && detail.hasDifference ? (
                <Button danger onClick={() => openAction('close')}>
                  差异关闭
                </Button>
              ) : null}
              {detail.status === 'draft' || detail.status === 'allocated' ? (
                <Button danger onClick={() => openAction('cancel')}>
                  取消
                </Button>
              ) : null}
              <Button onClick={() => void loadDetail(detail.id)}>刷新</Button>
            </Space>

            <Descriptions
              size="small"
              column={3}
              items={[
                { key: 'warehouse', label: '来源仓', children: detail.fromWarehouseName },
                { key: 'shop', label: '目标门店', children: detail.toShopName },
                { key: 'delivery', label: '交付日', children: detail.deliveryDate ?? '—' },
                { key: 'created', label: '创建时间', children: formatTime(detail.createdAt) },
                {
                  key: 'shipped',
                  label: '发货时间',
                  children: formatTime(detail.shippedAt)
                },
                {
                  key: 'received',
                  label: '收货时间',
                  children: formatTime(detail.receivedAt)
                },
                {
                  key: 'closed',
                  label: '差异关闭时间',
                  children: formatTime(detail.differenceClosedAt)
                },
                {
                  key: 'remark',
                  label: '备注',
                  children: detail.remark || '—',
                  span: 2
                },
                {
                  key: 'closeReason',
                  label: '差异关闭备注',
                  children: detail.differenceCloseReason || '—'
                },
                ...(detail.cancelReason
                  ? [
                      {
                        key: 'cancelReason',
                        label: '取消原因',
                        children: detail.cancelReason,
                        span: 2
                      }
                    ]
                  : [])
              ]}
            />

            <Space size={20} wrap style={{ fontSize: 13, color: colors.textSecondary }}>
              <span>
                申请合计 <b style={{ color: colors.text }}>{toNumber(detail.totals.requestedQuantity).toFixed(2)}</b>
              </span>
              <span>
                分配合计 <b style={{ color: colors.text }}>{toNumber(detail.totals.allocatedQuantity).toFixed(2)}</b>
              </span>
              <span>
                发出合计 <b style={{ color: colors.text }}>{toNumber(detail.totals.shippedQuantity).toFixed(2)}</b>
              </span>
              <span>
                实收合计 <b style={{ color: colors.text }}>{toNumber(detail.totals.receivedQuantity).toFixed(2)}</b>
              </span>
              {toNumber(detail.totals.lossQuantity) > 0 ? (
                <Tag color="volcano">
                  损耗 {toNumber(detail.totals.lossQuantity).toFixed(2)} / ¥
                  {toNumber(detail.totals.lossAmount).toFixed(2)}
                </Tag>
              ) : null}
            </Space>

            <Table<TransferItem>
              rowKey="id"
              size="small"
              {...getAdminTableProps(detailItemColumns)}
              dataSource={detail.items}
              pagination={false}
            />

            {detail.events.length > 0 ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, color: colors.text }}>操作记录</div>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {detail.events.slice(-8).reverse().map((event) => (
                    <div
                      key={event.id}
                      style={{ fontSize: 13, color: colors.textSecondary }}
                    >
                      {formatTime(event.createdAt)} · {event.operatorName ?? '系统'} ·{' '}
                      {STATUS_META[event.toStatus as TransferStatus]?.label ?? event.toStatus}
                      {event.reason ? ` · ${event.reason}` : ''}
                    </div>
                  ))}
                </Space>
              </div>
            ) : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title={actionTitle}
        open={Boolean(action)}
        onCancel={() => {
          if (!actionSubmitting) setAction(null);
        }}
        onOk={submitAction}
        okText={actionOkText}
        okButtonProps={{ danger: action === 'cancel' || action === 'close' }}
        confirmLoading={actionSubmitting}
        width={action === 'cancel' || action === 'close' ? 560 : 860}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {actionError ? (
            <div style={{ color: colors.danger, fontSize: 13 }}>{actionError}</div>
          ) : null}

          {action === 'cancel' ? (
            <Input.TextArea
              rows={4}
              maxLength={200}
              placeholder="请填写取消原因（必填）"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          ) : null}

          {action === 'close' ? (
            <>
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                将把剩余未收数量按损耗关闭，门店库存不会再次变动。预计放弃{' '}
                <b style={{ color: colors.danger }}>{closeLossPreview.quantity.toFixed(2)}</b>，损耗金额{' '}
                <b style={{ color: colors.danger }}>¥{closeLossPreview.amount.toFixed(2)}</b>。
              </div>
              <Select<DifferenceReason>
                value={closeReason}
                onChange={setCloseReason}
                options={DIFFERENCE_REASON_OPTIONS}
                style={{ width: '100%' }}
              />
              <Input.TextArea
                rows={3}
                maxLength={500}
                placeholder="差异说明（可选）"
                value={closeRemark}
                onChange={(event) => setCloseRemark(event.target.value)}
              />
            </>
          ) : null}

          {action && action !== 'cancel' && action !== 'close' ? (
            <>
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                数量均为「累计数量」；填写值不能小于当前值，也不能超过上限。
              </div>
              <Table<ActionLine>
                rowKey="itemId"
                size="small"
                {...getAdminTableProps(actionLineColumns)}
                dataSource={actionLines}
                pagination={false}
              />
            </>
          ) : null}
        </Space>
      </Modal>
    </div>
  );
}
