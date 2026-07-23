import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "glass-input flex h-11 w-full min-w-0 px-4 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-lavender",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
