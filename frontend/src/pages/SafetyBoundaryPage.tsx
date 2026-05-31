import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "../components/SectionCard";
import { useConstraintAuditQuery, useTargetQuery, useTargetsQuery } from "../hooks/queries";
import type { ConstraintAuditEventView, TaskOptions, TaskRecord } from "../types/api";
import { loadUiPreferences, subscribeUiPreferences, type BoundaryDefaults } from "../utils/preferences";
import { countConstraintViolations, formatActionList, formatPhaseLabel, formatSeverityLabel } from "../utils/taskLabels";

interface SafetyBoundaryPageProps {
  selectedTarget: string | null;
  activeTask: TaskRecord | null;
  onOpenHome: () => void;
  onOpenSettings: () => void;
  onSelectTarget: (target: string | null) => void;
}

interface BoundaryChip {
  label: string;
  value: string;
  tone: "allow" | "block" | "neutral";
}

interface BoundaryReadiness {
  tone: "ok" | "warn";
  title: string;
  copy: string;
}

function stringifyValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    const values = value.map(String).filter(Boolean);
    return key.includes("actions") ? formatActionList(values) : values.join(", ");
  }
  if (typeof value === "string") {
    return key.includes("actions") ? formatActionList([value]) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function boundaryLabel(key: string): string {
  const labels: Record<string, string> = {
    only_host: "仅允许主机",
    only_path: "仅允许路径",
    only_port: "仅允许端口",
    allowed_hosts: "仅允许主机",
    allowed_paths: "仅允许路径",
    allowed_ports: "仅允许端口",
    blocked_host: "排除主机",
    blocked_path: "排除路径",
    blocked_hosts: "排除主机",
    blocked_paths: "排除路径",
    allow_actions: "允许动作",
    allowed_actions: "允许动作",
    block_actions: "禁止动作",
    blocked_actions: "禁止动作",
  };
  return labels[key] ?? key;
}

function boundaryTone(key: string): BoundaryChip["tone"] {
  if (key.startsWith("blocked") || key.startsWith("block_")) return "block";
  if (key.startsWith("only") || key.startsWith("allow") || key.startsWith("allowed")) return "allow";
  return "neutral";
}

function normalizeConstraints(constraints: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!constraints) return {};
  return {
    allowed_hosts: constraints.allowed_hosts ?? constraints.only_host,
    allowed_ports: constraints.allowed_ports ?? constraints.only_port,
    allowed_paths: constraints.allowed_paths ?? constraints.only_path,
    blocked_hosts: constraints.blocked_hosts ?? constraints.blocked_host,
    blocked_paths: constraints.blocked_paths ?? constraints.blocked_path,
    allowed_actions: constraints.allowed_actions ?? constraints.allow_actions,
    blocked_actions: constraints.blocked_actions ?? constraints.block_actions,
  };
}

function buildBoundaryChips(constraints: Record<string, unknown> | undefined): BoundaryChip[] {
  if (!constraints) return [];
  return Object.entries(normalizeConstraints(constraints))
    .map(([key, value]) => ({
      label: boundaryLabel(key),
      value: stringifyValue(key, value),
      tone: boundaryTone(key),
    }))
    .filter((item) => item.value && item.value !== "[]" && item.value !== "{}");
}

function boundaryDefaultsToConstraints(defaults: BoundaryDefaults): Record<string, unknown> {
  return {
    only_port: defaults.onlyPort,
    only_host: defaults.onlyHost,
    only_path: defaults.onlyPath,
    blocked_host: defaults.blockedHost,
    blocked_path: defaults.blockedPath,
    allow_actions: defaults.allowActions,
    block_actions: defaults.blockActions,
  };
}

function taskOptionsToConstraints(options: TaskOptions | undefined): Record<string, unknown> {
  if (!options) return {};
  return {
    only_port: options.only_port,
    only_host: options.only_host,
    only_path: options.only_path,
    blocked_host: options.blocked_host,
    blocked_path: options.blocked_path,
    allow_actions: options.allow_actions,
    block_actions: options.block_actions,
  };
}

function hasConstraintValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null && value !== false;
}

