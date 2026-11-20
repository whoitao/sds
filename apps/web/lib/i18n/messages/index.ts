import type { Locale } from '../config';
import { account } from './account';
import { address } from './address';
import { auth } from './auth';
import { cart } from './cart';
import { checkout } from './checkout';
import { common } from './common';
import { footer } from './footer';
import { menu } from './menu';
import { nav } from './nav';
import { orders } from './orders';
import { settings } from './settings';
import { shops } from './shops';
import { site } from './site';

/**
 * 字典按命名空间拆分：每个文件维护一组 zh / en，
 * en 用 Record<keyof zh, string> 约束，漏译会直接报类型错误。
 */
const zhMessages = {
  common: common.zh,
  nav: nav.zh,
  footer: footer.zh,
  site: site.zh,
  shops: shops.zh,
  menu: menu.zh,
  cart: cart.zh,
  checkout: checkout.zh,
  orders: orders.zh,
  account: account.zh,
  address: address.zh,
  auth: auth.zh,
  settings: settings.zh
};

/** 把 as const 的字面量类型放宽成 string，en 与 zh 才能共用同一个类型 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof zhMessages>;

export function messagesOf(locale: Locale): Messages {
  return locale === 'en' ? enMessages : zhMessages;
}

const enMessages: Messages = {
  common: common.en,
  nav: nav.en,
  footer: footer.en,
  site: site.en,
  shops: shops.en,
  menu: menu.en,
  cart: cart.en,
  checkout: checkout.en,
  orders: orders.en,
  account: account.en,
  address: address.en,
  auth: auth.en,
  settings: settings.en
};
