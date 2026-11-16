import type { TableColumnsType, TableProps } from 'antd';

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

    return {
      align: 'left',
      ellipsis: true,
      ...column,
      ...(isAction ? { align: 'right', fixed: 'right', ellipsis: false } : {})
    };
  });
}

/** admin 列表统一：普通列左对齐并省略溢出内容，操作列固定右侧，超宽时横向滚动。 */
export function getAdminTableProps<RecordType>(
  columns: TableColumnsType<RecordType>
): Pick<TableProps<RecordType>, 'columns' | 'scroll'> {
  return {
    columns: normalizeColumns(columns),
    scroll: { x: 'max-content' }
  };
}
