/**
 * TUI Entry Point.
 * Main application component — composes ModalLayer, WelcomeScreen, and ChatScreen.
 */

import type { TextareaRenderable } from '@opentui/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { extractTuiConfig } from '../config/resolve';
import { ThemeProvider } from '../design';
import { FocusLayer, KeyboardFocusProvider, useFocusLayer } from './keyboard';
import { ChatScreen, ModalLayer, WelcomeScreen } from './components';
import {
  useAgentContext,
  useAgentSubmit,
  useCommandMenu,
  useFilePicker,
  useKeyboardShortcuts,
  useMcp,
  useSession,
} from './hooks';
import { useMessageStore } from './hooks/use-message-store';
import type { AppProps, Status } from './types';

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
      <KeyboardFocusProvider>
        <AppContent
          config={props.config}
          configLayers={props.configLayers}
          configWarnings={props.configWarnings}
          projectPath={props.projectPath}
          initialSessionId={props.initialSessionId}
        />
      </KeyboardFocusProvider>
    </ThemeProvider>
  );
}

function AppContent(props: AppProps) {
  // Static: set once at mount, never changes (config is resolved before render)
  const configLayers = props.configLayers ?? [];
  const configWarnings = props.configWarnings ?? [];
  const model = props.config.model;

  // Register the "app" focus layer — active when no modal/overlay is open
  useFocusLayer(FocusLayer.APP);
  let textareaRef: TextareaRenderable | undefined;
  const [toast, setToast] = createSignal<string | null>(null);
  const [showConfigModal, setShowConfigModal] = createSignal(false);
  const [showMcpModal, setShowMcpModal] = createSignal(false);

  // MCP hook — connects servers, registers tools, provides reactive status
  const mcp = useMcp({
    config: props.config,
    onToast: (message) => setToast(message),
  });

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
    updateRealTokenCounts: context.updateRealTokenCounts,
    setContextInfo: context.setContextInfo,
    mcpTools: mcp.mcpTools,
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
    handlers: {
      handleNewSession: session.handleNewSession,
      handleClearContext: context.handleClearContext,
      handleCompact: context.handleCompact,
      handleShowContext: context.handleShowContext,
      handleForget: context.handleForget,
      handleInit,
      handleConfig: () => setShowConfigModal(true),
      handleMcp: () => setShowMcpModal(true),
      setShowSessionPicker: session.setShowSessionPicker,
      setShowThemePicker: session.setShowThemePicker,
    },
  });

  // File picker hook for @ mentions
  const filePicker = useFilePicker({
    getTextareaRef,
  });

  // Global keyboard shortcuts
  const { toolsExpanded, showHelp, setShowHelp } = useKeyboardShortcuts({
    status: agent.status,
    mode: session.mode,
    setMode: session.setMode,
    abort: agent.abort,
    currentSession: session.currentSession,
    onClipboardNotify: (message: string) => setToast(message),
    tuiConfig: tuiConfig(),
  });

  // Derived: is input disabled on welcome screen
  const welcomeInputDisabled = () =>
    session.showSessionPicker() || session.showThemePicker();

  // Derived: is input disabled on chat screen
  const chatInputDisabled = () =>
    !!agent.confirmingToolId() ||
    session.showSessionPicker() ||
    session.showThemePicker();

  return (
    <>
      <ModalLayer
        showContextStats={context.showContextStats}
        contextStats={context.contextStats}
        modelName={model}
        onContextStatsClose={context.handleContextStatsClose}
        showConfigModal={showConfigModal}
        config={props.config}
        configLayers={configLayers}
        configWarnings={configWarnings}
        onConfigModalClose={() => setShowConfigModal(false)}
        showMcpModal={showMcpModal}
        mcpStatus={mcp.mcpStatus}
        mcpManager={mcp.manager}
        onMcpModalClose={() => setShowMcpModal(false)}
        showHelp={showHelp}
        onHelpClose={() => setShowHelp(false)}
        showSessionPicker={session.showSessionPicker}
        projectPath={props.projectPath}
        sessionListLimit={tuiConfig().sessionListLimit}
        onSessionSelect={session.handleSessionSelect}
        onSessionPickerCancel={session.handleSessionPickerCancel}
        onSessionsChanged={session.handleSessionsChanged}
        showThemePicker={session.showThemePicker}
        onThemeSelect={session.handleThemeSelect}
        onThemePickerCancel={session.handleThemePickerCancel}
      />

      <Show
        when={session.displayMessages().length > 0}
        fallback={
          <WelcomeScreen
            model={model}
            status={agent.status}
            mode={session.mode}
            getTextareaRef={getTextareaRef}
            getStatus={getStatus}
            onSubmit={agent.handleSubmit}
            onRef={(el) => {
              textareaRef = el;
            }}
            inputDisabled={welcomeInputDisabled}
            showCommandMenu={commands.showCommandMenu}
            slashCommands={commands.slashCommands}
            commandFilter={commands.commandFilter}
            commandSelectedIndex={commands.commandSelectedIndex}
            onCommandSelect={commands.handleCommandSelect}
            onCommandMenuCancel={commands.handleCommandMenuCancel}
            onCommandIndexChange={commands.handleCommandIndexChange}
            showFilePicker={filePicker.showFilePicker}
            files={filePicker.files}
            fileFilter={filePicker.fileFilter}
            fileSelectedIndex={filePicker.fileSelectedIndex}
            onFileSelect={filePicker.handleFileSelect}
            onFilePickerCancel={filePicker.handleFilePickerCancel}
            onFileIndexChange={filePicker.handleFileIndexChange}
            contextInfo={context.contextInfo}
            toast={toast}
            toastDuration={tuiConfig().toastDuration}
            onToastDismiss={() => setToast(null)}
          />
        }
      >
        <ChatScreen
          displayMessages={session.displayMessages}
          streamingContent={agent.streamingContent}
          confirmingToolId={agent.confirmingToolId}
          onToolConfirmation={agent.handleToolConfirmation}
          toolsExpanded={toolsExpanded}
          model={model}
          status={agent.status}
          mode={session.mode}
          getTextareaRef={getTextareaRef}
          getStatus={getStatus}
          onSubmit={agent.handleSubmit}
          onRef={(el) => {
            textareaRef = el;
          }}
          inputDisabled={chatInputDisabled}
          showCommandMenu={commands.showCommandMenu}
          slashCommands={commands.slashCommands}
          commandFilter={commands.commandFilter}
          commandSelectedIndex={commands.commandSelectedIndex}
          onCommandSelect={commands.handleCommandSelect}
          onCommandMenuCancel={commands.handleCommandMenuCancel}
          onCommandIndexChange={commands.handleCommandIndexChange}
          showFilePicker={filePicker.showFilePicker}
          files={filePicker.files}
          fileFilter={filePicker.fileFilter}
          fileSelectedIndex={filePicker.fileSelectedIndex}
          onFileSelect={filePicker.handleFileSelect}
          onFilePickerCancel={filePicker.handleFilePickerCancel}
          onFileIndexChange={filePicker.handleFileIndexChange}
          contextInfo={context.contextInfo}
          sidebarStats={context.sidebarStats}
          sidebarTodos={session.sidebarTodos}
          mcpStatus={mcp.mcpStatus}
          mcpConnecting={mcp.connecting}
          toast={toast}
          toastDuration={tuiConfig().toastDuration}
          onToastDismiss={() => setToast(null)}
        />
      </Show>
    </>
  );
}
