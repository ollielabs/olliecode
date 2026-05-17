/**
 * ChatScreen — displayed when messages exist in the session.
 * Shows the scrollable message list, input box, side panel, and overlays.
 */

import type { Accessor } from 'solid-js';
import { For, Show } from 'solid-js';
import type { McpStatusMap } from '../../agent/mcp/types';
import { useTheme } from '../../design';
import type {
  AgentMode,
  CompactionSummaryDisplayMessage,
  DisplayMessage,
  ErrorDisplayMessage,
  Status,
  TextareaRef,
  Todo,
  ToolDisplayMessage,
} from '../types';
import type { ContextStats } from '../../lib/tokenizer';
import { fastScrollAccel } from '../utils';
import { AssistantMessage } from './assistant-message';
import { CommandMenu, type SlashCommand } from './command-menu';
import { CompactionSummary } from './compaction-summary';
import { ContextInfoNotification } from './context-info-notification';
import { ErrorMessage } from './error-message';
import { FilePicker } from './file-picker';
import { InputBox } from './input-box';
import { SidePanel } from './side-panel';
import { ToastNotification } from './toast-notification';
import { ToolMessage } from './tool-message';
import { UserMessage } from './user-message';

export interface ChatScreenProps {
  // Messages
  displayMessages: Accessor<DisplayMessage[]>;
  streamingContent: Accessor<string | null>;

  // Tool confirmation
  confirmingToolId: Accessor<string | null>;
  onToolConfirmation: (
    response: import('../types').ConfirmationResponse,
  ) => void;
  toolsExpanded: Accessor<boolean>;

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

  // File picker
  showFilePicker: Accessor<boolean>;
  files: Accessor<string[]>;
  fileFilter: Accessor<string>;
  fileSelectedIndex: Accessor<number>;
  onFileSelect: (file: string) => void;
  onFilePickerCancel: () => void;
  onFileIndexChange: (index: number) => void;

  // Context info
  contextInfo: Accessor<string | null>;

  // Side panel
  sidebarStats: Accessor<ContextStats | null>;
  sidebarTodos: Accessor<Todo[]>;
  mcpStatus: Accessor<McpStatusMap>;
  mcpConnecting: Accessor<boolean>;

  // Toast
  toast: Accessor<string | null>;
  toastDuration: number;
  onToastDismiss: () => void;
}

export function ChatScreen(props: ChatScreenProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{ backgroundColor: tokens.bgBase }}
      flexDirection="row"
      flexGrow={1}
      flexShrink={1}
    >
      <box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        paddingTop={1}
        paddingX={2}
      >
        <scrollbox
          flexGrow={1}
          flexShrink={1}
          stickyScroll={true}
          stickyStart="bottom"
          scrollAcceleration={fastScrollAccel}
        >
          <box flexDirection="column" flexGrow={1} paddingRight={2}>
            <For each={props.displayMessages()}>
              {(msg) => (
                <box marginBottom={1}>
                  <Show when={msg.type === 'user' && msg}>
                    {(userMsg: () => DisplayMessage) => {
                      const m = userMsg() as {
                        type: 'user';
                        content: string;
                        attachedFiles?: string[];
                      };
                      return (
                        <UserMessage
                          content={m.content}
                          attachedFiles={m.attachedFiles}
                        />
                      );
                    }}
                  </Show>
                  <Show when={msg.type === 'assistant' && msg}>
                    {(assistantMsg: () => DisplayMessage) => {
                      const m = assistantMsg() as {
                        type: 'assistant';
                        content: string;
                      };
                      return <AssistantMessage content={m.content} />;
                    }}
                  </Show>
                  <Show when={msg.type === 'tool'}>
                    <ToolMessage
                      message={msg as ToolDisplayMessage}
                      isActiveConfirmation={
                        props.confirmingToolId() ===
                        (msg as ToolDisplayMessage).id
                      }
                      onConfirmationResponse={(response) => {
                        props.onToolConfirmation(response);
                      }}
                      expanded={props.toolsExpanded()}
                    />
                  </Show>
                  <Show when={msg.type === 'compaction_summary' && msg}>
                    {(summaryMsg: () => CompactionSummaryDisplayMessage) => (
                      <CompactionSummary
                        content={summaryMsg().content}
                        compactedCount={summaryMsg().compactedCount}
                      />
                    )}
                  </Show>
                  <Show when={msg.type === 'error' && msg}>
                    {(errorMsg: () => ErrorDisplayMessage) => (
                      <ErrorMessage
                        errorType={errorMsg().errorType}
                        content={errorMsg().content}
                      />
                    )}
                  </Show>
                </box>
              )}
            </For>

            <Show when={props.streamingContent()}>
              <box>
                <text>{props.streamingContent()}</text>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexDirection="column" flexShrink={0} position="relative">
          <Show when={props.contextInfo()}>
            {(info: () => string) => (
              <ContextInfoNotification message={info()} />
            )}
          </Show>

          <Show when={props.showCommandMenu()}>
            <CommandMenu
              commands={props.slashCommands}
              filter={props.commandFilter()}
              selectedIndex={props.commandSelectedIndex()}
              onSelect={props.onCommandSelect}
              onCancel={props.onCommandMenuCancel}
              onIndexChange={props.onCommandIndexChange}
              bottom={5}
            />
          </Show>

          <Show when={props.showFilePicker()}>
            <FilePicker
              files={props.files()}
              filter={props.fileFilter()}
              selectedIndex={props.fileSelectedIndex()}
              onSelect={props.onFileSelect}
              onCancel={props.onFilePickerCancel}
              onIndexChange={props.onFileIndexChange}
              bottom={5}
            />
          </Show>

          <InputBox
            id="chat-textarea"
            model={props.model}
            status={props.status()}
            mode={props.mode()}
            getTextareaRef={props.getTextareaRef}
            getStatus={props.getStatus}
            onSubmit={props.onSubmit}
            onRef={props.onRef}
            disabled={props.inputDisabled()}
            suppressSubmit={props.showFilePicker()}
          />
        </box>
      </box>

      <SidePanel
        contextStats={props.sidebarStats()}
        todos={props.sidebarTodos()}
        mcpStatus={props.mcpStatus()}
        mcpConnecting={props.mcpConnecting()}
        width={40}
      />

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
