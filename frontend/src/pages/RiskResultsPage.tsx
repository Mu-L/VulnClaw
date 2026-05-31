import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { generateTargetReport } from "../api/web";
import { SectionCard } from "../components/SectionCard";
import { useTargetPreviewQuery, useTargetQuery, useTargetsQuery } from "../hooks/queries";
import { loadUiPreferences, subscribeUiPreferences, type UiPreferences } from "../utils/preferences";
import {
  countConstraintViolations,
  formatConstraintSummary,
  formatFindingStatus,
  formatPhaseLabel,
  formatResumeStrategy,
  formatSeverityLabel,
} from "../utils/taskLabels";

interface RiskResultsPageProps {
  selectedTarget: string | null;
  onSelectTarget: (target: string | null) => void;
  onOpenHome: () => void;
  onOpenReports: (path?: string) => void;
  onOpenBoundary: () => void;
}

interface FindingCard {
  id: string;
  title: string;
  severity: string;
  status: string;
  evidence: string;
  impact: string;
  recommendation: string;
  type: string;
}

interface ActionCard {
  title: string;
  copy: string;
  tone: "primary" | "warn" | "safe";
}

interface GeneratedReportState {
  format: UiPreferences["reportFormat"];
  path: string;
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeSeverity(value: unknown): string {
  const text = asText(value, "Info");
  const lower = text.toLowerCase();
  if (lower.includes("critical")) return "Critical";
  if (lower.includes("high")) return "High";
  if (lower.includes("medium")) return "Medium";
  if (lower.includes("low")) return "Low";
  return text;
}

function severityTone(severity: string): "danger" | "warn" | "ok" | "info" {
  const normalized = severity.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("high")) return "danger";
  if (normalized.includes("medium") || normalized.includes("warn")) return "warn";
  if (normalized.includes("low")) return "ok";
  return "info";
}

function extractEvidence(raw: Record<string, unknown>): string {
  const evidence = raw.evidence;
  if (typeof evidence === "string" && evidence.trim()) return evidence;
  if (Array.isArray(evidence) && evidence.length) return evidence.map(String).slice(0, 3).join(" / ");
  return asText(raw.description, "暂未整理证据摘要，可在技术详情中查看原始记录。");
}

function extractFindingCards(rawFindings: unknown): FindingCard[] {
  if (!Array.isArray(rawFindings)) return [];
  return rawFindings.slice(0, 24).map((item, index) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = asText(raw.title, `风险线索 ${index + 1}`);
    return {
      id: asText(raw.finding_id, `${title}-${index}`),
      title,
      severity: normalizeSeverity(raw.severity),
      status: asText(raw.verification_status, asText(raw.lifecycle_status, raw.verified ? "verified" : "pending")),
      evidence: extractEvidence(raw),
      impact: asText(raw.impact, asText(raw.risk, "需要结合目标上下文判断影响范围。")),
      recommendation: asText(raw.recommendation, asText(raw.remediation, "建议人工复核该线索，并按最小暴露面原则修复。")),
      type: asText(raw.vuln_type, asText(raw.category, "未分类")),
    };
  });
}

function resultConclusion(verified: number, pending: number, manualReview: number): string {
  if (verified > 0) return `发现 ${verified} 个已验证风险，建议优先处理。`;
  if (manualReview > 0) return `有 ${manualReview} 个高价值线索需要人工复核。`;
  if (pending > 0) return `发现 ${pending} 个待复核线索，暂未确认可利用风险。`;
  return "暂未发现明确风险，可结合更深模式继续检查。";
}

function actionCardFromSignal(signal: string): ActionCard {
  const normalized = signal.toLowerCase();
  if (normalized.includes("report")) {
    return {
      title: "生成并保存报告",
      copy: "把本次检查结论整理成可交付的 Markdown / HTML 报告。",
      tone: "primary",
    };
  }
  if (normalized.includes("boundary") || normalized.includes("constraint")) {
    return {
      title: "查看安全边界",
      copy: "确认主机、端口、路径和动作范围是否仍符合授权。",
      tone: "safe",
    };
  }
  if (normalized.includes("verify") || normalized.includes("manual")) {
    return {
      title: "人工复核关键线索",
      copy: "优先确认高价值线索是否真实可复现，再决定是否扩大验证。",
      tone: "warn",
    };
  }
  if (normalized.includes("scan") || normalized.includes("recon")) {
    return {
      title: "继续补充检查",
      copy: "沿当前范围继续收集入口、服务和潜在风险线索。",
      tone: "primary",
    };
  }
  return {
    title: signal,
    copy: "来自后端恢复计划的建议动作，建议结合当前目标上下文判断。",
    tone: "primary",
  };
}

