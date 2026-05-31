import { useEffect, useMemo, useState } from "react";
import type { TaskCommand, TaskEvent, TaskOptions, TaskRecord, TaskSummary } from "../types/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SectionCard } from "../components/SectionCard";
import { loadUiPreferences, subscribeUiPreferences } from "../utils/preferences";
import {
  formatActionLabel,
  formatActionList,
  countConstraintViolations,
  formatEventLabel,
  formatPhaseLabel,
  formatTaskCommand,
  formatTaskStatus,
} from "../utils/taskLabels";
import { parseOptionalPort } from "../utils/validation";

type CheckMode = "quick" | "standard" | "deep" | "continuous";

interface HomePageProps {
  selectedTarget: string | null;
  activeTask: TaskRecord | null;
  latestEvent: TaskEvent | null;
  taskEvents: TaskEvent[];
  onCreateTask: (command: TaskCommand, target: string, resume: boolean, options: TaskOptions) => Promise<TaskRecord>;
  onOpenRisk: () => void;
  onOpenReports: () => void;
  onOpenBoundary: () => void;
}

const MODES: Array<{
  key: CheckMode;
  title: string;
  copy: string;
  command: TaskCommand;
  allowActions?: string[];
  blockActions?: string[];
}> = [
  {
    key: "quick",
    title: "快速摸底",
    copy: "只做信息收集和基础风险识别，适合第一次了解目标。",
    command: "recon",
    allowActions: ["recon"],
    blockActions: ["exploit", "persistent"],
  },
  {
    key: "standard",
    title: "标准检查",
    copy: "信息收集 + 风险发现，默认推荐，不主动做高风险验证。",
    command: "run",
    allowActions: ["recon", "scan"],
    blockActions: ["post_exploitation"],
  },
  {
    key: "deep",
    title: "深度验证",
    copy: "可能包含验证动作，启动前会再次确认授权范围。",
    command: "scan",
    allowActions: ["recon", "scan", "exploit"],
  },
  {
    key: "continuous",
    title: "持续检查",
    copy: "多轮持续运行，适合靶场或长期观察，需要更明确的边界。",
    command: "persistent",
    allowActions: ["recon", "scan"],
    blockActions: ["post_exploitation"],
  },
];

const ACTION_OPTIONS = [
  { value: "recon", copy: "收集公开信息和基础资产，不做验证动作。" },
  { value: "scan", copy: "识别服务入口与潜在风险，适合作为标准检查范围。" },
  { value: "exploit", copy: "执行验证利用类动作，需要明确授权后再开启。" },
  { value: "persistent", copy: "允许多轮持续检查，适合靶场或长期观察。" },
  { value: "post_exploitation", copy: "后渗透类动作，默认建议保持禁止。" },
];

function latestEventText(event: TaskEvent | null): string {
  if (!event) return "任务事件准备中，启动后会展示实时阶段。";
  const message = event.payload.message ?? event.payload.text;
  if (typeof message === "string" && message.trim()) return message;
  if (typeof event.payload.phase === "string" && event.payload.phase.trim()) {
    return formatPhaseLabel(event.payload.phase);
  }
  return formatEventLabel(event.event);
}

function currentPhaseKey(task: TaskRecord | null, event: TaskEvent | null): string {
  if (!task) return "scope";
  if (task.status === "completed" || task.status === "failed" || task.status === "stopped") return "report";
  const text = `${event?.payload.phase ?? ""} ${event?.event ?? ""} ${task.latest_phase ?? ""}`.toLowerCase();
  if (text.includes("report")) return "report";
  if (text.includes("exploit") || text.includes("verify")) return "verify";
  if (text.includes("scan")) return "scan";
  if (text.includes("recon")) return "recon";
  return task.status === "running" ? "recon" : "scope";
}

function taskResultTitle(task: TaskRecord): string {
  if (task.status === "completed") return "检查已完成，可以查看风险结果。";
  if (task.status === "failed") return "检查未完成，建议查看技术日志或重新启动。";
  if (task.status === "stopped") return "检查已停止，已保存的状态仍可查看。";
  return `正在检查 ${task.target}`;
}

