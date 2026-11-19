import type { TableColumnsType, TableProps } from 'antd';

export const ADMIN_FILTER_FIELD_WIDTH = 160;

function normalizeColumns<RecordType>(
  columns: TableColumnsType<RecordType>
): TableColumnsType<RecordType> {
  return columns.map((column) => {
    if ('children' in column && column.children) {
      return {
        ...column,
        align: column.align ?? 'left',
        children: normalizeColumns(column.children)
      };
    }

    const isAction =
      column.title === '操作' || column.key === 'action' || column.key === 'actions';

    if (isAction) {
      // 操作列不声明实际宽度：表格是 table-layout: auto（scroll.x = max-content），
      // 1px 只是占位提示，实际列宽由「按钮组宽度 + 单元格内边距」撑开；
      // 这样右对齐时不会在图标左侧空出一段，剩余空间交给其他自适应列吸收。
      return { ...column, width: 1, align: 'right', ellipsis: false, fixed: 'right' };
    }

    return {
      align: 'left',
      ellipsis: true,
      ...column
    };
  });
}

/** admin 列表统一：普通列左对齐并省略溢出内容，操作列固定右侧，超宽时横向滚动，表头随所在滚动容器吸顶。 */
export function getAdminTableProps<RecordType>(
  columns: TableColumnsType<RecordType>
): Pick<TableProps<RecordType>, 'columns' | 'scroll' | 'sticky'> {
  return {
    columns: normalizeColumns(columns),
    scroll: { x: 'max-content' },
    sticky: true
  };
}
