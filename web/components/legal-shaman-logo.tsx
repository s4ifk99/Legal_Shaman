type Props = {
  /** full = mark + wordmark + motto; mark = spiral sun only */
  variant?: "full" | "mark";
  className?: string;
  priority?: boolean;
  alt?: string;
};

/**
 * Legal Shaman logo using the exact spiral mark (vectorised from brand art).
 * SVG assets scale cleanly at any size.
 */
export function LegalShamanLogo({
  variant = "full",
  className,
  priority = false,
  alt = "Legal Shaman",
}: Props) {
  const src = variant === "mark" ? "/legal-shaman-mark.svg" : "/legal-shaman-logo.svg";
  const size =
    variant === "mark"
      ? { width: 200, height: 200 }
      : { width: 720, height: 160 };

  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup
    <img
      src={src}
      alt={alt}
      width={size.width}
      height={size.height}
      className={className}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
    />
  );
}
