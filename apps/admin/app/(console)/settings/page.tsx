'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Segmented, Select, Skeleton, Space, Switch, Tabs } from 'antd';
import { adminColors as colors } from '../../../lib/theme';
import { AdminListPage } from '../../../components/AdminListPage';
import {
  PAGE_SIZE_OPTIONS,
  useAdminSettings,
  type ThemePreference
} from '../../../components/AdminSettingsProvider';
import type { DisplayDensity } from '../../../lib/display';

const { TextArea } = Input;

interface SiteSettingsValue {
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  siteUrl: string;
  defaultTitle: string;
  defaultKeywords: string;
  defaultDescription: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

const EMPTY_SETTINGS: SiteSettingsValue = {
  maintenanceEnabled: false,
  maintenanceMessage: '',
  siteUrl: '',
  defaultTitle: '',
  defaultKeywords: '',
  defaultDescription: '',
  updatedAt: null,
  updatedByName: null
};

const cardStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 16
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: colors.text,
  marginBottom: 12
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: colors.text,
  marginBottom: 6
};

const hintStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.7,
  color: colors.textSecondary
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '尚未保存过';
}

const THEME_CHOICES: { label: string; value: ThemePreference }[] = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'system' }
];

const DISPLAY_CHOICES: { label: string; value: DisplayDensity }[] = [
  { label: '紧凑', value: 'compact' },
  { label: '标准', value: 'standard' },
  { label: '宽松', value: 'relaxed' }
];

/** 外观设置：直接复用账号菜单里的 useAdminSettings，即时生效并写入账号偏好 */
function GeneralSettingsPanel() {
  const { theme, pageSize, displayDensity, setTheme, setPageSize, setDisplayDensity } =
    useAdminSettings();

  return (
    <div style={{ padding: 16, maxWidth: 760 }}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <section style={cardStyle}>
          <div style={sectionTitleStyle}>外观设置</div>
          <div style={{ ...hintStyle, marginTop: 0, marginBottom: 16 }}>
            改动即时生效，并保存到当前管理员账号；刷新页面或换设备登录后保持。
          </div>

          <div>
            <label style={labelStyle}>主题</label>
            <Segmented
              value={theme}
              options={THEME_CHOICES}
              onChange={(value) => setTheme(value as ThemePreference)}
            />
            <div style={hintStyle}>
              浅色 / 深色 / 跟随系统；选择后立即切换全站配色，并同步到登录页与后续访问。
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>分页</label>
            <Select
              style={{ width: 160 }}
              value={pageSize}
              onChange={(value) => setPageSize(value)}
              options={PAGE_SIZE_OPTIONS.map((size) => ({
                value: size,
                label: `每页 ${size} 条`
              }))}
            />
            <div style={hintStyle}>列表页默认每页条数，对所有列表页生效，并保存在账号偏好中。</div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>展示效果</label>
            <Segmented
              value={displayDensity}
              options={DISPLAY_CHOICES}
              onChange={(value) => setDisplayDensity(value as DisplayDensity)}
            />
            <div style={hintStyle}>
              紧凑 / 标准 / 宽松三档字号与行高，调整后立即作用于菜单、表格等全局内容。
            </div>
          </div>
        </section>
      </Space>
    </div>
  );
}