function eventSummary(event: TaskEvent | null): TaskSummary | null {
  const summary = event?.payload.summary;
  return summary && typeof summary === "object" ? summary as TaskSummary : null;
}

function taskSummary(task: TaskRecord, event: TaskEvent | null): TaskSummary | null {
  return task.summary ?? eventSummary(event);
}

function formatEventPayload(event: TaskEvent): string {
  return JSON.stringify(event.payload, null, 2);
}

function joinScopeItems(items: string[]): string {
  return items.length ? items.join("；") : "未填写额外主机、端口或路径边界";
}

function inferScopeFromTarget(value: string): { host: string; port: string; path: string } {
  const target = value.trim();
  if (!target) return { host: "", port: "", path: "" };
  try {
    const parsed = new URL(target.includes("://") ? target : `https://${target}`);
    const inferredPath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return { host: parsed.hostname, port: parsed.port, path: inferredPath };
  } catch {
    const withoutScheme = target.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const match = withoutScheme.match(/^([^/:?#]+)(?::([^/?#]+))?(\/[^?#]*)?/);
    const inferredPath = match?.[3] && match[3] !== "/" ? match[3] : "";
    return { host: match?.[1] ?? "", port: match?.[2] ?? "", path: inferredPath };
  }
}

export function HomePage({ selectedTarget, activeTask, latestEvent, taskEvents, onCreateTask, onOpenRisk, onOpenReports, onOpenBoundary }: HomePageProps) {
  const [target, setTarget] = useState(selectedTarget ?? "");
  const preferences = loadUiPreferences();
  const [mode, setMode] = useState<CheckMode>(() => preferences.defaultCheckMode);
  const [onlyPort, setOnlyPort] = useState(preferences.defaultBoundary.onlyPort);
  const [onlyHost, setOnlyHost] = useState(preferences.defaultBoundary.onlyHost);
  const [onlyPath, setOnlyPath] = useState(preferences.defaultBoundary.onlyPath);
  const [blockedHost, setBlockedHost] = useState(preferences.defaultBoundary.blockedHost);
  const [blockedPath, setBlockedPath] = useState(preferences.defaultBoundary.blockedPath);
  const [allowActions, setAllowActions] = useState<string[]>(preferences.defaultBoundary.allowActions);
  const [blockActions, setBlockActions] = useState<string[]>(preferences.defaultBoundary.blockActions);
  const [resume, setResume] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [technicalLogsOpen, setTechnicalLogsOpen] = useState(() => preferences.showTechnicalLogs);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMode = useMemo(() => MODES.find((item) => item.key === mode) ?? MODES[1], [mode]);
  const inferredScope = inferScopeFromTarget(target);
  const effectiveOnlyHost = onlyHost.trim() || inferredScope.host;
  const effectiveOnlyPort = onlyPort.trim() || inferredScope.port;
  const effectiveOnlyPath = onlyPath.trim() || inferredScope.path;
  const scopeCount = [effectiveOnlyPort, effectiveOnlyHost, effectiveOnlyPath, blockedHost, blockedPath].filter((item) => item.trim()).length;
  const activeSummary = activeTask ? taskSummary(activeTask, latestEvent) : null;
  const boundaryBlockCount = countConstraintViolations(
    activeSummary?.constraint_violation_events,
    activeSummary?.constraint_violations,
  );
  const scopePreview = joinScopeItems([
    effectiveOnlyHost ? `仅主机 ${effectiveOnlyHost}${onlyHost.trim() ? "" : "（由目标自动推断）"}` : "",
    effectiveOnlyPort ? `仅端口 ${effectiveOnlyPort}${onlyPort.trim() ? "" : "（由目标自动推断）"}` : "",
    effectiveOnlyPath ? `仅路径 ${effectiveOnlyPath}${onlyPath.trim() ? "" : "（由目标自动推断）"}` : "",
    blockedHost.trim() ? `排除主机 ${blockedHost.trim()}` : "",
    blockedPath.trim() ? `排除路径 ${blockedPath.trim()}` : "",
  ].filter(Boolean));
  const allowPreview = formatActionList(allowActions.length ? allowActions : selectedMode.allowActions);
  const blockPreview = formatActionList(blockActions.length ? blockActions : selectedMode.blockActions);
  const requiresExtraCare = mode === "deep" || mode === "continuous";
  const confirmCopy = [
    "启动前请再次确认你拥有该目标的测试授权，并且下面的范围没有超出授权边界。",
    `目标: ${target.trim() || "未填写目标"}`,
    `模式: ${selectedMode.title}`,
    `范围: ${scopePreview}`,
    `允许动作: ${allowPreview}`,
    `禁止动作: ${blockPreview}`,
    requiresExtraCare ? "提示: 当前模式可能进行更深入或多轮验证，请确保授权范围足够明确。" : "",
  ].join("\n");

  useEffect(() => subscribeUiPreferences((nextPreferences) => {
    setMode(nextPreferences.defaultCheckMode);
    setTechnicalLogsOpen(nextPreferences.showTechnicalLogs);
    setOnlyPort(nextPreferences.defaultBoundary.onlyPort);
    setOnlyHost(nextPreferences.defaultBoundary.onlyHost);
    setOnlyPath(nextPreferences.defaultBoundary.onlyPath);
    setBlockedHost(nextPreferences.defaultBoundary.blockedHost);
    setBlockedPath(nextPreferences.defaultBoundary.blockedPath);
    setAllowActions(nextPreferences.defaultBoundary.allowActions);
    setBlockActions(nextPreferences.defaultBoundary.blockActions);
  }), []);

  useEffect(() => {
    if (selectedTarget) setTarget(selectedTarget);
  }, [selectedTarget]);

  function buildOptions(): TaskOptions {
    return {
      only_port: parseOptionalPort(effectiveOnlyPort),
      only_host: effectiveOnlyHost || undefined,
      only_path: effectiveOnlyPath || undefined,
      blocked_host: blockedHost.trim() || undefined,
      blocked_path: blockedPath.trim() || undefined,
      allow_actions: allowActions.length ? allowActions : selectedMode.allowActions,
      block_actions: blockActions.length ? blockActions : selectedMode.blockActions,
    };
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

  async function submit() {
    try {
      setSubmitting(true);
      setError(null);
      await onCreateTask(selectedMode.command, target.trim(), resume, buildOptions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动安全检查失败");
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  function handleStart() {
    try {
      parseOptionalPort(effectiveOnlyPort);
      if (mode === "continuous" && effectiveOnlyPath) {
        setError("持续检查暂不支持仅路径范围。请清空路径边界，或改用快速摸底、标准检查、深度验证。");
        return;
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "端口格式不正确。");
      return;
    }
    setConfirmOpen(true);
  }

  return (
    <section className="home-page">
      <div className="home-hero">
        <div className="home-stack">
          <span className="pill">授权安全检查</span>
          <h2>开始一次授权安全检查</h2>
          <p>
            输入你拥有授权的目标，确认测试范围，VulnClaw 会把检查过程限制在边界内，并生成可读报告。
          </p>
          <div className="home-quick-steps" aria-label="三步启动授权安全检查">
            <article>
              <span>1</span>
              <strong>输入授权目标</strong>
              <small>URL、域名或 IP 都可以。</small>
            </article>
            <article>
              <span>2</span>
              <strong>确认模式与范围</strong>
              <small>端口、主机、路径和动作边界启动前可见。</small>
            </article>
            <article>
              <span>3</span>
              <strong>点击开始检查</strong>
              <small>二次确认授权范围后运行。</small>
            </article>
          </div>

          <div className="hero-action-grid">
            <button
              type="button"
              className={`hero-orb ${submitting ? "hero-orb-busy" : ""}`}
              disabled={submitting || !target.trim()}
              onClick={handleStart}
            >
              <span>{submitting ? "启动中" : "开始"}</span>
              <strong>{selectedMode.title}</strong>
            </button>

            <SectionCard
              title="授权目标"
              copy="只填写你明确拥有测试授权的 URL、域名或 IP。"
              aside={<span className="status-badge">{scopeCount ? `${scopeCount} 条边界` : "默认边界"}</span>}
            >
              <label className="field">
                <span>目标</span>
                <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="输入已授权目标，例如 https://target.example" />
                {!target.trim() && <small>请输入你明确拥有授权的目标后再开始检查。</small>}
              </label>
              <label className="check-row home-check">
                <input checked={resume} onChange={(event) => setResume(event.target.checked)} type="checkbox" />
                <span>沿用该目标的历史上下文，避免重复探索</span>
              </label>
            </SectionCard>
          </div>
        </div>
      </div>

      <div className="mode-grid">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`mode-card ${mode === item.key ? "selected-item" : ""}`}
            onClick={() => setMode(item.key)}
          >
            <strong>{item.title}</strong>
            <span>{item.copy}</span>
          </button>
        ))}
      </div>

      {activeTask && (
        <SectionCard
          title="检查进度"
          copy="把实时事件整理成用户能理解的阶段，不默认展示终端流。"
          aside={<span className="status-badge">{formatTaskStatus(activeTask.status)}</span>}
        >
          <div className="check-progress-card">
            <div className="check-progress-head">
              <div>
                <span className="pill">当前任务</span>
                <h3>{taskResultTitle(activeTask)}</h3>
                <p>{latestEventText(latestEvent)}</p>
              </div>
              <div className="check-progress-target">
                <span>授权目标</span>
                <strong>{activeTask.target}</strong>
              </div>
            </div>
            <div className="check-stepper">
              {[
                ["scope", "确认授权范围"],
                ["recon", "收集公开信息"],
                ["scan", "识别服务和入口"],
                ["verify", "分析潜在风险"],
                ["report", "整理报告"],
              ].map(([key, label]) => {
                const activeKey = currentPhaseKey(activeTask, latestEvent);
                const keys = ["scope", "recon", "scan", "verify", "report"];
                const done = keys.indexOf(key) <= keys.indexOf(activeKey);
                return (
                  <div key={key} className={`check-step ${done ? "check-step-done" : ""}`}>
                    <span />
                    <strong>{label}</strong>
                  </div>
                );
              })}
            </div>
            <div className="next-actions">
              <button type="button" className="primary-btn" onClick={onOpenRisk}>
                查看风险结果
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenReports}>
                查看报告
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenBoundary}>
                查看安全边界
              </button>
            </div>
            {activeSummary && (
              <div className="stats-grid check-result-stats">
                <article className="stat">
                  <span className="stat-label">已验证风险</span>
                  <strong>{activeSummary.verified_count}</strong>
                </article>
                <article className="stat">
                  <span className="stat-label">待复核线索</span>
                  <strong>{activeSummary.pending_count}</strong>
                </article>
                <article className="stat">
                  <span className="stat-label">边界拦截</span>
                  <strong>{boundaryBlockCount}</strong>
                </article>
                <article className="stat">
                  <span className="stat-label">快照</span>
                  <strong>{activeSummary.snapshot_id || "已保存"}</strong>
                </article>
              </div>
            )}
            <div className="technical-log-panel">
              <button
                type="button"
                className="text-btn technical-log-toggle"
                onClick={() => setTechnicalLogsOpen((value) => !value)}
              >
                {technicalLogsOpen ? "收起技术日志" : "查看技术日志"}
              </button>
              {technicalLogsOpen && (
                <div className="technical-log-stream" aria-live="polite">
                  {taskEvents.length ? (
                    taskEvents.slice(-24).map((event) => (
                      <article key={`${event.task_id}-${event.timestamp}-${event.event}`} className="technical-log-entry">
                        <header>
                          <strong>{formatEventLabel(event.event)}</strong>
                          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                        </header>
                        <pre>{formatEventPayload(event)}</pre>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">暂无原始任务事件。</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      <div className="split-grid">
        <SectionCard title="测试范围" copy="把端口、主机、路径等约束写清楚，任务每轮都会按这些边界执行。">
          <div className="form-grid">
            <label className="field">
              <span>仅测试端口</span>
              <input value={onlyPort} onChange={(event) => setOnlyPort(event.target.value)} inputMode="numeric" placeholder="例如 443" />
              {!onlyPort.trim() && inferredScope.port && (
                <small>未手动填写时，将自动限制在端口 {inferredScope.port}。</small>
              )}
            </label>
            <label className="field">
              <span>仅测试主机</span>
              <input value={onlyHost} onChange={(event) => setOnlyHost(event.target.value)} placeholder="example.com" />
              {!onlyHost.trim() && inferredScope.host && (
                <small>未手动填写时，将自动限制在主机 {inferredScope.host}。</small>
              )}
            </label>
            <label className="field field-wide">
              <span>仅测试路径</span>
              <input value={onlyPath} onChange={(event) => setOnlyPath(event.target.value)} placeholder="/admin" />
              {!onlyPath.trim() && inferredScope.path && (
                <small>未手动填写时，将自动限制在路径 {inferredScope.path}。</small>
              )}
            </label>
            <label className="field">
              <span>排除主机</span>
              <input value={blockedHost} onChange={(event) => setBlockedHost(event.target.value)} placeholder="staging.example.com" />
            </label>
            <label className="field">
              <span>排除路径</span>
              <input value={blockedPath} onChange={(event) => setBlockedPath(event.target.value)} placeholder="/internal" />
            </label>
          </div>
          <button type="button" className="text-btn" onClick={() => setAdvancedOpen((value) => !value)}>
            {advancedOpen ? "收起高级动作边界" : "展开高级动作边界"}
          </button>
          {advancedOpen && (
            <div className="action-boundary-panel">
              <div>
                <strong>允许动作</strong>
                <span>不手动选择时，沿用当前检查模式的默认允许范围。</span>
              </div>
              <div className="action-choice-grid">
                {ACTION_OPTIONS.map((action) => (
                  <button
                    key={`allow-${action.value}`}
                    type="button"
                    className={`action-choice ${allowActions.includes(action.value) ? "selected-item" : ""}`}
                    onClick={() => toggleAction(action.value, allowActions, setAllowActions, blockActions, setBlockActions)}
                  >
                    <strong>{formatActionLabel(action.value)}</strong>
                    <span>{action.copy}</span>
                  </button>
                ))}
              </div>
              <div>
                <strong>禁止动作</strong>
                <span>用于明确声明本次检查不能触碰的高风险能力。</span>
              </div>
              <div className="action-choice-grid">
                {ACTION_OPTIONS.map((action) => (
                  <button
                    key={`block-${action.value}`}
                    type="button"
                    className={`action-choice action-choice-block ${blockActions.includes(action.value) ? "selected-item" : ""}`}
                    onClick={() => toggleAction(action.value, blockActions, setBlockActions, allowActions, setAllowActions)}
                  >
                    <strong>{formatActionLabel(action.value)}</strong>
                    <span>{action.copy}</span>
                  </button>
                ))}
              </div>
              <div className="scope-summary">
                <strong>本次允许</strong>
                <span>{formatActionList(allowActions.length ? allowActions : selectedMode.allowActions)}</span>
                <strong>本次禁止</strong>
                <span>{formatActionList(blockActions.length ? blockActions : selectedMode.blockActions)}</span>
              </div>
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
        </SectionCard>

        <SectionCard title="下一步" copy="检查完成后优先看风险结果和报告，高级细节仍然保留。">
          <div className="next-actions">
            <button type="button" className="secondary-btn" onClick={onOpenBoundary}>
              查看安全边界
            </button>
            <button type="button" className="secondary-btn" onClick={onOpenReports}>
              查看历史报告
            </button>
          </div>
          <div className="scope-summary">
            <strong>当前模式会执行</strong>
            <span>{formatTaskCommand(selectedMode.command)}</span>
            <strong>默认允许动作</strong>
            <span>{formatActionList(selectedMode.allowActions)}</span>
            <strong>默认禁止动作</strong>
            <span>{formatActionList(selectedMode.blockActions)}</span>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="确认授权范围"
        copy={confirmCopy}
        confirmLabel="确认并开始"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </section>
  );
}
