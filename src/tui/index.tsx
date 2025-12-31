import { RGBA, SyntaxStyle, type TextareaRenderable, type ScrollAcceleration } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useRef, useState, useEffect } from "react";
import type { Message, ToolCall } from "ollama";

import type { SemanticTokens } from "../design";
import { ThemeProvider, useTheme } from "../design";
import { runAgent } from "../agent";
import type { ToolResult, AgentStep } from "../agent/types";
import type { ConfirmationRequest, ConfirmationResponse } from "../agent/safety/types";
import type { AgentMode } from "../agent/modes";
import { toggleMode, DEFAULT_MODE } from "../agent/modes";
import { compactMessages, getCompactionLevel } from "../agent/compaction";
import { fetchModelInfo, getContextStats, type ContextStats } from "../lib/tokenizer";
import { ContextStatsModal } from "./components/context-stats-modal";
import { InputBox } from "./components/input-box";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import type { Status } from "./components/status-bar";
import {
  getSession,
  getMessages,
  listSessions,
  createSession,
  addMessage,
  updateSession,
  toOllamaMessages,
  toDisplayMessages,
  fromUserInput,
  fromAssistantResponse,
  type Session,
} from "../session";
import { SessionPicker } from "./components/session-picker";
import { CommandMenu, type SlashCommand } from "./components/command-menu";
import { SidePanel } from "./components/side-panel";
import { ThemePicker } from "./components/theme-picker";
import { getTodos, type Todo } from "../session/todo";

const fastScrollAccel: ScrollAcceleration = {
  tick: () => 5,
  reset: () => {},
};

function createMarkdownSyntaxStyle(tokens: SemanticTokens): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(tokens.syntaxDefault) },
    "markup.heading": { bold: true },
    "markup.heading.1": { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(tokens.syntaxConstant), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(tokens.syntaxProperty), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(tokens.syntaxFunction), bold: true },
    "markup.heading.5": { fg: RGBA.fromHex(tokens.syntaxType), bold: true },
    "markup.heading.6": { fg: RGBA.fromHex(tokens.syntaxComment), bold: true },
    "markup.strong": { fg: RGBA.fromHex(tokens.warning), bold: true },
    "markup.italic": { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    "markup.raw": { fg: RGBA.fromHex(tokens.syntaxFunction) },
    "markup.link": { fg: RGBA.fromHex(tokens.syntaxProperty) },
    "markup.link.url": { fg: RGBA.fromHex(tokens.syntaxProperty), underline: true },
    "markup.list": { fg: RGBA.fromHex(tokens.syntaxConstant) },
    "markup.quote": { fg: RGBA.fromHex(tokens.syntaxComment), italic: true },
    "text.title": { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    "text.emphasis": { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    "text.strong": { fg: RGBA.fromHex(tokens.syntaxString), bold: true },
    "text.literal": { fg: RGBA.fromHex(tokens.syntaxString) },
    "text.uri": { fg: RGBA.fromHex(tokens.syntaxProperty), underline: true },
    "text.reference": { fg: RGBA.fromHex(tokens.syntaxProperty) },
    keyword: { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    string: { fg: RGBA.fromHex(tokens.syntaxString) },
    comment: { fg: RGBA.fromHex(tokens.syntaxComment), italic: true },
    number: { fg: RGBA.fromHex(tokens.syntaxNumber) },
    function: { fg: RGBA.fromHex(tokens.syntaxFunction) },
    variable: { fg: RGBA.fromHex(tokens.syntaxVariable) },
    operator: { fg: RGBA.fromHex(tokens.syntaxOperator) },
    type: { fg: RGBA.fromHex(tokens.syntaxType) },
    property: { fg: RGBA.fromHex(tokens.syntaxProperty) },
    punctuation: { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    "punctuation.bracket": { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    constant: { fg: RGBA.fromHex(tokens.syntaxConstant) },
  });
}

type DisplayMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; error?: string };

function AssistantMessage({ content }: { content: string }) {
  const { tokens } = useTheme();
  const markdownStyle = createMarkdownSyntaxStyle(tokens);

  return (
    <box flexDirection="column" marginLeft={2}>
      <code selectable={true} content={content} filetype="markdown" syntaxStyle={markdownStyle} drawUnstyledText={true} />
    </box>
  );
}

function UserMessage({ content }: { content: string }) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: tokens.borderAccent,
      }}
    >
      <text>{content}</text>
    </box>
  );
}

