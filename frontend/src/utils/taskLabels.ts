import type { TaskCommand } from "../types/api";

const COMMAND_LABELS: Record<TaskCommand, string> = {
  recon: "快速摸底",
  run: "标准检查",
  scan: "深度扫描",
  exploit: "深度验证",
  persistent: "持续检查",
};

const ACTION_LABELS: Record<string, string> = {
  recon: "信息收集",
  run: "标准检查",
  scan: "风险识别",
  exploit: "验证利用",
  persistent: "持续检查",
  post_exploitation: "后渗透动作",
};

const PHASE_LABELS: Record<string, string> = {
  scope: "确认授权范围",
  recon: "收集公开信息",
  scan: "识别服务和入口",
  verify: "分析潜在风险",
  exploit: "验证风险影响",
  report: "整理报告",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "排队中",
  running: "检查中",
  completed: "已完成",
  failed: "未完成",
  stopped: "已停止",
};

const FINDING_STATUS_LABELS: Record<string, string> = {
  verified: "已验证",
  pending: "待复核",
  candidate: "线索",
  manual_review: "人工复核",
  dismissed: "已排除",
  false_positive: "误报",
};

const EVENT_LABELS: Record<string, string> = {
  task_started: "检查已启动",
  task_progress: "检查进展",
  task_message: "任务消息",
  task_completed: "检查已完成",
  task_failed: "检查失败",
  task_stopped: "检查已停止",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high: "高风险",
  medium: "中风险",
  warn: "需关注",
  warning: "需关注",
  low: "低风险",
  info: "提示",
};

const MCP_HEALTH_LABELS: Record<string, string> = {
  healthy: "可用",
  degraded: "降级可用",
  unavailable: "不可用",
  unknown: "未知",
};

const MCP_MODE_LABELS: Record<string, string> = {
  local: "内置本地能力",
  placeholder: "占位模式",
  sdk: "已连接工具服务",
  sse: "远程事件服务",
};

export function formatTaskCommand(command: string | null | undefined): string {
  if (!command) return "安全检查";
  return COMMAND_LABELS[command as TaskCommand] ?? "自定义检查";
}

export function formatTaskTitle(command: string | null | undefined, target: string): string {
  return `${formatTaskCommand(command)} · ${target}`;
}

export function formatActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatActionList(actions: string[] | undefined, fallback = "按系统默认边界"): string {
  if (!actions?.length) return fallback;
  return actions.map(formatActionLabel).join("、");
}

export function formatPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "暂无阶段";
  const normalized = phase.toLowerCase();
  const matchedKey = Object.keys(PHASE_LABELS).find((key) => normalized.includes(key));
  return PHASE_LABELS[normalized] ?? (matchedKey ? PHASE_LABELS[matchedKey] : phase);
}

export function formatTaskStatus(status: string | null | undefined): string {
  if (!status) return "空闲";
  return STATUS_LABELS[status] ?? status;
}

export function formatFindingStatus(status: string | null | undefined): string {
  if (!status) return "待复核";
  const normalized = status.toLowerCase();
  const matchedKey = Object.keys(FINDING_STATUS_LABELS).find((key) => normalized.includes(key));
  return FINDING_STATUS_LABELS[normalized] ?? (matchedKey ? FINDING_STATUS_LABELS[matchedKey] : status);
}

export function formatEventLabel(event: string | null | undefined): string {
  if (!event) return "任务事件";
  return EVENT_LABELS[event] ?? event;
}

export function formatSeverityLabel(severity: string | null | undefined): string {
  if (!severity) return "提示";
  const normalized = severity.toLowerCase();
  const matchedKey = Object.keys(SEVERITY_LABELS).find((key) => normalized.includes(key));
  return SEVERITY_LABELS[normalized] ?? (matchedKey ? SEVERITY_LABELS[matchedKey] : severity);
}

export function formatMcpHealth(status: string | null | undefined): string {
  if (!status) return "未知";
  return MCP_HEALTH_LABELS[status] ?? status;
}

export function formatMcpExecutionMode(mode: string | null | undefined): string {
  if (!mode) return "未知";
  return MCP_MODE_LABELS[mode] ?? mode;
}

export function formatResumeStrategy(strategy: string | null | undefined): string {
  if (!strategy) return "暂无恢复建议";
  const normalized = strategy.toLowerCase();
  if (normalized.includes("stop") || normalized.includes("complete")) return "可以结束本次检查";
  if (normalized.includes("verify")) return "建议优先复核关键线索";
  if (normalized.includes("exploit")) return "需要明确授权后再验证";
  if (normalized.includes("scan")) return "建议继续做风险识别";
  if (normalized.includes("recon")) return "建议补充信息收集";
  if (normalized.includes("continue") || normalized.includes("resume")) return "可以继续沿当前方向检查";
  return strategy;
}

export function formatConstraintSummary(constraints: Record<string, unknown> | undefined): string {
  if (!constraints || !Object.keys(constraints).length) return "未设置额外边界";
  const labels: string[] = [];
  const onlyHost = constraints.allowed_hosts ?? constraints.only_host;
  const onlyPath = constraints.allowed_paths ?? constraints.only_path;
  const onlyPort = constraints.allowed_ports ?? constraints.only_port;
  const blockedHost = constraints.blocked_hosts ?? constraints.blocked_host;
  const blockedPath = constraints.blocked_paths ?? constraints.blocked_path;
  const allowActions = constraints.allowed_actions ?? constraints.allow_actions;
  const blockActions = constraints.blocked_actions ?? constraints.block_actions;
  if (onlyHost) labels.push(`仅主机 ${formatConstraintValue(onlyHost)}`);
  if (onlyPath) labels.push(`仅路径 ${formatConstraintValue(onlyPath)}`);
  if (onlyPort) labels.push(`仅端口 ${formatConstraintValue(onlyPort)}`);
  if (blockedHost) labels.push(`排除主机 ${formatConstraintValue(blockedHost)}`);
  if (blockedPath) labels.push(`排除路径 ${formatConstraintValue(blockedPath)}`);
  if (Array.isArray(allowActions)) labels.push(`允许 ${formatActionList(allowActions.map(String))}`);
  if (Array.isArray(blockActions)) labels.push(`禁止 ${formatActionList(blockActions.map(String))}`);
  return labels.length ? labels.join("；") : "已设置自定义边界";
}

export function countConstraintViolations(
  events: unknown[] | undefined,
  violations: unknown[] | undefined,
  fallback = 0,
): number {
  if (events?.length) return events.length;
  if (violations?.length) return violations.length;
  return fallback;
}

function formatConstraintValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  return String(value);
}
