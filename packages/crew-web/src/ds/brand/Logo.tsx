// crew: tự dựng
import { cn } from '../cn';

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 28"
      role="img"
      aria-label="2P Crew"
      className={cn('h-7 w-auto text-foreground', className)}
    >
      <text x="0" y="21" fontFamily="Inter, Arial, sans-serif" fontSize="20" fontWeight="700" fill="currentColor">
        2P Crew
      </text>
    </svg>
  );
}
