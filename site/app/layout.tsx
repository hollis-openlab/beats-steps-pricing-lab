import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LabProvider } from '@/components/lab/provider';
import { Shell } from '@/components/lab/shell';
import './globals.css';
export const metadata: Metadata = { title: { default: '赔率工作台', template: '%s | 赔率工作台' }, description: 'Beats 触碰板、Steps 方向阶梯、数据回测与行情回放。', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="zh-CN"><body><a className="skip-link" href="#main-content">跳到主要内容</a><LabProvider><Shell>{children}</Shell></LabProvider></body></html>; }
