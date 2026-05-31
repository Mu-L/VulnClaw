import { useMemo, useState } from "react";
import { createTask, stopTask } from "../api/web";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useTasksQuery } from "../hooks/queries";
import type { TaskCommand, TaskEvent, TaskOptions, TaskRecord } from "../types/api";
import {
  formatActionLabel,
  formatActionList,
  formatConstraintSummary,
  formatEventLabel,
  formatPhaseLabel,
  formatTaskCommand,
  formatTaskStatus,
  formatTaskTitle,
} from "../utils/taskLabels";
import { parseOptionalPort } from "../utils/validation";

const ACTION_OPTIONS = [
  { value: "recon", copy: "信息收集与基础资产发现。" },
  { value: "scan", copy: "服务入口识别与风险发现。" },
  { value: "exploit", copy: "验证利用动作，需要明确授权。" },
  { value: "persistent", copy: "多轮持续检查能力。" },
  { value: "post_exploitation", copy: "后渗透动作，默认建议禁止。" },
];

interface TaskConsolePageProps {
  activeTask: TaskRecord | null;
  events: TaskEvent[];
  onTaskCreated: (task: TaskRecord) => void;
  onEvent: (event: TaskEvent) => void;
  onFocusTarget: (target: string) => void;
}

export function TaskConsolePage({
  activeTask,
  events,
  onTaskCreated,
  onEvent,
  onFocusTarget,
}: TaskConsolePageProps) {
  const tasksQuery = useTasksQuery();
  const [command, setCommand] = useState<TaskCommand>("persistent");
  const [target, setTarget] = useState("");
  const [resume, setResume] = useState(true);
  const [maxRounds, setMaxRounds] = useState<number | "">("");
  const [roundsPerCycle, setRoundsPerCycle] = useState<number | "">("");
  const [maxCycles, setMaxCycles] = useState<number | "">("");
  const [cve, setCve] = useState("");
  const [cmd, setCmd] = useState("");
  const [onlyPort, setOnlyPort] = useState("");
  const [onlyHost, setOnlyHost] = useState("");
  const [onlyPath, setOnlyPath] = useState("");
  const [blockedHost, setBlockedHost] = useState("");
  const [blockedPath, setBlockedPath] = useState("");
  const [allowActions, setAllowActions] = useState<string[]>([]);
  const [blockActions, setBlockActions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);

  const latestEvents = useMemo(() => events.slice(-24).reverse(), [events]);
  const requiresRunConfirmation = command === "exploit" || command === "persistent";
  const scopePreview = formatConstraintSummary({
    only_port: onlyPort.trim() || undefined,
    only_host: onlyHost.trim() || undefined,
    only_path: onlyPath.trim() || undefined,
    blocked_host: blockedHost.trim() || undefined,
    blocked_path: blockedPath.trim() || undefined,
    allow_actions: allowActions.length ? allowActions : undefined,
    block_actions: blockActions.length ? blockActions : undefined,
  });
  const runConfirmCopy = [
    "你正在从高级控制台启动原始任务。请确认该目标已获得授权，并且下方测试范围没有超出授权边界。",
    `目标: ${target.trim() || "未填写"}`,
    `命令: ${formatTaskCommand(command)} (${command})`,
    `范围: ${scopePreview}`,
    "建议: 如不确定授权范围，请回到首页使用安全检查向导设置端口、主机或路径边界。",
  ].join("\n");

  function renderEventText(item: TaskEvent): string {
    const payload = item.payload;
    const parts: string[] = [];
    if (typeof payload.cycle === "number") parts.push(`第 ${payload.cycle} 个周期`);
    if (typeof payload.round === "number") parts.push(`第 ${payload.round} 轮`);
    if (typeof payload.phase === "string") parts.push(formatPhaseLabel(payload.phase));
    const text = typeof payload.text === "string" ? payload.text : "";
    const message = typeof payload.message === "string" ? payload.message : "";
    const summary = text || message || formatEventLabel(item.event);
    parts.push(summary);
    return parts.join(" · ");
  }

  function eventTone(eventName: string): "ok" | "warn" | "danger" | "info" {
    if (eventName.includes("completed")) return "ok";
    if (eventName.includes("failed")) return "danger";
    if (eventName.includes("stopped")) return "warn";
    if (eventName.includes("state") || eventName.includes("started")) return "info";
    return "info";
  }

  function toggleAction(
    value: string,
    selected: string[],
    setSelected: (next: string[]) => void,
    oppositeSelected?: string[],
    setOppositeSelected?: (next: string[]) => void,
  ) {
    setSelected(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
    if (!selected.includes(value) && oppositeSelected && setOppositeSelected) {
      setOppositeSelected(oppositeSelected.filter((item) => item !== value));
    }
  }

  function buildTaskOptions(): TaskOptions {
    return {
      max_rounds: maxRounds === "" ? undefined : maxRounds,
      rounds_per_cycle: roundsPerCycle === "" ? undefined : roundsPerCycle,
      max_cycles: maxCycles === "" ? undefined : maxCycles,
      cve: cve.trim() || undefined,
      cmd: cmd.trim() || undefined,
      only_port: parseOptionalPort(onlyPort),
      only_host: onlyHost.trim() || undefined,
      only_path: onlyPath.trim() || undefined,
      blocked_host: blockedHost.trim() || undefined,
      blocked_path: blockedPath.trim() || undefined,
      allow_actions: allowActions.length ? allowActions : undefined,
      block_actions: blockActions.length ? blockActions : undefined,
    };
  }

  function handleRunRequest() {
    try {
      setError(null);
      buildTaskOptions();
      if (requiresRunConfirmation) {
        setConfirmRunOpen(true);
        return;
      }
      void handleRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务参数不正确");
    }
  }

  async function handleRun() {
    try {
      setSubmitting(true);
      setError(null);
      const task = await createTask(command, target, resume, buildTaskOptions());
      onTaskCreated(task);
      onFocusTarget(task.target);
      await tasksQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    if (!activeTask) return;
    try {
      await stopTask(activeTask.task_id);
      await tasksQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "停止任务失败");
    }
  }

  return (
    <section className="card">
      <header className="card-header">
        <div>
          <h3>高级任务控制台</h3>
          <p>保留原始命令、SSE 事件和调试参数，建议高级用户在排查问题时使用。</p>
        </div>
        <span className="status-badge">{formatTaskStatus(activeTask?.status)}</span>
      </header>

      <div className="form-grid">
        <label className="field">
          <span>原始命令</span>
          <select value={command} onChange={(event) => setCommand(event.target.value as TaskCommand)}>
            <option value="run">标准检查</option>
            <option value="recon">快速摸底</option>
            <option value="scan">深度扫描</option>
            <option value="exploit">深度验证</option>
            <option value="persistent">持续检查</option>
          </select>
          <small>接口命令: {command}</small>
        </label>

        <label className="field field-wide">
          <span>目标</span>
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="输入已授权目标，例如 https://target.example" />
        </label>

        <label className="check-row">
          <input checked={resume} onChange={(event) => setResume(event.target.checked)} type="checkbox" />
          <span>沿用目标历史上下文</span>
        </label>
        <label className="field">
          <span>最大轮次</span>
          <input
            type="number"
            value={maxRounds}
            onChange={(event) => setMaxRounds(event.target.value ? Number(event.target.value) : "")}
            placeholder="使用后端默认值"
          />
        </label>
        <label className="field">
          <span>每周期轮次</span>
          <input
            type="number"
            value={roundsPerCycle}
            onChange={(event) => setRoundsPerCycle(event.target.value ? Number(event.target.value) : "")}
            placeholder="仅持续检查"
          />
        </label>
        <label className="field">
          <span>最大周期</span>
          <input
            type="number"
            value={maxCycles}
            onChange={(event) => setMaxCycles(event.target.value ? Number(event.target.value) : "")}
            placeholder="仅持续检查"
          />
        </label>
        <label className="field">
          <span>CVE 提示</span>
          <input value={cve} onChange={(event) => setCve(event.target.value)} placeholder="例如 CVE-2024-xxxx" />
        </label>
        <label className="field">
          <span>仅测试端口</span>
          <input
            inputMode="numeric"
            value={onlyPort}
            onChange={(event) => setOnlyPort(event.target.value)}
            placeholder="例如 443"
          />
        </label>
        <label className="field">
          <span>仅测试主机</span>
          <input value={onlyHost} onChange={(event) => setOnlyHost(event.target.value)} placeholder="example.com" />
        </label>
        <label className="field field-wide">
          <span>仅测试路径</span>
          <input value={onlyPath} onChange={(event) => setOnlyPath(event.target.value)} placeholder="/admin" />
        </label>
        <label className="field">
          <span>排除主机</span>
          <input value={blockedHost} onChange={(event) => setBlockedHost(event.target.value)} placeholder="staging.example.com" />
        </label>
        <label className="field">
          <span>排除路径</span>
          <input value={blockedPath} onChange={(event) => setBlockedPath(event.target.value)} placeholder="/internal" />
        </label>
        <div className="field field-wide">
          <span>允许动作</span>
          <div className="action-choice-grid">
            {ACTION_OPTIONS.map((action) => (
              <button
                key={`advanced-allow-${action.value}`}
                type="button"
                className={`action-choice ${allowActions.includes(action.value) ? "selected-item" : ""}`}
                onClick={() => toggleAction(action.value, allowActions, setAllowActions, blockActions, setBlockActions)}
              >
                <strong>{formatActionLabel(action.value)}</strong>
                <span>{action.copy}</span>
              </button>
            ))}
          </div>
          <small>{formatActionList(allowActions, "未指定允许动作")}</small>
        </div>
        <div className="field field-wide">
          <span>禁止动作</span>
          <div className="action-choice-grid">
            {ACTION_OPTIONS.map((action) => (
              <button
                key={`advanced-block-${action.value}`}
                type="button"
                className={`action-choice action-choice-block ${blockActions.includes(action.value) ? "selected-item" : ""}`}
                onClick={() => toggleAction(action.value, blockActions, setBlockActions, allowActions, setAllowActions)}
              >
                <strong>{formatActionLabel(action.value)}</strong>
                <span>{action.copy}</span>
              </button>
            ))}
          </div>
          <small>{formatActionList(blockActions, "未指定禁止动作")}</small>
        </div>
        <label className="field field-wide">
          <span>命令提示</span>
          <input value={cmd} onChange={(event) => setCmd(event.target.value)} placeholder="验证命令，例如 id" />
        </label>
      </div>

      <div className="button-row">
        <button className="primary-btn" disabled={submitting || !target.trim()} onClick={handleRunRequest} type="button">
          {submitting ? "启动中..." : "启动原始任务"}
        </button>
        <button className="secondary-btn" disabled={!activeTask || activeTask.status !== "running"} onClick={() => setConfirmStopOpen(true)} type="button">
          停止任务
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <ConfirmDialog
        open={confirmRunOpen}
        title="确认启动高风险原始任务"
        copy={runConfirmCopy}
        tone="danger"
        confirmLabel="确认启动"
        onCancel={() => setConfirmRunOpen(false)}
        onConfirm={() => {
          setConfirmRunOpen(false);
          void handleRun();
        }}
      />

      <ConfirmDialog
        open={confirmStopOpen}
        title="确认停止当前任务"
        copy={`停止后当前任务不会继续执行，已经保存的目标状态和报告不会被删除。\n目标: ${activeTask?.target ?? "未知目标"}\n任务: ${activeTask ? formatTaskTitle(activeTask.command, activeTask.target) : "未选择任务"}`}
        tone="danger"
        confirmLabel="确认停止"
        onCancel={() => setConfirmStopOpen(false)}
        onConfirm={() => {
          setConfirmStopOpen(false);
          void handleStop();
        }}
      />

      <div className="split-grid inner-grid">
        <article className="card inset-card">
          <h4>任务记录</h4>
          <div className="list list-scroll">
            {tasksQuery.data?.slice(0, 8).map((task) => (
              <button
                key={task.task_id}
                type="button"
                className={`list-item list-button ${activeTask?.task_id === task.task_id ? "selected-item" : ""}`}
                onClick={() => {
                  onTaskCreated(task);
                  onFocusTarget(task.target);
                }}
              >
                <strong>{formatTaskTitle(task.command, task.target)}</strong>
                <span>{formatTaskStatus(task.status)}</span>
                <span className="muted-inline">{task.latest_phase ? formatPhaseLabel(task.latest_phase) : task.created_at}</span>
                {task.summary?.constraints && Object.keys(task.summary.constraints).length > 0 && (
                  <span className="muted-inline">{formatConstraintSummary(task.summary.constraints)}</span>
                )}
              </button>
            ))}
            {!tasksQuery.data?.length && <div className="empty-state">暂无任务记录。</div>}
          </div>
        </article>

        <article className="card inset-card">
          <h4>实时事件流</h4>
          <div className="terminal terminal-scroll">
            {activeTask ? (
              <>
                <div className="terminal-line">任务 ID: {activeTask.task_id}</div>
                <div className="terminal-line">检查模式: {formatTaskCommand(activeTask.command)} ({activeTask.command})</div>
                <div className="terminal-line">目标: {activeTask.target}</div>
                <div className="terminal-line dim">阶段: {formatPhaseLabel(activeTask.latest_phase)}</div>
                {activeTask.summary?.constraints && Object.keys(activeTask.summary.constraints).length > 0 && (
                  <div className="terminal-line dim">边界: {formatConstraintSummary(activeTask.summary.constraints)}</div>
                )}
              </>
            ) : (
              <div className="terminal-line dim">暂无运行中的任务。</div>
            )}

            {latestEvents.map((item) => (
              <div key={`${item.timestamp}-${item.event}`} className="terminal-line terminal-row">
                <span className={`terminal-event tone-${eventTone(item.event)}`}>{formatEventLabel(item.event)}</span>
                <span className="terminal-time">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <span>{renderEventText(item)}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
