/**
 * Slash command menu component.
 * Overlays above the textarea when user types '/'.
 * Uses absolute positioning to avoid pushing content.
 */

import { useKeyboard } from "@opentui/react";
import { useEffect } from "react";

export type SlashCommand = {
  name: string;
  description: string;
  action: () => void;
};

export type CommandMenuProps = {
  commands: SlashCommand[];
  filter: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onCancel: () => void;
  onIndexChange: (index: number) => void;
  /** Bottom position offset (distance from bottom of parent) */
  bottom?: number;
  /** Width of the menu */
  width?: number;
};

/**
 * Get filtered commands based on current filter text.
 */
export function getFilteredCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  return commands.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(filter.toLowerCase())
  );
}

export function CommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
  onCancel,
  onIndexChange,
  bottom = 0,
  width,
}: CommandMenuProps) {
  // Filter commands based on input
  const filteredCommands = getFilteredCommands(commands, filter);

  // Ensure selectedIndex is within bounds when filtered list changes
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length && filteredCommands.length > 0) {
      onIndexChange(filteredCommands.length - 1);
    }
  }, [filteredCommands.length, selectedIndex, onIndexChange]);

  // Handle keyboard navigation
  const handleKeyPress = (key: { name?: string }) => {
    switch (key.name) {
      case "up":
      case "k":
        onIndexChange(Math.max(0, selectedIndex - 1));
        break;
      case "down":
      case "j":
        onIndexChange(Math.min(filteredCommands.length - 1, selectedIndex + 1));
        break;
      case "return": {
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          onSelect(selected);
        }
        break;
      }
      case "escape":
        onCancel();
        break;
    }
  };

  useKeyboard(handleKeyPress);

  const baseStyles = {
    position: "absolute" as const,
    bottom,
    left: 0,
    width,
    zIndex: 100,
    backgroundColor: "#1e1e2e",
  };

  if (filteredCommands.length === 0) {
    return (
      <box
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        {...baseStyles}
      >
        <text fg="#666">No matching commands</text>
      </box>
    );
  }

  return (
    <box
      flexDirection="column"
      maxHeight={8}
      {...baseStyles}
    >
      <scrollbox maxHeight={6} stickyScroll={false}>
        <box flexDirection="column">
          {filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <box
                key={cmd.name}
                flexDirection="row"
                backgroundColor={isSelected ? "#333" : undefined}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={isSelected ? "#7aa2f7" : "#ffffff"}>
                  <b>/{cmd.name}</b>
                </text>
                <text fg="#666"> {cmd.description}</text>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}
