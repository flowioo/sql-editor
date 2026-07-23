import * as RPopover from "@radix-ui/react-popover";
import "./popover.css";

/**
 * Popover primitive — non-modal floating content. Used for things like
 * inline previews or right-side panels anchored to a trigger.
 *
 * As with DropdownMenu, this is currently a thin re-export of Radix so
 * call sites can migrate incrementally.
 */
export const Popover = {
  Root: RPopover.Root,
  Trigger: RPopover.Trigger,
  Portal: RPopover.Portal,
  Content: RPopover.Content,
  Anchor: RPopover.Anchor,
  Close: RPopover.Close,
  Arrow: RPopover.Arrow,
};