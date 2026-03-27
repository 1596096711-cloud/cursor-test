import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "排版智能分析器 | Typography & Grid Detector",
  description: "基于 GPT-4o 的版式与网格智能分析工具"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