function boundaryReadiness(constraints: Record<string, unknown> | undefined): BoundaryReadiness {
  const normalized = normalizeConstraints(constraints);
  if (!Object.values(normalized).some(hasConstraintValue)) {
    return {
      tone: "warn",
      title: "建议补充授权范围",
      copy: "当前目标没有显式端口、主机、路径或动作边界。普通自测建议至少指定一个范围，让后续多轮检查更稳。",
    };
  }

  const hasPreciseScope = ["allowed_hosts", "allowed_ports", "allowed_paths"].some((key) => hasConstraintValue(normalized[key]));
  const hasActionBoundary = ["allowed_actions", "blocked_actions"].some((key) => hasConstraintValue(normalized[key]));

  if (hasPreciseScope && hasActionBoundary) {
    return {
      tone: "ok",
      title: "授权范围清晰",
      copy: "目标范围和动作边界都已声明，后续每轮检查都会继续按这些规则执行。",
    };
  }

  return {
    tone: "warn",
    title: "边界已生效，但还可更精确",
    copy: hasPreciseScope
      ? "已经声明目标范围，建议再补充允许或禁止动作，减少深度验证时的误触风险。"
      : "已经声明动作边界，建议再补充主机、端口或路径，让授权范围更具体。",
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "未知时间";
  return date.toLocaleString();
}

function eventTone(event: ConstraintAuditEventView): "danger" | "warn" | "info" {
  const severity = event.severity.toLowerCase();
  if (severity.includes("high") || severity.includes("critical")) return "danger";
  if (severity.includes("medium") || severity.includes("warn")) return "warn";
  return "info";
}

export function SafetyBoundaryPage({ selectedTarget, activeTask, onOpenHome, onOpenSettings, onSelectTarget }: SafetyBoundaryPageProps) {
  const targetsQuery = useTargetsQuery();
  const auditQuery = useConstraintAuditQuery();
  const [localTarget, setLocalTarget] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const [defaultBoundary, setDefaultBoundary] = useState<BoundaryDefaults>(() => loadUiPreferences().defaultBoundary);

  useEffect(() => subscribeUiPreferences((preferences) => {
    setDefaultBoundary(preferences.defaultBoundary);
  }), []);

  useEffect(() => {
    if (selectedTarget) {
      setLocalTarget(selectedTarget);
      return;
    }
    const first = targetsQuery.data?.[0]?.target;
    if (first) {
      setLocalTarget(first);
      onSelectTarget(first);
    }
  }, [selectedTarget, targetsQuery.data, onSelectTarget]);

  const targetValue = selectedTarget ?? localTarget ?? null;
  const targetQuery = useTargetQuery(targetValue);
  const target = targetQuery.data;
  const audit = auditQuery.data;
  const defaultConstraints = useMemo(() => boundaryDefaultsToConstraints(defaultBoundary), [defaultBoundary]);
  const activeTaskConstraints = useMemo(() => taskOptionsToConstraints(activeTask?.options), [activeTask?.options]);
  const activeTaskMatchesTarget = Boolean(activeTask?.target && activeTask.target === targetValue);
  const displayedConstraints = activeTaskMatchesTarget && Object.values(activeTaskConstraints).some(hasConstraintValue)
    ? activeTaskConstraints
    : target?.constraints;
  const displayedConstraintsSource = activeTaskMatchesTarget && Object.values(activeTaskConstraints).some(hasConstraintValue)
    ? "活动任务"
    : "已保存范围";

  const chips = useMemo(() => buildBoundaryChips(displayedConstraints), [displayedConstraints]);
  const defaultChips = useMemo(() => buildBoundaryChips(defaultConstraints), [defaultConstraints]);
  const targetEvents = useMemo(() => {
    const selected = targetValue;
    const events = audit?.recent_events ?? [];
    return selected ? events.filter((event) => event.target === selected) : events;
  }, [audit?.recent_events, targetValue]);
  const blockedCount = countConstraintViolations(
    target?.constraint_violation_events,
    target?.constraint_violations,
    targetEvents.length,
  );
  const highSeverityCount = targetEvents.filter((event) => eventTone(event) === "danger").length;
  const readiness = useMemo(() => boundaryReadiness(displayedConstraints), [displayedConstraints]);
  const defaultReadiness = useMemo(() => boundaryReadiness(defaultConstraints), [defaultConstraints]);

  return (
    <section className="boundary-page">
      <SectionCard
        title="安全边界保护"
        copy="VulnClaw 会在每轮任务中重复检查这些边界，阻止超出授权范围的动作。"
        aside={<span className="status-badge">{blockedCount} 次拦截</span>}
      >
        <label className="field">
          <span>查看目标</span>
          <select
            value={targetValue ?? ""}
            onChange={(event) => {
              const value = event.target.value || null;
              setLocalTarget(value ?? "");
              onSelectTarget(value);
            }}
          >
            <option value="">全部目标</option>
            {targetsQuery.data?.map((item) => (
              <option key={item.target} value={item.target}>
                {item.target}
              </option>
            ))}
          </select>
        </label>

        <div className="boundary-hero">
          <div>
            <span className="pill">边界守护</span>
            <h3>{blockedCount > 0 ? "已阻止越界尝试" : "当前未记录越界尝试"}</h3>
            <p>
              {targetValue
                ? `当前查看 ${targetValue} 的授权范围和拦截记录。`
                : "选择目标后可查看该目标的授权范围；未选择时展示全局拦截记录。"}
            </p>
          </div>
          <div className="boundary-shield">
            <strong>{blockedCount}</strong>
            <span>已拦截</span>
          </div>
        </div>

        <div className="stats-grid">
          <article className="stat">
            <span className="stat-label">全局拦截</span>
            <strong>{audit?.total_events ?? 0}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">高严重度</span>
            <strong>{audit?.high_severity_events ?? 0}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">当前目标高危</span>
            <strong>{highSeverityCount}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">边界规则</span>
            <strong>{chips.length}</strong>
          </article>
        </div>
      </SectionCard>

      <div className="split-grid">
        <SectionCard
          title="当前测试范围"
        copy="优先展示正在运行或刚创建任务的边界；没有活动任务时展示已保存测试范围。"
          aside={<span className="status-badge">{displayedConstraintsSource}</span>}
        >
          <div className={`boundary-readiness boundary-readiness-${readiness.tone}`}>
            <strong>{readiness.title}</strong>
            <span>{readiness.copy}</span>
          </div>
          <div className="boundary-chip-grid">
            {chips.length ? (
              chips.map((chip) => (
                <div key={`${chip.label}-${chip.value}`} className={`boundary-chip boundary-chip-${chip.tone}`}>
                  <span>{chip.label}</span>
                  <strong>{chip.value}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state boundary-empty-state">
                <span>
                  {targetQuery.isLoading ? "正在读取目标边界..." : "当前目标没有额外范围约束，建议在首页启动任务前明确端口、主机或路径。"}
                </span>
                {!targetQuery.isLoading && (
                  <button className="secondary-btn" type="button" onClick={onOpenHome}>
                    回首页设置本次范围
                  </button>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="默认安全边界" copy="这些默认值来自设置页，下一次从首页启动检查时会自动带入。">
          <div className={`boundary-readiness boundary-readiness-${defaultReadiness.tone}`}>
            <strong>{defaultReadiness.title}</strong>
            <span>{defaultReadiness.copy}</span>
          </div>
          <div className="boundary-chip-grid">
            {defaultChips.length ? (
              defaultChips.map((chip) => (
                <div key={`default-${chip.label}-${chip.value}`} className={`boundary-chip boundary-chip-${chip.tone}`}>
                  <span>{chip.label}</span>
                  <strong>{chip.value}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state boundary-empty-state">
                <span>还没有配置默认边界。可以到设置页的“安全边界默认值”里设置常用端口、主机、路径或动作范围。</span>
                <button className="secondary-btn" type="button" onClick={onOpenSettings}>
                  去设置默认边界
                </button>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="保护说明" copy="把约束系统翻译成普通用户能理解的安全感。">
          <div className="boundary-explain-list">
            <div className="boundary-explain-item">
              <strong>每轮检查都会重新确认范围</strong>
              <span>即使任务运行多轮，端口、主机、路径和禁止动作也会在执行前被代码校验。</span>
            </div>
            <div className="boundary-explain-item">
              <strong>越界尝试会被记录</strong>
              <span>被阻止的动作会进入审计记录，方便后续解释“为什么没有继续测试”。</span>
            </div>
            <div className="boundary-explain-item">
              <strong>深度验证需要更明确授权</strong>
              <span>当使用深度或持续检查模式时，建议至少指定主机、端口或路径边界。</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="被阻止的越界尝试" copy="优先显示最近拦截原因，技术字段放在辅助信息里。">
        <div className="boundary-timeline">
          {targetEvents.length ? (
            targetEvents.map((event, index) => (
              <article key={`${event.timestamp}-${event.code}-${index}`} className={`boundary-event boundary-event-${eventTone(event)}`}>
                <div className="boundary-event-time">
                  <span>{formatTime(event.timestamp)}</span>
                </div>
                <div className="boundary-event-body">
                  <div className="boundary-event-head">
                    <strong>{event.summary || "已阻止一次越界动作"}</strong>
                    <span className={`severity-badge severity-${eventTone(event)}`}>{formatSeverityLabel(event.severity)}</span>
                  </div>
                  <p>{event.detail || "该动作不符合当前授权范围，因此没有执行。"}</p>
                  <div className="boundary-event-meta">
                    <span>目标: {event.target || "未知目标"}</span>
                    <span>动作: {formatActionList(event.action ? [event.action] : undefined, "未记录")}</span>
                    <span>工具: {event.tool_name || "未记录"}</span>
                    <span>阶段: {formatPhaseLabel(event.phase)}</span>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">暂未记录被阻止的越界尝试。</div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="技术审计"
        copy="保留规则来源和拦截统计，方便高级用户排查安全边界为什么生效。"
        aside={
          <button type="button" className="text-btn inline-text-btn" onClick={() => setShowTechnical((value) => !value)}>
            {showTechnical ? "收起" : "展开"}
          </button>
        }
      >
        {showTechnical ? (
          <div className="split-grid no-top-gap">
            <article className="inset-card compact-card">
              <h4>按来源</h4>
              <div className="list">
                {audit && Object.entries(audit.by_source).length ? (
                  Object.entries(audit.by_source).map(([key, value]) => (
                    <div key={key} className="list-item">
                      <strong>{key}</strong>
                      <span>{value}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">暂无来源统计。</div>
                )}
              </div>
            </article>
            <article className="inset-card compact-card">
              <h4>按规则</h4>
              <div className="list">
                {audit && Object.entries(audit.by_code).length ? (
                  Object.entries(audit.by_code).map(([key, value]) => (
                    <div key={key} className="list-item">
                      <strong>{key}</strong>
                      <span>{value}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">暂无规则统计。</div>
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="empty-state">技术审计已收起。</div>
        )}
      </SectionCard>
    </section>
  );
}
