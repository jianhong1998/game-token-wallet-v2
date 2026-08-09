"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", testId: "bottom-nav-home" },
  { href: "/games/all", label: "Browse", testId: "bottom-nav-browse" },
  { href: "/account", label: "You", testId: "bottom-nav-you" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-white/10 bg-app-shell/90 py-3 backdrop-blur-lg">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-xs font-bold",
              isActive ? "text-cyan-accent" : "text-text-secondary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
