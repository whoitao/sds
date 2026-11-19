'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Descriptions, Empty, Input, Modal, Select, Space, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { getAdminTableProps } from '../../../lib/table';
import {
  AdminFilterField,
  AdminListPage
} from '../../../components/AdminListPage';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';
import { useConfirmDanger } from '../../../components/AdminConfirmProvider';

interface ShopOption {
  id: string;
  name: string;
}

interface SupplierRow {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  status: 'active' | 'disabled';
}

interface PurchaseRow {
  id: string;
  shopId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  poNo: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierPhone: string | null;
  demandPlanId: string | null;
  demandPlanNo: string | null;
  status: 'draft' | 'submitted' | 'received' | 'cancelled';
  orderedAmount: string;
  receivedAmount: string;
  expectedAt: string | null;
  submittedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  remark: string | null;
  createdAt: string;
  itemCount: number;
  receivedLineCount?: number;
}

interface PurchaseDetailItem {
  id: string;
  productSkuId: string | null;
  catalogSkuId: string | null;
  productName: string | null;
  specName: string | null;
  itemName: string;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  quantity: string;
  unitCost: string;
  receivedQuantity: string;
  amount: string;
  differenceReason: string | null;
}

interface PurchaseReceiptItem {
  id: string;
  purchaseOrderItemId: string;
  itemName: string;
  unit: string;
  expectedQuantity: string;
  receivedQuantity: string;
  qualifiedQuantity: string;
  rejectedQuantity: string;
  unitCost: string;
  amount: string;
  differenceReason: string | null;
  remark: string | null;
}

interface PurchaseReceipt {
  id: string;
  receiptNo: string;
  status: string;
  receivedAt: string;
  receivedAmount: string;
  remark: string | null;
  items: PurchaseReceiptItem[];
}

interface PurchaseDetail extends PurchaseRow {
  receivedLineCount: number;
  items: PurchaseDetailItem[];
  receipts: PurchaseReceipt[];
}

interface InventoryOption {
  skuId: string;
  catalogSkuId: string | null;
  productName: string;
  specName: string;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  effectivePrice: string | null;
  quantity: string;
}

/** 总部仓采购可选规格 */
interface CatalogSkuOption {
  id: string;
  productName: string;
  specName: string;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  quantity: string;
  lastUnitCost: string | null;
}

type ReceiveDraft = {
  id: string;
  receivedQuantity: string;
  unitCost: string;
  differenceReason: string;
};

/** 入库质检草稿：purchaseOrderItemId + 本次应收/实收/合格/不合格 */
type ReceiptDraft = {
  id: string;
  itemName: string;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  expectedQuantity: string;
  receivedQuantity: string;
  qualifiedQuantity: string;
  rejectedQuantity: string;
  unitCost: string;
  differenceReason?: ReceiptReason;
  remark: string;
};

type ReceiptReason = 'shortage' | 'damaged' | 'expired' | 'spec_mismatch' | 'other';

const receiptReasonOptions: Array<{ value: ReceiptReason; label: string }> = [
  { value: 'shortage', label: '短装' },
  { value: 'damaged', label: '破损' },
  { value: 'expired', label: '过期' },
  { value: 'spec_mismatch', label: '规格不符' },
  { value: 'other', label: '其他' }
];

const receiptReasonLabels: Record<string, string> = Object.fromEntries(
  receiptReasonOptions.map((option) => [option.value, option.label])
);

type PurchaseItemDraft = {
  key: string;
  skuId?: string;
  catalogSkuId?: string;
  quantity: string;
  unitCost: string;
};

type PurchaseSubjectType = 'shop' | 'warehouse';

const statusLabels: Record<PurchaseRow['status'], string> = {
  draft: '草稿',
  submitted: '待入库',
  received: '已入库',
  cancelled: '已取消'
};

