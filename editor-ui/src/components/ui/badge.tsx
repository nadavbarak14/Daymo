import * as React from "react";
import { cn } from "../../lib/utils";
export function Badge({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border border-zinc-800 px-2 py-0.5 text-xs", className)}
      {...p}
    />
  );
}
