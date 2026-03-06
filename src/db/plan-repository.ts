import type { DatabaseType } from "./connection.js";
import { getDatabase, runInTransaction } from "./connection.js";
import type {
  ExecutionPlan,
  PlanStep,
  PlanMetadata,
  PlanBudget,
  StepResult,
} from "../types/plan.js";
import { PlanError } from "../errors/index.js";

interface PlanRow {
  id: string;
  description: string;
  metadata: string;
  budget: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface StepRow {
  id: string;
  plan_id: string;
  description: string;
  dependencies: string;
  status: string;
  assigned_agent: string | null;
  result: string | null;
  created_at: number;
  updated_at: number;
}

type PlanStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export class PlanRepository {
  private readonly db: DatabaseType;
  private initialized = false;

  constructor(db?: DatabaseType) {
    this.db = db ?? getDatabase();
  }

  initialize(): void {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        budget TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plan_steps (
        id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        description TEXT NOT NULL,
        dependencies TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_agent TEXT,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (id, plan_id),
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
      CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id);
      CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status);
    `);

    this.initialized = true;
  }

  save(plan: ExecutionPlan): ExecutionPlan {
    this.initialize();

    runInTransaction(() => {
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO plans (id, description, metadata, budget, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        plan.id,
        plan.description,
        JSON.stringify(plan.metadata),
        JSON.stringify(plan.budget),
        "pending",
        plan.createdAt ?? now,
        plan.updatedAt ?? now
      );

      const stepStmt = this.db.prepare(`
        INSERT INTO plan_steps (id, plan_id, description, dependencies, status, assigned_agent, result, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const step of plan.steps) {
        stepStmt.run(
          step.id,
          plan.id,
          step.description,
          JSON.stringify(step.dependencies),
          step.status,
          step.assignedAgent ?? null,
          step.result ? JSON.stringify(step.result) : null,
          now,
          now
        );
      }
    });

    return plan;
  }

  getById(planId: string): ExecutionPlan | null {
    this.initialize();

    const planRow = this.db
      .prepare("SELECT * FROM plans WHERE id = ?")
      .get(planId) as PlanRow | undefined;

    if (!planRow) {
      return null;
    }

    const stepRows = this.db
      .prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY id")
      .all(planId) as StepRow[];

    return this.rowToPlan(planRow, stepRows);
  }

  updateStep(
    planId: string,
    stepId: string,
    status: PlanStep["status"],
    result?: StepResult
  ): ExecutionPlan | null {
    this.initialize();

    return runInTransaction(() => {
      const plan = this.getById(planId);
      if (!plan) {
        throw new PlanError("PLAN_NOT_FOUND", `Plan ${planId} not found`);
      }

      const now = Date.now();
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) {
        throw new PlanError(
          "PLAN_NOT_FOUND",
          `Step ${stepId} not found in plan ${planId}`
        );
      }

      this.db
        .prepare(
          "UPDATE plan_steps SET status = ?, result = ?, updated_at = ? WHERE id = ? AND plan_id = ?"
        )
        .run(
          status,
          result ? JSON.stringify(result) : step.result ? JSON.stringify(step.result) : null,
          now,
          stepId,
          planId
        );

      const newStatus = this.calculatePlanStatus(planId);
      this.db
        .prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?")
        .run(newStatus, now, planId);

      return this.getById(planId);
    });
  }

  getByStatus(status: PlanStatus): ExecutionPlan[] {
    this.initialize();

    const planRows = this.db
      .prepare("SELECT * FROM plans WHERE status = ? ORDER BY created_at DESC")
      .all(status) as PlanRow[];

    return planRows.map((row) => {
      const stepRows = this.db
        .prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY id")
        .all(row.id) as StepRow[];
      return this.rowToPlan(row, stepRows);
    });
  }

  getAll(): ExecutionPlan[] {
    this.initialize();

    const planRows = this.db
      .prepare("SELECT * FROM plans ORDER BY created_at DESC")
      .all() as PlanRow[];

    return planRows.map((row) => {
      const stepRows = this.db
        .prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY id")
        .all(row.id) as StepRow[];
      return this.rowToPlan(row, stepRows);
    });
  }

  delete(planId: string): boolean {
    this.initialize();

    return runInTransaction(() => {
      const result = this.db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
      return result.changes > 0;
    });
  }

  updateStatus(planId: string, status: PlanStatus): ExecutionPlan | null {
    this.initialize();

    const now = Date.now();
    this.db
      .prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, planId);

    return this.getById(planId);
  }

  getStepsByPlanId(planId: string): PlanStep[] {
    this.initialize();

    const rows = this.db
      .prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY id")
      .all(planId) as StepRow[];

    return rows.map((row) => this.rowToStep(row));
  }

  private rowToPlan(planRow: PlanRow, stepRows: StepRow[]): ExecutionPlan {
    return {
      id: planRow.id,
      description: planRow.description,
      steps: stepRows.map((row) => this.rowToStep(row)),
      metadata: JSON.parse(planRow.metadata) as PlanMetadata,
      budget: JSON.parse(planRow.budget) as PlanBudget,
      createdAt: planRow.created_at,
      updatedAt: planRow.updated_at,
    };
  }

  private rowToStep(row: StepRow): PlanStep {
    return {
      id: row.id,
      description: row.description,
      dependencies: JSON.parse(row.dependencies) as string[],
      status: row.status as PlanStep["status"],
      assignedAgent: row.assigned_agent ?? undefined,
      result: row.result ? (JSON.parse(row.result) as StepResult) : undefined,
    };
  }

  private calculatePlanStatus(planId: string): PlanStatus {
    const steps = this.getStepsByPlanId(planId);

    if (steps.every((s) => s.status === "completed" || s.status === "skipped")) {
      return "completed";
    }

    if (steps.some((s) => s.status === "failed")) {
      return "failed";
    }

    if (steps.some((s) => s.status === "running")) {
      return "running";
    }

    return "pending";
  }
}
