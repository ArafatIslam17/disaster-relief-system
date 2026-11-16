import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap",
  {
    variants: {
      tone: {
        pending: "bg-status-pending-bg text-status-pending-fg",
        ok: "bg-status-ok-bg text-status-ok-fg",
        danger: "bg-status-danger-bg text-status-danger-fg",
        neutral: "bg-status-neutral-bg text-status-neutral-fg",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
