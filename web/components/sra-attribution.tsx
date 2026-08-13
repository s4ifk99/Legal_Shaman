import {
  SRA_ATTRIBUTION_PRODUCT,
  SRA_ATTRIBUTION_TEXT,
  SRA_ATTRIBUTION_URL,
} from "@/lib/sra-attribution";

type Props = {
  className?: string;
  /** Compact single-line for cards / footers. */
  compact?: boolean;
};

/**
 * Public SRA attribution required when listing solicitors / organisations from SRA data.
 */
export function SraAttribution({ className, compact = false }: Props) {
  return (
    <p
      className={
        className ||
        (compact
          ? "text-xs leading-relaxed text-muted-foreground"
          : "mt-4 text-xs leading-relaxed text-muted-foreground")
      }
      data-sra-attribution
    >
      {SRA_ATTRIBUTION_PRODUCT} includes data supplied by the{" "}
      <a
        href={SRA_ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 hover:opacity-90"
      >
        Solicitors Regulation Authority
      </a>
      .{" "}
      <a
        href={SRA_ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:opacity-90"
      >
        Attribution statement
      </a>
      <span className="sr-only">. {SRA_ATTRIBUTION_TEXT}</span>
    </p>
  );
}