export default function SiteSettingsPage() {
  const [values, setValues] = useState<SiteSettingsValue>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'site' | 'general'>('site');
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setForbidden(false);
    try {
      const response = await fetch('/api/admin/settings/site', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) {
        setLoadError(payload?.message ?? '加载站点设置失败');
        return;
      }
      setValues({ ...EMPTY_SETTINGS, ...payload });
    } catch {
      setLoadError('接口不可用，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update<K extends keyof SiteSettingsValue>(key: K, value: SiteSettingsValue[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  }

  async function save() {
    if (values.maintenanceEnabled && !values.maintenanceMessage.trim()) {
      setNotice({ type: 'error', text: '启用站点维护时必须填写维护通知' });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/settings/site', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          maintenanceEnabled: values.maintenanceEnabled,
          maintenanceMessage: values.maintenanceMessage,
          siteUrl: values.siteUrl,
          defaultTitle: values.defaultTitle,
          defaultKeywords: values.defaultKeywords,
          defaultDescription: values.defaultDescription
        })
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) {
        setNotice({ type: 'error', text: payload?.message ?? '保存失败，请稍后重试' });
        return;
      }
      setValues({ ...EMPTY_SETTINGS, ...payload });
      setNotice({ type: 'success', text: '站点设置已保存' });
    } catch {
      setNotice({ type: 'error', text: '接口不可用，请稍后重试' });
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <Tabs
      activeKey={activeTab}
      onChange={(key) => setActiveTab(key as 'site' | 'general')}
      tabBarStyle={{ margin: 0 }}
      items={[
        { key: 'site', label: '站点设置' },
        { key: 'general', label: '通用设置' }
      ]}
    />
  );

  return (
    <AdminListPage
      header={header}
      actions={
        activeTab === 'site' ? (
          <Button type="primary" loading={saving} disabled={loading || forbidden} onClick={() => void save()}>
            保存设置
          </Button>
        ) : undefined
      }
      notice={
        activeTab === 'site' && notice ? (
          <Alert
            style={{ margin: '0 16px 8px' }}
            type={notice.type}
            showIcon
            message={notice.text}
            closable
            onClose={() => setNotice(null)}
          />
        ) : undefined
      }
    >
      {activeTab === 'general' ? (
        <GeneralSettingsPanel />
      ) : loading ? (
        <div style={{ padding: 16 }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : forbidden ? (
        <div style={{ padding: 16 }}>
          <Alert
            type="warning"
            showIcon
            message="没有权限"
            description="站点设置仅超级管理员可查看和修改，请联系超级管理员。"
          />
        </div>
      ) : loadError ? (
        <div style={{ padding: 16 }}>
          <Alert
            type="error"
            showIcon
            message="加载失败"
            description={loadError}
            action={
              <Button size="small" onClick={() => void load()}>
                重试
              </Button>
            }
          />
        </div>
      ) : (
        <div style={{ padding: 16, maxWidth: 760 }}>
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <section style={cardStyle}>
              <div style={sectionTitleStyle}>站点维护</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch
                  checked={values.maintenanceEnabled}
                  onChange={(checked) => update('maintenanceEnabled', checked)}
                />
                <span style={{ color: colors.text }}>启用站点维护</span>
              </div>
              <div style={hintStyle}>
                开启后，顾客端全站会展示维护页或维护提示；admin 后台与 /api/* 接口不受影响。
                该开关仅在正式环境生效，开发与预览环境不会展示维护页。
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>维护通知（中文）</label>
                <TextArea
                  rows={4}
                  maxLength={500}
                  showCount
                  value={values.maintenanceMessage}
                  placeholder="站点正在维护，预计 12:00 恢复，请稍后再试。"
                  onChange={(event) => update('maintenanceMessage', event.target.value)}
                />
                <div style={hintStyle}>展示在维护页正文，建议写清维护原因与预计恢复时间。</div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={sectionTitleStyle}>SEO 设置</div>

              <div>
                <label style={labelStyle}>站点 URL</label>
                <Input
                  value={values.siteUrl}
                  placeholder="https://www.example.com"
                  onChange={(event) => update('siteUrl', event.target.value)}
                />
                <div style={hintStyle}>
                  用于 canonical、Open Graph 与 sitemap 的绝对地址，需带上 http:// 或 https://，末尾不要带 /
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>默认标题</label>
                <Input
                  maxLength={200}
                  showCount
                  value={values.defaultTitle}
                  placeholder="捎点啥 · 30 分钟生鲜到家"
                  onChange={(event) => update('defaultTitle', event.target.value)}
                />
                <div style={hintStyle}>
                  作为页面未单独设置标题时的兜底，建议 30–60 个字符，过长会被搜索引擎截断。
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>默认关键词</label>
                <TextArea
                  rows={2}
                  maxLength={300}
                  showCount
                  value={values.defaultKeywords}
                  placeholder="生鲜,水果,蔬菜,30分钟送达"
                  onChange={(event) => update('defaultKeywords', event.target.value)}
                />
                <div style={hintStyle}>
                  英文逗号分隔，例如「生鲜,水果,蔬菜,30分钟送达」；建议 3–10 个，总长不超过 300 字符。
                  保存时会自动去重并统一为英文逗号。
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>默认描述</label>
                <TextArea
                  rows={3}
                  maxLength={500}
                  showCount
                  value={values.defaultDescription}
                  placeholder="精选生鲜与日用百货，附近门店 30 分钟送达。"
                  onChange={(event) => update('defaultDescription', event.target.value)}
                />
                <div style={hintStyle}>
                  用于搜索结果摘要与社交分享，建议 120–160 个字符。
                </div>
              </div>
            </section>

            <div style={{ fontSize: 12, color: colors.textTertiary }}>
              最后保存：{formatTime(values.updatedAt)}
              {values.updatedByName ? ` · ${values.updatedByName}` : ''}
            </div>
          </Space>
        </div>
      )}
    </AdminListPage>
  );
}
