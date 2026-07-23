import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/Spinner/Spinner";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-7 py-[15px] font-sans text-sm font-extrabold transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-gradient-primary text-ink hover:brightness-105",
        secondary: "glass-input text-text-primary hover:bg-white/10",
        destructive: "bg-danger text-ink hover:brightness-105",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    isLoading?: boolean;
  };

function Button({
  className,
  variant,
  asChild = false,
  isLoading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <span className="relative inline-flex">
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, className }))}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        <span className={isLoading ? "invisible" : undefined}>{children}</span>
      </Comp>
      {isLoading && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
    </span>
  );
}

export { Button, buttonVariants };
