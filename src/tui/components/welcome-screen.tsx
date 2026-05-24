/**
 * WelcomeScreen — displayed when no messages exist in the session.
 * Shows the ASCII banner, input box, and contextual overlays.
 */

import type { Accessor } from 'solid-js';
import { Show } from 'solid-js';
import { RGBA } from '@opentui/core';
import { useTheme } from '../../design';
import type { AgentMode, Status } from '../types';
import type { TextareaRef } from '../types';
import { CommandMenu, type SlashCommand } from './command-menu';
import { ContextInfoNotification } from './context-info-notification';
import { MentionPicker } from './mention-picker';
import { InputBox } from './input-box';
import { ToastNotification } from './toast-notification';

export interface WelcomeScreenProps {
  // Input box
  model: string;
  status: Accessor<Status>;
  mode: Accessor<AgentMode>;
  getTextareaRef: () => TextareaRef;
  getStatus: () => Status;
  onSubmit: (message: string) => void;
  onRef: (el: NonNullable<TextareaRef>) => void;
  inputDisabled: Accessor<boolean>;

  // Command menu
  showCommandMenu: Accessor<boolean>;
  slashCommands: SlashCommand[];
  commandFilter: Accessor<string>;
  commandSelectedIndex: Accessor<number>;
  onCommandSelect: (command: SlashCommand) => void;
  onCommandMenuCancel: () => void;
  onCommandIndexChange: (index: number) => void;

  // Mention picker (agents + files)
  showMentionPicker: Accessor<boolean>;
  mentionAgents: Accessor<
    import('../hooks/use-mention-picker').AgentMentionItem[]
  >;
  mentionFiles: Accessor<string[]>;
  mentionFilter: Accessor<string>;
  mentionSelectedIndex: Accessor<number>;
  onMentionSelect: (value: string) => void;
  onMentionPickerCancel: () => void;
  onMentionIndexChange: (index: number) => void;

  // Context info
  contextInfo: Accessor<string | null>;

  // Toast
  toast: Accessor<string | null>;
  toastDuration: number;
  onToastDismiss: () => void;
}

export function WelcomeScreen(props: WelcomeScreenProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{ backgroundColor: tokens.bgBase }}
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <box flexDirection="row">
        <ascii_font
          text="Ollie"
          font="tiny"
          color={RGBA.fromHex(tokens.primaryBase)}
        />
        <text> </text>
        <ascii_font
          text="Code"
          font="tiny"
          color={RGBA.fromHex(tokens.textBase)}
        />
      </box>

      <Show when={props.contextInfo()}>
        {(info: () => string) => (
          <box marginTop={1}>
            <ContextInfoNotification message={info()} />
          </box>
        )}
      </Show>

      <box flexDirection="column" marginTop={2} width={80} position="relative">
        <Show when={props.showCommandMenu()}>
          <CommandMenu
            commands={props.slashCommands}
            filter={props.commandFilter()}
            selectedIndex={props.commandSelectedIndex()}
            onSelect={props.onCommandSelect}
            onCancel={props.onCommandMenuCancel}
            onIndexChange={props.onCommandIndexChange}
            bottom={5}
            width={80}
          />
        </Show>

        <Show when={props.showMentionPicker()}>
          <MentionPicker
            agents={props.mentionAgents()}
            files={props.mentionFiles()}
            filter={props.mentionFilter()}
            selectedIndex={props.mentionSelectedIndex()}
            onSelect={props.onMentionSelect}
            onCancel={props.onMentionPickerCancel}
            onIndexChange={props.onMentionIndexChange}
            bottom={5}
            width={80}
          />
        </Show>

        <InputBox
          id="greeting-textarea"
          model={props.model}
          status={props.status()}
          mode={props.mode()}
          getTextareaRef={props.getTextareaRef}
          getStatus={props.getStatus}
          onSubmit={props.onSubmit}
          onRef={props.onRef}
          disabled={props.inputDisabled()}
          suppressSubmit={props.showMentionPicker()}
        />
      </box>

      <Show when={props.toast()}>
        {(msg: () => string) => (
          <ToastNotification
            message={msg()}
            duration={props.toastDuration}
            onDismiss={props.onToastDismiss}
          />
        )}
      </Show>
    </box>
  );
}
