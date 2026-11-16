"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Right-hand drawer built on the Dialog primitive. */
export const Sheet = DialogPrimitive.Root;

export function SheetContent({ className, children, title, description }: { className?: string; children: React.ReactNode; title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content className={cn("fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-line bg-surface", className)}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="rounded-sm p-1 text-ink-muted hover:bg-canvas" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
