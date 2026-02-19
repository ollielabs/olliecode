/**
 * TUI Entry Point.
 * Main application component with all hooks and UI rendering.
 */

import type { TextareaRenderable } from '@opentui/core';
import { RGBA } from '@opentui/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { extractTuiConfig } from '../config/resolve';
import { ThemeProvider, useTheme } from '../design';
import { listSessions } from '../session';
import {
  AssistantMessage,
  CommandMenu,
  ConfigModal,
  ContextInfoNotification,
  ContextStatsModal,
  FilePicker,
  InputBox,
  KeyboardShortcutsModal,
  SessionPicker,
  SidePanel,
  ThemePicker,
  ToastNotification,
  ToolMessage,
  UserMessage,
} from './components';
import {
  useAgentContext,
  useAgentSubmit,
  useCommandMenu,
  useFilePicker,
  useKeyboardShortcuts,
  useSession,
} from './hooks';
import { useMessageStore } from './hooks/use-message-store';
import type { AppProps, DisplayMessage, Status } from './types';
import { fastScrollAccel } from './utils';

/** Prompt template for /init command - creates/updates AGENTS.md */
const INIT_PROMPT_TEMPLATE = `Please analyze this codebase and create an AGENTS.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 150 lines long.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.

If there's already an AGENTS.md, improve it.`;

export function App(props: AppProps) {
  return (
    <ThemeProvider initialTheme={props.config.tui.theme}>
      <AppContent
        config={props.config}
        configLayers={props.configLayers}
        configWarnings={props.configWarnings}
        projectPath={props.projectPath}
        initialSessionId={props.initialSessionId}
      />
    </ThemeProvider>
  );
}