function buildActionCards(actions: string[], pending: number, manualReview: number): ActionCard[] {
  const cards = actions.slice(0, 6).map(actionCardFromSignal);
  if (!cards.length && (pending > 0 || manualReview > 0)) {
    cards.push({
      title: "先复核待确认线索",
      copy: "当前存在待复核内容，建议先确认证据和影响范围，再生成正式报告。",
      tone: "warn",
    });
  }
  if (!cards.length) {
    cards.push({
      title: "生成报告或继续观察",
      copy: "当前没有明确下一步动作，可生成报告留档，或在更明确授权范围内继续检查。",
      tone: "safe",
    });
  }
  return cards;
}

export function RiskResultsPage({ selectedTarget, onSelectTarget, onOpenHome, onOpenReports, onOpenBoundary }: RiskResultsPageProps) {
  const queryClient = useQueryClient();
  const targetsQuery = useTargetsQuery();
  const [localTarget, setLocalTarget] = useState("");
  const [generatedReport, setGeneratedReport] = useState<GeneratedReportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportFormat, setReportFormat] = useState<UiPreferences["reportFormat"]>(() => loadUiPreferences().reportFormat);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => subscribeUiPreferences((preferences) => {
    setReportFormat(preferences.reportFormat);
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
  const previewQuery = useTargetPreviewQuery(targetValue);
  const target = targetQuery.data;
  const preview = previewQuery.data;

  const findings = useMemo(() => extractFindingCards(target?.raw?.findings), [target]);
  const criticalOrHigh = findings.filter((item) => severityTone(item.severity) === "danger").length;
  const boundaryBlocks = countConstraintViolations(
    target?.constraint_violation_events,
    target?.constraint_violations,
  );
  const nextActions = preview?.next_actions ?? [];
  const actionCards = useMemo(
    () => buildActionCards(nextActions, target?.pending_count ?? 0, target?.manual_review_count ?? 0),
    [nextActions, target?.pending_count, target?.manual_review_count],
  );

  async function handleGenerateReport() {
    if (!targetValue) return;
    try {
      setGenerating(true);
      setError(null);
      const result = await generateTargetReport(targetValue, reportFormat);
      setGeneratedReport({ format: reportFormat, path: result.path });
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="risk-page">
      <SectionCard
        title="目标风险概览"
        copy="优先展示用户真正关心的结论、风险数量、证据和下一步。"
        aside={<span className="status-badge">{target ? formatPhaseLabel(target.phase) : "等待目标"}</span>}
      >
        <label className="field">
          <span>目标</span>
          <select
            value={targetValue ?? ""}
            onChange={(event) => {
              const value = event.target.value || null;
              setLocalTarget(value ?? "");
              onSelectTarget(value);
              setGeneratedReport(null);
              setError(null);
            }}
          >
            <option value="">选择一个目标</option>
            {targetsQuery.data?.map((item) => (
              <option key={item.target} value={item.target}>
                {item.target}
              </option>
            ))}
          </select>
        </label>

        {target ? (
          <>
            <div className="risk-hero">
              <div>
                <span className="pill">安全结论</span>
                <h3>{resultConclusion(target.verified_count, target.pending_count, target.manual_review_count)}</h3>
                <p>
                  VulnClaw 已将目标状态、验证结果、待复核线索和安全边界信息合并到当前视图。
                </p>
              </div>
              <div className="risk-score">
                <strong>{criticalOrHigh}</strong>
                <span>高优先级风险</span>
              </div>
            </div>

            <div className="stats-grid">
              <article className="stat">
                <span className="stat-label">已验证风险</span>
                <strong>{target.verified_count}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">待复核线索</span>
                <strong>{target.pending_count}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">人工复核</span>
                <strong>{target.manual_review_count}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">边界拦截</span>
                <strong>{boundaryBlocks}</strong>
              </article>
            </div>

            <div className="button-row">
              <button type="button" className="primary-btn" disabled={generating} onClick={handleGenerateReport}>
                {generating ? "生成中..." : `生成 ${reportFormat === "html" ? "HTML" : "Markdown"} 报告`}
              </button>
              <button type="button" className="secondary-btn" onClick={() => onOpenReports()}>
                查看报告中心
              </button>
              <button type="button" className="secondary-btn" onClick={onOpenBoundary}>
                查看安全边界
              </button>
            </div>

            {generatedReport && (
              <div className="report-delivery-card risk-delivery-card">
                <div>
                  <span>交付状态</span>
                  <strong>报告已生成</strong>
                </div>
                <div>
                  <span>报告格式</span>
                  <strong>{generatedReport.format === "html" ? "HTML" : "Markdown"}</strong>
                </div>
                <div>
                  <span>文件位置</span>
                  <strong>{generatedReport.path}</strong>
                </div>
                <div className="risk-delivery-action">
                  <button className="primary-btn" onClick={() => onOpenReports(generatedReport.path)} type="button">
                    去报告中心预览
                  </button>
                </div>
              </div>
            )}
            {error && <div className="error-box">{error}</div>}
          </>
        ) : (
          <div className="empty-state risk-empty-state">
            <strong>{targetQuery.isLoading ? "正在加载目标..." : "还没有可展示的目标结果"}</strong>
            {!targetQuery.isLoading && (
              <>
                <span>先从首页输入授权目标并完成一次检查，VulnClaw 会把风险、证据和下一步建议整理到这里。</span>
                <button className="secondary-btn" type="button" onClick={onOpenHome}>
                  回首页开始检查
                </button>
              </>
            )}
          </div>
        )}
      </SectionCard>

      {target && (
        <div className="split-grid">
          <SectionCard title="风险列表" copy="按严重程度和验证状态展示，技术记录默认收起。">
            <div className="risk-list">
              {findings.length ? (
                findings.map((finding) => (
                  <article key={finding.id} className="risk-item">
                    <div className="risk-item-head">
                      <div>
                        <span className={`severity-badge severity-${severityTone(finding.severity)}`}>{formatSeverityLabel(finding.severity)}</span>
                        <h4>{finding.title}</h4>
                      </div>
                      <span className="status-badge">{formatFindingStatus(finding.status)}</span>
                    </div>
                    <div className="risk-detail-grid">
                      <div>
                        <strong>类型</strong>
                        <span>{finding.type}</span>
                      </div>
                      <div>
                        <strong>证据摘要</strong>
                        <span>{finding.evidence}</span>
                      </div>
                      <div>
                        <strong>影响范围</strong>
                        <span>{finding.impact}</span>
                      </div>
                      <div>
                        <strong>修复建议</strong>
                        <span>{finding.recommendation}</span>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">当前目标还没有结构化风险项。</div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="下一步建议" copy="把 resume plan 和治理信号转成可执行建议。">
            <div className="list dense-list">
              <div className="list-item">
                <strong>恢复策略</strong>
                <span>{formatResumeStrategy(target.resume_strategy || preview?.resume_strategy)}</span>
                <span className="muted-inline">{target.resume_reason || preview?.resume_reason || "暂无说明"}</span>
              </div>
              <div className="list-item">
                <strong>推荐动作</strong>
                <div className="risk-action-grid">
                  {actionCards.map((item) => (
                    <article key={`${item.title}-${item.copy}`} className={`risk-action-card risk-action-card-${item.tone}`}>
                      <strong>{item.title}</strong>
                      <span>{item.copy}</span>
                    </article>
                  ))}
                </div>
              </div>
              <div className="list-item">
                <strong>优先目标</strong>
                {preview?.priority_targets.length ? (
                  preview.priority_targets.slice(0, 6).map((item) => <span key={item}>{item}</span>)
                ) : (
                  <span className="muted-inline">暂无优先目标。</span>
                )}
              </div>
              <div className="list-item">
                <strong>安全边界</strong>
                <span className="muted-inline">{formatConstraintSummary(target.constraints)}</span>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {target && (
        <SectionCard
          title="技术详情"
          copy="高级用户可以展开查看后端保存的原始状态记录，普通用户默认不需要阅读。"
          aside={
            <button type="button" className="text-btn inline-text-btn" onClick={() => setShowRaw((value) => !value)}>
              {showRaw ? "收起" : "展开"}
            </button>
          }
        >
          {showRaw ? (
            <div className="report-preview">
              <pre>{JSON.stringify(target.raw, null, 2)}</pre>
            </div>
          ) : (
            <div className="empty-state">技术记录已收起。</div>
          )}
        </SectionCard>
      )}
    </section>
  );
}
