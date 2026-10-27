// crew: tự dựng
import type * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip';

interface HintTooltipProps {
  /** Chữ giải thích; bỏ trống thì không bọc tooltip. */
  hint?: string;
  children: React.ReactNode;
}

/**
 * Tooltip giải thích vì sao một nút bị khóa. Nút `disabled` không nhận sự kiện chuột nên tooltip gắn trên thẻ bao ngoài,
 * và thẻ bao cho focus bàn phím để người dùng không chuột vẫn đọc được lý do.
 */
function HintTooltip({ hint, children }: HintTooltipProps) {
  if (!hint) return <>{children}</>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: nút bên trong bị khóa nên không focus được; thẻ bao nhận focus để đọc lý do bằng bàn phím */}
          <span data-slot="hint-tooltip" className="inline-flex" tabIndex={0}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type { HintTooltipProps };
export { HintTooltip };
