/**
 * Hook for session management.
 * Handles session CRUD, mode, history, display messages, and todos.
 */

import { useState, useEffect, useRef } from 'react';
import { DEFAULT_MODE } from '../../agent/modes';
import {
  getSession,
  getMessages,
  listSessions,
  createSession,
  toOllamaMessages,
  toDisplayMessages,
} from '../../session';
import { getTodos } from '../../session/todo';
import { FOCUS_DELAY_MS, SESSION_LIST_LIMIT } from '../constants';
import type {
  Session,
  Message,
  DisplayMessage,
  AgentMode,
  Todo,
  TextareaRef,
} from '../types';

export type UseSessionProps = {
  /** Project path for session creation */
  projectPath: string;
  /** Model name */
  model: string;
  /** Ollama host URL */
  host: string;
  /** Initial session ID to load */
  initialSessionId?: string;
  /** Textarea ref for focus management */
  textareaRef: TextareaRef;
};

export type UseSessionReturn = {
  /** Current session or null */
  currentSession: Session | null;
  /** Set current session */
  setCurrentSession: React.Dispatch<React.SetStateAction<Session | null>>;
  /** Message history for Ollama */
  history: Message[];
  /** Set history */
  setHistory: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Display messages for UI */
  displayMessages: DisplayMessage[];
  /** Set display messages */
  setDisplayMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>;
  /** Current agent mode */
  mode: AgentMode;
  /** Set mode */
  setMode: React.Dispatch<React.SetStateAction<AgentMode>>;
  /** Todos for sidebar */
  sidebarTodos: Todo[];
  /** Set sidebar todos */
  setSidebarTodos: React.Dispatch<React.SetStateAction<Todo[]>>;
  /** Whether session picker is visible */
  showSessionPicker: boolean;
  /** Set session picker visibility */
  setShowSessionPicker: React.Dispatch<React.SetStateAction<boolean>>;
  /** Key for forcing session picker refresh */
  sessionRefreshKey: number;
  /** Whether theme picker is visible */
  showThemePicker: boolean;
  /** Set theme picker visibility */
  setShowThemePicker: React.Dispatch<React.SetStateAction<boolean>>;
  /** List available sessions */
  listAvailableSessions: () => Session[];
  /** Create a new session */
  handleNewSession: () => void;
  /** Select a session */
  handleSessionSelect: (session: Session) => void;
  /** Cancel session picker */
  handleSessionPickerCancel: () => void;
  /** Notify sessions changed */
  handleSessionsChanged: () => void;
  /** Handle theme selection */
  handleThemeSelect: (themeId: string) => void;
  /** Cancel theme picker */
  handleThemePickerCancel: () => void;
  /** Create session if needed and return it */
  ensureSession: () => Promise<Session>;
};

export function useSession({
  projectPath,
  model,
  host,
  initialSessionId,
  textareaRef,
}: UseSessionProps): UseSessionReturn {
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [mode, setMode] = useState<AgentMode>(DEFAULT_MODE);
  const [sidebarTodos, setSidebarTodos] = useState<Todo[]>([]);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [showThemePicker, setShowThemePicker] = useState(false);

  // Keep a ref to current session for use in callbacks
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = currentSession;

  // Load initial session
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

  // Load todos when session changes
  useEffect(() => {
    if (currentSession) {
      setSidebarTodos(getTodos(currentSession.id));
    } else {
      setSidebarTodos([]);
    }
  }, [currentSession]);

  const listAvailableSessions = () => {
    return listSessions({ limit: SESSION_LIST_LIMIT });
  };

  const handleNewSession = () => {
    setCurrentSession(null);
    setHistory([]);
    setDisplayMessages([]);
    setMode(DEFAULT_MODE);
  };

  const handleSessionSelect = (session: Session) => {
    setShowSessionPicker(false);
    setCurrentSession(session);
    setMode(session.mode);
    const storedMessages = getMessages(session.id);
    setHistory(toOllamaMessages(storedMessages));
    setDisplayMessages(toDisplayMessages(storedMessages));
    setTimeout(() => textareaRef.current?.focus(), FOCUS_DELAY_MS);
  };

  const handleSessionPickerCancel = () => {
    setShowSessionPicker(false);
    setTimeout(() => textareaRef.current?.focus(), FOCUS_DELAY_MS);
  };

  const handleSessionsChanged = () => {
    setSessionRefreshKey((prev) => prev + 1);
  };

  const handleThemeSelect = (themeId: string) => {
    setShowThemePicker(false);
    // Persist theme selection to config
    void import('../../config').then(({ setConfigValue }) => {
      setConfigValue('theme', themeId);
    });
    setTimeout(() => textareaRef.current?.focus(), FOCUS_DELAY_MS);
  };

  const handleThemePickerCancel = () => {
    setShowThemePicker(false);
    setTimeout(() => textareaRef.current?.focus(), FOCUS_DELAY_MS);
  };

  const ensureSession = async (): Promise<Session> => {
    if (sessionRef.current) {
      return sessionRef.current;
    }
    const session = await createSession({ projectPath, model, host, mode });
    setCurrentSession(session);
    return session;
  };

  return {
    currentSession,
    setCurrentSession,
    history,
    setHistory,
    displayMessages,
    setDisplayMessages,
    mode,
    setMode,
    sidebarTodos,
    setSidebarTodos,
    showSessionPicker,
    setShowSessionPicker,
    sessionRefreshKey,
    showThemePicker,
    setShowThemePicker,
    listAvailableSessions,
    handleNewSession,
    handleSessionSelect,
    handleSessionPickerCancel,
    handleSessionsChanged,
    handleThemeSelect,
    handleThemePickerCancel,
    ensureSession,
  };
}
