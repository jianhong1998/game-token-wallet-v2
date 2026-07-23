import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva("glass-row w-full px-4 py-3 text-sm font-semibold", {
  variants: {
    variant: {
      success: "text-cyan-accent",
      error: "text-danger",
    },
  },
  defaultVariants: {
    variant: "success",
  },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="status"
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Alert, alertVariants };
