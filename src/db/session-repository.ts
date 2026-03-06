import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase, runInTransaction } from "./connection.js";
import type {
  AgentSession,
  AgentStep,
  GlmMessage,
  Checkpoint,
  TokenUsage,
} from "../types.js";
import type { FeedbackEvent } from "../types/feedback.js";
import type { ExecutionPlan } from "../types/plan.js";

interface SessionRow {
  id: string;
  task: string;
  working_dir: string;
  model: string;
  status: string;
  plan_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  budget_remaining: number | null;
  created_at: number;
  updated_at: number;
}

interface StepRow {
  id: number;
  session_id: string;
  action: string;
  tool: string;
  args: string;
  result: string;
  timestamp: number;
}

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  position: number;
}

interface CheckpointRow {
  id: string;
  session_id: string;
  step_id: string;
  timestamp: number;
  state: string;
}

interface FeedbackEventRow {
  id: number;
  type: string;
  timestamp: number;
  session_id: string;
  plan_id: string | null;
  step_id: string | null;
  payload: string;
}

interface PlanRow {
  id: string;
  description: string;
  steps: string;
  metadata: string;
  budget: string;
  created_at: number;
  updated_at: number;
}

export class SessionRepository {
  private db: DatabaseType;

  constructor(db?: DatabaseType) {
    this.db = db ?? getDatabase();
  }

  create(session: AgentSession): AgentSession {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, task, working_dir, model, status, plan_id,
        prompt_tokens, completion_tokens, total_tokens, budget_remaining,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.task,
      session.workingDir,
      session.model,
      session.status,
      session.planId ?? null,
      session.tokenUsage?.promptTokens ?? 0,
      session.tokenUsage?.completionTokens ?? 0,
      session.tokenUsage?.totalTokens ?? 0,
      session.tokenUsage?.budgetRemaining ?? null,
      session.createdAt ?? now,
      session.updatedAt ?? now
    );

    for (let i = 0; i < session.messages.length; i++) {
      this.addMessage(session.id, session.messages[i], i);
    }

    for (const step of session.steps) {
      this.addStep(session.id, step);
    }

    if (session.checkpoints) {
      for (const checkpoint of session.checkpoints) {
        this.addCheckpoint(session.id, checkpoint);
      }
    }

