import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { runMigrations } from "../src/db/migrations.js";
import { SessionRepository } from "../src/db/session-repository.js";
import type { AgentSession, AgentStep, GlmMessage, Checkpoint } from "../src/types.js";
import { createFeedbackEvent } from "../src/types/feedback.js";
import { createExecutionPlan, createPlanStep } from "../src/types/plan.js";

describe("SessionRepository", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;
  let repo: SessionRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-test-"));
    dbPath = path.join(tempDir, "test.db");
    db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestSession = (id: string = "test-session"): AgentSession => ({
    id,
    task: "Test task",
    workingDir: "/test/dir",
    model: "glm-5",
    messages: [
      { role: "system", content: "System prompt" },
      { role: "user", content: "User message" },
    ],
    status: "ready",
    steps: [],
    checkpoints: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const createTestStep = (): AgentStep => ({
    action: "execute_tool",
    tool: "read_file",
    args: { path: "/test/file.txt" },
    result: "file contents",
    timestamp: Date.now(),
  });

  const createTestCheckpoint = (): Checkpoint => ({
    id: `checkpoint-${Date.now()}`,
    stepId: "step-1",
    timestamp: Date.now(),
    state: { filesRead: 5, lastFile: "/test/file.txt" },
  });

  describe("create", () => {
    it("should create a new session", () => {
      const session = createTestSession();
      const created = repo.create(session);

      expect(created.id).toBe(session.id);
      expect(created.task).toBe(session.task);
      expect(created.workingDir).toBe(session.workingDir);
      expect(created.model).toBe(session.model);
      expect(created.status).toBe("ready");
    });

    it("should store messages", () => {
      const session = createTestSession();
      repo.create(session);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.messages).toHaveLength(2);
      expect(retrieved?.messages[0].role).toBe("system");
      expect(retrieved?.messages[1].role).toBe("user");
    });

    it("should store steps", () => {
      const session = createTestSession();
      session.steps = [createTestStep(), createTestStep()];
      repo.create(session);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.steps).toHaveLength(2);
    });

    it("should store checkpoints", () => {
      const session = createTestSession();
      session.checkpoints = [createTestCheckpoint()];
      repo.create(session);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.checkpoints).toHaveLength(1);
    });

    it("should store token usage", () => {
      const session = createTestSession();
      session.tokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        budgetRemaining: 850,
      };
      repo.create(session);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.tokenUsage?.promptTokens).toBe(100);
      expect(retrieved?.tokenUsage?.completionTokens).toBe(50);
      expect(retrieved?.tokenUsage?.totalTokens).toBe(150);
      expect(retrieved?.tokenUsage?.budgetRemaining).toBe(850);
    });
  });

  describe("getById", () => {
    it("should return null for non-existent session", () => {
      const result = repo.getById("non-existent");
      expect(result).toBeNull();
    });

    it("should retrieve existing session", () => {
      const session = createTestSession();
      repo.create(session);

      const retrieved = repo.getById(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(session.id);
    });
  });

  describe("update", () => {
    it("should update session fields", () => {
      const session = createTestSession();
      repo.create(session);

      const updated = { ...session, status: "running" as const, task: "Updated task" };
      repo.update(updated);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.status).toBe("running");
      expect(retrieved?.task).toBe("Updated task");
    });

    it("should update messages", () => {
      const session = createTestSession();
      repo.create(session);

      const updated = {
        ...session,
        messages: [
          ...session.messages,
          { role: "assistant" as const, content: "Assistant response" },
        ],
      };
      repo.update(updated);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.messages).toHaveLength(3);
    });

    it("should update steps", () => {
      const session = createTestSession();
      repo.create(session);

      const updated = {
        ...session,
        steps: [createTestStep()],
      };
      repo.update(updated);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.steps).toHaveLength(1);
    });

    it("should update token usage", () => {
      const session = createTestSession();
      repo.create(session);

      const updated = {
        ...session,
        tokenUsage: {
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
        },
      };
      repo.update(updated);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.tokenUsage?.totalTokens).toBe(300);
    });
  });

  describe("delete", () => {
    it("should delete existing session", () => {
      const session = createTestSession();
      repo.create(session);

      const result = repo.delete(session.id);
      expect(result).toBe(true);

      const retrieved = repo.getById(session.id);
      expect(retrieved).toBeNull();
    });

    it("should return false for non-existent session", () => {
      const result = repo.delete("non-existent");
      expect(result).toBe(false);
    });

    it("should cascade delete related data", () => {
      const session = createTestSession();
      session.steps = [createTestStep()];
      session.checkpoints = [createTestCheckpoint()];
      repo.create(session);

      repo.delete(session.id);

      const steps = repo.getSteps(session.id);
      const checkpoints = repo.getCheckpoints(session.id);
      const messages = repo.getMessages(session.id);

      expect(steps).toHaveLength(0);
      expect(checkpoints).toHaveLength(0);
      expect(messages).toHaveLength(0);
    });
  });

  describe("addStep / getSteps", () => {
    it("should add step to session", () => {
      const session = createTestSession();
      repo.create(session);

      const step = createTestStep();
      repo.addStep(session.id, step);

      const steps = repo.getSteps(session.id);
      expect(steps).toHaveLength(1);
      expect(steps[0].action).toBe(step.action);
      expect(steps[0].tool).toBe(step.tool);
    });

    it("should retrieve steps in order", () => {
      const session = createTestSession();
      repo.create(session);

      const step1 = { ...createTestStep(), timestamp: Date.now() - 1000 };
      const step2 = { ...createTestStep(), timestamp: Date.now() };
      const step3 = { ...createTestStep(), timestamp: Date.now() + 1000 };

      repo.addStep(session.id, step2);
      repo.addStep(session.id, step1);
      repo.addStep(session.id, step3);

      const steps = repo.getSteps(session.id);
      expect(steps[0].timestamp).toBe(step1.timestamp);
      expect(steps[1].timestamp).toBe(step2.timestamp);
      expect(steps[2].timestamp).toBe(step3.timestamp);
    });

    it("should parse step args correctly", () => {
      const session = createTestSession();
      repo.create(session);

      const step: AgentStep = {
        action: "complex_action",
        tool: "multi_tool",
        args: {
          files: ["a.txt", "b.txt"],
          options: { recursive: true, encoding: "utf-8" },
        },
        result: "success",
        timestamp: Date.now(),
      };
      repo.addStep(session.id, step);

      const steps = repo.getSteps(session.id);
      expect(steps[0].args.files).toEqual(["a.txt", "b.txt"]);
      expect(steps[0].args.options).toEqual({ recursive: true, encoding: "utf-8" });
    });
  });

  describe("addMessage / getMessages", () => {
    it("should add message to session", () => {
      const session = createTestSession();
      repo.create(session);

      const message: GlmMessage = { role: "assistant", content: "New response" };
      repo.addMessage(session.id, message, 2);

      const messages = repo.getMessages(session.id);
      expect(messages).toHaveLength(3);
    });

    it("should handle tool calls in messages", () => {
      const session = createTestSession();
      repo.create(session);

      const message: GlmMessage = {
        role: "assistant",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_file", arguments: '{"path": "/test"}' },
          },
        ],
      };
      repo.addMessage(session.id, message, 2);

      const messages = repo.getMessages(session.id);
      expect(messages[2].tool_calls).toBeDefined();
      expect(messages[2].tool_calls).toHaveLength(1);
      expect(messages[2].tool_calls?.[0].function.name).toBe("read_file");
    });

    it("should handle tool result messages", () => {
      const session = createTestSession();
      repo.create(session);

      const message: GlmMessage = {
        role: "tool",
        tool_call_id: "call-1",
        content: "Tool result content",
      };
      repo.addMessage(session.id, message, 2);

      const messages = repo.getMessages(session.id);
      expect(messages[2].role).toBe("tool");
      expect(messages[2].tool_call_id).toBe("call-1");
    });
  });

  describe("addCheckpoint / getCheckpoints", () => {
    it("should add checkpoint to session", () => {
      const session = createTestSession();
      repo.create(session);

      const checkpoint = createTestCheckpoint();
      repo.addCheckpoint(session.id, checkpoint);

      const checkpoints = repo.getCheckpoints(session.id);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].id).toBe(checkpoint.id);
    });

    it("should retrieve checkpoints in order", () => {
      const session = createTestSession();
      repo.create(session);

      const cp1 = { ...createTestCheckpoint(), id: "cp-1", timestamp: Date.now() - 1000 };
      const cp2 = { ...createTestCheckpoint(), id: "cp-2", timestamp: Date.now() };

      repo.addCheckpoint(session.id, cp2);
      repo.addCheckpoint(session.id, cp1);

      const checkpoints = repo.getCheckpoints(session.id);
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].timestamp).toBe(cp1.timestamp);
      expect(checkpoints[1].timestamp).toBe(cp2.timestamp);
    });

    it("should parse checkpoint state correctly", () => {
      const session = createTestSession();
      repo.create(session);

      const checkpoint: Checkpoint = {
        id: "cp-complex",
        stepId: "step-1",
        timestamp: Date.now(),
        state: {
          nested: { value: 42 },
          array: [1, 2, 3],
          string: "test",
        },
      };
      repo.addCheckpoint(session.id, checkpoint);

      const checkpoints = repo.getCheckpoints(session.id);
      expect(checkpoints[0].state.nested).toEqual({ value: 42 });
      expect(checkpoints[0].state.array).toEqual([1, 2, 3]);
    });
  });

  describe("getCheckpointById / deleteCheckpoint", () => {
    it("should get checkpoint by id", () => {
      const session = createTestSession();
      repo.create(session);

      const checkpoint = createTestCheckpoint();
      repo.addCheckpoint(session.id, checkpoint);

      const retrieved = repo.getCheckpointById(checkpoint.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(checkpoint.id);
    });

    it("should return null for non-existent checkpoint", () => {
      const result = repo.getCheckpointById("non-existent");
      expect(result).toBeNull();
    });

    it("should delete checkpoint", () => {
      const session = createTestSession();
      repo.create(session);

      const checkpoint = createTestCheckpoint();
      repo.addCheckpoint(session.id, checkpoint);

      const result = repo.deleteCheckpoint(checkpoint.id);
      expect(result).toBe(true);

      const retrieved = repo.getCheckpointById(checkpoint.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("addFeedbackEvent / getFeedbackEvents", () => {
    it("should add and retrieve feedback events", () => {
      const session = createTestSession();
      repo.create(session);

      const event = createFeedbackEvent("step_started", session.id, {
        stepId: "step-1",
      });
      repo.addFeedbackEvent(event);

      const events = repo.getFeedbackEvents(session.id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("step_started");
      expect(events[0].payload.stepId).toBe("step-1");
    });

    it("should filter events by type", () => {
      const session = createTestSession();
      repo.create(session);

      repo.addFeedbackEvent(
        createFeedbackEvent("step_started", session.id, { step: 1 })
      );
      repo.addFeedbackEvent(
        createFeedbackEvent("step_completed", session.id, { step: 1 })
      );
      repo.addFeedbackEvent(
        createFeedbackEvent("step_started", session.id, { step: 2 })
      );

      const startedEvents = repo.getFeedbackEvents(session.id, {
        type: "step_started",
      });
      expect(startedEvents).toHaveLength(2);
    });

    it("should limit number of events", () => {
      const session = createTestSession();
      repo.create(session);

      for (let i = 0; i < 10; i++) {
        repo.addFeedbackEvent(
          createFeedbackEvent("token_usage", session.id, { count: i })
        );
      }

      const events = repo.getFeedbackEvents(session.id, { limit: 5 });
      expect(events).toHaveLength(5);
    });
  });

  describe("savePlan / getPlanById / deletePlan", () => {
    it("should save and retrieve plan", () => {
      const plan = createExecutionPlan(
        "plan-1",
        "Test plan",
        [
          createPlanStep("step-1", "First step"),
          createPlanStep("step-2", "Second step", ["step-1"]),
        ],
        { priority: "high", tags: ["test", "important"] }
      );

      repo.savePlan(plan);

      const retrieved = repo.getPlanById("plan-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.description).toBe("Test plan");
      expect(retrieved?.steps).toHaveLength(2);
      expect(retrieved?.metadata.priority).toBe("high");
      expect(retrieved?.metadata.tags).toContain("test");
    });

    it("should update existing plan", () => {
      const plan = createExecutionPlan("plan-2", "Original", [
        createPlanStep("step-1", "Step"),
      ]);
      repo.savePlan(plan);

      const updated = createExecutionPlan(
        "plan-2",
        "Updated description",
        [
          createPlanStep("step-1", "Updated step"),
          createPlanStep("step-2", "New step"),
        ],
        { priority: "critical" }
      );
      repo.savePlan(updated);

      const retrieved = repo.getPlanById("plan-2");
      expect(retrieved?.description).toBe("Updated description");
      expect(retrieved?.steps).toHaveLength(2);
      expect(retrieved?.metadata.priority).toBe("critical");
    });

    it("should delete plan", () => {
      const plan = createExecutionPlan("plan-3", "To delete", []);
      repo.savePlan(plan);

      const result = repo.deletePlan("plan-3");
      expect(result).toBe(true);

      const retrieved = repo.getPlanById("plan-3");
      expect(retrieved).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("should list all sessions", () => {
      repo.create(createTestSession("session-1"));
      repo.create(createTestSession("session-2"));
      repo.create(createTestSession("session-3"));

      const sessions = repo.listSessions();
      expect(sessions).toHaveLength(3);
    });

    it("should filter by status", () => {
      const session1 = createTestSession("session-1");
      session1.status = "completed";
      repo.create(session1);

      const session2 = createTestSession("session-2");
      session2.status = "running";
      repo.create(session2);

      const session3 = createTestSession("session-3");
      session3.status = "completed";
      repo.create(session3);

      const completed = repo.listSessions({ status: "completed" });
      expect(completed).toHaveLength(2);
    });

    it("should filter by plan id", () => {
      const session1 = createTestSession("session-1");
      session1.planId = "plan-1";
      repo.create(session1);

      const session2 = createTestSession("session-2");
      session2.planId = "plan-2";
      repo.create(session2);

      const filtered = repo.listSessions({ planId: "plan-1" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].planId).toBe("plan-1");
    });

    it("should limit results", () => {
      for (let i = 0; i < 10; i++) {
        repo.create(createTestSession(`session-${i}`));
      }

      const sessions = repo.listSessions({ limit: 5 });
      expect(sessions).toHaveLength(5);
    });
  });

  describe("updateStatus", () => {
    it("should update session status", () => {
      const session = createTestSession();
      repo.create(session);

      repo.updateStatus(session.id, "running");

      const retrieved = repo.getById(session.id);
      expect(retrieved?.status).toBe("running");
    });
  });

  describe("updateTokenUsage", () => {
    it("should update token usage", () => {
      const session = createTestSession();
      repo.create(session);

      repo.updateTokenUsage(session.id, {
        promptTokens: 500,
        completionTokens: 250,
        totalTokens: 750,
        budgetRemaining: 250,
      });

      const retrieved = repo.getById(session.id);
      expect(retrieved?.tokenUsage?.promptTokens).toBe(500);
      expect(retrieved?.tokenUsage?.completionTokens).toBe(250);
      expect(retrieved?.tokenUsage?.budgetRemaining).toBe(250);
    });
  });

  describe("complex scenarios", () => {
    it("should handle full session lifecycle", () => {
      const session = createTestSession();
      repo.create(session);

      repo.updateStatus(session.id, "running");

      const step1 = createTestStep();
      repo.addStep(session.id, step1);

      repo.addFeedbackEvent(
        createFeedbackEvent("step_completed", session.id, { stepId: "step-1" })
      );

      const checkpoint = createTestCheckpoint();
      repo.addCheckpoint(session.id, checkpoint);

      repo.updateTokenUsage(session.id, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });

      repo.updateStatus(session.id, "completed");

      const final = repo.getById(session.id);
      expect(final?.status).toBe("completed");
      expect(final?.steps).toHaveLength(1);
      expect(final?.checkpoints).toHaveLength(1);
      expect(final?.tokenUsage?.totalTokens).toBe(150);

      const events = repo.getFeedbackEvents(session.id);
      expect(events).toHaveLength(1);
    });

    it("should handle session with plan", () => {
      const plan = createExecutionPlan("plan-1", "Test plan", [
        createPlanStep("step-1", "First step"),
      ]);
      repo.savePlan(plan);

      const session = createTestSession();
      session.planId = plan.id;
      repo.create(session);

      const sessions = repo.listSessions({ planId: plan.id });
      expect(sessions).toHaveLength(1);

      const retrieved = repo.getById(session.id);
      expect(retrieved?.planId).toBe(plan.id);
    });
  });
});
