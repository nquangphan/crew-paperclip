// crew: tự dựng
import { cn } from '../cn';

/** Khối mã/log chỉ đọc: font mono, giữ xuống dòng, cuộn khi dài; focus được để cuộn bằng bàn phím. */
function CodeBlock({ code, label, className }: { code: string; label: string; className?: string }) {
  return (
    <section
      data-slot="code-block"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: vùng cuộn phải focus được để cuộn bằng bàn phím
      tabIndex={0}
      className={cn(
        'max-h-96 w-full overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <pre className="whitespace-pre-wrap break-words">{code}</pre>
    </section>
  );
}

export { CodeBlock };
