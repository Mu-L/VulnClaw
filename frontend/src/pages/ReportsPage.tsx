import { useEffect, useState } from "react";
import { generateTargetReport, getReportDownloadUrl } from "../api/web";
import { ReportPreview, ReportPreviewDialog } from "../components/ReportPreviewDialog";
import { SectionCard } from "../components/SectionCard";
import { useReportContentQuery, useReportsQuery, useTargetsQuery } from "../hooks/queries";
import type { ReportListItem } from "../types/api";
import { loadUiPreferences, subscribeUiPreferences } from "../utils/preferences";

interface ReportsPageProps {
  selectedTarget: string | null;
  focus?: {
    target: string | null;
    path?: string;
    openPreview?: boolean;
  } | null;
}

export function ReportsPage({ selectedTarget, focus }: ReportsPageProps) {
  const reportsQuery = useReportsQuery();
  const targetsQuery = useTargetsQuery();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [search, setSearch] = useState(selectedTarget ?? "");
  const [reportTarget, setReportTarget] = useState(selectedTarget ?? "");
  const [generateFormat, setGenerateFormat] = useState<"markdown" | "html">(() => loadUiPreferences().reportFormat);
  const [kindFilter, setKindFilter] = useState<"all" | "markdown" | "html">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week">("all");

  useEffect(() => {
    if (!selectedPath && reportsQuery.data?.[0]?.path) {
      setSelectedPath(reportsQuery.data[0].path);
    }
  }, [selectedPath, reportsQuery.data]);

  useEffect(() => subscribeUiPreferences((preferences) => {
    setGenerateFormat(preferences.reportFormat);
  }), []);

  useEffect(() => {
    if (selectedTarget) {
      setSearch(selectedTarget);
      setReportTarget(selectedTarget);
    }
  }, [selectedTarget]);

  useEffect(() => {
    if (!focus) return;
    if (focus.target) {
      setSearch(focus.target);
      setReportTarget(focus.target);
    }
    if (focus.path) {
      setSelectedPath(focus.path);
    }
    if (focus.openPreview) {
      setPreviewOpen(true);
    }
  }, [focus]);

  useEffect(() => {
    if (!reportTarget && targetsQuery.data?.[0]?.target) {
      setReportTarget(targetsQuery.data[0].target);
    }
  }, [reportTarget, targetsQuery.data]);

  async function handleGenerate() {
    const target = reportTarget.trim();
    if (!target) {
      setError("请先选择或输入一个要生成报告的目标。");
      return;
    }
    try {
      setGenerating(true);
      setError(null);
      const result = await generateTargetReport(target, generateFormat);
      setStatus(result.path);
      setSearch(target);
      setKindFilter(generateFormat);
      await reportsQuery.refetch();
      setSelectedPath(result.path);
      setPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyPath() {
    if (!selectedReport?.path) return;
    try {
      await navigator.clipboard.writeText(selectedReport.path);
      setCopyStatus("报告路径已复制。");
    } catch {
      setCopyStatus("无法访问剪贴板，请手动复制报告路径。");
    }
  }

  function handleDownload() {
    const content = previewContent;
    if (!content || !selectedReport) return;
    const mime = previewKind === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedReport.name || `vulnclaw-report.${previewKind === "html" ? "html" : "md"}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setCopyStatus("报告已开始下载。");
  }

  function handleOpenReportFile() {
    if (!selectedReport?.path) return;
    window.open(getReportDownloadUrl(selectedReport.path), "_blank", "noopener,noreferrer");
  }

  function resetReportFilters() {
    setSearch("");
    setKindFilter("all");
    setDateFilter("all");
    setSelectedPath(reports[0]?.path ?? null);
  }

  function reportStatusCopy(report: ReportListItem | null): string {
    if (!report) return "选择或生成报告后，会在这里展示交付摘要。";
    const kind = report.kind === "html" ? "HTML 网页报告" : "Markdown 文档报告";
    return `${kind} · ${formatSize(report.size_bytes ?? 0)} · ${formatDate(report.modified_at)}`;
  }

  const reports = reportsQuery.data ?? [];
  const filteredReports = reports.filter((report) => reportMatchesFilters(report, search, kindFilter, dateFilter));
  const selectedReport = filteredReports.find((report) => report.path === selectedPath)
    ?? filteredReports[0]
    ?? null;
  const previewPath = selectedReport?.path ?? null;
  const contentQuery = useReportContentQuery(previewPath);
  const effectiveSelectedPath = previewPath;
  const markdownCount = reports.filter((report) => report.kind === "markdown").length;
  const htmlCount = reports.filter((report) => report.kind === "html").length;
  const totalSize = reports.reduce((sum, report) => sum + (report.size_bytes ?? 0), 0);
  const canGenerate = Boolean(reportTarget.trim()) && !generating;
  const previewContent = selectedReport ? contentQuery.data?.content : undefined;
  const previewKind = selectedReport ? contentQuery.data?.kind : undefined;
  const previewLoading = Boolean(selectedReport) && contentQuery.isLoading;

  return (
    <section className="reports-page">
      <SectionCard
        title="报告中心"
        copy="生成、预览和整理安全测试报告。报告内容仍来自后端真实生成结果。"
        aside={<span className="status-badge">{reports.length} 份报告</span>}
      >
        <div className="report-hero">
          <div>
            <span className="pill">最新报告</span>
            <h3>{selectedReport?.name ?? "暂无报告"}</h3>
            <p>{reportStatusCopy(selectedReport)}</p>
          </div>
          <div className="report-actions">
            <label className="field report-target-field">
              <span>生成目标</span>
              <input
                list="report-targets"
                value={reportTarget}
                onChange={(event) => setReportTarget(event.target.value)}
                placeholder="选择或输入目标"
              />
              <datalist id="report-targets">
                {targetsQuery.data?.map((target) => (
                  <option key={target.target} value={target.target} />
                ))}
              </datalist>
            </label>
            <label className="field report-format-field">
              <span>生成格式</span>
              <select value={generateFormat} onChange={(event) => setGenerateFormat(event.target.value as "markdown" | "html")}>
                <option value="markdown">Markdown 文档</option>
                <option value="html">HTML 网页</option>
              </select>
            </label>
            <button
              className="primary-btn"
              disabled={!canGenerate}
              onClick={handleGenerate}
              type="button"
            >
              {generating ? "生成中..." : `生成 ${generateFormat === "html" ? "HTML" : "Markdown"} 报告`}
            </button>
            <button
              className="secondary-btn"
              disabled={!selectedReport}
              onClick={() => setPreviewOpen(true)}
              type="button"
            >
              沉浸预览
            </button>
            <button
              className="secondary-btn"
              disabled={!selectedReport?.path}
              onClick={handleOpenReportFile}
              type="button"
            >
              打开原文件
            </button>
          </div>
        </div>

        <div className="inline-panel">
          <strong>生成说明</strong>
          <p className="inline-note">
            选择 Markdown 适合归档和二次编辑；选择 HTML 会生成可直接在浏览器中打开的网页报告。报告列表默认展示全部格式，生成完成后会临时切到对应格式，避免新报告被筛选隐藏。
          </p>
        </div>

        <div className="report-delivery-card">
          <div>
            <span>交付状态</span>
            <strong>{selectedReport ? "可预览与导出" : "等待生成"}</strong>
          </div>
          <div>
            <span>报告格式</span>
            <strong>{selectedReport?.kind === "html" ? "HTML" : selectedReport?.kind === "markdown" ? "Markdown" : "未选择"}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{selectedReport ? formatDate(selectedReport.modified_at) : "暂无"}</strong>
          </div>
          <div>
            <span>文件位置</span>
            <strong>{selectedReport?.path ?? "生成后自动记录"}</strong>
          </div>
        </div>

        <div className="stats-grid">
          <article className="stat">
            <span className="stat-label">Markdown</span>
            <strong>{markdownCount}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">HTML</span>
            <strong>{htmlCount}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">生成目标</span>
            <strong>{reportTarget || "未选择"}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">总大小</span>
            <strong>{formatSize(totalSize)}</strong>
          </article>
        </div>

        {reportTarget && <p className="inline-note">当前生成目标: <code>{reportTarget}</code></p>}
        {status && <div className="success-box">报告已生成: {status}</div>}
        {copyStatus && <div className="success-box">{copyStatus}</div>}
        {error && <div className="error-box">{error}</div>}
      </SectionCard>

      <div className="report-center-grid">
        <SectionCard
          title="报告列表"
          copy="这里的格式用于筛选已有报告，不会改变新报告的生成格式。点击任意报告可在右侧预览。"
          aside={<span className="status-badge">{filteredReports.length} / {reports.length}</span>}
        >
          <div className="report-filter-grid">
            <label className="field">
              <span>目标或文件名</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="example.com / report.md" />
            </label>
            <label className="field">
              <span>格式</span>
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "all" | "markdown" | "html")}>
                <option value="all">全部格式</option>
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
              </select>
            </label>
            <label className="field">
              <span>时间</span>
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as "all" | "today" | "week")}>
                <option value="all">全部时间</option>
                <option value="today">今天</option>
                <option value="week">最近 7 天</option>
              </select>
            </label>
          </div>
          <div className="list list-scroll report-file-list">
            {filteredReports.slice(0, 24).map((report) => (
              <button
                key={report.path}
                type="button"
                className={`list-item list-button report-file-item ${effectiveSelectedPath === report.path ? "selected-item" : ""}`}
                onClick={() => setSelectedPath(report.path)}
              >
                <strong>{report.name}</strong>
                <span>{report.kind} · {formatSize(report.size_bytes ?? 0)}</span>
                <span className="muted-inline">{formatDate(report.modified_at)}</span>
                <span className="muted-inline">{report.path}</span>
              </button>
            ))}
            {!reports.length && (
              <div className="empty-state report-empty-state">
                <strong>还没有生成报告</strong>
                <span>
                  {reportTarget
                    ? `可以立即为 ${reportTarget} 生成 ${generateFormat === "html" ? "HTML" : "Markdown"} 报告。`
                    : "请选择或输入一个目标，生成第一份可交付报告。"}
                </span>
                <button className="secondary-btn" disabled={!canGenerate} onClick={handleGenerate} type="button">
                  {generating ? "生成中..." : "立即生成报告"}
                </button>
              </div>
            )}
            {Boolean(reports.length) && !filteredReports.length && (
              <div className="empty-state report-filter-empty-state">
                <strong>没有匹配当前筛选条件的报告</strong>
                <span>报告仍然保留在本地，只是被目标、格式或时间筛选暂时隐藏了。</span>
                <button className="secondary-btn" onClick={resetReportFilters} type="button">
                  清空筛选并显示全部报告
                </button>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="报告预览"
          copy="优先展示可读报告内容，文件路径和格式信息放在辅助区域。"
          aside={
            <div className="report-preview-actions">
              <button className="text-btn inline-text-btn" disabled={!previewContent} onClick={handleDownload} type="button">
                导出副本
              </button>
              <button className="text-btn inline-text-btn" disabled={!selectedReport?.path} onClick={handleOpenReportFile} type="button">
                打开原文件
              </button>
              <button className="text-btn inline-text-btn" disabled={!selectedReport?.path} onClick={() => void handleCopyPath()} type="button">
                复制路径
              </button>
              <button className="text-btn inline-text-btn" disabled={!selectedReport} onClick={() => setPreviewOpen(true)} type="button">
                放大阅读
              </button>
            </div>
          }
        >
          <ReportPreview content={previewContent} kind={previewKind} loading={previewLoading} />
        </SectionCard>
      </div>

      <ReportPreviewDialog
        open={previewOpen && Boolean(selectedReport)}
        title={selectedReport?.name ?? "报告预览"}
        path={selectedReport?.path}
        content={previewContent}
        kind={previewKind}
        loading={previewLoading}
        onDownload={handleDownload}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}

function reportMatchesFilters(
  report: ReportListItem,
  search: string,
  kindFilter: "all" | "markdown" | "html",
  dateFilter: "all" | "today" | "week",
): boolean {
  const keyword = search.trim().toLowerCase();
  const haystack = `${report.name} ${report.path}`.toLowerCase();
  if (keyword && !haystack.includes(keyword)) return false;
  if (kindFilter !== "all" && report.kind !== kindFilter) return false;
  return matchesDateFilter(report.modified_at, dateFilter);
}

function matchesDateFilter(value: string | undefined, filter: "all" | "today" | "week"): boolean {
  if (filter === "all") return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (filter === "today") {
    return date.toDateString() === now.toDateString();
  }
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return date.getTime() >= weekAgo;
}

function formatDate(value: string | undefined): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatSize(value: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
