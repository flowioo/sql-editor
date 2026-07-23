import * as React from "react";
import * as RTooltip from "@radix-ui/react-tooltip";
import "./tooltip.css";

interface TooltipProps {
  /** Content — text or node. If empty/undefined, nothing is rendered. */
  readonly content: React.ReactNode;
  readonly children: React.ReactNode;
  /** Side relative to the trigger. Default "top". */
  readonly side?: "top" | "right" | "bottom" | "left";
  /** Override the default open delay (ms). */
  readonly delayMs?: number;
  /** Optional className on the content panel. */
  readonly className?: string;
}

/**
 * Lightweight tooltip — drop-in replacement for the browser's native
 * `title` attribute. Mount <TooltipProvider> once near the root.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  delayMs = 300,
  className,
}: TooltipProps) {
  if (!content) {
    // Avoid rendering an empty tooltip root (Radix warns).
    return <>{children}</>;
  }
  return (
    <RTooltip.Root delayDuration={delayMs}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className={`ui-tooltip${className ? " " + className : ""}`}
        >
          {content}
          <RTooltip.Arrow className="ui-tooltip-arrow" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/** Provider — mount once near the root (App.tsx). */
export const TooltipProvider = RTooltip.Provider;