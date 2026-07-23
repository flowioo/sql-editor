import * as RDropdown from "@radix-ui/react-dropdown-menu";
import "./dropdown-menu.css";

/**
 * Dropdown menu primitive. For now, a thin re-export of Radix's components
 * so existing call sites can migrate incrementally. We may add opinionated
 * defaults (icon/shortcut slots) later once we see actual usage patterns.
 *
 * Typical usage:
 *
 *   <DropdownMenu.Root>
 *     <DropdownMenu.Trigger asChild>
 *       <button>...</button>
 *     </DropdownMenu.Trigger>
 *     <DropdownMenu.Portal>
 *       <DropdownMenu.Content className="ui-dropdown-content">
 *         <DropdownMenu.Item className="ui-dropdown-item">...</DropdownMenu.Item>
 *         <DropdownMenu.Separator className="ui-dropdown-separator" />
 *         <DropdownMenu.Item>...</DropdownMenu.Item>
 *       </DropdownMenu.Content>
 *     </DropdownMenu.Portal>
 *   </DropdownMenu.Root>
 */
export const DropdownMenu = {
  Root: RDropdown.Root,
  Trigger: RDropdown.Trigger,
  Portal: RDropdown.Portal,
  Content: RDropdown.Content,
  Item: RDropdown.Item,
  Separator: RDropdown.Separator,
  Label: RDropdown.Label,
  Group: RDropdown.Group,
  CheckboxItem: RDropdown.CheckboxItem,
  Sub: RDropdown.Sub,
  SubTrigger: RDropdown.SubTrigger,
  SubContent: RDropdown.SubContent,
};