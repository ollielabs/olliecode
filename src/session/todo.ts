/**
 * Todo persistence for session task tracking.
 * Enables agents to maintain persistent task lists across session resumption.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from './db';

/**
 * Todo status - matches OpenCode's pattern
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Todo priority levels
 */
export type TodoPriority = 'high' | 'medium' | 'low';

/**
 * A single todo item
 */
export type Todo = {
  id: string;
  sessionId: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: number;
  updatedAt: number;
};

/**
 * Input for creating/updating a todo (without session metadata)
 */
export type TodoInput = {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
};

/**
 * Summary of todos for a session
 */
export type TodoSummary = {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
};

// Internal DB row type
type TodoRow = {
  id: string;
  session_id: string;
  content: string;
  status: string;
  priority: string;
  created_at: number;
  updated_at: number;
};

/**
 * Convert DB row to Todo type
 */
function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    status: row.status as TodoStatus,
    priority: row.priority as TodoPriority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all todos for a session.
 */
export function getTodos(sessionId: string): Todo[] {
  const db = getDatabase();
  const rows = db
    .query('SELECT * FROM todos WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as TodoRow[];
  return rows.map(rowToTodo);
}

/**
 * Get a single todo by ID.
 */
export function getTodo(id: string): Todo | null {
  const db = getDatabase();
  const row = db
    .query('SELECT * FROM todos WHERE id = ?')
    .get(id) as TodoRow | null;
  return row ? rowToTodo(row) : null;
}

/**
 * Update all todos for a session (replace strategy).
 * This matches OpenCode's TodoWrite behavior - the agent sends the complete
 * updated list each time, and we replace all todos for the session.
 *
 * Preserves created_at timestamps for existing todos.
 */
export function updateTodos(sessionId: string, todos: TodoInput[]): Todo[] {
  const db = getDatabase();
  const now = Date.now();

  // Get existing todos to preserve created_at
  const existing = new Map(getTodos(sessionId).map((t) => [t.id, t]));

  // Delete all existing todos for this session
  db.run('DELETE FROM todos WHERE session_id = ?', [sessionId]);

  // Insert the new todos
  const result: Todo[] = [];
  const stmt = db.prepare(
    `INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const todo of todos) {
    const existingTodo = existing.get(todo.id);
    const createdAt = existingTodo?.createdAt ?? now;
    const priority = todo.priority ?? 'medium';

    stmt.run(
      todo.id,
      sessionId,
      todo.content,
      todo.status,
      priority,
      createdAt,
      now,
    );

    result.push({
      id: todo.id,
      sessionId,
      content: todo.content,
      status: todo.status,
      priority,
      createdAt,
      updatedAt: now,
    });
  }

  return result;
}

/**
 * Add a single todo to a session.
 */
export function addTodo(
  sessionId: string,
  content: string,
  priority: TodoPriority = 'medium',
): Todo {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  db.run(
    `INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, sessionId, content, 'pending', priority, now, now],
  );

  return {
    id,
    sessionId,
    content,
    status: 'pending',
    priority,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a single todo's status.
 */
export function updateTodoStatus(id: string, status: TodoStatus): void {
  const db = getDatabase();
  const now = Date.now();
  db.run('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    now,
    id,
  ]);
}

/**
 * Delete a todo.
 */
export function deleteTodo(id: string): void {
  const db = getDatabase();
  db.run('DELETE FROM todos WHERE id = ?', [id]);
}

/**
 * Delete all todos for a session.
 */
export function clearTodos(sessionId: string): void {
  const db = getDatabase();
  db.run('DELETE FROM todos WHERE session_id = ?', [sessionId]);
}

/**
 * Get summary of todos for a session.
 */
export function getTodoSummary(sessionId: string): TodoSummary {
  const todos = getTodos(sessionId);
  return {
    total: todos.length,
    pending: todos.filter((t) => t.status === 'pending').length,
    inProgress: todos.filter((t) => t.status === 'in_progress').length,
    completed: todos.filter((t) => t.status === 'completed').length,
    cancelled: todos.filter((t) => t.status === 'cancelled').length,
  };
}

/**
 * Format todos for display/output.
 */
export function formatTodos(todos: Todo[]): string {
  if (todos.length === 0) {
    return 'No todos.';
  }

  const statusIcons: Record<TodoStatus, string> = {
    pending: '[ ]',
    in_progress: '[>]',
    completed: '[x]',
    cancelled: '[-]',
  };

  return todos.map((t) => `${statusIcons[t.status]} ${t.content}`).join('\n');
}
