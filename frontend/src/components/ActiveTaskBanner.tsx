import type { TaskEvent, TaskRecord } from "../types/api";
import { countConstraintViolations, formatEventLabel, formatPhaseLabel, formatTaskTitle } from "../utils/taskLabels";

interface ActiveTaskBannerProps {
  task: TaskRecord | null;
  latestEvent: TaskEvent | null;
  onOpenBoundary: () => void;
  onOpenAdvanced: () => void;
  onOpenReports: () => void;
  onOpenTarget: (target: string) => void;
  onStop: () => void;
}

function eventText(event: TaskEvent | null): string {
  if (!event) return "等待任务事件...";
  const text = event.payload.text;
  const message = event.payload.message;
  const phase = event.payload.phase;
  if (typeof text === "string" && text.trim()) return text;
  if (typeof message === "string" && message.trim()) return message;
  if (typeof phase === "string" && phase.trim()) return `当前阶段: ${formatPhaseLabel(phase)}`;
  return formatEventLabel(event.event);
}

function estimateProgress(task: TaskRecord, latestEvent: TaskEvent | null): number {
  if (task.status === "completed") return 100;
  if (task.status === "failed" || task.status === "stopped") return 100;
  const phase = String(latestEvent?.payload.phase ?? task.latest_phase ?? "").toLowerCase();
  if (phase.includes("report")) return 88;
  if (phase.includes("exploit") || phase.includes("verify")) return 70;
  if (phase.includes("scan")) return 52;
  if (phase.includes("recon")) return 34;
  if (task.status === "running") return 18;
  return 8;
}

function eventBlockedAttempts(event: TaskEvent | null): number {
  if (!event) return 0;
  const payload = event.payload as {
    constraint_violation_events?: unknown[];
    constraint_violations?: unknown[];
    message?: unknown;
    error?: unknown;
    summary?: {
      constraint_violation_events?: unknown[];
      constraint_violations?: unknown[];
    };
  };
  const directCount = countConstraintViolations(payload.constraint_violation_events, payload.constraint_violations);
  const summaryCount = countConstraintViolations(
    payload.summary?.constraint_violation_events,
    payload.summary?.constraint_violations,
  );
  if (directCount) return directCount;
  if (summaryCount) return summaryCount;
  const message = String(payload.message ?? payload.error ?? "");
  return message.includes("constraint_violation") ? 1 : 0;
}

function blockedAttempts(task: TaskRecord, event: TaskEvent | null): number {
  return countConstraintViolations(
    task.summary?.constraint_violation_events,
    task.summary?.constraint_violations,
    eventBlockedAttempts(event),
  );
}

export function ActiveTaskBanner({ task, latestEvent, onOpenAdvanced, onOpenBoundary, onOpenReports, onOpenTarget, onStop }: ActiveTaskBannerProps) {
  if (!task) return null;

  const progress = estimateProgress(task, latestEvent);
  const blocked = blockedAttempts(task, latestEvent);
  const canStop = task.status === "running" || task.status === "pending";
  const isComplete = task.status === "completed";
  const isFailed = task.status === "failed";

  return (
    <section className={`task-banner task-banner-${task.status}`}>
      <div className="task-banner-main">
        <div>
          <span className="task-banner-kicker">当前安全检查</span>
          <h3>{formatTaskTitle(task.command, task.target)}</h3>
          <p>{eventText(latestEvent)}</p>
        </div>
        <div className="task-banner-actions">
          <button type="button" className="secondary-btn" onClick={() => onOpenTarget(task.target)}>
            查看风险
          </button>
          <button
            type="button"
            className={`secondary-btn ${blocked > 0 ? "boundary-alert-btn" : ""}`}
            onClick={onOpenBoundary}
            aria-label={blocked > 0 ? `查看 ${blocked} 次被阻止的越界尝试` : "查看安全边界"}
          >
            {blocked > 0 ? `已阻止 ${blocked} 次越界` : "安全边界"}
          </button>
          {isFailed ? (
            <button type="button" className="danger-btn" onClick={onOpenAdvanced}>
              查看技术日志
            </button>
          ) : isComplete ? (
            <button type="button" className="primary-btn" onClick={onOpenReports}>
              查看报告
            </button>
          ) : (
            <button type="button" className="danger-btn" disabled={!canStop} onClick={onStop}>
              停止
            </button>
          )}
        </div>
      </div>
      <div className="task-progress" aria-label={`任务进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}
