import * as React from "react";
import { cn } from "@/lib/utils";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn("h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink focus-visible:border-primary focus-visible:outline-none disabled:opacity-50", className)}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("w-full rounded-md border border-line bg-surface p-2 text-sm text-ink focus-visible:border-primary focus-visible:outline-none aria-[invalid=true]:border-status-danger-fg", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