function AppContent(props: AppProps) {
  const configLayers = props.configLayers ?? [];
  const configWarnings = props.configWarnings ?? [];
  const model = props.config.model;
  const { tokens } = useTheme();
  let textareaRef: TextareaRenderable | undefined;
  const [toast, setToast] = createSignal<string | null>(null);
  const [showConfigModal, setShowConfigModal] = createSignal(false);

  // Getter for textarea ref
  const getTextareaRef = () => textareaRef;

  // Extract TUI config once
  const tuiConfig = createMemo(() => extractTuiConfig(props.config));

  // Central message store — single source of truth for all message state
  const store = useMessageStore();

  // Initialize session hook first as other hooks depend on it
  const session = useSession({
    projectPath: props.projectPath,
    config: props.config,
    initialSessionId: props.initialSessionId,
    getTextareaRef,
    tuiConfig: tuiConfig(),
    store,
  });

  // Context hook for stats, compaction, and related operations
  const context = useAgentContext({
    config: props.config,
    store,
    sessionId: () => session.currentSession()?.id,
  });

  // Agent submission hook (includes confirmation handling)
  const agent = useAgentSubmit({
    config: props.config,
    projectPath: props.projectPath,
    ensureSession: session.ensureSession,
    mode: session.mode,
    store,
    setSidebarTodos: session.setSidebarTodos,
  });

  // Status getter for InputBox
  const getStatus = (): Status => agent.status();

  // Handler for /init command - submits prompt to agent to create/update AGENTS.md
  const handleInit = (args?: string) => {
    const prompt = args
      ? `${INIT_PROMPT_TEMPLATE}\n\nAdditional instructions: ${args}`
      : INIT_PROMPT_TEMPLATE;
    void agent.handleSubmit(prompt);
  };

  // Command menu hook
  const commands = useCommandMenu({
    getTextareaRef,
    status: agent.status,
    showSessionPicker: session.showSessionPicker,
    handlers: {
      handleNewSession: session.handleNewSession,
      handleClearContext: context.handleClearContext,
      handleCompact: context.handleCompact,
      handleShowContext: context.handleShowContext,
      handleForget: context.handleForget,
      handleInit,
      handleConfig: () => setShowConfigModal(true),
      setShowSessionPicker: session.setShowSessionPicker,
      setShowThemePicker: session.setShowThemePicker,
    },
  });

  // File picker hook for @ mentions
  const filePicker = useFilePicker({
    getTextareaRef,
    status: agent.status,
    isModalOpen: () =>
      session.showSessionPicker() || commands.showCommandMenu(),
  });

  // Global keyboard shortcuts
  const { toolsExpanded, showHelp, setShowHelp } = useKeyboardShortcuts({
    status: agent.status,
    mode: session.mode,
    setMode: session.setMode,
    abort: agent.abort,
    showCommandMenu: commands.showCommandMenu,
    showSessionPicker: session.showSessionPicker,
    currentSession: session.currentSession,
    onCopySuccess: (message: string) => setToast(message),
    tuiConfig: tuiConfig(),
  });

  // Render welcome screen if no messages
  return (
    <Show
      when={session.displayMessages().length > 0}
      fallback={
        <box
          style={{ backgroundColor: tokens.bgBase }}
          flexDirection="column"
          flexGrow={1}
          alignItems="center"
          justifyContent="center"
        >
          <Show when={context.showContextStats() && context.contextStats()}>
            {(stats: () => import('./types').ContextStats) => (
              <ContextStatsModal
                stats={stats()}
                modelName={model}
                onClose={context.handleContextStatsClose}
              />
            )}
          </Show>

          <Show when={showConfigModal()}>
            <ConfigModal
              config={props.config}
              layers={configLayers}
              warnings={configWarnings}
              onClose={() => setShowConfigModal(false)}
            />
          </Show>

          <Show when={showHelp()}>
            <KeyboardShortcutsModal onClose={() => setShowHelp(false)} />
          </Show>

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

          <Show when={session.showSessionPicker()}>
            <SessionPicker
              sessions={listSessions({ limit: tuiConfig().sessionListLimit })}
              projectPath={props.projectPath}
              onSelect={session.handleSessionSelect}
              onCancel={session.handleSessionPickerCancel}
              onSessionsChanged={session.handleSessionsChanged}
            />
          </Show>

          <Show when={session.showThemePicker()}>
            <ThemePicker
              onSelect={session.handleThemeSelect}
              onCancel={session.handleThemePickerCancel}
            />
          </Show>

          <Show when={context.contextInfo()}>
            {(info: () => string) => (
              <box marginTop={1}>
                <ContextInfoNotification message={info()} />
              </box>
            )}
          </Show>

          <box
            flexDirection="column"
            marginTop={2}
            width={80}
            position="relative"
          >
            <Show when={commands.showCommandMenu()}>
              <CommandMenu
                commands={commands.slashCommands}
                filter={commands.commandFilter()}
                selectedIndex={commands.commandSelectedIndex()}
                onSelect={commands.handleCommandSelect}
                onCancel={commands.handleCommandMenuCancel}
                onIndexChange={commands.handleCommandIndexChange}
                bottom={5}
                width={80}
              />
            </Show>

            <Show when={filePicker.showFilePicker()}>
              <FilePicker
                files={filePicker.files()}
                filter={filePicker.fileFilter()}
                selectedIndex={filePicker.fileSelectedIndex()}
                onSelect={filePicker.handleFileSelect}
                onCancel={filePicker.handleFilePickerCancel}
                onIndexChange={filePicker.handleFileIndexChange}
                bottom={5}
                width={80}
              />
            </Show>

            <InputBox
              id="greeting-textarea"
              model={model}
              status={agent.status()}
              error={agent.error()}
              mode={session.mode()}
              getTextareaRef={getTextareaRef}
              getStatus={getStatus}
              onSubmit={agent.handleSubmit}
              onRef={(el) => {
                textareaRef = el;
              }}
              disabled={
                session.showSessionPicker() || session.showThemePicker()
              }
              suppressSubmit={filePicker.showFilePicker()}
            />
          </box>

          <Show when={toast()}>
            {(msg: () => string) => (
              <ToastNotification
                message={msg()}
                duration={tuiConfig().toastDuration}
                onDismiss={() => setToast(null)}
              />
            )}
          </Show>
        </box>
      }
    >
      {/* Chat screen with messages */}
      <box
        style={{ backgroundColor: tokens.bgBase }}
        flexDirection="row"
        flexGrow={1}
        flexShrink={1}
      >
        <Show when={context.showContextStats() && context.contextStats()}>
          {(stats: () => import('./types').ContextStats) => (
            <ContextStatsModal
              stats={stats()}
              modelName={model}
              onClose={context.handleContextStatsClose}
            />
          )}
        </Show>

        <Show when={showConfigModal()}>
          <ConfigModal
            config={props.config}
            layers={configLayers}
            warnings={configWarnings}
            onClose={() => setShowConfigModal(false)}
          />
        </Show>

        <Show when={showHelp()}>
          <KeyboardShortcutsModal onClose={() => setShowHelp(false)} />
        </Show>

        <Show when={session.showSessionPicker()}>
          <SessionPicker
            sessions={listSessions({ limit: tuiConfig().sessionListLimit })}
            projectPath={props.projectPath}
            onSelect={session.handleSessionSelect}
            onCancel={session.handleSessionPickerCancel}
            onSessionsChanged={session.handleSessionsChanged}
          />
        </Show>

        <Show when={session.showThemePicker()}>
          <ThemePicker
            onSelect={session.handleThemeSelect}
            onCancel={session.handleThemePickerCancel}
          />
        </Show>

        <box
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          paddingTop={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <scrollbox
            flexGrow={1}
            flexShrink={1}
            stickyScroll={true}
            stickyStart="bottom"
            scrollAcceleration={fastScrollAccel}
          >
            <box flexDirection="column" flexGrow={1} paddingRight={2}>
              <For each={session.displayMessages()}>
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
                        message={msg as import('./types').ToolDisplayMessage}
                        isActiveConfirmation={
                          agent.confirmingToolId() ===
                          (msg as import('./types').ToolDisplayMessage).id
                        }
                        onConfirmationResponse={(response) => {
                          agent.handleToolConfirmation(response);
                        }}
                        expanded={toolsExpanded()}
                        isModalOpen={() =>
                          session.showSessionPicker() ||
                          commands.showCommandMenu()
                        }
                      />
                    </Show>
                  </box>
                )}
              </For>

              <Show when={agent.streamingContent()}>
                <box>
                  <text>{agent.streamingContent()}</text>
                </box>
              </Show>
            </box>
          </scrollbox>

          <box flexDirection="column" flexShrink={0} position="relative">
            <Show when={context.contextInfo()}>
              {(info: () => string) => (
                <ContextInfoNotification message={info()} />
              )}
            </Show>

            <Show when={commands.showCommandMenu()}>
              <CommandMenu
                commands={commands.slashCommands}
                filter={commands.commandFilter()}
                selectedIndex={commands.commandSelectedIndex()}
                onSelect={commands.handleCommandSelect}
                onCancel={commands.handleCommandMenuCancel}
                onIndexChange={commands.handleCommandIndexChange}
                bottom={5}
              />
            </Show>

            <Show when={filePicker.showFilePicker()}>
              <FilePicker
                files={filePicker.files()}
                filter={filePicker.fileFilter()}
                selectedIndex={filePicker.fileSelectedIndex()}
                onSelect={filePicker.handleFileSelect}
                onCancel={filePicker.handleFilePickerCancel}
                onIndexChange={filePicker.handleFileIndexChange}
                bottom={5}
              />
            </Show>

            <InputBox
              id="chat-textarea"
              model={model}
              status={agent.status()}
              error={agent.error()}
              mode={session.mode()}
              getTextareaRef={getTextareaRef}
              getStatus={getStatus}
              onSubmit={agent.handleSubmit}
              onRef={(el) => {
                textareaRef = el;
              }}
              disabled={
                !!agent.confirmingToolId() ||
                session.showSessionPicker() ||
                session.showThemePicker()
              }
              suppressSubmit={filePicker.showFilePicker()}
            />
          </box>
        </box>

        <SidePanel
          contextStats={context.sidebarStats()}
          todos={session.sidebarTodos()}
          width={40}
        />

        <Show when={toast()}>
          {(msg: () => string) => (
            <ToastNotification
              message={msg()}
              duration={tuiConfig().toastDuration}
              onDismiss={() => setToast(null)}
            />
          )}
        </Show>
      </box>
    </Show>
  );
}
