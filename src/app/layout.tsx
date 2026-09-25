import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Boss 科研助手",
  description: "把模糊的科研想法拆成眼前能完成的一步",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
