import { useState, type ComponentProps } from "react";
import { ImageOff } from "lucide-react";
import { MISSING_FILE_LABEL } from "../lib/retention-placeholders";
import { cn } from "../lib/utils";

export function MissingFilePlaceholder({
  className,
  label = MISSING_FILE_LABEL,
}: {
  className?: string;
  label?: string;
}) {
  // A span so the placeholder stays valid inside Markdown paragraphs.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-missing-file=""
      className={cn(
        "inline-flex max-w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 align-middle text-xs text-muted-foreground",
        className,
      )}
    >
      <ImageOff aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * An `<img>` for stored content that swaps to a small placeholder when the
 * file cannot be loaded (for example after storage retention removed it),
 * instead of a broken-image icon that collapses or distorts its layout.
 * `placeholderClassName` sizes the placeholder; it defaults to the image's
 * own classes so thumbnails keep their box.
 */
export function StoredImage({
  placeholderClassName,
  onError,
  className,
  ...props
}: ComponentProps<"img"> & { placeholderClassName?: string }) {
  const [failedSrc, setFailedSrc] = useState<{ src: string | undefined } | null>(null);
  if (failedSrc && failedSrc.src === props.src) {
    return <MissingFilePlaceholder className={placeholderClassName ?? className} />;
  }
  return (
    <img
      {...props}
      className={className}
      onError={(event) => {
        setFailedSrc({ src: props.src });
        onError?.(event);
      }}
    />
  );
}
