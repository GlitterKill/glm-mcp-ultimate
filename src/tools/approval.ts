import type { FeedbackEvent } from "../types.js";
import { createFeedbackEvent } from "../types/feedback.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  reason: string;
  timestamp: number;
  sessionId?: string;
  planId?: string;
  stepId?: string;
}

export interface ApprovalDecision {
  approved: boolean;
  requestId: string;
  reason?: string;
  timestamp: number;
  approver?: string;
}

export type ApprovalCallback = (
  request: ApprovalRequest
) => Promise<ApprovalDecision> | ApprovalDecision;

export interface ApprovalManagerConfig {
  autoApproveLowRisk: boolean;
  requireApprovalFor: RiskLevel[];
  timeoutMs: number;
  maxPendingRequests: number;
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalManagerConfig = {
  autoApproveLowRisk: true,
  requireApprovalFor: ["medium", "high", "critical"],
  timeoutMs: 60000,
  maxPendingRequests: 100,
};

export class ApprovalManager {
  private config: ApprovalManagerConfig;
  private callback: ApprovalCallback | null = null;
  private pendingRequests: Map<string, ApprovalRequest> = new Map();
  private decisions: Map<string, ApprovalDecision> = new Map();

  constructor(config: Partial<ApprovalManagerConfig> = {}) {
    this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
  }

  setCallback(callback: ApprovalCallback): void {
    this.callback = callback;
  }

  clearCallback(): void {
    this.callback = null;
  }

  async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    riskLevel: RiskLevel,
    reason: string,
    context?: { sessionId?: string; planId?: string; stepId?: string }
  ): Promise<ApprovalDecision> {
    if (!this.requiresApproval(riskLevel)) {
      return this.autoApprove(toolName, args, riskLevel);
    }

    if (this.pendingRequests.size >= this.config.maxPendingRequests) {
      throw new Error("Maximum pending approval requests reached");
    }

    const request: ApprovalRequest = {
      id: this.generateRequestId(),
      toolName,
      args,
      riskLevel,
      reason,
      timestamp: Date.now(),
      ...context,
    };

    this.pendingRequests.set(request.id, request);

    if (!this.callback) {
      return this.autoApprove(toolName, args, riskLevel);
    }

    try {
      const decision = await Promise.race([
        this.callback(request),
        this.createTimeout(request.id),
      ]);

      this.pendingRequests.delete(request.id);
      this.decisions.set(request.id, decision);

      return decision;
    } catch (err) {
      this.pendingRequests.delete(request.id);
      return {
        approved: false,
        requestId: request.id,
        reason: err instanceof Error ? err.message : "Approval request failed",
        timestamp: Date.now(),
      };
    }
  }

  private requiresApproval(riskLevel: RiskLevel): boolean {
    if (this.config.autoApproveLowRisk && riskLevel === "low") {
      return false;
    }
    return this.config.requireApprovalFor.includes(riskLevel);
  }

  private autoApprove(
    toolName: string,
    args: Record<string, unknown>,
    riskLevel: RiskLevel
  ): ApprovalDecision {
    return {
      approved: true,
      requestId: this.generateRequestId(),
      reason: `Auto-approved (${riskLevel} risk)`,
      timestamp: Date.now(),
    };
  }

  private createTimeout(requestId: string): Promise<ApprovalDecision> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Approval request ${requestId} timed out`));
      }, this.config.timeoutMs);
    });
  }

  private generateRequestId(): string {
    return `approval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  getDecision(requestId: string): ApprovalDecision | undefined {
    return this.decisions.get(requestId);
  }

  clearHistory(): void {
    this.decisions.clear();
  }

  createFeedbackEvent(
    request: ApprovalRequest,
    decision: ApprovalDecision
  ): FeedbackEvent {
    return createFeedbackEvent(
      "tool_called",
      request.sessionId || "unknown",
      {
        toolName: request.toolName,
        args: request.args,
        riskLevel: request.riskLevel,
        approved: decision.approved,
        reason: decision.reason,
      },
      {
        planId: request.planId,
        stepId: request.stepId,
      }
    );
  }

  updateConfig(config: Partial<ApprovalManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): Readonly<ApprovalManagerConfig> {
    return { ...this.config };
  }
}

export function createApprovalManager(
  config?: Partial<ApprovalManagerConfig>
): ApprovalManager {
  return new ApprovalManager(config);
}
