/**
 * Todo tools for task tracking.
 * Based on OpenCode's TodoWrite/TodoRead pattern.
 */

import { z } from "zod";
import type { ToolDefinition } from "../types";
import {
  getTodos,
  updateTodos,
  formatTodos,
  type TodoInput,
} from "../../session/todo";

/**
 * Schema for a single todo item
 */
const TodoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo"),
  content: z.string().describe("Description of the task"),
  status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .describe("Current status of the task"),
  priority: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe("Priority level (defaults to medium)"),
});

// ============================================================================
// TodoWrite Tool
// ============================================================================

const todoWriteInput = z.object({
  sessionId: z.string().describe("The session ID to store todos for"),
  todos: z.array(TodoItemSchema).describe("The complete updated todo list"),
});

const todoWriteOutput = z.object({
  summary: z.string(),
  todos: z.array(TodoItemSchema),
});

export const todoWriteTool: ToolDefinition<typeof todoWriteInput, typeof todoWriteOutput> = {
  name: "todo_write",
  description: `Create and manage a structured task list for tracking progress on complex tasks.

## When to Use
Use this tool proactively for:
- Complex multi-step tasks (3+ distinct steps)
- After receiving new instructions - capture requirements as todos
- After completing a task - mark it complete and add follow-ups
- When starting a task - mark it as in_progress

## When NOT to Use
- Single, trivial tasks that need no tracking
- Purely informational/conversational requests
- Tasks completable in fewer than 3 steps

## Task States
- pending: Not yet started
- in_progress: Currently working on (only ONE at a time)
- completed: Finished successfully
- cancelled: No longer needed

## Important
- Mark tasks complete IMMEDIATELY after finishing
- Only ONE task should be in_progress at a time
- Send the COMPLETE todo list each time (replaces previous)
- Break complex tasks into smaller, actionable steps`,
  parameters: todoWriteInput,
  outputSchema: todoWriteOutput,
  risk: "safe",
  execute: async ({ sessionId, todos }) => {
    const todoInputs: TodoInput[] = todos.map((t) => ({
      id: t.id,
      content: t.content,
      status: t.status,
      priority: t.priority,
    }));

    const updated = updateTodos(sessionId, todoInputs);
    const active = updated.filter((t) => t.status !== "completed" && t.status !== "cancelled");

    return {
      summary: `${active.length} active todos (${updated.length} total)`,
      todos: updated.map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status,
        priority: t.priority,
      })),
    };
  },
};

// ============================================================================
// TodoRead Tool
// ============================================================================

const todoReadInput = z.object({
  sessionId: z.string().describe("The session ID to read todos from"),
});

const todoReadOutput = z.object({
  summary: z.string(),
  todos: z.array(TodoItemSchema),
  formatted: z.string(),
});

export const todoReadTool: ToolDefinition<typeof todoReadInput, typeof todoReadOutput> = {
  name: "todo_read",
  description: `Read your current todo list to check progress and pending tasks.

Use this when:
- Resuming a session to see what tasks were in progress
- Checking what tasks remain before providing a final response
- Verifying all tasks are complete`,
  parameters: todoReadInput,
  outputSchema: todoReadOutput,
  risk: "safe",
  execute: async ({ sessionId }) => {
    const todos = getTodos(sessionId);
    const active = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled");

    return {
      summary: `${active.length} active todos (${todos.length} total)`,
      todos: todos.map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status,
        priority: t.priority,
      })),
      formatted: formatTodos(todos),
    };
  },
};
