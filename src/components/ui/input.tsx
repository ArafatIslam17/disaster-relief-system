import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        "disabled:cursor-not-allowed disabled:bg-canvas aria-[invalid=true]:border-status-danger-fg",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