    return this.getById(session.id)!;
  }

  getById(id: string): AgentSession | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return this.rowToSession(row);
  }

  update(session: AgentSession): AgentSession {
    const now = Date.now();

    runInTransaction(() => {
      this.db
        .prepare(
          `
        UPDATE sessions SET
          task = ?, working_dir = ?, model = ?, status = ?, plan_id = ?,
          prompt_tokens = ?, completion_tokens = ?, total_tokens = ?,
          budget_remaining = ?, updated_at = ?
        WHERE id = ?
      `
        )
        .run(
          session.task,
          session.workingDir,
          session.model,
          session.status,
          session.planId ?? null,
          session.tokenUsage?.promptTokens ?? 0,
          session.tokenUsage?.completionTokens ?? 0,
          session.tokenUsage?.totalTokens ?? 0,
          session.tokenUsage?.budgetRemaining ?? null,
          now,
          session.id
        );

      this.db
        .prepare("DELETE FROM messages WHERE session_id = ?")
        .run(session.id);
      for (let i = 0; i < session.messages.length; i++) {
        this.addMessage(session.id, session.messages[i], i);
      }

      this.db.prepare("DELETE FROM steps WHERE session_id = ?").run(session.id);
      for (const step of session.steps) {
        this.addStep(session.id, step);
      }

      this.db
        .prepare("DELETE FROM checkpoints WHERE session_id = ?")
        .run(session.id);
      if (session.checkpoints) {
        for (const checkpoint of session.checkpoints) {
          this.addCheckpoint(session.id, checkpoint);
        }
      }
    });

    return this.getById(session.id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  addStep(sessionId: string, step: AgentStep): void {
    this.db
      .prepare(
        `
      INSERT INTO steps (session_id, action, tool, args, result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        sessionId,
        step.action,
        step.tool,
        JSON.stringify(step.args),
        step.result,
        step.timestamp
      );
  }

  getSteps(sessionId: string): AgentStep[] {
    const rows = this.db
      .prepare("SELECT * FROM steps WHERE session_id = ? ORDER BY timestamp")
      .all(sessionId) as StepRow[];

    return rows.map((row) => ({
      action: row.action,
      tool: row.tool,
      args: JSON.parse(row.args) as Record<string, unknown>,
      result: row.result,
      timestamp: row.timestamp,
    }));
  }

  addMessage(sessionId: string, message: GlmMessage, position: number): void {
    this.db
      .prepare(
        `
      INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        sessionId,
        message.role,
        message.content ?? null,
        message.tool_calls ? JSON.stringify(message.tool_calls) : null,
        message.tool_call_id ?? null,
        position
      );
  }

  getMessages(sessionId: string): GlmMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY position")
      .all(sessionId) as MessageRow[];

    return rows.map((row) => ({
      role: row.role as GlmMessage["role"],
      content: row.content ?? undefined,
      tool_calls: row.tool_calls
        ? (JSON.parse(row.tool_calls) as GlmMessage["tool_calls"])
        : undefined,
      tool_call_id: row.tool_call_id ?? undefined,
    }));
  }

  addCheckpoint(sessionId: string, checkpoint: Checkpoint): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO checkpoints (id, session_id, step_id, timestamp, state)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        checkpoint.id,
        sessionId,
        checkpoint.stepId,
        checkpoint.timestamp,
        JSON.stringify(checkpoint.state)
      );
  }

  getCheckpoints(sessionId: string): Checkpoint[] {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY timestamp")
      .all(sessionId) as CheckpointRow[];

    return rows.map((row) => ({
      id: row.id,
      stepId: row.step_id,
      timestamp: row.timestamp,
      state: JSON.parse(row.state) as Record<string, unknown>,
    }));
  }

  getCheckpointById(checkpointId: string): Checkpoint | null {
    const row = this.db
      .prepare("SELECT * FROM checkpoints WHERE id = ?")
      .get(checkpointId) as CheckpointRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      stepId: row.step_id,
      timestamp: row.timestamp,
      state: JSON.parse(row.state) as Record<string, unknown>,
    };
  }

  deleteCheckpoint(checkpointId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM checkpoints WHERE id = ?")
      .run(checkpointId);
    return result.changes > 0;
  }

  addFeedbackEvent(event: FeedbackEvent): void {
    this.db
      .prepare(
        `
      INSERT INTO feedback_events (type, timestamp, session_id, plan_id, step_id, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event.type,
        event.timestamp,
        event.sessionId,
        event.planId ?? null,
        event.stepId ?? null,
        JSON.stringify(event.payload)
      );
  }

  getFeedbackEvents(
    sessionId: string,
    options?: { type?: string; limit?: number }
  ): FeedbackEvent[] {
    let sql = "SELECT * FROM feedback_events WHERE session_id = ?";
    const params: (string | number)[] = [sessionId];

    if (options?.type) {
      sql += " AND type = ?";
      params.push(options.type);
    }

    sql += " ORDER BY timestamp";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as FeedbackEventRow[];

    return rows.map((row) => ({
      type: row.type as FeedbackEvent["type"],
      timestamp: row.timestamp,
      sessionId: row.session_id,
      planId: row.plan_id ?? undefined,
      stepId: row.step_id ?? undefined,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
  }

  savePlan(plan: ExecutionPlan): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO plans (id, description, steps, metadata, budget, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        plan.id,
        plan.description,
        JSON.stringify(plan.steps),
        JSON.stringify(plan.metadata),
        JSON.stringify(plan.budget),
        plan.createdAt,
        plan.updatedAt
      );
  }

  getPlanById(id: string): ExecutionPlan | null {
    const row = this.db
      .prepare("SELECT * FROM plans WHERE id = ?")
      .get(id) as PlanRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      description: row.description,
      steps: JSON.parse(row.steps),
      metadata: JSON.parse(row.metadata),
      budget: JSON.parse(row.budget),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deletePlan(id: string): boolean {
    const result = this.db.prepare("DELETE FROM plans WHERE id = ?").run(id);
    return result.changes > 0;
  }

  listSessions(options?: {
    status?: string;
    planId?: string;
    limit?: number;
  }): AgentSession[] {
    let sql = "SELECT * FROM sessions WHERE 1=1";
    const params: (string | number)[] = [];

    if (options?.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }

    if (options?.planId) {
      sql += " AND plan_id = ?";
      params.push(options.planId);
    }

    sql += " ORDER BY created_at DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as SessionRow[];

    return rows.map((row) => this.rowToSession(row));
  }

  updateStatus(sessionId: string, status: AgentSession["status"]): void {
    this.db
      .prepare(
        "UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?"
      )
      .run(status, Date.now(), sessionId);
  }

  updateTokenUsage(sessionId: string, usage: TokenUsage): void {
    this.db
      .prepare(
        `
        UPDATE sessions SET
          prompt_tokens = ?,
          completion_tokens = ?,
          total_tokens = ?,
          budget_remaining = ?,
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        usage.promptTokens,
        usage.completionTokens,
        usage.totalTokens,
        usage.budgetRemaining ?? null,
        Date.now(),
        sessionId
      );
  }

  private rowToSession(row: SessionRow): AgentSession {
    const tokenUsage: TokenUsage | undefined =
      row.total_tokens > 0
        ? {
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens,
            totalTokens: row.total_tokens,
            budgetRemaining: row.budget_remaining ?? undefined,
          }
        : undefined;

    return {
      id: row.id,
      task: row.task,
      workingDir: row.working_dir,
      model: row.model,
      messages: this.getMessages(row.id),
      status: row.status as AgentSession["status"],
      steps: this.getSteps(row.id),
      checkpoints: this.getCheckpoints(row.id),
      tokenUsage,
      planId: row.plan_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