const statusColors: Record<PurchaseRow['status'], string> = {
  draft: 'default',
  submitted: 'processing',
  received: 'success',
  cancelled: 'error'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function formatQty(value: string | number, mode: 'integer' | 'decimal_2') {
  const numeric = Number(value);
  return mode === 'integer' ? String(Math.round(numeric)) : numeric.toFixed(2);
}

/** 状态展示：submitted 且已有部分明细收满时派生「部分入库」，不改后端状态枚举 */
function purchaseStatusView(row: { status: PurchaseRow['status']; receivedLineCount?: number }) {
  if (row.status === 'submitted' && (row.receivedLineCount ?? 0) > 0) {
    return { label: '部分入库', color: 'warning' as const };
  }
  return { label: statusLabels[row.status], color: statusColors[row.status] };
}

function newDraftItem(): PurchaseItemDraft {
  return { key: crypto.randomUUID(), quantity: '1', unitCost: '' };
}

export default function PurchasesPage() {
  const [modal, contextHolder] = Modal.useModal();
  const confirmDanger = useConfirmDanger();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string | undefined>();
  // 页签写在 ?tab= 里：warehouse（默认）| shop，刷新/分享/前进后退保持当前页签
  const subjectType: PurchaseSubjectType =
    searchParams.get('tab') === 'shop' ? 'shop' : 'warehouse';
  const [warehouses, setWarehouses] = useState<ShopOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [error, setError] = useState('');

  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);
  const [catalogOptions, setCatalogOptions] = useState<CatalogSkuOption[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [expectedAt, setExpectedAt] = useState('');
  const [purchaseRemark, setPurchaseRemark] = useState('');
  const [draftItems, setDraftItems] = useState<PurchaseItemDraft[]>([newDraftItem()]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [planInfo, setPlanInfo] = useState<{ planNo: string; matched: number; total: number } | null>(
    null
  );

  const [receiveDetail, setReceiveDetail] = useState<PurchaseDetail | null>(null);
  const [receiveDrafts, setReceiveDrafts] = useState<ReceiveDraft[]>([]);
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  const [receiptDetail, setReceiptDetail] = useState<PurchaseDetail | null>(null);
  const [receiptDrafts, setReceiptDrafts] = useState<ReceiptDraft[]>([]);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState('');

  const [viewDetail, setViewDetail] = useState<PurchaseDetail | null>(null);
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const value = new URLSearchParams(window.location.search).get('demandPlanId');
    if (value) setPlanId(value);
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

  useEffect(() => {
    async function loadWarehouses() {
      try {
        const response = await fetch('/api/admin/warehouses?page=1&pageSize=100', {
          cache: 'no-store'
        });
        const payload = await response.json();
        const items: ShopOption[] = response.ok ? (payload.items ?? []) : [];
        setWarehouses(items);
        setWarehouseId(items[0]?.id);
      } catch {
        setError('接口不可用');
      }
    }
    void loadWarehouses();
  }, []);

  /** 页签切换：门店/仓库各自独立保留，清掉新建单已选的供应商与页码 */
  const changeTab = useCallback(
    (key: string) => {
      setError('');
      setPurchasePage(1);
      setSupplierId(undefined);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', key === 'shop' ? 'shop' : 'warehouse');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const loadPurchases = useCallback(async () => {
    const subjectParam =
      subjectType === 'shop'
        ? shopId && `shopId=${encodeURIComponent(shopId)}`
        : warehouseId && `warehouseId=${encodeURIComponent(warehouseId)}`;
    if (!subjectParam) return;
    setPurchaseLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/purchases?${subjectParam}&page=${purchasePage}&pageSize=20`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '采购单加载失败');
        return;
      }
      setPurchases(payload.items ?? []);
      setPurchaseTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setPurchaseLoading(false);
    }
  }, [subjectType, shopId, warehouseId, purchasePage]);

  useEffect(() => {
    void loadPurchases();
  }, [loadPurchases]);

  const loadSuppliers = useCallback(async () => {
    if (subjectType === 'warehouse') {
      if (!warehouseId) {
        setSuppliers([]);
        return;
      }
      try {
        const response = await fetch(
          `/api/admin/suppliers?warehouseId=${encodeURIComponent(warehouseId)}&page=1&pageSize=100`,
          { cache: 'no-store' }
        );
        const payload = await response.json();
        if (!response.ok) {
          setError(payload?.message ?? '供应商加载失败');
          return;
        }
        setSuppliers(payload.items ?? []);
      } catch {
        setError('接口不可用');
      }
      return;
    }
    if (!shopId) return;
    try {
      const response = await fetch(
        `/api/admin/suppliers?shopId=${encodeURIComponent(shopId)}&page=1&pageSize=100`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '供应商加载失败');
        return;
      }
      setSuppliers(payload.items ?? []);
    } catch {
      setError('接口不可用');
    }
  }, [subjectType, shopId, warehouseId]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const loadInventoryOptions = useCallback(async () => {
    if (!shopId) return;
    try {
      const response = await fetch(
        `/api/admin/inventory?shopId=${encodeURIComponent(shopId)}&page=1&pageSize=100`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '商品规格加载失败');
        return;
      }
      setInventoryOptions(payload.items ?? []);
    } catch {
      setError('接口不可用');
    }
  }, [shopId]);

  useEffect(() => {
    if (createOpen) void loadInventoryOptions();
  }, [createOpen, loadInventoryOptions]);

  const loadCatalogOptions = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const response = await fetch(
        `/api/admin/purchases/catalog-suggestions?warehouseId=${encodeURIComponent(warehouseId)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '总部规格加载失败');
        return;
      }
      setCatalogOptions(payload.items ?? []);
    } catch {
      setError('接口不可用');
    }
  }, [warehouseId]);

  useEffect(() => {
    if (createOpen && subjectType === 'warehouse') void loadCatalogOptions();
  }, [createOpen, subjectType, loadCatalogOptions]);

  async function openCreate() {
    setSupplierId(undefined);
    setExpectedAt('');
    setPurchaseRemark('');
    setDraftItems([newDraftItem()]);
    setPlanInfo(null);
    setCreateOpen(true);
    if (subjectType === 'warehouse') return;
    if (!shopId || !planId) return;

    // 从需求计划进入：把计划明细按 catalogSkuId 映射到当前门店的商品规格，带入数量与采纳数量一致
    try {
      const [planResponse, inventoryResponse] = await Promise.all([
        fetch(`/api/admin/demand-plans/${planId}`, { cache: 'no-store' }),
        fetch(`/api/admin/inventory?shopId=${encodeURIComponent(shopId)}&page=1&pageSize=100`, {
          cache: 'no-store'
        })
      ]);
      const planPayload = await planResponse.json();
      const inventoryPayload = await inventoryResponse.json();
      if (!planResponse.ok || !inventoryResponse.ok) {
        setError(planPayload?.message ?? '需求计划加载失败，可手工添加明细');
        return;
      }
      const inventory = (inventoryPayload.items ?? []) as InventoryOption[];
      const byCatalog = new Map(
        inventory
          .filter((option) => option.catalogSkuId && option.stockType === 'tracked')
          .map((option) => [option.catalogSkuId as string, option])
      );
      const planItems = (planPayload.item?.items ?? []) as {
        catalogSkuId: string;
        finalQty: string;
      }[];
      const lines = planItems
        .filter((item) => byCatalog.has(item.catalogSkuId))
        .map((item) => ({
          key: crypto.randomUUID(),
          skuId: byCatalog.get(item.catalogSkuId)!.skuId,
          quantity: String(Number(item.finalQty) || 1),
          unitCost: ''
        }));
      if (lines.length > 0) {
        setDraftItems(lines);
        setInventoryOptions(inventory);
      }
      setPlanInfo({
        planNo: planPayload.item?.planNo ?? '',
        matched: lines.length,
        total: planItems.length
      });
    } catch {
      setError('需求计划加载失败，可手工添加明细');
    }
  }

  async function submitCreate() {
    const isWarehouse = subjectType === 'warehouse';
    if (isWarehouse ? !warehouseId : !shopId) return;
    const items = draftItems
      .filter((item) =>
        isWarehouse
          ? Boolean(item.catalogSkuId && item.quantity.trim() && item.unitCost.trim())
          : Boolean(item.skuId && item.quantity.trim() && item.unitCost.trim())
      )
      .map((item) =>
        isWarehouse
          ? {
              catalogSkuId: item.catalogSkuId,
              quantity: item.quantity.trim(),
              unitCost: Number(item.unitCost)
            }
          : {
              skuId: item.skuId,
              quantity: item.quantity.trim(),
              unitCost: Number(item.unitCost)
            }
      );
    if (items.length === 0) {
      setError('请至少添加一条有效采购明细');
      return;
    }
    if (items.some((item) => !Number.isFinite(item.unitCost) || item.unitCost < 0)) {
      setError('进价不合法');
      return;
    }
    if (!supplierId) {
      setError('请选择供应商（供应商必须来自供应商档案，未建档供应商不能下单）');
      return;
    }
    if (!activeSuppliers.some((supplier) => supplier.id === supplierId)) {
      setError('所选供应商不可用，请从供应商档案中重新选择');
      return;
    }

    setCreateSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/purchases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(isWarehouse ? { warehouseId } : { shopId }),
          supplierId,
          demandPlanId: isWarehouse ? null : planId,
          expectedAt: expectedAt || null,
          remark: purchaseRemark.trim() || null,
          items
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '新建采购单失败');
        return;
      }
      setCreateOpen(false);
      if (planId) {
        setPlanId(null);
        window.history.replaceState(
          {},
          '',
          subjectType === 'shop' ? '/purchases?tab=shop' : '/purchases?tab=warehouse'
        );
      }
      void loadPurchases();
    } catch {
      setError('新建采购单失败');
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function submitPurchase(id: string) {
    setError('');
    try {
      const response = await fetch(`/api/admin/purchases/${id}/submit`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '提交失败');
        return;
      }
      void loadPurchases();
    } catch {
      setError('提交失败');
    }
  }

  async function cancelPurchase(row: PurchaseRow) {
    const confirmed = await confirmDanger({
      title: `取消采购单 ${row.poNo}？`,
      content: '取消后该采购单不能再入库，已发生的入库与结算记录不受影响；不可撤销。',
      okText: '确认取消'
    });
    if (!confirmed) return;
    const response = await fetch(`/api/admin/purchases/${row.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.message ?? '取消失败');
      return;
    }
    void loadPurchases();
  }

  async function openView(row: PurchaseRow) {
    setError('');
    setViewLoadingId(row.id);
    try {
      const response = await fetch(`/api/admin/purchases/${row.id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '采购单加载失败');
        return;
      }
      setViewDetail(payload.item as PurchaseDetail);
    } catch {
      setError('接口不可用');
    } finally {
      setViewLoadingId(null);
    }
  }

  async function openReceive(row: PurchaseRow) {
    setError('');
    try {
      const response = await fetch(`/api/admin/purchases/${row.id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '采购单加载失败');
        return;
      }
      const detail = payload.item as PurchaseDetail;
      setReceiveDetail(detail);
      setReceiveDrafts(
        detail.items.map((item) => ({
          id: item.id,
          receivedQuantity: item.quantity,
          unitCost: item.unitCost,
          differenceReason: item.differenceReason ?? ''
        }))
      );
    } catch {
      setError('接口不可用');
    }
  }

  async function submitReceive() {
    if (!receiveDetail) return;
    setReceiveSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/purchases/${receiveDetail.id}/receive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: receiveDrafts.map((draft) => ({
            id: draft.id,
            receivedQuantity: draft.receivedQuantity,
            unitCost: Number(draft.unitCost),
            differenceReason: draft.differenceReason.trim() || null
          }))
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '入库失败');
        return;
      }
      setReceiveDetail(null);
      void loadPurchases();
      void loadInventoryOptions();
    } catch {
      setError('入库失败');
    } finally {
      setReceiveSubmitting(false);
    }
  }

  async function openReceipt(row: PurchaseRow) {
    setError('');
    try {
      const response = await fetch(`/api/admin/purchases/${row.id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '采购单加载失败');
        return;
      }
      const detail = payload.item as PurchaseDetail;
      setReceiptDrafts(
        detail.items.map((item) => {
          const remaining = Math.max(Number(item.quantity) - Number(item.receivedQuantity), 0);
          const value = formatQty(remaining, item.quantityMode);
          return {
            id: item.id,
            itemName: item.productName ?? item.itemName,
            unit: item.unit,
            quantityMode: item.quantityMode,
            expectedQuantity: value,
            receivedQuantity: value,
            qualifiedQuantity: value,
            rejectedQuantity: '0',
            unitCost: item.unitCost,
            remark: ''
          };
        })
      );
      setReceiptDetail(detail);
      // 每次打开弹窗生成一个幂等键，重复点「确认入库」不会重复记库存
      setReceiptIdempotencyKey(crypto.randomUUID());
    } catch {
      setError('接口不可用');
    }
  }

  function patchReceiptDraft(id: string, patch: Partial<ReceiptDraft>) {
    setReceiptDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );
  }

  /** 实收变化时默认按全合格带入，再让用户改不合格数量 */
  function updateReceiptReceived(draft: ReceiptDraft, value: string) {
    patchReceiptDraft(draft.id, {
      receivedQuantity: value,
      qualifiedQuantity: value,
      rejectedQuantity: '0'
    });
  }

  function updateReceiptQualified(draft: ReceiptDraft, value: string) {
    const received = Number(draft.receivedQuantity);
    const qualified = Number(value);
    const rejected =
      Number.isFinite(received) && Number.isFinite(qualified)
        ? Math.max(received - qualified, 0)
        : 0;
    patchReceiptDraft(draft.id, {
      qualifiedQuantity: value,
      rejectedQuantity: formatQty(rejected, draft.quantityMode)
    });
  }

  function updateReceiptRejected(draft: ReceiptDraft, value: string) {
    const received = Number(draft.receivedQuantity);
    const rejected = Number(value);
    const qualified =
      Number.isFinite(received) && Number.isFinite(rejected)
        ? Math.max(received - rejected, 0)
        : 0;
    patchReceiptDraft(draft.id, {
      rejectedQuantity: value,
      qualifiedQuantity: formatQty(qualified, draft.quantityMode)
    });
  }

  async function submitReceipt() {
    if (!receiptDetail) return;
    setError('');

    for (const draft of receiptDrafts) {
      const received = Number(draft.receivedQuantity);
      const qualified = Number(draft.qualifiedQuantity);
      const rejected = Number(draft.rejectedQuantity);
      const expected = Number(draft.expectedQuantity);
      const unitCost = Number(draft.unitCost);
      if (![received, qualified, rejected, expected, unitCost].every(Number.isFinite)) {
        setError(`${draft.itemName} 的数量或单价格式不正确`);
        return;
      }
      if (received < 0 || qualified < 0 || rejected < 0) {
        setError(`${draft.itemName} 的数量不能为负`);
        return;
      }
      if (Math.round(received * 100) > Math.round(expected * 100)) {
        setError(`${draft.itemName} 实收 ${received} 超过应收 ${expected}`);
        return;
      }
      if (Math.round(qualified * 100) + Math.round(rejected * 100) !== Math.round(received * 100)) {
        setError(`${draft.itemName} 的合格 + 不合格必须等于实收数量`);
        return;
      }
      if (rejected > 0 && !draft.differenceReason) {
        setError(`${draft.itemName} 有不合格数量，请选择差异原因`);
        return;
      }
      if (unitCost < 0) {
        setError(`${draft.itemName} 的到货实价不合法`);
        return;
      }
    }
    if (receiptDrafts.every((draft) => Number(draft.receivedQuantity) <= 0)) {
      setError('请填写本次到货数量');
      return;
    }

    setReceiptSubmitting(true);
    try {
      const response = await fetch(`/api/admin/purchases/${receiptDetail.id}/receipts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': receiptIdempotencyKey
        },
        body: JSON.stringify({
          items: receiptDrafts.map((draft) => ({
            purchaseOrderItemId: draft.id,
            receivedQuantity: draft.receivedQuantity,
            qualifiedQuantity: draft.qualifiedQuantity,
            rejectedQuantity: draft.rejectedQuantity,
            unitCost: Number(draft.unitCost),
            differenceReason: draft.differenceReason ?? null,
            remark: draft.remark.trim() || null
          }))
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '入库质检失败');
        return;
      }
      const item = payload.item as {
        receiptNo: string;
        purchaseOrderStatus: 'submitted' | 'received';
        partial: boolean;
        receivedAmount: string;
        receivedLineCount: number;
        completedLineCount: number;
        itemCount: number;
        lines: Array<{
          itemName: string;
          unit: string;
          receivedQuantity: string;
          qualifiedQuantity: string;
          rejectedQuantity: string;
        }>;
      };
      setReceiptDetail(null);
      void loadPurchases();
      void loadInventoryOptions();
      modal.success({
        title: `入库质检完成 · ${item.receiptNo}`,
        width: 520,
        content: (
          <div style={{ display: 'grid', gap: 6 }}>
            <div>
              本次合格入库金额 ¥{item.receivedAmount}；
              {item.partial
                ? `部分入库（已收满 ${item.completedLineCount}/${item.itemCount} 行）`
                : '采购单已全部入库'}
            </div>
            {item.lines
              .filter((line) => Number(line.receivedQuantity) > 0)
              .map((line, index) => (
                <div key={index} style={{ fontSize: 13 }}>
                  {line.itemName}：实收 {line.receivedQuantity} {line.unit}，合格{' '}
                  {line.qualifiedQuantity}，不合格 {line.rejectedQuantity}
                </div>
              ))}
          </div>
        )
      });
    } catch {
      setError('入库质检失败');
    } finally {
      setReceiptSubmitting(false);
    }
  }

  const purchaseColumns: TableColumnsType<PurchaseRow> = [
    {
      title: '采购单号',
      dataIndex: 'poNo',
      width: 170
    },
    {
      title: '采购主体',
      key: 'subject',
      width: 140,
      render: (_, row) =>
        row.warehouseId ? (
          <Tag color="blue">总部仓 · {row.warehouseName ?? '—'}</Tag>
        ) : (
          <span>{shops.find((shop) => shop.id === row.shopId)?.name ?? '门店'}</span>
        )
    },
    {
      title: '供应商',
      key: 'supplier',
      render: (_, row) => (
        <div>
          <div>
            {row.supplierName ?? '—'}
            {row.supplierName && !row.supplierId ? (
              <Tag style={{ marginLeft: 6 }} color="warning">
                未建档
              </Tag>
            ) : null}
          </div>
          {row.supplierPhone ? (
            <div style={{ fontSize: 12, opacity: 0.65 }}>{row.supplierPhone}</div>
          ) : null}
        </div>
      )
    },
    {
      title: '明细',
      dataIndex: 'itemCount',
      width: 80,
      render: (value: number) => `${value} 项`
    },
    {
      title: '采购金额',
      dataIndex: 'orderedAmount',
      width: 110,
      render: (value: string) => `¥${value}`
    },
    {
      title: '已入库金额',
      dataIndex: 'receivedAmount',
      width: 120,
      render: (value: string) => `¥${value}`
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_: PurchaseRow['status'], row) => {
        const view = purchaseStatusView(row);
        return <Tag color={view.color}>{view.label}</Tag>;
      }
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value)
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      align: 'right',
      render: (_, row) => (
        <Space size={4} wrap>
          <Button
            size="small"
            loading={viewLoadingId === row.id}
            onClick={() => void openView(row)}
          >
            查看
          </Button>
          {row.status === 'draft' ? (
            <Button size="small" type="primary" onClick={() => void submitPurchase(row.id)}>
              提交
            </Button>
          ) : null}
          {row.status === 'submitted' ? (
            row.warehouseId ? (
              <Button size="small" type="primary" onClick={() => void openReceipt(row)}>
                入库质检
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={() => void openReceive(row)}>
                入库
              </Button>
            )
          ) : null}
          {row.status === 'draft' || row.status === 'submitted' ? (
            <Button size="small" danger onClick={() => cancelPurchase(row)}>
              取消
            </Button>
          ) : null}
        </Space>
      )
    }
  ];

  const receiveColumns: TableColumnsType<PurchaseDetailItem> = [
    {
      title: '商品 / 规格',
      key: 'item',
      render: (_, row) => (
        <div>
          <div>{row.productName ?? row.itemName}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            {row.specName ?? ''} · 采购 {row.quantity} {row.unit}
          </div>
        </div>
      )
    },
    {
      title: '实收数量',
      key: 'received',
      width: 160,
      render: (_, row) => {
        const draft = receiveDrafts.find((item) => item.id === row.id);
        return (
          <Input
            value={draft?.receivedQuantity ?? ''}
            onChange={(event) =>
              setReceiveDrafts((current) =>
                current.map((item) =>
                  item.id === row.id
                    ? { ...item, receivedQuantity: event.target.value }
                    : item
                )
              )
            }
          />
        );
      }
    },
    {
      title: '进价',
      key: 'unitCost',
      width: 130,
      render: (_, row) => {
        const draft = receiveDrafts.find((item) => item.id === row.id);
        return (
          <Input
            value={draft?.unitCost ?? ''}
            onChange={(event) =>
              setReceiveDrafts((current) =>
                current.map((item) =>
                  item.id === row.id ? { ...item, unitCost: event.target.value } : item
                )
              )
            }
          />
        );
      }
    },
    {
      title: '差异原因',
      key: 'differenceReason',
      render: (_, row) => {
        const draft = receiveDrafts.find((item) => item.id === row.id);
        return (
          <Input
            value={draft?.differenceReason ?? ''}
            placeholder="实收与采购不一致时填写"
            onChange={(event) =>
              setReceiveDrafts((current) =>
                current.map((item) =>
                  item.id === row.id
                    ? { ...item, differenceReason: event.target.value }
                    : item
                )
              )
            }
          />
        );
      }
    }
  ];

  /** 入库质检录入：逐行填实收/合格/不合格，合格 + 不合格必须等于实收 */
  const receiptColumns: TableColumnsType<ReceiptDraft> = [
    {
      title: '商品 / 规格',
      key: 'item',
      render: (_, row) => (
        <div>
          <div>{row.itemName}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            应收 {row.expectedQuantity} {row.unit}
          </div>
        </div>
      )
    },
    {
      title: '实收',
      key: 'received',
      width: 90,
      render: (_, row) => (
        <Input
          value={row.receivedQuantity}
          onChange={(event) => updateReceiptReceived(row, event.target.value)}
        />
      )
    },
    {
      title: '合格',
      key: 'qualified',
      width: 90,
      render: (_, row) => (
        <Input
          value={row.qualifiedQuantity}
          onChange={(event) => updateReceiptQualified(row, event.target.value)}
        />
      )
    },
    {
      title: '不合格',
      key: 'rejected',
      width: 90,
      render: (_, row) => (
        <Input
          value={row.rejectedQuantity}
          onChange={(event) => updateReceiptRejected(row, event.target.value)}
        />
      )
    },
    {
      title: '差异原因',
      key: 'reason',
      width: 130,
      render: (_, row) => (
        <Select
          allowClear
          style={{ width: '100%' }}
          placeholder="不合格时必填"
          value={row.differenceReason}
          onChange={(value) => patchReceiptDraft(row.id, { differenceReason: value })}
          options={receiptReasonOptions}
        />
      )
    },
    {
      title: '到货实价',
      key: 'unitCost',
      width: 100,
      render: (_, row) => (
        <Input
          value={row.unitCost}
          onChange={(event) => patchReceiptDraft(row.id, { unitCost: event.target.value })}
        />
      )
    },
    {
      title: '备注',
      key: 'remark',
      width: 150,
      render: (_, row) => (
        <Input
          value={row.remark}
          placeholder="可选"
          onChange={(event) => patchReceiptDraft(row.id, { remark: event.target.value })}
        />
      )
    }
  ];

  const receiptItemColumns: TableColumnsType<PurchaseReceiptItem> = [
    {
      title: '商品',
      dataIndex: 'itemName',
      render: (value: string, row) => `${value}（${row.unit}）`
    },
    { title: '应收', dataIndex: 'expectedQuantity', width: 70 },
    { title: '实收', dataIndex: 'receivedQuantity', width: 70 },
    { title: '合格', dataIndex: 'qualifiedQuantity', width: 70 },
    { title: '不合格', dataIndex: 'rejectedQuantity', width: 70 },
    {
      title: '差异原因',
      dataIndex: 'differenceReason',
      width: 100,
      render: (value: string | null) => (value ? receiptReasonLabels[value] ?? value : '—')
    },
    { title: '实价', dataIndex: 'unitCost', width: 80, render: (value: string) => `¥${value}` },
    {
      title: '备注',
      dataIndex: 'remark',
      render: (value: string | null) => value || '—'
    }
  ];

  const viewItemColumns: TableColumnsType<PurchaseDetailItem> = [
    {
      title: '商品 / 规格',
      key: 'item',
      render: (_, row) => (
        <div>
          <div>{row.productName ?? row.itemName}</div>
          {row.specName ? (
            <div style={{ fontSize: 12, opacity: 0.65 }}>{row.specName}</div>
          ) : null}
        </div>
      )
    },
    {
      title: '采购数量',
      key: 'quantity',
      width: 120,
      render: (_, row) => `${row.quantity} ${row.unit}`
    },
    {
      title: '进价',
      dataIndex: 'unitCost',
      width: 100,
      render: (value: string) => `¥${value}`
    },
    {
      title: '采购金额',
      dataIndex: 'amount',
      width: 110,
      render: (value: string) => `¥${value}`
    },
    {
      title: '实收数量',
      key: 'receivedQuantity',
      width: 120,
      render: (_, row) =>
        Number(row.receivedQuantity) > 0 ? `${row.receivedQuantity} ${row.unit}` : '—'
    },
    {
      title: '差异原因',
      dataIndex: 'differenceReason',
      render: (value: string | null) => value || '—'
    }
  ];

  if (!mounted) return null;

  const activeSuppliers = suppliers.filter((supplier) => supplier.status === 'active');
  const selectedSupplier = activeSuppliers.find((supplier) => supplier.id === supplierId);

  return (
    <AdminListPage
      header={
        <Tabs
          activeKey={subjectType}
          onChange={changeTab}
          tabBarStyle={{ margin: 0 }}
          items={[
            { key: 'warehouse', label: '仓库采购' },
            { key: 'shop', label: '门店采购' }
          ]}
        />
      }
      actions={
        <Space size={8}>
          <Button icon={<ReloadOutlined />} onClick={() => void loadPurchases()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建采购单
          </Button>
          <TestDataCleanupButton onCleaned={() => void loadPurchases()} />
        </Space>
      }
      filters={
        <>
          <AdminFilterField>
            {subjectType === 'shop' ? (
              <Select
                placeholder="选择门店"
                value={shopId}
                onChange={(value) => {
                  setShopId(value);
                  setPurchasePage(1);
                  // 供应商按门店供货关系限定，切店后清空已选供应商，避免沿用其他门店的选择
                  setSupplierId(undefined);
                }}
                options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
              />
            ) : (
              <Select
                placeholder="选择总部仓"
                value={warehouseId}
                onChange={(value) => {
                  setWarehouseId(value);
                  setPurchasePage(1);
                  setSupplierId(undefined);
                }}
                options={warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: warehouse.name
                }))}
              />
            )}
          </AdminFilterField>
        </>
      }
      notice={
        error ? (
          <Alert
            type="error"
            showIcon
            title={error}
            style={{ margin: '0 12px 8px' }}
            closable
            onClose={() => setError('')}
          />
        ) : null
      }
    >
      {contextHolder}

      <Table
        rowKey="id"
        loading={purchaseLoading}
        {...getAdminTableProps(purchaseColumns)}
        dataSource={purchases}
        locale={{
          emptyText: (
            <Empty
              description={
                <span>
                  还没有采购单，点右上角「新建采购单」开始。供应商统一在
                  <Link href="/suppliers">供应商档案</Link>维护。
                </span>
              }
            />
          )
        }}
        pagination={{
          current: purchasePage,
          pageSize: 20,
          total: purchaseTotal,
          showSizeChanger: false,
          showTotal: (count) => `共 ${count} 条`,
          onChange: setPurchasePage
        }}
      />

      <Modal
        title={subjectType === 'warehouse' ? '新建总部仓采购单' : '新建采购单'}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={createSubmitting}
        okText="保存草稿"
        width={900}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {planId ? (
            <Alert
              type="info"
              showIcon
              title={
                planInfo
                  ? `关联需求计划 ${planInfo.planNo}：已带入 ${planInfo.matched}/${planInfo.total} 条明细，数量取采纳数量`
                  : '正在加载需求计划明细…'
              }
            />
          ) : null}
          <Space wrap>
            <Select
              style={{ width: 260 }}
              placeholder="选择供应商（仅档案中启用的供应商）"
              value={supplierId}
              onChange={(value) => setSupplierId(value)}
              optionFilterProp="label"
              showSearch
              options={activeSuppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              }))}
            />
            {activeSuppliers.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--admin-text-tertiary)' }}>
                {subjectType === 'warehouse'
                  ? '暂无绑定该仓库的供应商，请先到'
                  : '该门店暂无可选供应商，请先到'}
                <Link href="/suppliers">供应商档案</Link>
                配置供货范围并启用
              </span>
            ) : null}
            {selectedSupplier ? (
              <span style={{ fontSize: 12, color: 'var(--admin-text-tertiary)' }}>
                联系人：{selectedSupplier.contactName || '—'} · 电话：
                {selectedSupplier.phone || '—'}
              </span>
            ) : null}
            <Input
              type="date"
              style={{ width: 180 }}
              value={expectedAt}
              onChange={(event) => setExpectedAt(event.target.value)}
            />
          </Space>

          <Input
            placeholder="采购备注"
            value={purchaseRemark}
            onChange={(event) => setPurchaseRemark(event.target.value)}
            maxLength={500}
          />

          <div style={{ display: 'grid', gap: 8 }}>
            {draftItems.map((item) => (
              <Space key={item.key} wrap>
                <Select
                  showSearch
                  style={{ width: 340 }}
                  placeholder={subjectType === 'warehouse' ? '选择总部规格' : '选择规格'}
                  value={
                    subjectType === 'warehouse' ? item.catalogSkuId : item.skuId
                  }
                  optionFilterProp="label"
                  onChange={(value) =>
                    setDraftItems((current) =>
                      current.map((row) =>
                        row.key === item.key
                          ? subjectType === 'warehouse'
                            ? { ...row, catalogSkuId: value, skuId: undefined }
                            : { ...row, skuId: value, catalogSkuId: undefined }
                          : row
                      )
                    )
                  }
                  options={
                    subjectType === 'warehouse'
                      ? catalogOptions.map((option) => ({
                          value: option.id,
                          label: `${option.productName} ${option.specName}（${option.unit}，仓库库存 ${option.quantity}）`
                        }))
                      : inventoryOptions.map((option) => ({
                          value: option.skuId,
                          label: `${option.productName} ${option.specName}（${option.unit}，库存 ${option.quantity}）`
                        }))
                  }
                />
                <Input
                  style={{ width: 120 }}
                  placeholder="数量"
                  value={item.quantity}
                  onChange={(event) =>
                    setDraftItems((current) =>
                      current.map((row) =>
                        row.key === item.key
                          ? { ...row, quantity: event.target.value }
                          : row
                      )
                    )
                  }
                />
                <Input
                  style={{ width: 120 }}
                  placeholder="进价"
                  value={item.unitCost}
                  onChange={(event) =>
                    setDraftItems((current) =>
                      current.map((row) =>
                        row.key === item.key
                          ? { ...row, unitCost: event.target.value }
                          : row
                      )
                    )
                  }
                />
                <Button
                  danger
                  onClick={() =>
                    setDraftItems((current) =>
                      current.length === 1
                        ? current
                        : current.filter((row) => row.key !== item.key)
                    )
                  }
                >
                  删除
                </Button>
              </Space>
            ))}
            <Button
              type="dashed"
              onClick={() => setDraftItems((current) => [...current, newDraftItem()])}
            >
              添加明细
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        title={viewDetail ? `采购单详情 · ${viewDetail.poNo}` : '采购单详情'}
        open={Boolean(viewDetail)}
        onCancel={() => setViewDetail(null)}
        footer={<Button onClick={() => setViewDetail(null)}>关闭</Button>}
        width={960}
      >
        {viewDetail ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                { key: 'poNo', label: '采购单号', children: viewDetail.poNo },
                {
                  key: 'subject',
                  label: '采购主体',
                  children: viewDetail.warehouseId
                    ? `总部仓 · ${viewDetail.warehouseName ?? '—'}`
                    : '门店'
                },
                {
                  key: 'status',
                  label: '状态',
                  children: (
                    <Tag color={purchaseStatusView(viewDetail).color}>
                      {purchaseStatusView(viewDetail).label}
                    </Tag>
                  )
                },
                {
                  key: 'supplier',
                  label: '供应商',
                  children: viewDetail.supplierName ? (
                    <span>
                      {viewDetail.supplierName}
                      {viewDetail.supplierId ? null : (
                        <Tag style={{ marginLeft: 6 }} color="warning">
                          未建档
                        </Tag>
                      )}
                    </span>
                  ) : (
                    '—'
                  )
                },
                // 需求计划单号较长，独占整行；放在供应商之后，保证上一行已满 2 列
                ...(viewDetail.demandPlanId
                  ? [
                      {
                        key: 'demandPlan',
                        label: '需求计划',
                        children: viewDetail.demandPlanNo ?? viewDetail.demandPlanId,
                        span: 2
                      }
                    ]
                  : []),
                { key: 'phone', label: '联系电话', children: viewDetail.supplierPhone ?? '—' },
                { key: 'ordered', label: '采购金额', children: `¥${viewDetail.orderedAmount}` },
                { key: 'received', label: '已入库金额', children: `¥${viewDetail.receivedAmount}` },
                { key: 'expected', label: '预计到货', children: formatTime(viewDetail.expectedAt) },
                { key: 'created', label: '创建时间', children: formatTime(viewDetail.createdAt) },
                { key: 'submitted', label: '提交时间', children: formatTime(viewDetail.submittedAt) },
                { key: 'receivedAt', label: '入库时间', children: formatTime(viewDetail.receivedAt) },
                { key: 'cancelledAt', label: '取消时间', children: formatTime(viewDetail.cancelledAt) },
                // 取消原因通常较长，独占整行；备注放最后，最后一行不足由 Descriptions 自动补齐
                ...(viewDetail.cancelReason
                  ? [
                      {
                        key: 'cancelReason',
                        label: '取消原因',
                        children: viewDetail.cancelReason,
                        span: 2
                      }
                    ]
                  : []),
                { key: 'remark', label: '备注', children: viewDetail.remark || '—' }
              ]}
            />
            <Table
              rowKey="id"
              size="small"
              {...getAdminTableProps(viewItemColumns)}
              dataSource={viewDetail.items}
              pagination={false}
            />
            {viewDetail.receipts?.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>入库质检记录</div>
                {viewDetail.receipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}
                  >
                    <Space wrap style={{ marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>{receipt.receiptNo}</span>
                      <Tag color="success">已过账</Tag>
                      <span style={{ fontSize: 12, opacity: 0.65 }}>
                        {formatTime(receipt.receivedAt)} · 合格入库 ¥{receipt.receivedAmount}
                      </span>
                    </Space>
                    <Table
                      rowKey="id"
                      size="small"
                      sticky
                      columns={receiptItemColumns}
                      dataSource={receipt.items}
                      pagination={false}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        title={receiveDetail ? `采购入库 · ${receiveDetail.poNo}` : '采购入库'}
        open={Boolean(receiveDetail)}
        onCancel={() => setReceiveDetail(null)}
        onOk={() => void submitReceive()}
        confirmLoading={receiveSubmitting}
        okText="确认入库"
        width={900}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="入库后库存立即增加，并生成采购入库流水；提交后不可撤销。"
        />
        <Table
          rowKey="id"
          size="small"
          {...getAdminTableProps(receiveColumns)}
          dataSource={receiveDetail?.items ?? []}
          pagination={false}
        />
      </Modal>
      <Modal
        title={receiptDetail ? `入库质检 · ${receiptDetail.poNo}` : '入库质检'}
        open={Boolean(receiptDetail)}
        onCancel={() => setReceiptDetail(null)}
        onOk={() => void submitReceipt()}
        confirmLoading={receiptSubmitting}
        okText="确认入库"
        width={1020}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="只把合格数量写入仓库库存；不合格数量仅保留拒收记录，不增加库存。"
          description="校验：合格 + 不合格 = 实收，实收 ≤ 应收；不合格时请选择差异原因。"
        />
        <Table
          rowKey="id"
          size="small"
          sticky
          columns={receiptColumns}
          dataSource={receiptDrafts}
          pagination={false}
          scroll={{ x: 920 }}
        />
      </Modal>
    </AdminListPage>
  );
}
