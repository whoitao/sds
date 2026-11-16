import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '捎点啥 · 顾客端',
  description: '面向老年人的多店铺买菜与生鲜电商'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-paper text-[#1f2329]">{children}</body>
    </html>
  );
}
