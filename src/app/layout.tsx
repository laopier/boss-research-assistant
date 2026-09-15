import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Boss 科研助手",
  description: "从模糊科研意图到可验收任务",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
