import type { ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Button, DatePicker, Input, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { adminColors as colors } from '../lib/theme';

// 后台列表页统一骨架：页头（标题/Tabs + 右上角操作区）、筛选行、内容区。
// 内容区独立滚动，筛选控件统一 160px 栅格，页面不再各自拼装样式。

interface AdminListPageProps {
  /** 页头标题 */
  title?: ReactNode;
  /** 页头 Tabs（如商品管理/分类管理） */
  tabs?: ReactNode;
  /** 标题右侧说明文字 */
  description?: ReactNode;
  /** 自定义页头左侧内容（如带切换进度的 Tabs），优先于 title/tabs */
  header?: ReactNode;
  /** 右上角操作区：新建、刷新、清理测试数据等 */
  actions?: ReactNode;
  /** Tab/页头下方的筛选元素；为空时不占位 */
  filters?: ReactNode;
  /** 筛选行空间不足时是否换行，默认换行 */
  wrapFilters?: boolean;
  /** 筛选行与表格之间的提示区（错误、通知等） */
  notice?: ReactNode;
  /** 表格等内容，在内容区独立滚动 */
  children: ReactNode;
}

export function AdminListPage({
  title,
  tabs,
  description,
  header,
  actions,
  filters,
  wrapFilters = true,
  notice,
  children
}: AdminListPageProps) {
  return (
    <div className="admin-list-page">
      <div className="admin-page-bar">
        <div className="admin-list-page-head">
          {header ?? (
            <>
              {tabs}
              {title ? <span className="admin-list-page-title">{title}</span> : null}
              {description ? (
                <span className="admin-list-page-desc">{description}</span>
              ) : null}
            </>
          )}
        </div>
        {actions ? <div className="admin-list-page-actions">{actions}</div> : null}
      </div>

      {filters ? (
        <div
          className={
            wrapFilters ? 'admin-filter-bar admin-filter-bar--wrap' : 'admin-filter-bar'
          }
        >
          {filters}
        </div>
      ) : null}

      {notice}

      <div className="admin-list-page-body">{children}</div>
    </div>
  );
}

/** 筛选行内不可拆开的控件组（如日期区间：开始 至 结束），整组换行不拆散。 */
export function AdminFilterGroup({ children }: { children: ReactNode }) {
  return <div className="admin-filter-group">{children}</div>;
}

/** 筛选行内的固定宽度控件容器：统一 160px，内部控件撑满。 */
export function AdminFilterField({ children }: { children: ReactNode }) {
  return <div className="admin-filter-field">{children}</div>;
}

const DATE_RANGE_PRESETS: Array<{ label: string; value: () => [Dayjs, Dayjs] }> = [
  { label: '今天', value: () => [dayjs(), dayjs()] },
  { label: '近 7 天', value: () => [dayjs().subtract(6, 'day'), dayjs()] },
  { label: '近 30 天', value: () => [dayjs().subtract(29, 'day'), dayjs()] }
];

interface AdminFilterDateRangeProps {
  /** 起始日期，YYYY-MM-DD；空字符串表示未选 */
  start: string;
  /** 结束日期，YYYY-MM-DD；空字符串表示未选 */
  end: string;
  /** 起止任一变化时回调，清除时两项都返回空字符串 */
  onChange: (start: string, end: string) => void;
}

/**
 * 筛选行内的日期区间：一个控件内选起止，按自然日（含首尾）筛选。
 * 区间控件比普通筛选字段宽，整组不可拆散；窄屏随筛选行整组换行。
 */
export function AdminFilterDateRange({ start, end, onChange }: AdminFilterDateRangeProps) {
  const value: [Dayjs | null, Dayjs | null] | null =
    start || end ? [start ? dayjs(start) : null, end ? dayjs(end) : null] : null;

  return (
    <AdminFilterGroup>
      <div className="admin-filter-range">
        <DatePicker.RangePicker
          needConfirm
          allowClear
          format="YYYY-MM-DD"
          placeholder={['开始日期', '结束日期']}
          presets={DATE_RANGE_PRESETS}
          value={value}
          onChange={(dates) =>
            onChange(
              dates?.[0]?.format('YYYY-MM-DD') ?? '',
              dates?.[1]?.format('YYYY-MM-DD') ?? ''
            )
          }
        />
      </div>
    </AdminFilterGroup>
  );
}

interface AdminFilterSearchProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** 点击查询或回车时触发 */
  onSearch: () => void;
}

/** 搜索框 + 查询按钮组合，整组按 160px，输入部分自适应。 */
export function AdminFilterSearch({
  value,
  placeholder,
  onChange,
  onSearch
}: AdminFilterSearchProps) {
  return (
    <AdminFilterField>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          allowClear
          value={value}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(event) => onChange(event.target.value)}
          onPressEnter={onSearch}
        />
        <Button
          icon={<SearchOutlined />}
          aria-label="查询"
          style={{
            background: colors.subtle,
            borderColor: colors.border,
            color: colors.textSecondary
          }}
          onClick={onSearch}
        />
      </Space.Compact>
    </AdminFilterField>
  );
}
