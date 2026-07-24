export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={[
        "inline-block size-[18px] animate-spin rounded-full border-2 border-violet-accent/30 border-t-violet-accent",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
