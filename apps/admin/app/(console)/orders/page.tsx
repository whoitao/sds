'use client';

// 订单管理：查看顾客订单、接单/配送/完成/取消、退款审核；取消与退款都会回补库存
// 线上已收款的订单不能直接取消，必须走「同意退款」，避免钱货两头空
// 列表沿用后台紧凑规格：筛选行、固定操作列、Tag、分页跟随全局每页条数
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@sds/shared';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';
import { useConfirmDanger } from '../../../components/AdminConfirmProvider';
import { getAdminTableProps } from '../../../lib/table';
import {
  AdminFilterField,
  AdminFilterSearch,
  AdminListPage
} from '../../../components/AdminListPage';

interface ShopOption {
  id: string;
  name: string;
}

interface OrderRow {
  id: string;
  orderNo: string;
  shopId: string;
  shopName: string;
  customerName: string;
  customerPhone: string | null;
  status: OrderStatus;
  statusLabel: string;
  fulfillmentType: 'delivery' | 'pickup';
  contactName: string | null;
  contactPhone: string | null;
  itemCount: string;
  totalAmount: string;
  remark: string | null;
  paymentMethod: 'wechat' | 'cash' | 'balance' | null;
  paymentMethodLabel: string | null;
  paidAt: string | null;
  refundAmount: string | null;
  createdAt: string;
  itemSummary: string | null;
}

interface OrderItem {
  id: string;
  productId: string;
  skuId: string;
  name: string;
  specName: string | null;
  imageUrl: string | null;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  unitPrice: string;
  quantity: string;
  subtotal: string;
}

interface OrderDetail extends Omit<OrderRow, 'itemSummary'> {
  addressText: string | null;
  subtotal: string;
  deliveryFee: string;
  discountAmount: string;
  paymentStatus: string | null;
  paymentProvider: string | null;
  paymentExternalNo: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  refundRejectedReason: string | null;
  cancelledReason: string | null;
  completedAt: string | null;
  updatedAt: string;
  items: OrderItem[];
}

const statusColors: Record<string, string> = {
  pending_payment: 'orange',
  paid: 'blue',
  preparing: 'gold',
  delivering: 'processing',
  pickup_ready: 'cyan',
  completed: 'success',
  refund_pending: 'volcano',
  cancelled: 'default',
  refunded: 'red'
};

const paymentStatusLabels: Record<string, string> = {
  created: '待支付',
  paid: '已收款',
  offline: '线下收款',
  refunded: '已退款',
  cancelled: '已作废'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function formatQuantity(value: string, mode: OrderItem['quantityMode']) {
  return mode === 'integer' ? String(Math.round(Number(value))) : Number(value).toFixed(2);
}

/** 线上通道已经收到钱：取消必须先退款 */
function isOnlinePaid(row: Pick<OrderRow, 'paymentMethod' | 'paidAt'>) {
  return (row.paymentMethod === 'wechat' || row.paymentMethod === 'balance') && !!row.paidAt;
}

function paymentSummary(row: Pick<OrderRow, 'status' | 'paymentMethod' | 'paidAt' | 'refundAmount'>) {
  if (row.status === 'refunded') return row.refundAmount ? `已退 ¥${row.refundAmount}` : '已退款';
  if (row.status === 'cancelled') return '未收款';
  if (row.paidAt) return '已收款';
  return row.paymentMethod === 'cash' ? '待当面收' : '未付款';
}

function nextActions(row: Pick<OrderRow, 'status' | 'fulfillmentType' | 'paymentMethod' | 'paidAt'>) {
  const actions: { status: OrderStatus; label: string; danger?: boolean }[] = [];
  if (row.status === 'paid') actions.push({ status: 'preparing', label: '接单' });
  if (row.status === 'preparing') {
    actions.push(
      row.fulfillmentType === 'pickup'
        ? { status: 'pickup_ready', label: '备货完成' }
        : { status: 'delivering', label: '开始配送' }
    );
  }
  if (row.status === 'delivering' || row.status === 'pickup_ready') {
    actions.push({ status: 'completed', label: '完成' });
  }
  if (['paid', 'preparing', 'pickup_ready'].includes(row.status) && !isOnlinePaid(row)) {
    actions.push({ status: 'cancelled', label: '取消', danger: true });
  }
  return actions;
}

/** 门店可主动退款的已收款状态 */
const REFUNDABLE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'pickup_ready'];

