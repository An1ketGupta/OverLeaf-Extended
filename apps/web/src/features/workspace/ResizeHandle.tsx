import { useRef } from "react";

export function ResizeHandle({
  label,
  value,
  min,
  max,
  direction = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: number;
  onChange: (value: number) => void;
}) {
  const start = useRef({ x: 0, value: 0 });
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    // biome-ignore lint/a11y/useSemanticElements: Interactive WAI-ARIA window splitter, not a document horizontal rule.
    <div
      className="resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          change(
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : value + (event.key === "ArrowRight" ? 16 : -16) * direction,
          );
        }
      }}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          change(
            start.current.value + (event.clientX - start.current.x) * direction,
          );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <span />
    </div>
  );
}
