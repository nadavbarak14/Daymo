import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...p }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn("inline-flex h-9 items-center justify-start border-b border-zinc-800", className)}
      {...p}
    />
  ),
);
TabsList.displayName = "TabsList";
export const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...p }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-xs opacity-60 data-[state=active]:opacity-100 data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:font-semibold",
        className,
      )}
      {...p}
    />
  ),
);
TabsTrigger.displayName = "TabsTrigger";
export const TabsContent = TabsPrimitive.Content;
