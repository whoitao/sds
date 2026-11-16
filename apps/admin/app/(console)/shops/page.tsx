'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button, Checkbox, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, TreeSelect, Upload } from 'antd';
import type { FormInstance, TableColumnsType } from 'antd';
import {
  EditOutlined,
  ImportOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  TeamOutlined,
  UploadOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { ImageCompressError, compressCoverImage } from '../../../lib/compress-image';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';

interface ShopRow {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  status: 'open' | 'closed' | 'suspended';
  longitude: string;
  latitude: string;
  announcement: string | null;
  coverUrl: string | null;
  businessHours: ShopBusinessHours | null;
  managerCount: number;
  createdAt: string;
}

/** 与 shops.business_hours 一致：按周几存 open/close，单日均在同一天内 */
type DayHours = { open: string; close: string };

const WEEKDAYS = [
  ['mon', '周一'],
  ['tue', '周二'],
  ['wed', '周三'],
  ['thu', '周四'],
  ['fri', '周五'],
  ['sat', '周六'],
  ['sun', '周日']
] as const;

type WeekdayKey = (typeof WEEKDAYS)[number][0];
type ShopBusinessHours = Partial<Record<WeekdayKey, DayHours>>;

interface MemberRow {
  id: string;
  userId: string;
  role: 'shop_manager' | 'shop_staff' | 'delivery';
  phone: string;
  name: string | null;
  createdAt: string;
}

const STATUS_META: Record<ShopRow['status'], { label: string; color: string }> = {
  open: { label: '营业中', color: 'success' },
  closed: { label: '已打烊', color: 'default' },
  suspended: { label: '已暂停', color: 'warning' }
};

const MEMBER_ROLE_LABELS: Record<MemberRow['role'], string> = {
  shop_manager: '店长',
  shop_staff: '店员',
  delivery: '配送员'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function formatBusinessHours(value: ShopBusinessHours | null) {
  if (!value) return '未设置';
  const days = Object.values(value).filter((day): day is DayHours =>
    Boolean(day?.open && day?.close)
  );
  if (days.length === 0) return '未设置';
  const same = days.every((day) => day.open === days[0].open && day.close === days[0].close);
  return same ? `${days[0].open} - ${days[0].close}` : `分日不同 · ${days.length} 天营业`;
}

/** 店铺图片：上传到 /api/admin/uploads（Supabase Storage），表单里只保留 URL */
function ShopCoverField({
  value: coverUrl,
  onChange
}: {
  value?: string | null;
  onChange?: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      {coverUrl ? (
        <img
          src={coverUrl}
          alt="店铺图片"
          style={{
            width: 144,
            height: 72,
            objectFit: 'cover',
            borderRadius: 8,
            border: `1px solid ${colors.border}`
          }}
        />
      ) : (
        <div
          style={{
            width: 144,
            height: 72,
            borderRadius: 8,
            border: `1px dashed ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: colors.textTertiary
          }}
        >
          暂无
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Space size={8}>
          <Upload
            accept="image/jpeg,image/png,image/webp,image/gif"
            maxCount={1}
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              setUploading(true);
              setUploadError('');
              try {
                // 上传前先压到 20KB 以内（2:1），服务端 5MB 限制保持不变
                const compressed = await compressCoverImage(file as File);
                const data = new FormData();
                data.append('file', compressed);
                data.append('dir', 'shops');
                const response = await fetch('/api/admin/uploads', { method: 'POST', body: data });
                const payload = await response.json();
                if (!response.ok || !payload?.url) {
                  const message = payload?.message ?? '上传失败';
                  setUploadError(message);
                  onError?.(new Error(message));
                  return;
                }
                onChange?.(payload.url);
                onSuccess?.(payload);
              } catch (error) {
                const message =
                  error instanceof ImageCompressError ? error.message : '上传失败';
                setUploadError(message);
                onError?.(new Error(message));
              } finally {
                setUploading(false);
              }
            }}
          >
            <Button size="small" icon={<UploadOutlined />} loading={uploading}>
              {coverUrl ? '重新上传' : '上传图片'}
            </Button>
          </Upload>
          {coverUrl ? (
            <Button
              size="small"
              variant="text"
              color="danger"
              onClick={() => onChange?.(null)}
            >
              移除
            </Button>
          ) : null}
        </Space>
        <span style={{ fontSize: 12, color: colors.textTertiary }}>
          JPG / PNG / WebP / GIF，自动压成 2:1 封面（约 20KB 内）
        </span>
        {uploadError ? (
          <span style={{ fontSize: 12, color: colors.danger }}>{uploadError}</span>
        ) : null}
      </div>
    </div>
  );
}

/** 营业时间：每天一段「开始 - 结束」，勾选休息即清空该天；不做跨天 */
function BusinessHoursField({
  value,
  onChange
}: {
  value?: ShopBusinessHours | null;
  onChange?: (next: ShopBusinessHours | null) => void;
}) {
  const hours = value ?? null;

  function update(day: WeekdayKey, next: DayHours | null) {
    const current: ShopBusinessHours = { ...(hours ?? {}) };
    if (next) current[day] = next;
    else delete current[day];
    onChange?.(Object.keys(current).length > 0 ? current : null);
  }

  function timeInput(day: WeekdayKey, hours: DayHours, field: keyof DayHours) {
    return (
      <input
        type="time"
        step={300}
        value={hours[field]}
        aria-label={`${day} ${field === 'open' ? '开始' : '结束'}时间`}
        onChange={(event) => update(day, { ...hours, [field]: event.target.value })}
        style={{
          width: 92,
          height: 28,
          padding: '0 8px',
          fontSize: 13,
          color: colors.text,
          background: 'transparent',
          border: `1px solid ${colors.border}`,
          borderRadius: 6
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {WEEKDAYS.map(([day, label]) => {
        const hours = value?.[day];
        const invalid = Boolean(hours && hours.close <= hours.open);
        return (
          <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 32, fontSize: 13, color: colors.textSecondary }}>{label}</span>
            {hours ? timeInput(day, hours, 'open') : null}
            {hours ? (
              <span style={{ fontSize: 12, color: colors.textTertiary }}>至</span>
            ) : null}
            {hours ? timeInput(day, hours, 'close') : null}
            <Checkbox
              checked={!hours}
              onChange={() => update(day, hours ? null : { open: '08:00', close: '20:00' })}
            >
              <span style={{ fontSize: 13, color: colors.textSecondary }}>休息</span>
            </Checkbox>
            {invalid ? (
              <span style={{ fontSize: 12, color: colors.danger }}>结束需晚于开始</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// 地图组件按需加载：高德脚本由组件挂载时注入，不进首屏包，也不在列表页加载
const AmapLocationPicker = dynamic(
  () => import('@sds/ui/amap').then((mod) => mod.AmapLocationPicker),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 260,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          color: '#8c8c8c',
          border: '1px solid #d9d9d9',
          borderRadius: 8
        }}
      >
        地图加载中…
      </div>
    )
  }
);

/** 把表单里的经纬度与地图组件互相打通：打开编辑时回显，选点后写回 */
function ShopLocationField({ form }: { form: FormInstance }) {
  const longitude = Form.useWatch('longitude', form);
  const latitude = Form.useWatch('latitude', form);

  const value = useMemo(() => {
    const lng = Number(longitude);
    const lat = Number(latitude);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { longitude: lng, latitude: lat } : null;
  }, [longitude, latitude]);

  return (
    <AmapLocationPicker
      value={value}
      onChange={(next) => {
        const currentAddress = form.getFieldValue('address');
        form.setFieldsValue({
          longitude: Number(next.longitude.toFixed(7)),
          latitude: Number(next.latitude.toFixed(7)),
          // 只在地址为空时用逆地理编码结果补上，避免覆盖手填地址
          ...(currentAddress || !next.address ? {} : { address: next.address.slice(0, 200) })
        });
      }}
    />
  );
}

export default function ShopsPage() {
  const { pageSize } = useAdminSettings();
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ShopRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState<ShopRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const [memberShop, setMemberShop] = useState<ShopRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  // 一键铺货：把已发布的总部商品补到该门店（只补缺，不覆盖门店价格）
  const [importShop, setImportShop] = useState<ShopRow | null>(null);
  const [importCategoryId, setImportCategoryId] = useState<string | undefined>();
  const [importing, setImporting] = useState(false);
  const [importTree, setImportTree] = useState<{ value: string; title: string; children?: { value: string; title: string }[] }[]>([]);
  const [notice, setNotice] = useState('');
  const [memberForm] = Form.useForm();

  // 全局「每页条数」变化后回到第 1 页重新加载
  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (status) params.set('status', status);

    try {
      const response = await fetch(`/api/admin/shops?${params}`, { cache: 'no-store' });
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
  }, [keyword, status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // Modal 通过 portal 渲染到 body，服务端不产出节点；forceRender 会让客户端首帧多出
  // 一份 DOM 造成 hydration 不一致。等客户端挂载后再渲染表单 Modal（第 368 行门控）。
  useEffect(() => {
    setMounted(true);
  }, []);

  const loadMembers = useCallback(async (shopId: string) => {
    setMemberLoading(true);
    try {
      const response = await fetch(`/api/admin/shops/${shopId}/members`, { cache: 'no-store' });
      const payload = await response.json();
      setMembers(response.ok ? (payload.items ?? []) : []);
    } catch {
      setMembers([]);
    } finally {
      setMemberLoading(false);
    }
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'open', coverUrl: null, businessHours: null });
    setFormOpen(true);
  }

  function openEdit(row: ShopRow) {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      address: row.address,
      phone: row.phone ?? '',
      longitude: Number(row.longitude),
      latitude: Number(row.latitude),
      announcement: row.announcement ?? '',
      coverUrl: row.coverUrl,
      businessHours: row.businessHours,
      status: row.status
    });
    setFormOpen(true);
  }

  async function submitShop() {
    const values = await form.validateFields();
    const businessHours = (values.businessHours ?? null) as ShopBusinessHours | null;
    const coverUrl = (values.coverUrl as string | null | undefined) ?? null;
    const invalidDay = Object.entries(businessHours ?? {}).find(
      ([, hours]) => hours && hours.close <= hours.open
    );
    if (invalidDay) {
      setError('营业时间的结束时间需晚于开始时间');
      return;
    }

    setSubmitting(true);
    try {
      const url = `/api/admin/shops${editing ? `/${editing.id}` : ''}`;
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          phone: values.phone || null,
          announcement: values.announcement || null,
          coverUrl: coverUrl || null,
          businessHours
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '保存失败');
        return;
      }
      setFormOpen(false);
      if (!editing && typeof payload.importedCount === 'number') {
        setNotice(`门店已创建，已自动铺货 ${payload.importedCount} 个商品`);
      }
      void load();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(row: ShopRow, next: ShopRow['status']) {
    const response = await fetch(`/api/admin/shops/${row.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next })
    });
    if (response.ok) void load();
  }

  async function addMember() {
    if (!memberShop) return;
    const values = await memberForm.validateFields();
    const response = await fetch(`/api/admin/shops/${memberShop.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    const payload = await response.json();
    if (!response.ok) {
      setMemberLoading(false);
      setError(payload?.message ?? '添加成员失败');
      return;
    }
    memberForm.resetFields();
    void loadMembers(memberShop.id);
    void load();
  }

  async function removeMember(member: MemberRow) {
    if (!memberShop) return;
    const response = await fetch(`/api/admin/shops/${memberShop.id}/members/${member.id}`, {
      method: 'DELETE'
    });
    if (response.ok) {
      void loadMembers(memberShop.id);
      void load();
    }
  }

  async function openImport(row: ShopRow) {
    setImportShop(row);
    setImportCategoryId(undefined);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/categories', { cache: 'no-store' });
      const payload = await response.json();
      const items: { id: string; parentId: string | null; name: string }[] = response.ok
        ? (payload.items ?? [])
        : [];
      const roots = items.filter((item) => item.parentId === null);
      setImportTree(
        roots.map((root) => ({
          value: root.id,
          title: root.name,
          children: items
            .filter((item) => item.parentId === root.id)
            .map((child) => ({ value: child.id, title: child.name }))
        }))
      );
    } catch {
      setImportTree([]);
    }
  }

  async function submitImport() {
    if (!importShop) return;
    setImporting(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/shops/${importShop.id}/catalog/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId: importCategoryId ?? null })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '铺货失败');
        return;
      }
      setNotice(
        `已为「${importShop.name}」新增 ${payload.created ?? 0} 个商品；已发布总部商品共 ${payload.publishedTotal ?? 0} 个`
      );
      setImportShop(null);
    } catch {
      setError('铺货失败');
    } finally {
      setImporting(false);
    }
  }

  const columns: TableColumnsType<ShopRow> = [
    {
      title: '店铺名称',
      dataIndex: 'name',
      width: 210,
      render: (value: string, row: ShopRow) => (
        <Space size={8}>
          {row.coverUrl ? (
            <img
              src={row.coverUrl}
              alt=""
              style={{ width: 56, height: 28, borderRadius: 6, objectFit: 'cover' }}
            />
          ) : null}
          <span>{value}</span>
        </Space>
      )
    },
    { title: '地址', dataIndex: 'address', width: 240, ellipsis: true },
    { title: '电话', dataIndex: 'phone', width: 120, render: (value: string | null) => value || '—' },
    {
      title: '营业时间',
      dataIndex: 'businessHours',
      width: 140,
      render: (value: ShopRow['businessHours']) => formatBusinessHours(value)
    },
    {
      title: '店长',
      dataIndex: 'managerCount',
      width: 76,
      render: (value: number) => (value > 0 ? `${value} 人` : '未绑定')
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (value: ShopRow['status']) => <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (value: string) => formatTime(value) },
    {
      title: '操作',
      key: 'action',
      width: 96,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row: ShopRow) => (
        <Space size={4}>
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<EditOutlined />}
            title="编辑"
            aria-label="编辑"
            onClick={() => openEdit(row)}
          />
          <Button
            variant="text"
            size="small"
            icon={<TeamOutlined />}
            title="店长"
            aria-label="店长"
            onClick={() => {
              setMemberShop(row);
              setMembers([]);
              void loadMembers(row.id);
            }}
          />
          <Button
            variant="text"
            size="small"
            icon={<ImportOutlined />}
            title="一键铺货"
            aria-label="一键铺货"
            onClick={() => void openImport(row)}
          />
          <Button
            variant="text"
            color={row.status === 'suspended' ? 'primary' : 'danger'}
            size="small"
            icon={row.status === 'suspended' ? <PlayCircleOutlined /> : <StopOutlined />}
            title={row.status === 'suspended' ? '恢复' : '暂停'}
            aria-label={row.status === 'suspended' ? '恢复' : '暂停'}
            onClick={() =>
              void changeStatus(row, row.status === 'suspended' ? 'open' : 'suspended')
            }
          />
        </Space>
      )
    }
  ];

  return (
    <div>
      <div
        style={{
          background: colors.surface,
          minHeight: '100vh'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            height: 44,
            padding: '0 12px',
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>店铺列表</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建店铺
          </Button>
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
          <Space.Compact>
            <Input
              allowClear
              value={searchText}
              placeholder="按店铺名称搜索…"
              style={{ width: 320 }}
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
              style={{ background: colors.subtle, borderColor: colors.border, color: colors.textSecondary }}
              onClick={() => {
                setKeyword(searchText.trim());
                setPage(1);
              }}
            />
          </Space.Compact>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'open', label: '营业中' },
              { value: 'closed', label: '已打烊' },
              { value: 'suspended', label: '已暂停' }
            ]}
          />
        </div>

        {error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
        ) : null}
        {notice && !error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>{notice}</div>
        ) : null}

        <Table<ShopRow>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (count) => `共 ${count} 条`,
            style: { margin: '12px' },
            onChange: setPage
          }}
        />
      </div>

      {mounted ? (
      <>
      <Modal
        open={Boolean(importShop)}
        title="一键铺货"
        okText="开始铺货"
        cancelText="取消"
        confirmLoading={importing}
        onOk={() => void submitImport()}
        onCancel={() => setImportShop(null)}
        forceRender
      >
        <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>
          将把已发布的总部商品补到「{importShop?.name}」。已在该门店存在的商品不会重复创建，门店已改的价格、上下架、排序不会被覆盖。
        </div>
        <TreeSelect
          allowClear
          showSearch
          treeDefaultExpandAll
          treeNodeFilterProp="title"
          placeholder="全部已发布商品（可选某个分类）"
          style={{ width: '100%' }}
          value={importCategoryId}
          onChange={(value?: string) => setImportCategoryId(value)}
          treeData={importTree}
        />
      </Modal>
      <Modal
        open={formOpen}
        title={editing ? '编辑店铺' : '新建店铺'}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submitShop()}
        onCancel={() => setFormOpen(false)}
        width={900}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          {/* 左右 1:1 两栏：左边是名称/电话/地址/地图/经纬度，右边是图片/营业时间/公告/状态 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              {/* 店铺名称与店铺电话同排，各占左列一半 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Form.Item name="name" label="店铺名称" rules={[{ required: true, message: '请输入店铺名称' }]}>
                  <Input maxLength={100} />
                </Form.Item>
                <Form.Item name="phone" label="店铺电话" rules={[{ pattern: /^1\d{10}$/, message: '请输入 11 位手机号' }]}>
                  <Input maxLength={11} placeholder="选填" />
                </Form.Item>
              </div>
              <Form.Item name="address" label="详细地址" rules={[{ required: true, message: '请输入地址' }]}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item
                label="地图选点"
                tooltip="点击地图或拖动标记，自动回填经纬度；搜索框可直接找地点"
                extra="地址为空时会用选点结果回填，已手填的地址不会被覆盖"
              >
                {formOpen ? <ShopLocationField form={form} /> : null}
              </Form.Item>
              <Space size={12} style={{ display: 'flex' }}>
                <Form.Item name="longitude" label="经度" rules={[{ required: true, message: '请输入经度' }]}>
                  <InputNumber style={{ width: 150 }} min={-180} max={180} step={0.0000001} stringMode />
                </Form.Item>
                <Form.Item name="latitude" label="纬度" rules={[{ required: true, message: '请输入纬度' }]}>
                  <InputNumber style={{ width: 150 }} min={-90} max={90} step={0.0000001} stringMode />
                </Form.Item>
              </Space>
            </div>
            <div style={{ minWidth: 0 }}>
              <Form.Item name="coverUrl" label="店铺图片" extra="上传后保存图片地址，不会把图片存进数据库">
                <ShopCoverField />
              </Form.Item>
              <Form.Item
                name="businessHours"
                label="营业时间"
                extra="结束时间需晚于开始时间；勾选休息表示当天不营业，暂不支持跨天营业"
              >
                <BusinessHoursField />
              </Form.Item>
              <Form.Item name="announcement" label="店铺公告" rules={[{ max: 500, message: '最多 500 字' }]}>
                <Input.TextArea rows={3} maxLength={500} placeholder="选填" />
              </Form.Item>
              <Form.Item name="status" label="营业状态" rules={[{ required: true, message: '请选择状态' }]}>
                <Select
                  options={[
                    { value: 'open', label: '营业中' },
                    { value: 'closed', label: '已打烊' },
                    { value: 'suspended', label: '已暂停' }
                  ]}
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
      </>
      ) : null}

      <Modal
        open={Boolean(memberShop)}
        title={`店长绑定 · ${memberShop?.name ?? ''}`}
        footer={null}
        onCancel={() => setMemberShop(null)}
        destroyOnHidden
      >
        <Form form={memberForm} layout="inline" style={{ margin: '8px 0 16px' }} onFinish={() => void addMember()}>
          <Form.Item name="phone" rules={[{ required: true, pattern: /^1\d{10}$/, message: '11 位手机号' }]}>
            <Input placeholder="业务用户手机号" style={{ width: 180 }} maxLength={11} />
          </Form.Item>
          <Form.Item name="role" initialValue="shop_manager" rules={[{ required: true }]}>
            <Select
              style={{ width: 120 }}
              options={[
                { value: 'shop_manager', label: '店长' },
                { value: 'shop_staff', label: '店员' },
                { value: 'delivery', label: '配送员' }
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            添加
          </Button>
        </Form>

        {members.length === 0 && !memberLoading ? (
          <Empty description="还没有绑定成员" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          // antd 6.6 起 List 已弃用，这里用普通列表结构保持原有信息层级
          <div>
            {memberLoading ? (
              <div style={{ padding: '8px 0', fontSize: 13, color: colors.textTertiary }}>加载中…</div>
            ) : null}
            {members.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: `1px solid ${colors.border}`
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: colors.text }}>
                    {member.name || '未命名'} · {member.phone}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textTertiary, marginTop: 2 }}>
                    {MEMBER_ROLE_LABELS[member.role]} · {formatTime(member.createdAt)}
                  </div>
                </div>
                <a onClick={() => void removeMember(member)}>解绑</a>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
