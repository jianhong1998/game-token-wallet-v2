export function PageLoader() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="bg-app-shell fixed inset-0 z-50 flex items-center justify-center"
      style={{ perspective: "600px" }}
    >
      <img
        src="/chip-icon.svg"
        alt=""
        width={64}
        height={64}
        className="animate-chip-flip"
        style={{ filter: "saturate(1.6) hue-rotate(220deg) brightness(1.3)" }}
      />
    </div>
  );
}
