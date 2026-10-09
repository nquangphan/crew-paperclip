// clone: ui/src/components/ui/skeleton.tsx @ v2026.1005.0
import { cn } from "../cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent/75 rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
