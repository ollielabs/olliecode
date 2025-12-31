/**
 * Slash command menu component.
 * Overlays above the textarea when user types '/'.
 */

import { useKeyboard } from "@opentui/react";
import { useEffect } from "react";
import { useTheme } from "../../design";

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
  bottom?: number;
  width?: number;
};

export function getFilteredCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  return commands.filter((cmd) => cmd.name.toLowerCase().startsWith(filter.toLowerCase()));
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
  const { tokens } = useTheme();
  const filteredCommands = getFilteredCommands(commands, filter);

  useEffect(() => {
    if (selectedIndex >= filteredCommands.length && filteredCommands.length > 0) {
      onIndexChange(filteredCommands.length - 1);
    }
  }, [filteredCommands.length, selectedIndex, onIndexChange]);

  useKeyboard((key: { name?: string }) => {
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
        if (selected) onSelect(selected);
        break;
      }
      case "escape":
        onCancel();
        break;
    }
  });

  if (filteredCommands.length === 0) {
    return (
      <box
        style={{
          position: "absolute",
          left: 0,
          bottom,
          width,
          zIndex: 100,
          backgroundColor: tokens.bgSurface,
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text style={{ fg: tokens.textSubtle }}>No matching commands</text>
      </box>
    );
  }

  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        bottom,
        width,
        zIndex: 100,
        backgroundColor: tokens.bgSurface,
        flexDirection: "column",
        maxHeight: 8,
      }}
    >
      <scrollbox maxHeight={6} stickyScroll={false}>
        <box flexDirection="column">
          {filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <box
                key={cmd.name}
                style={{
                  flexDirection: "row",
                  paddingLeft: 1,
                  paddingRight: 1,
                  ...(isSelected && { backgroundColor: tokens.selected }),
                }}
              >
                <text style={{ fg: isSelected ? tokens.primaryBase : tokens.textBase }}>
                  <b>/{cmd.name}</b>
                </text>
                <text style={{ fg: tokens.textSubtle }}> {cmd.description}</text>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}
