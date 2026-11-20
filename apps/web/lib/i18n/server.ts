import 'server-only';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, parseLocale, type Locale } from './config';
import { messagesOf, type Messages } from './messages';

/** 服务端读取语言 cookie；没有或非法时按中文渲染 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

/** 服务端组件 / server action 里直接取当前语言的字典 */
export async function getMessages(): Promise<Messages> {
  return messagesOf(await getLocale());
}
