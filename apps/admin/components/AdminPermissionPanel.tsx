'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminColors as colors } from '../lib/theme';
import { useConfirmDanger } from './AdminConfirmProvider';

interface PermissionItem {
  id: string;
  code: string;
  module: string;
  action: string;
  name: string;
  description: string | null;
}

interface RoleGrant {
  permissionId: string;
  code: string;
  name: string;
  module: string;
  action: string;
  conditions: Record<string, unknown> | null;
}

interface RoleItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: RoleGrant[];
  adminIds: string[];
}

interface AdminItem {
  id: string;
  username: string;
  displayName: string;
}

const MODULE_LABELS: Record<string, string> = {
  users: '业务用户',
  admins: '管理员',
  roles: '角色权限',
  shops: '店铺',
  products: '商品',
  orders: '订单',
  inventory: '库存',
  purchases: '采购',
  reports: '报表'
};

const CONDITION_PLACEHOLDER = '{"attr":"resource.status","op":"neq","value":"suspended"}';

/** 管理员权限（ABAC）：管理员-角色绑定 + 角色权限授予与属性条件 */
export function AdminPermissionPanel() {
  const confirmDanger = useConfirmDanger();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [admins, setAdmins] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [grantDraft, setGrantDraft] = useState<
    Record<string, { checked: boolean; conditions: string }>
  >({});
  const [bindingDraft, setBindingDraft] = useState<Record<string, string[]>>({});
  const [savingAdminId, setSavingAdminId] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roleRes, permRes, adminRes] = await Promise.all([
        fetch('/api/admin/roles', { cache: 'no-store' }),
        fetch('/api/admin/permissions', { cache: 'no-store' }),
        fetch('/api/admin/admins?pageSize=100', { cache: 'no-store' })
      ]);
      if (!roleRes.ok || !permRes.ok || !adminRes.ok) throw new Error('加载失败');
      const roleJson = (await roleRes.json()) as { items: RoleItem[] };
      const permJson = (await permRes.json()) as { items: PermissionItem[] };
      const adminJson = (await adminRes.json()) as { items: AdminItem[] };

      setRoles(roleJson.items);
      setPermissions(permJson.items);
      setAdmins(adminJson.items);
      setSelectedRoleId((current) => current || roleJson.items[0]?.id || '');

      const bindings: Record<string, string[]> = {};
      for (const admin of adminJson.items) {
        bindings[admin.id] = roleJson.items.filter((role) => role.adminIds.includes(admin.id)).map((role) => role.id);
      }
      setBindingDraft(bindings);
    } catch {
      messageApi.error('权限数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  useEffect(() => {
    if (!selectedRole) {
      setGrantDraft({});
      return;
    }
    const next: Record<string, { checked: boolean; conditions: string }> = {};
    for (const permission of permissions) {
      const granted = selectedRole.permissions.find((item) => item.permissionId === permission.id);
      next[permission.id] = {
        checked: Boolean(granted),
        conditions: granted?.conditions ? JSON.stringify(granted.conditions) : ''
      };
    }
    setGrantDraft(next);
  }, [selectedRole, permissions]);

  const moduleGroups = useMemo(() => {
    const groups = new Map<string, PermissionItem[]>();
    for (const permission of permissions) {
      const list = groups.get(permission.module) ?? [];
      list.push(permission);
      groups.set(permission.module, list);
    }
    return Array.from(groups.entries());
  }, [permissions]);

  async function saveGrants() {
    if (!selectedRole) return;
    const payload: { permissionId: string; conditions: Record<string, unknown> | null }[] = [];
    for (const [permissionId, draft] of Object.entries(grantDraft)) {
      if (!draft.checked) continue;
      let conditions: Record<string, unknown> | null = null;
      if (draft.conditions.trim()) {
        try {
          conditions = JSON.parse(draft.conditions) as Record<string, unknown>;
        } catch {
          messageApi.error('条件不是合法 JSON');
          return;
        }
      }
      payload.push({ permissionId, conditions });
    }

    setSavingRole(true);
    try {
      const response = await fetch(`/api/admin/roles/${selectedRole.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissions: payload })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        messageApi.error(body?.message ?? '保存失败');
        return;
      }
      messageApi.success('权限已保存');
      await load();
    } finally {
      setSavingRole(false);
    }
  }

  async function saveBindings(adminId: string) {
    setSavingAdminId(adminId);
    try {
      const response = await fetch(`/api/admin/admins/${adminId}/roles`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleIds: bindingDraft[adminId] ?? [] })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        messageApi.error(body?.message ?? '保存失败');
        return;
      }
      messageApi.success('角色已更新');
      await load();
    } finally {
      setSavingAdminId('');
    }
  }

  async function removeRole(role: RoleItem) {
    const confirmed = await confirmDanger({
      title: `删除角色「${role.name}」？`,
      content: '删除后不可恢复，已绑定该角色的管理员会立即失去对应权限。',
      okText: '删除角色'
    });
    if (!confirmed) return;
    const response = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      messageApi.error(body?.message ?? '删除失败');
      return;
    }
    messageApi.success('角色已删除');
    if (selectedRoleId === role.id) setSelectedRoleId('');
    await load();
  }

  async function createRole() {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values)
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        messageApi.error(body?.message ?? '创建失败');
        return;
      }
      messageApi.success('角色已创建');
      setCreateOpen(false);
      createForm.resetFields();
      await load();
    } finally {
      setCreating(false);
    }
  }

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));

  return (
    <div style={{ padding: '12px 12px 16px' }}>
      {contextHolder}

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: colors.text }}>
        管理员与角色
      </div>
      <Table<AdminItem>
        rowKey="id"
        size="small"
        sticky
        loading={loading}
        dataSource={admins}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: '账号', dataIndex: 'username', width: 180 },
          { title: '姓名', dataIndex: 'displayName', width: 160 },
          {
            title: '角色',
            width: 360,
            render: (_, row) => (
              <Select
                mode="multiple"
                style={{ width: '100%' }}
                options={roleOptions}
                value={bindingDraft[row.id] ?? []}
                onChange={(value) => setBindingDraft((current) => ({ ...current, [row.id]: value }))}
              />
            )
          },
          {
            title: '操作',
            width: 110,
            align: 'right',
            render: (_, row) => (
              <Button
                size="small"
                variant="text"
                color="primary"
                loading={savingAdminId === row.id}
                onClick={() => void saveBindings(row.id)}
              >
                保存
              </Button>
            )
          }
        ]}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '16px 0 8px'
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>角色与权限</span>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建角色
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 240,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'hidden'
          }}
        >
          {roles.map((role) => {
            const active = role.id === selectedRoleId;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedRoleId(role.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  borderBottom: `1px solid ${colors.border}`,
                  background: active ? colors.accentLight : 'transparent',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: colors.text }}>
                    {role.name}
                  </span>
                  {role.isSystem ? <Tag color="default">内置</Tag> : null}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  {role.code} · {role.adminIds.length} 人 · {role.permissions.length} 项权限
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedRole ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>
                  正在编辑：{selectedRole.name}（{selectedRole.code}）
                </span>
                <div style={{ flex: 1 }} />
                {selectedRole.isSystem ? null : (
                  <Button
                    size="small"
                    danger
                    variant="text"
                    icon={<DeleteOutlined />}
                    onClick={() => void removeRole(selectedRole)}
                  >
                    删除
                  </Button>
                )}
                <Button size="small" type="primary" loading={savingRole} onClick={() => void saveGrants()}>
                  保存授予
                </Button>
              </div>

              <Table<PermissionItem>
                rowKey="id"
                size="small"
                sticky
                pagination={false}
                dataSource={permissions}
                scroll={{ x: 'max-content' }}
                columns={[
                  {
                    title: '模块',
                    width: 100,
                    render: (_, row) => MODULE_LABELS[row.module] ?? row.module
                  },
                  {
                    title: '权限',
                    width: 220,
                    render: (_, row) => (
                      <Space size={6}>
                        <span style={{ fontSize: 13 }}>{row.name}</span>
                        <span style={{ fontSize: 12, color: colors.textSecondary }}>{row.code}</span>
                      </Space>
                    )
                  },
                  {
                    title: '授予',
                    width: 70,
                    render: (_, row) => (
                      <Checkbox
                        checked={grantDraft[row.id]?.checked ?? false}
                        onChange={(event) =>
                          setGrantDraft((current) => ({
                            ...current,
                            [row.id]: {
                              checked: event.target.checked,
                              conditions: current[row.id]?.conditions ?? ''
                            }
                          }))
                        }
                      />
                    )
                  },
                  {
                    title: 'ABAC 条件（JSON，留空为无条件）',
                    render: (_, row) => (
                      <Input
                        size="small"
                        placeholder={CONDITION_PLACEHOLDER}
                        disabled={!grantDraft[row.id]?.checked}
                        value={grantDraft[row.id]?.conditions ?? ''}
                        onChange={(event) =>
                          setGrantDraft((current) => ({
                            ...current,
                            [row.id]: {
                              checked: current[row.id]?.checked ?? false,
                              conditions: event.target.value
                            }
                          }))
                        }
                      />
                    )
                  }
                ]}
                expandable={{
                  expandedRowRender: (row) => (
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>
                      {MODULE_LABELS[row.module] ?? row.module} · {row.code}
                      {row.description ? ` · ${row.description}` : ''}
                    </div>
                  ),
                  rowExpandable: (row) => Boolean(row.description)
                }}
              />
            </>
          ) : (
            <div style={{ padding: 24, color: colors.textSecondary, fontSize: 13 }}>
              请选择左侧角色，或先新建一个角色
            </div>
          )}
        </div>
      </div>

      <Modal
        open={createOpen}
        title="新建角色"
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        onOk={() => void createRole()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }, { max: 50 }]}
          >
            <Input placeholder="如：门店审核员" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="code"
            label="角色编码"
            rules={[
              { required: true, message: '请输入角色编码' },
              { pattern: /^[a-z][a-z0-9_]{2,49}$/, message: '小写字母开头，仅含小写字母、数字、下划线' }
            ]}
          >
            <Input placeholder="如：shop_auditor" maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label="说明" rules={[{ max: 200 }]}>
            <Input.TextArea rows={2} maxLength={200} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