export default function OrdersPage() {
  const [modal, contextHolder] = Modal.useModal();
  const confirmDanger = useConfirmDanger();
  const { pageSize } = useAdminSettings();
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [shopId, setShopId] = useState<string | undefined>();
  const [status, setStatus] = useState<OrderStatus | undefined>();
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; orderNo: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    async function loadShops() {
      try {
        const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
        const payload = await response.json();
        setShops(response.ok ? (payload.items ?? []) : []);
      } catch {
        setShops([]);
      }
    }
    void loadShops();
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (shopId) query.set('shopId', shopId);
      if (status) query.set('status', status);
      if (keyword.trim()) query.set('keyword', keyword.trim());
      const response = await fetch(`/api/admin/orders?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '订单加载失败');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [keyword, page, pageSize, shopId, status]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/orders/${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '订单详情加载失败');
        return;
      }
      setDetail(payload.order ?? null);
    } catch {
      setError('接口不可用');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openDetail(row: OrderRow) {
    setDetailOpen(true);
    setDetail(null);
    void loadDetail(row.id);
  }

  async function changeStatus(
    target: Pick<OrderRow, 'id' | 'orderNo'>,
    next: OrderStatus,
    remark?: string
  ) {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/orders/${target.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next, remark })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '状态更新失败');
        return;
      }
      void loadOrders();
      if (detailOpen && detail?.id === target.id) void loadDetail(target.id);
    } catch {
      setError('状态更新失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmAction(row: Pick<OrderRow, 'id' | 'orderNo'>, next: OrderStatus) {
    if (next === 'cancelled') {
      const confirmed = await confirmDanger({
        title: `取消订单 ${row.orderNo}？`,
        content: '取消后商品数量会回补到门店库存，顾客端会看到「已取消」；不可撤销。',
        okText: '取消订单'
      });
      if (confirmed) await changeStatus(row, next);
      return;
    }
    if (next === 'completed') {
      modal.confirm({
        title: `确认订单 ${row.orderNo} 已完成？`,
        content: '完成后顾客端会显示已完成，订单不可再修改。',
        okText: '完成订单',
        cancelText: '返回',
        onOk: () => changeStatus(row, next)
      });
      return;
    }
    void changeStatus(row, next);
  }

  async function decideRefund(
    target: Pick<OrderRow, 'id' | 'orderNo'>,
    decision: 'approve' | 'reject',
    remark?: string
  ) {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/orders/${target.id}/refund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, remark })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '退款处理失败');
        return false;
      }
      void loadOrders();
      if (detailOpen && detail?.id === target.id) void loadDetail(target.id);
      return true;
    } catch {
      setError('退款处理失败');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRefund(row: Pick<OrderRow, 'id' | 'orderNo' | 'totalAmount'>) {
    const confirmed = await confirmDanger({
      title: `给订单 ${row.orderNo} 退款 ¥${row.totalAmount}？`,
      content: '退款后订单变为「已退款」，商品数量会回补到门店库存，顾客端会看到退款结果；不可撤销。',
      okText: '同意退款'
    });
    if (confirmed) await decideRefund(row, 'approve');
  }

  function askReject(row: Pick<OrderRow, 'id' | 'orderNo'>) {
    setError('');
    setRejectReason('');
    setRejectTarget({ id: row.id, orderNo: row.orderNo });
  }

  const columns: TableColumnsType<OrderRow> = [
    {
      title: '订单号',
      key: 'orderNo',
      width: 210,
      render: (_, row) => (
        <div>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openDetail(row)}>
            {row.orderNo}
          </Button>
          <div style={{ fontSize: 12, opacity: 0.65 }}>{formatTime(row.createdAt)}</div>
        </div>
      )
    },
    {
      title: '门店',
      dataIndex: 'shopName',
      width: 190
    },
    {
      title: '顾客',
      key: 'customer',
      width: 150,
      render: (_, row) => (
        <div>
          <div>{row.customerName}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>{row.customerPhone ?? '—'}</div>
        </div>
      )
    },
    {
      title: '商品',
      key: 'items',
      width: 220,
      render: (_, row) => (
        <div>
          <div
            style={{
              fontSize: 13,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical'
            }}
            title={row.itemSummary ?? undefined}
          >
            {row.itemSummary ?? '—'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>共 {Number(row.itemCount)} 件</div>
        </div>
      )
    },
    {
      title: '金额',
      key: 'amount',
      width: 140,
      align: 'left',
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>¥{row.totalAmount}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            {row.paymentMethodLabel ?? '—'} · {paymentSummary(row)}
          </div>
        </div>
      )
    },
    {
      title: '方式',
      dataIndex: 'fulfillmentType',
      width: 72,
      render: (value: OrderRow['fulfillmentType']) =>
        value === 'pickup' ? <Tag>自取</Tag> : <Tag color="blue">配送</Tag>
    },
    {
      title: '状态',
      key: 'status',
      width: 88,
      render: (_, row) => (
        <Tag color={statusColors[row.status]}>{row.statusLabel}</Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      align: 'right',
      render: (_, row) => {
        const actions = nextActions(row);
        const refundable =
          row.status === 'refund_pending' ||
          (isOnlinePaid(row) && REFUNDABLE_STATUSES.includes(row.status));
        return (
          <Space size={4}>
            <Button size="small" onClick={() => openDetail(row)}>
              查看
            </Button>
            {actions.map((action) => (
              <Button
                key={action.status}
                size="small"
                type={action.danger ? 'default' : 'primary'}
                danger={action.danger}
                disabled={submitting}
                onClick={() => confirmAction(row, action.status)}
              >
                {action.label}
              </Button>
            ))}
            {refundable ? (
              <>
                <Button
                  size="small"
                  type="primary"
                  danger
                  disabled={submitting}
                  onClick={() => confirmRefund(row)}
                >
                  {row.status === 'refund_pending' ? '同意退款' : '退款'}
                </Button>
                {row.status === 'refund_pending' ? (
                  <Button size="small" disabled={submitting} onClick={() => askReject(row)}>
                    驳回
                  </Button>
                ) : null}
              </>
            ) : null}
          </Space>
        );
      }
    }
  ];

  const itemColumns: TableColumnsType<OrderItem> = [
    {
      title: '商品',
      key: 'name',
      render: (_, item) => (
        <div>
          <div>{item.name}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            {item.specName ?? '—'} · {item.unit}
          </div>
        </div>
      )
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      width: 90,
      render: (value: string) => `¥${value}`
    },
    {
      title: '数量',
      key: 'quantity',
      width: 90,
      render: (_, item) => `${formatQuantity(item.quantity, item.quantityMode)} ${item.unit}`
    },
    {
      title: '小计',
      dataIndex: 'subtotal',
      width: 100,
      align: 'right',
      render: (value: string) => `¥${value}`
    }
  ];

  return (
    <AdminListPage
      title="订单管理"
      actions={
        <Space size={8}>
          <Button icon={<ReloadOutlined />} onClick={() => void loadOrders()}>
            刷新
          </Button>
          <TestDataCleanupButton onCleaned={() => void loadOrders()} />
        </Space>
      }
      filters={
        <>
          <AdminFilterField>
            <Select
              allowClear
              placeholder="全部门店"
              value={shopId}
              onChange={(value) => {
                setShopId(value);
                setPage(1);
              }}
              options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
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
              options={(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((value) => ({
                value,
                label: ORDER_STATUS_LABELS[value]
              }))}
            />
          </AdminFilterField>
          <AdminFilterSearch
            value={keywordInput}
            placeholder="订单号 / 顾客姓名 / 手机号"
            onChange={setKeywordInput}
            onSearch={() => {
              setKeyword(keywordInput);
              setPage(1);
            }}
          />
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

      <Drawer
        title={detail ? `订单详情 · ${detail.orderNo}` : '订单详情'}
        size={720}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
        extra={
          detail ? (
            <Space>
              {nextActions(detail).map((action) => (
                <Button
                  key={action.status}
                  type={action.danger ? 'default' : 'primary'}
                  danger={action.danger}
                  disabled={submitting}
                  onClick={() => confirmAction(detail, action.status)}
                >
                  {action.label}
                </Button>
              ))}
              {detail.status === 'refund_pending' ||
              (isOnlinePaid(detail) && REFUNDABLE_STATUSES.includes(detail.status)) ? (
                <>
                  <Button
                    type="primary"
                    danger
                    disabled={submitting}
                    onClick={() => confirmRefund(detail)}
                  >
                    {detail.status === 'refund_pending' ? '同意退款' : '退款'}
                  </Button>
                  {detail.status === 'refund_pending' ? (
                    <Button disabled={submitting} onClick={() => askReject(detail)}>
                      驳回
                    </Button>
                  ) : null}
                </>
              ) : null}
            </Space>
          ) : null
        }
      >
        {detail ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                {
                  key: 'status',
                  label: '状态',
                  children: <Tag color={statusColors[detail.status]}>{detail.statusLabel}</Tag>
                },
                {
                  key: 'fulfillment',
                  label: '方式',
                  children: detail.fulfillmentType === 'pickup' ? '到店自取' : '配送上门'
                },
                { key: 'shop', label: '门店', children: detail.shopName },
                { key: 'customer', label: '顾客', children: detail.customerName },
                { key: 'contact', label: '联系人', children: detail.contactName ?? '—' },
                { key: 'phone', label: '联系电话', children: detail.contactPhone ?? '—' },
                {
                  key: 'address',
                  label: '收货地址',
                  children: detail.addressText ?? '—'
                },
                { key: 'created', label: '下单时间', children: formatTime(detail.createdAt) },
                { key: 'total', label: '订单金额', children: `¥${detail.totalAmount}` },
                {
                  key: 'payment',
                  label: '付款方式',
                  children: detail.paymentMethodLabel ?? '—'
                },
                {
                  key: 'paymentStatus',
                  label: '收款状态',
                  children: (
                    <Space size={4}>
                      <span>
                        {detail.paymentStatus
                          ? (paymentStatusLabels[detail.paymentStatus] ?? detail.paymentStatus)
                          : '—'}
                      </span>
                      {detail.paymentExternalNo ? (
                        <Tag>{detail.paymentExternalNo}</Tag>
                      ) : null}
                    </Space>
                  )
                },
                { key: 'paidAt', label: '付款时间', children: formatTime(detail.paidAt) },
                { key: 'remark', label: '顾客备注', children: detail.remark || '—' },
                {
                  key: 'completed',
                  label: '完成时间',
                  children: formatTime(detail.completedAt)
                },
                ...(detail.refundReason
                  ? [{ key: 'refundReason', label: '退款理由', children: detail.refundReason }]
                  : []),
                ...(detail.refundRejectedReason
                  ? [
                      {
                        key: 'refundRejectedReason',
                        label: '驳回理由',
                        children: detail.refundRejectedReason
                      }
                    ]
                  : []),
                ...(detail.refundedAt
                  ? [
                      {
                        key: 'refundedAt',
                        label: '退款时间',
                        children: `${formatTime(detail.refundedAt)} · ¥${detail.refundAmount ?? detail.totalAmount}`
                      }
                    ]
                  : []),
                ...(detail.cancelledReason
                  ? [
                      {
                        key: 'cancelledReason',
                        label: '取消原因',
                        children: detail.cancelledReason
                      }
                    ]
                  : [])
              ]}
            />

            <Table
              rowKey="id"
              size="small"
              {...getAdminTableProps(itemColumns)}
              dataSource={detail.items}
              pagination={false}
              summary={() =>
                detail.items.length > 0 ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}>
                      <span style={{ fontWeight: 600 }}>合计</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <span style={{ fontWeight: 600 }}>¥{detail.totalAmount}</span>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                ) : null
              }
            />
          </div>
        ) : null}
      </Drawer>

      <Modal
        title={rejectTarget ? `驳回 ${rejectTarget.orderNo} 的退款申请` : '驳回退款申请'}
        open={rejectTarget !== null}
        okText="驳回申请"
        okButtonProps={{ danger: true, disabled: submitting || rejectReason.trim() === '' }}
        cancelText="返回"
        confirmLoading={submitting}
        onOk={async () => {
          if (!rejectTarget || submitting) return;
          if (await decideRefund(rejectTarget, 'reject', rejectReason.trim())) {
            setRejectTarget(null);
          }
        }}
        onCancel={() => {
          if (!submitting) setRejectTarget(null);
        }}
      >
        {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}
        <p style={{ marginBottom: 8, opacity: 0.65 }}>
          订单会回到顾客申请退款前的状态，下面的说明会显示在顾客的订单里。
        </p>
        <Input.TextArea
          rows={3}
          maxLength={200}
          showCount
          value={rejectReason}
          placeholder="例如：菜已经在配送路上了，麻烦您先收下"
          onChange={(event) => setRejectReason(event.target.value)}
        />
      </Modal>
    </AdminListPage>
  );
}
