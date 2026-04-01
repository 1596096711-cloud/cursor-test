"use client";

import { LocaleProvider } from "@/components/locale-provider";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}
