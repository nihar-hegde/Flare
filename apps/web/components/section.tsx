import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Section({
  title,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="border-b">
        <CardTitle className="min-w-0 text-sm">{title}</CardTitle>
        {action ? (
          <CardAction className="text-xs text-muted-foreground">
            {action}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
