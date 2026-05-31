import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rollbackTarget } from "../api/web";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SectionCard } from "../components/SectionCard";
import { useTargetDiffQuery, useTargetSnapshotsQuery, useTargetsQuery, useTasksQuery } from "../hooks/queries";
import { formatPhaseLabel, formatResumeStrategy, formatTaskCommand, formatTaskStatus, formatTaskTitle } from "../utils/taskLabels";

interface HistoryPageProps {
  selectedTarget: string | null;
  onSelectTarget: (target: string | null) => void;
  onOpenHome: () => void;
  onOpenReports: (target: string) => void;
  onOpenTarget: (target: string) => void;
}

function formatTime(value?: string): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function diffConclusion(diff: {
  added_findings: string[];
  updated_findings: string[];
  added_steps: string[];
  added_recon_assets: string[];
}): string {
  const total =
    diff.added_findings.length
    + diff.updated_findings.length
    + diff.added_steps.length
    + diff.added_recon_assets.length;
  if (diff.added_findings.length || diff.updated_findings.length) {
    return "风险内容发生变化，建议回到风险结果页复核影响范围。";
  }
  if (total > 0) return "检查过程有新增信息，但暂未看到风险项变化。";
  return "两次快照之间暂无明显新增内容。";
}

export function HistoryPage({ selectedTarget, onSelectTarget, onOpenHome, onOpenReports, onOpenTarget }: HistoryPageProps) {
  const queryClient = useQueryClient();
  const targetsQuery = useTargetsQuery();
  const tasksQuery = useTasksQuery();
  const [localTarget, setLocalTarget] = useState("");
  const [fromSnapshotId, setFromSnapshotId] = useState<string | null>(null);
  const [toSnapshotId, setToSnapshotId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySnapshot, setBusySnapshot] = useState<string | null>(null);
  const [pendingRollbackId, setPendingRollbackId] = useState<string | null>(null);

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
  const snapshotsQuery = useTargetSnapshotsQuery(targetValue);
  const diffQuery = useTargetDiffQuery(targetValue, fromSnapshotId, toSnapshotId);

  useEffect(() => {
    const snapshots = snapshotsQuery.data ?? [];
    if (snapshots.length >= 2) {
      setToSnapshotId((current) => current ?? snapshots[0].snapshot_id);
      setFromSnapshotId((current) => current ?? snapshots[1].snapshot_id);
    } else if (snapshots.length === 1) {
      setToSnapshotId(snapshots[0].snapshot_id);
      setFromSnapshotId(snapshots[0].snapshot_id);
    } else {
      setFromSnapshotId(null);
      setToSnapshotId(null);
    }
  }, [snapshotsQuery.data]);

  const targetTasks = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    return targetValue ? tasks.filter((task) => task.target === targetValue) : tasks;
  }, [tasksQuery.data, targetValue]);

  async function handleRollback(snapshotId: string) {
    if (!targetValue) return;
    try {
      setBusySnapshot(snapshotId);
      setError(null);
      setMessage(null);
      await rollbackTarget(targetValue, snapshotId);
      setMessage(`已恢复 ${targetValue} 到快照 ${snapshotId}`);
      await Promise.all([
        snapshotsQuery.refetch(),
        targetsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["target", targetValue] }),
        queryClient.invalidateQueries({ queryKey: ["target-preview", targetValue] }),
        queryClient.invalidateQueries({ queryKey: ["target-diff", targetValue] }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "快照恢复失败");
    } finally {
      setBusySnapshot(null);
    }
  }

  return (
    <section className="history-page">
      <SectionCard
        title="历史记录"
        copy="整合任务记录、目标状态和快照恢复。普通用户看时间线，高级用户再展开差异。"
        aside={<span className="status-badge">{targetTasks.length} 条任务</span>}
      >
        <label className="field">
          <span>目标</span>
          <select
            value={targetValue ?? ""}
            onChange={(event) => {
              const value = event.target.value || null;
              setLocalTarget(value ?? "");
              onSelectTarget(value);
              setMessage(null);
              setError(null);
            }}
          >
            <option value="">全部目标</option>
            {targetsQuery.data?.map((target) => (
              <option key={target.target} value={target.target}>
                {target.target}
              </option>
            ))}
          </select>
        </label>

        <div className="history-summary-grid">
          <article className="stat">
            <span className="stat-label">任务记录</span>
            <strong>{targetTasks.length}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">目标状态</span>
            <strong>{targetsQuery.data?.length ?? 0}</strong>
          </article>
          <article className="stat">
            <span className="stat-label">当前快照</span>
            <strong>{snapshotsQuery.data?.length ?? 0}</strong>
          </article>
        </div>

        {message && <div className="success-box">{message}</div>}
        {error && <div className="error-box">{error}</div>}
      </SectionCard>

      <div className="history-grid">
        <SectionCard title="测试记录" copy="最近通过 Web 后端任务管理器创建的检查。">
          <div className="list list-scroll history-list">
            {targetTasks.slice(0, 18).map((task) => (
              <article
                key={task.task_id}
                className="list-item history-task-item"
              >
                <strong>{formatTaskTitle(task.command, task.target)}</strong>
                <span>{formatTaskStatus(task.status)}</span>
                <span className="muted-inline">{formatPhaseLabel(task.latest_phase)}</span>
                <span className="muted-inline">{formatTime(task.created_at)}</span>
                <div className="button-row compact-row">
                  <button className="secondary-btn" type="button" onClick={() => onOpenTarget(task.target)}>
                    查看风险
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => onOpenReports(task.target)}>
                    查看报告
                  </button>
                </div>
              </article>
            ))}
            {!targetTasks.length && (
              <div className="empty-state history-empty-state">
                <strong>暂无任务记录</strong>
                <span>从首页开始一次授权安全检查后，任务时间线会自动汇总到这里。</span>
                <button className="secondary-btn" onClick={onOpenHome} type="button">
                  回首页开始检查
                </button>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="目标状态" copy="从目标状态继续查看风险结论，或直接进入报告中心生成交付物。">
          <div className="list list-scroll history-list">
            {targetsQuery.data?.slice(0, 18).map((target) => (
              <article
                key={target.target}
                className={`list-item ${targetValue === target.target ? "selected-item" : ""}`}
              >
                <strong>{target.target}</strong>
                <span>{target.verified_count} 已验证 / {target.pending_count} 待复核</span>
                <span className="muted-inline">{formatResumeStrategy(target.resume_strategy)}</span>
                <div className="button-row compact-row">
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => {
                      onSelectTarget(target.target);
                      onOpenTarget(target.target);
                    }}
                  >
                    查看风险
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => onOpenReports(target.target)}>
                    查看报告
                  </button>
                </div>
              </article>
            ))}
            {!targetsQuery.data?.length && (
              <div className="empty-state history-empty-state">
                <strong>暂无目标状态</strong>
                <span>输入授权目标并完成检查后，这里会显示风险结论、恢复建议和报告入口。</span>
                <button className="secondary-btn" onClick={onOpenHome} type="button">
                  去首页设置目标
                </button>
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="history-grid">
        <SectionCard title="快照恢复" copy="高级恢复能力默认放在历史页，不打扰首页检查流程。">
          <div className="list list-scroll history-list">
            {snapshotsQuery.data?.map((snapshot) => (
              <div key={snapshot.snapshot_id} className="list-item">
                <strong>{snapshot.snapshot_id}</strong>
                <span>{formatTaskCommand(snapshot.last_command)}</span>
                <span className="muted-inline">{formatTime(snapshot.last_saved_at)}</span>
                <span className="muted-inline">
                  已验证 {snapshot.verified_findings} / 待复核 {snapshot.pending_findings}
                </span>
                <div className="button-row compact-row">
                  <button
                    className="secondary-btn"
                    disabled={busySnapshot === snapshot.snapshot_id}
                    onClick={() => setPendingRollbackId(snapshot.snapshot_id)}
                    type="button"
                  >
                    {busySnapshot === snapshot.snapshot_id ? "恢复中..." : "恢复到此快照"}
                  </button>
                </div>
              </div>
            ))}
            {!snapshotsQuery.data?.length && (
              <div className="empty-state">{targetValue ? "该目标暂无快照。" : "请选择目标查看快照。"}</div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="快照差异" copy="用于判断两次检查之间新增了哪些发现、步骤和资产。">
          <div className="form-grid compact-form">
            <label className="field">
              <span>从快照</span>
              <select value={fromSnapshotId ?? ""} onChange={(event) => setFromSnapshotId(event.target.value || null)}>
                <option value="">选择</option>
                {snapshotsQuery.data?.map((snapshot) => (
                  <option key={`from-${snapshot.snapshot_id}`} value={snapshot.snapshot_id}>
                    {snapshot.snapshot_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>到快照</span>
              <select value={toSnapshotId ?? ""} onChange={(event) => setToSnapshotId(event.target.value || null)}>
                <option value="">当前状态</option>
                {snapshotsQuery.data?.map((snapshot) => (
                  <option key={`to-${snapshot.snapshot_id}`} value={snapshot.snapshot_id}>
                    {snapshot.snapshot_id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {diffQuery.data ? (
            <div className="list dense-list">
              <div className="history-diff-summary">
                <strong>{diffConclusion(diffQuery.data)}</strong>
                <div>
                  <span>新增风险 {diffQuery.data.added_findings.length}</span>
                  <span>更新风险 {diffQuery.data.updated_findings.length}</span>
                  <span>新增步骤 {diffQuery.data.added_steps.length}</span>
                  <span>新增资产 {diffQuery.data.added_recon_assets.length}</span>
                </div>
              </div>
              <div className="list-item">
                <strong>新增风险</strong>
                {diffQuery.data.added_findings.length ? diffQuery.data.added_findings.map((item) => <span key={item}>{item}</span>) : <span className="muted-inline">无</span>}
              </div>
              <div className="list-item">
                <strong>更新风险</strong>
                {diffQuery.data.updated_findings.length ? diffQuery.data.updated_findings.map((item) => <span key={item}>{item}</span>) : <span className="muted-inline">无</span>}
              </div>
              <div className="list-item">
                <strong>新增步骤</strong>
                {diffQuery.data.added_steps.length ? diffQuery.data.added_steps.map((item) => <span key={item}>{item}</span>) : <span className="muted-inline">无</span>}
              </div>
              <div className="list-item">
                <strong>新增资产</strong>
                {diffQuery.data.added_recon_assets.length ? diffQuery.data.added_recon_assets.map((item) => <span key={item}>{item}</span>) : <span className="muted-inline">无</span>}
              </div>
            </div>
          ) : (
            <div className="empty-state">{diffQuery.isLoading ? "正在加载差异..." : "请选择快照进行比较。"}</div>
          )}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={Boolean(pendingRollbackId)}
        title="恢复历史快照"
        copy="恢复快照会把当前目标状态切回所选时间点。这个动作不会删除报告文件，但可能影响后续风险结果展示。"
        tone="danger"
        confirmLabel="确认恢复"
        onCancel={() => setPendingRollbackId(null)}
        onConfirm={() => {
          const snapshotId = pendingRollbackId;
          setPendingRollbackId(null);
          if (snapshotId) void handleRollback(snapshotId);
        }}
      />
    </section>
  );
}
