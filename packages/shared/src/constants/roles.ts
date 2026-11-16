/** 平台与店铺内角色定义（对应 PRD 第 8 章权限模型） */
export const ROLES = {
  CUSTOMER: 'customer',
  SHOP_MANAGER: 'shop_manager',
  SHOP_STAFF: 'shop_staff',
  DELIVERY: 'delivery',
  PLATFORM_ADMIN: 'platform_admin'
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  customer: '顾客',
  shop_manager: '店长',
  shop_staff: '店员',
  delivery: '配送员',
  platform_admin: '平台管理员'
};
