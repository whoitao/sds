/** 通用文案：步骤条、按钮、加载与兜底提示 */
const zh = {
  stepShop: '选店',
  stepPick: '挑菜',
  stepCheckout: '结算',
  stepOrder: '下单',
  loading: '加载中…',
  processing: '正在处理，请稍候…',
  saving: '保存中…',
  submitting: '提交中…',
  networkError: '网络异常，请稍后重试',
  retry: '重试',
  back: '返回',
  cancel: '取消',
  confirm: '确定',
  save: '保存',
  delete: '删除',
  edit: '编辑',
  close: '关闭',
  maintenanceTitle: '站点维护中',
  maintenanceNote: '维护完成后刷新页面即可继续浏览，给你带来不便请见谅。'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  stepShop: 'Shops',
  stepPick: 'Pick',
  stepCheckout: 'Checkout',
  stepOrder: 'Done',
  loading: 'Loading…',
  processing: 'Processing, please wait…',
  saving: 'Saving…',
  submitting: 'Submitting…',
  networkError: 'Network error. Please try again later.',
  retry: 'Retry',
  back: 'Back',
  cancel: 'Cancel',
  confirm: 'OK',
  save: 'Save',
  delete: 'Delete',
  edit: 'Edit',
  close: 'Close',
  maintenanceTitle: 'Site under maintenance',
  maintenanceNote:
    'We will be back shortly. Refresh the page after maintenance to continue. Sorry for the inconvenience.'
};

export const common = { zh, en };
