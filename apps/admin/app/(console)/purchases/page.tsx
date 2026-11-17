'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';

interface ShopOption {
  id: string;
  name: string;
}

interface SupplierRow {
  id: string;
  shopId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  remark: string | null;
  status: 'active' | 'disabled';
  createdAt: string;
}

interface PurchaseRow {
  id: string;
  shopId: string;
  poNo: string;
  supplierName: string | null;
  supplierPhone: string | null;
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
}

interface PurchaseDetailItem {
  id: string;
  productSkuId: string | null;
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

interface PurchaseDetail extends PurchaseRow {
  items: PurchaseDetailItem[];
}

interface InventoryOption {
  skuId: string;
  productName: string;
  specName: string;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  effectivePrice: string | null;
  quantity: string;
}

type ReceiveDraft = {
  id: string;
  receivedQuantity: string;
  unitCost: string;
  differenceReason: string;
};

type PurchaseItemDraft = {
  key: string;
  skuId?: string;
  quantity: string;
  unitCost: string;
};

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

function newDraftItem(): PurchaseItemDraft {
  return { key: crypto.randomUUID(), quantity: '1', unitCost: '' };
}

export default function PurchasesPage() {
  const [mounted, setMounted] = useState(false);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string | undefined>();
  const [tab, setTab] = useState('purchases');
  const [error, setError] = useState('');

  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(false);

  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [purchaseRemark, setPurchaseRemark] = useState('');
  const [draftItems, setDraftItems] = useState<PurchaseItemDraft[]>([newDraftItem()]);

  const [receiveDetail, setReceiveDetail] = useState<PurchaseDetail | null>(null);
  const [receiveDrafts, setReceiveDrafts] = useState<ReceiveDraft[]>([]);
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  const [viewDetail, setViewDetail] = useState<PurchaseDetail | null>(null);
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null);

  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRow | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactName: '',
    phone: '',
    remark: '',
    status: 'active' as SupplierRow['status']
  });
  const [supplierSubmitting, setSupplierSubmitting] = useState(false);

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

  const loadPurchases = useCallback(async () => {
    if (!shopId) return;
    setPurchaseLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/purchases?shopId=${encodeURIComponent(shopId)}&page=${purchasePage}&pageSize=20`,
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
  }, [shopId, purchasePage]);

  useEffect(() => {
    void loadPurchases();
  }, [loadPurchases]);

  const loadSuppliers = useCallback(async () => {
    if (!shopId) return;
    setSupplierLoading(true);
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
    } finally {
      setSupplierLoading(false);
    }
  }, [shopId]);

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

  function openCreate() {
    setSupplierId(undefined);
    setSupplierName('');
    setSupplierPhone('');
    setExpectedAt('');
    setPurchaseRemark('');
    setDraftItems([newDraftItem()]);
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!shopId) return;
    const items = draftItems
      .filter((item) => item.skuId && item.quantity.trim() && item.unitCost.trim())
      .map((item) => ({
        skuId: item.skuId,
        quantity: item.quantity.trim(),
        unitCost: Number(item.unitCost)
      }));
    if (items.length === 0) {
      setError('请至少添加一条有效采购明细');
      return;
    }
    if (items.some((item) => !Number.isFinite(item.unitCost) || item.unitCost < 0)) {
      setError('进价不合法');
      return;
    }
    if (!supplierId && !supplierName.trim()) {
      setError('请选择供应商或填写供应商名称');
      return;
    }

    setCreateSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/purchases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shopId,
          supplierId: supplierId ?? null,
          supplierName: supplierName.trim() || null,
          supplierPhone: supplierPhone.trim() || null,
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

  function cancelPurchase(row: PurchaseRow) {
    Modal.confirm({
      title: `取消采购单 ${row.poNo}？`,
      content: '取消后不能再入库。',
      okText: '确认取消',
      okButtonProps: { danger: true },
      onOk: async () => {
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
    });
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

  function openSupplierModal(row?: SupplierRow) {
    setEditingSupplier(row ?? null);
    setSupplierForm({
      name: row?.name ?? '',
      contactName: row?.contactName ?? '',
      phone: row?.phone ?? '',
      remark: row?.remark ?? '',
      status: row?.status ?? 'active'
    });
    setSupplierModalOpen(true);
  }

  async function submitSupplier() {
    if (!shopId) return;
    if (!supplierForm.name.trim()) {
      setError('供应商名称必填');
      return;
    }
    setSupplierSubmitting(true);
    setError('');
    try {
      const url = editingSupplier
        ? `/api/admin/suppliers/${editingSupplier.id}`
        : '/api/admin/suppliers';
      const method = editingSupplier ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(editingSupplier ? {} : { shopId }),
          name: supplierForm.name.trim(),
          contactName: supplierForm.contactName.trim() || null,
          phone: supplierForm.phone.trim() || null,
          remark: supplierForm.remark.trim() || null,
          ...(editingSupplier ? { status: supplierForm.status } : {})
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '供应商保存失败');
        return;
      }
      setSupplierModalOpen(false);
      void loadSuppliers();
    } catch {
      setError('供应商保存失败');
    } finally {
      setSupplierSubmitting(false);
    }
  }

  const purchaseColumns: TableColumnsType<PurchaseRow> = [
    {
      title: '采购单号',
      dataIndex: 'poNo',
      width: 170
    },
    {
      title: '供应商',
      key: 'supplier',
      render: (_, row) => (
        <div>
          <div>{row.supplierName ?? '—'}</div>
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
      render: (value: PurchaseRow['status']) => (
        <Tag color={statusColors[value]}>{statusLabels[value]}</Tag>
      )
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
            <Button size="small" type="primary" onClick={() => void openReceive(row)}>
              入库
            </Button>
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

  const supplierColumns: TableColumnsType<SupplierRow> = [
    { title: '供应商', dataIndex: 'name' },
    {
      title: '联系人',
      dataIndex: 'contactName',
      render: (value: string | null) => value || '—'
    },
    {
      title: '电话',
      dataIndex: 'phone',
      render: (value: string | null) => value || '—'
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: SupplierRow['status']) => (
        <Tag color={value === 'active' ? 'success' : 'default'}>
          {value === 'active' ? '启用' : '停用'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_, row) => (
        <Button size="small" onClick={() => openSupplierModal(row)}>
          编辑
        </Button>
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
        viewDetail?.status === 'received' ? `${row.receivedQuantity} ${row.unit}` : '—'
    },
    {
      title: '差异原因',
      dataIndex: 'differenceReason',
      render: (value: string | null) => value || '—'
    }
  ];

  if (!mounted) return null;

  return (
    <div style={{ background: 'var(--admin-surface)', minHeight: '100vh' }}>
      <div className="admin-page-bar admin-page-bar--wrap">
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--admin-text)' }}>采购管理</span>
        <Space size={8} wrap>
          <Select
            style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
            placeholder="选择门店"
            value={shopId}
            onChange={(value) => {
              setShopId(value);
              setPurchasePage(1);
            }}
            options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadPurchases()}>
            刷新
          </Button>
          {tab === 'purchases' ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建采购单
            </Button>
          ) : (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openSupplierModal()}>
              新建供应商
            </Button>
          )}
        </Space>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ margin: '0 12px 8px' }}
          closable
          onClose={() => setError('')}
        />
      ) : null}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        tabBarStyle={{ padding: '0 12px' }}
        items={[
          {
            key: 'purchases',
            label: `采购单 (${purchaseTotal})`,
            children: (
              <Table
                rowKey="id"
                loading={purchaseLoading}
                {...getAdminTableProps(purchaseColumns)}
                dataSource={purchases}
                pagination={{
                  current: purchasePage,
                  pageSize: 20,
                  total: purchaseTotal,
                  showSizeChanger: false,
                  showTotal: (count) => `共 ${count} 条`,
                  onChange: setPurchasePage
                }}
              />
            )
          },
          {
            key: 'suppliers',
            label: `供应商 (${suppliers.length})`,
            children: (
              <Table
                rowKey="id"
                loading={supplierLoading}
                {...getAdminTableProps(supplierColumns)}
                dataSource={suppliers}
                pagination={false}
              />
            )
          }
        ]}
      />

      <Modal
        title="新建采购单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={createSubmitting}
        okText="保存草稿"
        width={900}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Space wrap>
            <Select
              allowClear
              style={{ width: 260 }}
              placeholder="选择供应商"
              value={supplierId}
              onChange={(value) => setSupplierId(value)}
              options={suppliers
                .filter((supplier) => supplier.status === 'active')
                .map((supplier) => ({ value: supplier.id, label: supplier.name }))}
            />
            {!supplierId ? (
              <>
                <Input
                  style={{ width: 220 }}
                  placeholder="或直接填写供应商名称"
                  value={supplierName}
                  onChange={(event) => setSupplierName(event.target.value)}
                />
                <Input
                  style={{ width: 180 }}
                  placeholder="供应商电话"
                  value={supplierPhone}
                  onChange={(event) => setSupplierPhone(event.target.value)}
                />
              </>
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
                  placeholder="选择规格"
                  value={item.skuId}
                  optionFilterProp="label"
                  onChange={(value) =>
                    setDraftItems((current) =>
                      current.map((row) =>
                        row.key === item.key ? { ...row, skuId: value } : row
                      )
                    )
                  }
                  options={inventoryOptions.map((option) => ({
                    value: option.skuId,
                    label: `${option.productName} ${option.specName}（${option.unit}，库存 ${option.quantity}）`
                  }))}
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
                  key: 'status',
                  label: '状态',
                  children: (
                    <Tag color={statusColors[viewDetail.status]}>
                      {statusLabels[viewDetail.status]}
                    </Tag>
                  )
                },
                { key: 'supplier', label: '供应商', children: viewDetail.supplierName ?? '—' },
                { key: 'phone', label: '联系电话', children: viewDetail.supplierPhone ?? '—' },
                { key: 'ordered', label: '采购金额', children: `¥${viewDetail.orderedAmount}` },
                { key: 'received', label: '已入库金额', children: `¥${viewDetail.receivedAmount}` },
                { key: 'expected', label: '预计到货', children: formatTime(viewDetail.expectedAt) },
                { key: 'created', label: '创建时间', children: formatTime(viewDetail.createdAt) },
                { key: 'submitted', label: '提交时间', children: formatTime(viewDetail.submittedAt) },
                { key: 'receivedAt', label: '入库时间', children: formatTime(viewDetail.receivedAt) },
                { key: 'cancelledAt', label: '取消时间', children: formatTime(viewDetail.cancelledAt) },
                { key: 'remark', label: '备注', children: viewDetail.remark || '—' },
                ...(viewDetail.cancelReason
                  ? [
                      {
                        key: 'cancelReason',
                        label: '取消原因',
                        children: viewDetail.cancelReason,
                        span: 2
                      }
                    ]
                  : [])
              ]}
            />
            <Table
              rowKey="id"
              size="small"
              {...getAdminTableProps(viewItemColumns)}
              dataSource={viewDetail.items}
              pagination={false}
            />
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
        title={editingSupplier ? '编辑供应商' : '新建供应商'}
        open={supplierModalOpen}
        onCancel={() => setSupplierModalOpen(false)}
        onOk={() => void submitSupplier()}
        confirmLoading={supplierSubmitting}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Input
            placeholder="供应商名称"
            value={supplierForm.name}
            onChange={(event) =>
              setSupplierForm((current) => ({ ...current, name: event.target.value }))
            }
          />
          <Input
            placeholder="联系人"
            value={supplierForm.contactName}
            onChange={(event) =>
              setSupplierForm((current) => ({ ...current, contactName: event.target.value }))
            }
          />
          <Input
            placeholder="电话"
            value={supplierForm.phone}
            onChange={(event) =>
              setSupplierForm((current) => ({ ...current, phone: event.target.value }))
            }
          />
          <Input
            placeholder="备注"
            value={supplierForm.remark}
            onChange={(event) =>
              setSupplierForm((current) => ({ ...current, remark: event.target.value }))
            }
          />
          {editingSupplier ? (
            <Select
              value={supplierForm.status}
              onChange={(value) =>
                setSupplierForm((current) => ({ ...current, status: value }))
              }
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' }
              ]}
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