function ToolCallMessage({ name, args }: { name: string; args: Record<string, unknown> }) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: tokens.warning,
      }}
    >
      <text style={{ fg: tokens.warning }}>Tool: {name}</text>
      <text style={{ fg: tokens.textMuted }}> {JSON.stringify(args)}</text>
    </box>
  );
}

function ToolResultMessage({ name, output, error }: { name: string; output: string; error?: string }) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: error ? tokens.error : tokens.success,
      }}
    >
      {error ? (
        <text style={{ fg: tokens.error }}>x {name}: {error}</text>
      ) : (
        <text style={{ fg: tokens.success }}>+ {name}: {output.length > 100 ? output.slice(0, 100) + "..." : output}</text>
      )}
    </box>
  );
}

function ContextInfoNotification({ message }: { message: string }) {
  const { tokens } = useTheme();

  return (
    <box style={{ paddingLeft: 1 }}>
      <text style={{ fg: tokens.textMuted }}>{message}</text>
    </box>
  );
}

type AppProps = {
  model: string;
  host: string;
  projectPath: string;
  initialSessionId?: string;
  initialTheme?: string;
};

export function App({ initialTheme, ...props }: AppProps) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <ChatApp {...props} />
    </ThemeProvider>
  );
}

function ChatApp({ model, host, projectPath, initialSessionId }: AppProps) {
  const { tokens } = useTheme();
  const renderer = useRenderer();
  const textareaRef = useRef<TextareaRenderable>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastEscapeRef = useRef<number>(0);

  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [mode, setMode] = useState<AgentMode>(DEFAULT_MODE);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const confirmationResolverRef = useRef<((response: ConfirmationResponse) => void) | null>(null);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [contextInfo, setContextInfo] = useState<string | null>(null);
  const [showContextStats, setShowContextStats] = useState(false);
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [sidebarStats, setSidebarStats] = useState<ContextStats | null>(null);
  const [sidebarTodos, setSidebarTodos] = useState<Todo[]>([]);

  const statusRef = useRef(status);
  statusRef.current = status;
  const historyRef = useRef(history);
  historyRef.current = history;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  sessionRef.current = currentSession;

  useEffect(() => {
    if (initialSessionId) {
      const session = getSession(initialSessionId);
      if (session) {
        setCurrentSession(session);
        setMode(session.mode);
        const storedMessages = getMessages(session.id);
        const ollamaMessages = toOllamaMessages(storedMessages);
        const displayMsgs = toDisplayMessages(storedMessages);
        setHistory(ollamaMessages);
        setDisplayMessages(displayMsgs);
      }
    }
  }, [initialSessionId]);

  useEffect(() => {
    if (history.length === 0) {
      setSidebarStats(null);
      return;
    }
    void (async () => {
      try {
        const modelInfo = await fetchModelInfo(model, host);
        const stats = getContextStats(history, modelInfo.contextLength);
        setSidebarStats(stats);
      } catch {
        setSidebarStats(null);
      }
    })();
  }, [history, model, host]);

  useEffect(() => {
    if (currentSession) {
      setSidebarTodos(getTodos(currentSession.id));
    } else {
      setSidebarTodos([]);
    }
  }, [currentSession]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "k") {
      renderer.toggleDebugOverlay();
      renderer.console.toggle();
    }

    if (key.name === "tab" && statusRef.current === "idle" && !showCommandMenu && !showSessionPicker) {
      const newMode = toggleMode(modeRef.current);
      setMode(newMode);
      if (sessionRef.current) {
        updateSession(sessionRef.current.id, { mode: newMode });
      }
    }

    if (key.name === "escape" && statusRef.current === "thinking") {
      const now = Date.now();
      if (now - lastEscapeRef.current < 500) {
        abortControllerRef.current?.abort();
        lastEscapeRef.current = 0;
      } else {
        lastEscapeRef.current = now;
      }
    }

    setTimeout(() => {
      if (!textareaRef.current || textareaRef.current.isDestroyed) return;
      const currentText = textareaRef.current.plainText ?? "";
      if (statusRef.current === "idle" && !showSessionPicker) {
        if (currentText.startsWith("/")) {
          const newFilter = currentText.slice(1);
          if (!showCommandMenu) setShowCommandMenu(true);
          setCommandFilter(newFilter);
        } else if (showCommandMenu) {
          setShowCommandMenu(false);
          setCommandFilter("");
          setCommandSelectedIndex(0);
        }
      }
    }, 0);
  });

  const handleSubmit = async (prompt: string) => {
    setStatus("thinking");
    setError("");
    setStreamingContent("");

    let session = sessionRef.current;
    if (!session) {
      session = await createSession({ projectPath, model, host, mode: modeRef.current });
      setCurrentSession(session);
    }

    addMessage(session.id, "user", fromUserInput(prompt));
    setDisplayMessages((prev) => [...prev, { type: "user", content: prompt }]);

    abortControllerRef.current = new AbortController();

    const result = await runAgent({
      model,
      host,
      userMessage: prompt,
      history: historyRef.current,
      mode: modeRef.current,
      sessionId: session.id,
      signal: abortControllerRef.current.signal,
      onReasoningToken: (token) => setStreamingContent((prev) => prev + token),
      onToolCall: (call: ToolCall) => {
        setDisplayMessages((prev) => [...prev, { type: "tool_call", name: call.function.name, args: call.function.arguments }]);
      },
      onToolResult: (result: ToolResult) => {
        setDisplayMessages((prev) => [...prev, { type: "tool_result", name: result.tool, output: result.output, error: result.error }]);
      },
      onStepComplete: (_step: AgentStep) => setStreamingContent(""),
      onConfirmationNeeded: (request: ConfirmationRequest): Promise<ConfirmationResponse> => {
        return new Promise((resolve) => {
          confirmationResolverRef.current = resolve;
          setPendingConfirmation(request);
        });
      },
      onToolBlocked: (tool: string, reason: string) => {
        setDisplayMessages((prev) => [...prev, { type: "tool_result", name: tool, output: "", error: `Blocked: ${reason}` }]);
      },
    });

    if ("type" in result) {
      switch (result.type) {
        case "aborted":
          setStatus("idle");
          if (streamingContent.trim()) {
            setDisplayMessages((prev) => [...prev, { type: "assistant", content: streamingContent + "\n\n[interrupted]" }]);
          }
          break;
        case "model_error":
          setStatus("error");
          setError(result.message);
          break;
        case "max_iterations":
          setStatus("error");
          setError(`Max iterations (${result.iterations}) reached. Last thought: ${result.lastThought.slice(0, 100)}...`);
          break;
        case "loop_detected":
          setStatus("error");
          setError(`Loop detected: ${result.action} called ${result.attempts} times`);
          break;
        case "tool_error":
          setStatus("error");
          setError(`Tool error (${result.tool}): ${result.message}`);
          break;
      }
    } else {
      setDisplayMessages((prev) => [...prev, { type: "assistant", content: result.finalAnswer }]);
      setHistory(result.messages);
      setStatus("idle");

      if (session) setSidebarTodos(getTodos(session.id));

      if (session) {
        const lastStep = result.steps[result.steps.length - 1];
        const toolCalls = lastStep?.actions.map((tc) => ({ name: tc.function.name, args: tc.function.arguments as Record<string, unknown> }));
        const toolResults = lastStep?.observations.map((obs) => ({ name: obs.tool, output: obs.output, error: obs.error }));
        addMessage(session.id, "assistant", fromAssistantResponse(result.finalAnswer, toolCalls, toolResults));
      }
    }

    setStreamingContent("");
  };

  const handleConfirmationResponse = (response: ConfirmationResponse) => {
    if (confirmationResolverRef.current) {
      confirmationResolverRef.current(response);
      confirmationResolverRef.current = null;
    }
    setPendingConfirmation(null);
  };

  const handleNewSession = () => {
    setCurrentSession(null);
    setHistory([]);
    setDisplayMessages([]);
    setMode(DEFAULT_MODE);
    setError("");
    setStreamingContent("");
  };

  const handleSessionSelect = (session: Session) => {
    setShowSessionPicker(false);
    setCurrentSession(session);
    setMode(session.mode);
    const storedMessages = getMessages(session.id);
    setHistory(toOllamaMessages(storedMessages));
    setDisplayMessages(toDisplayMessages(storedMessages));
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleSessionPickerCancel = () => {
    setShowSessionPicker(false);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleSessionsChanged = () => setSessionRefreshKey((prev) => prev + 1);

  const handleClearContext = () => {
    setHistory([]);
    setDisplayMessages([]);
    setStreamingContent("");
    setError("");
    setContextInfo("Context cleared. Starting fresh conversation.");
    setTimeout(() => setContextInfo(null), 3000);
  };

  const handleCompact = async () => {
    if (history.length === 0) {
      setContextInfo("Nothing to compact - context is empty.");
      setTimeout(() => setContextInfo(null), 3000);
      return;
    }

    try {
      setContextInfo("Compacting context...");
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(history, modelInfo.contextLength);
      const level = getCompactionLevel(stats.usagePercent);
      const result = await compactMessages([{ role: "system", content: "" }, ...history], level, undefined, model, host);
      const compactedHistory = result.messages.slice(1);
      setHistory(compactedHistory);
      setContextInfo(
        `Compacted: ${result.originalCount} -> ${result.compactedCount} messages, ` +
        `${result.tokensBefore} -> ${result.tokensAfter} tokens (${Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)}% reduction)`
      );
      setTimeout(() => setContextInfo(null), 5000);
    } catch (e) {
      setContextInfo(`Compaction failed: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setContextInfo(null), 5000);
    }
  };

  const handleShowContext = async () => {
    if (history.length === 0) {
      setContextInfo("Context is empty.");
      setTimeout(() => setContextInfo(null), 3000);
      return;
    }

    try {
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(history, modelInfo.contextLength);
      setContextStats(stats);
      setShowContextStats(true);
    } catch (e) {
      setContextInfo(`Could not get context stats: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setContextInfo(null), 5000);
    }
  };

  const handleContextStatsClose = () => {
    setShowContextStats(false);
    setContextStats(null);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleThemeSelect = (themeId: string) => {
    setShowThemePicker(false);
    // Persist theme selection to config
    void import("../config").then(({ setConfigValue }) => {
      setConfigValue("theme", themeId);
    });
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleThemePickerCancel = () => {
    setShowThemePicker(false);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleForget = (n: number) => {
    if (history.length === 0) {
      setContextInfo("Nothing to forget - context is empty.");
      setTimeout(() => setContextInfo(null), 3000);
      return;
    }

    const toRemove = Math.min(n, history.length);
    setHistory(history.slice(0, -toRemove));
    const displayToRemove = Math.min(toRemove * 2, displayMessages.length);
    setDisplayMessages((prev) => prev.slice(0, -displayToRemove));
    setContextInfo(`Forgot last ${toRemove} message${toRemove === 1 ? "" : "s"}.`);
    setTimeout(() => setContextInfo(null), 3000);
  };

  const slashCommands: SlashCommand[] = [
    { name: "new", description: "Start a new session", action: () => { handleNewSession(); textareaRef.current?.setText(""); } },
    { name: "session", description: "Switch to a different session", action: () => { setShowSessionPicker(true); textareaRef.current?.setText(""); } },
    { name: "clear", description: "Clear context (keep session)", action: () => { handleClearContext(); textareaRef.current?.setText(""); } },
    { name: "compact", description: "Manually compact context", action: () => { void handleCompact(); textareaRef.current?.setText(""); } },
    { name: "context", description: "Show context usage stats", action: () => { void handleShowContext(); textareaRef.current?.setText(""); } },
    {
      name: "forget",
      description: "Forget last N messages (e.g., /forget 3)",
      action: () => {
        const filterNum = parseInt(commandFilter.replace("forget", "").trim(), 10);
        handleForget(isNaN(filterNum) || filterNum < 1 ? 1 : filterNum);
        textareaRef.current?.setText("");
      },
    },
    { name: "theme", description: "Change color theme", action: () => { setShowThemePicker(true); textareaRef.current?.setText(""); } },
  ];

  const handleCommandSelect = (command: SlashCommand) => {
    setShowCommandMenu(false);
    setCommandFilter("");
    command.action();
  };

  const handleCommandMenuCancel = () => {
    setShowCommandMenu(false);
    setCommandFilter("");
    setCommandSelectedIndex(0);
  };

  const handleCommandIndexChange = (index: number) => setCommandSelectedIndex(index);

  // Welcome screen
  if (displayMessages.length === 0) {
    return (
      <box key="greeting-container" style={{ backgroundColor: tokens.bgBase }} flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
        {showContextStats && contextStats && (
          <ContextStatsModal stats={contextStats} modelName={model} onClose={handleContextStatsClose} />
        )}

        <box flexDirection="row">
          <ascii-font text="Olly" font="tiny" color={RGBA.fromHex(tokens.primaryBase)} />
          <text>{" "}</text>
          <ascii-font text="Code" font="tiny" color={RGBA.fromHex(tokens.textBase)} />
        </box>

        {showSessionPicker && (
          <SessionPicker
            key={sessionRefreshKey}
            sessions={listSessions({ limit: 50 })}
            projectPath={projectPath}
            onSelect={handleSessionSelect}
            onCancel={handleSessionPickerCancel}
            onSessionsChanged={handleSessionsChanged}
          />
        )}

        {showThemePicker && <ThemePicker onSelect={handleThemeSelect} onCancel={handleThemePickerCancel} />}

        {contextInfo && (
          <box marginTop={1}>
            <ContextInfoNotification message={contextInfo} />
          </box>
        )}

        <box flexDirection="column" marginTop={2} width={80} position="relative">
          {showCommandMenu && (
            <CommandMenu
              commands={slashCommands}
              filter={commandFilter}
              selectedIndex={commandSelectedIndex}
              onSelect={handleCommandSelect}
              onCancel={handleCommandMenuCancel}
              onIndexChange={handleCommandIndexChange}
              bottom={5}
              width={80}
            />
          )}

          <InputBox
            id="greeting-textarea"
            model={model}
            status={status}
            error={error}
            mode={mode}
            textareaRef={textareaRef}
            statusRef={statusRef}
            onSubmit={handleSubmit}
          />
        </box>
      </box>
    );
  }

  // Chat screen
  return (
    <box key="chat-container" style={{ backgroundColor: tokens.bgBase }} flexDirection="row" flexGrow={1} flexShrink={1}>
      {showContextStats && contextStats && (
        <ContextStatsModal stats={contextStats} modelName={model} onClose={handleContextStatsClose} />
      )}

      {showSessionPicker && (
        <SessionPicker
          key={sessionRefreshKey}
          sessions={listSessions({ limit: 50 })}
          projectPath={projectPath}
          onSelect={handleSessionSelect}
          onCancel={handleSessionPickerCancel}
          onSessionsChanged={handleSessionsChanged}
        />
      )}

      {showThemePicker && <ThemePicker onSelect={handleThemeSelect} onCancel={handleThemePickerCancel} />}

      <box flexDirection="column" flexGrow={1} flexShrink={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
        <scrollbox flexGrow={1} flexShrink={1} stickyScroll={true} stickyStart="bottom" scrollAcceleration={fastScrollAccel}>
          <box flexDirection="column" flexGrow={1} paddingRight={2}>
            {displayMessages.map((msg, idx) => (
              <box key={`msg-${idx}`} marginBottom={1}>
                {msg.type === "user" && <UserMessage content={msg.content} />}
                {msg.type === "assistant" && <AssistantMessage content={msg.content} />}
                {msg.type === "tool_call" && <ToolCallMessage name={msg.name} args={msg.args} />}
                {msg.type === "tool_result" && <ToolResultMessage name={msg.name} output={msg.output} error={msg.error} />}
              </box>
            ))}

            {streamingContent && (
              <box key="streaming">
                <text>{streamingContent}</text>
              </box>
            )}

            {pendingConfirmation && (
              <ConfirmationDialog request={pendingConfirmation} onResponse={handleConfirmationResponse} />
            )}
          </box>
        </scrollbox>

        <box flexDirection="column" flexShrink={0} position="relative">
          {contextInfo && <ContextInfoNotification message={contextInfo} />}

          {showCommandMenu && (
            <CommandMenu
              commands={slashCommands}
              filter={commandFilter}
              selectedIndex={commandSelectedIndex}
              onSelect={handleCommandSelect}
              onCancel={handleCommandMenuCancel}
              onIndexChange={handleCommandIndexChange}
              bottom={5}
            />
          )}

          <InputBox
            id="chat-textarea"
            model={model}
            status={status}
            error={error}
            mode={mode}
            textareaRef={textareaRef}
            statusRef={statusRef}
            onSubmit={handleSubmit}
          />
        </box>
      </box>

      <SidePanel contextStats={sidebarStats} todos={sidebarTodos} width={40} />
    </box>
  );
}
