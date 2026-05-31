import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "./components/AppShell";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ToastHost, type ToastItem, type ToastTone } from "./components/ToastHost";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { ReportsPage } from "./pages/ReportsPage";
import { RiskResultsPage } from "./pages/RiskResultsPage";
import { SafetyBoundaryPage } from "./pages/SafetyBoundaryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskConsolePage } from "./pages/TaskConsolePage";
import { createTask, openTaskStream, stopTask } from "./api/web";
import { useConfigQuery } from "./hooks/queries";
import type { TaskCommand, TaskEvent, TaskOptions, TaskRecord, TaskSummary } from "./types/api";
import { formatTaskTitle } from "./utils/taskLabels";

type AppView = "home" | "risk" | "reports" | "boundary" | "history" | "settings" | "advanced";
type SettingsSection = "basic" | "ai" | "checks" | "boundary" | "data" | "python" | "diagnostics";
interface ReportFocus {
  target: string | null;
  path?: string;
  openPreview?: boolean;
}

const VIEW_META: Record<AppView, { eyebrow: string; title: string; copy: string }> = {
  home: {
    eyebrow: "授权安全检查",
    title: "首页",
    copy: "输入授权目标、确认测试范围，然后启动一次受控检查。",
  },
  risk: {
    eyebrow: "结果与证据",
    title: "风险结果",
    copy: "查看检查结论、已验证风险、待复核线索和下一步建议。",
  },
  reports: {
    eyebrow: "可读交付物",
    title: "报告",
    copy: "生成并预览 Markdown / HTML 安全测试报告。",
  },
  boundary: {
    eyebrow: "授权范围保护",
    title: "安全边界",
    copy: "查看当前测试范围、越界拦截和规则来源记录。",
  },
  history: {
    eyebrow: "过程回溯",
    title: "历史",
    copy: "查看目标快照、状态变化和可恢复检查记录。",
  },
  settings: {
    eyebrow: "偏好与连接",
    title: "设置",
    copy: "配置 AI 模型、工具链和运行偏好。",
  },
  advanced: {
    eyebrow: "高级诊断",
    title: "任务控制台",
    copy: "保留原始任务参数、实时事件和调试入口，方便高级用户排查。",
  },
};

const HASH_TO_VIEW: Record<string, AppView> = {
  home: "home",
  risk: "risk",
  reports: "reports",
  boundary: "boundary",
  history: "history",
  settings: "settings",
  advanced: "advanced",
};

function viewFromHash(): AppView {
  const key = window.location.hash.replace(/^#/, "");
  return HASH_TO_VIEW[key] ?? "home";
}

function viewHash(view: AppView): string {
  return view;
}

export function App() {
  const configQuery = useConfigQuery();
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<AppView>(() => viewFromHash());
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [reportFocus, setReportFocus] = useState<ReportFocus | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("basic");
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const nav = useMemo(
    () => [
      { key: "home" as const, label: "首页", description: "开始安全检查", icon: "◇" },
      { key: "risk" as const, label: "风险结果", description: "证据与建议", icon: "!" },
      { key: "reports" as const, label: "报告", description: "预览与导出", icon: "□" },
      { key: "boundary" as const, label: "安全边界", description: "范围与拦截", icon: "◎" },
      { key: "history" as const, label: "历史", description: "快照与回溯", icon: "↺" },
      { key: "settings" as const, label: "设置", description: "模型与工具链", icon: "⚙" },
    ],
    [],
  );

  const latestEvent = taskEvents.length > 0 ? taskEvents[taskEvents.length - 1] : null;

  useEffect(() => {
    function handleHashChange() {
      setActiveView(viewFromHash());
    }
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigateToView(view: AppView) {
    const nextHash = viewHash(view);
    if (window.location.hash !== `#${nextHash}`) {
      window.location.hash = nextHash;
    }
    setActiveView(view);
  }

  function eventSummary(event: TaskEvent): TaskSummary | null {
    const summary = event.payload.summary;
    return summary && typeof summary === "object" ? summary as TaskSummary : null;
  }

  function pushToast(
    tone: ToastTone,
    title: string,
    copy?: string,
    action?: Pick<ToastItem, "actionLabel" | "onAction">,
  ) {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, tone, title, copy, ...action }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4800);
  }

  function refreshTaskData(target: string | null | undefined) {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["targets"] });
    void queryClient.invalidateQueries({ queryKey: ["constraint-audit"] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    if (target) {
      void queryClient.invalidateQueries({ queryKey: ["target", target] });
      void queryClient.invalidateQueries({ queryKey: ["target-preview", target] });
      void queryClient.invalidateQueries({ queryKey: ["target-snapshots", target] });
    }
  }

  useEffect(() => {
    if (!activeTask) return;
    const source = openTaskStream(activeTask.task_id, (event) => {
      setTaskEvents((prev) => [...prev.slice(-79), event]);
      if (event.event === "task_completed") {
        const summary = eventSummary(event);
        setActiveTask((prev) => prev && prev.task_id === event.task_id ? { ...prev, status: "completed", summary: summary ?? prev.summary } : prev);
        refreshTaskData(summary?.target ?? activeTask.target);
        pushToast(
          "success",
          "安全检查已完成",
          "可以查看风险结果或生成报告。",
          {
            actionLabel: "查看风险结果",
            onAction: () => {
              setSelectedTarget(summary?.target ?? activeTask.target);
              navigateToView("risk");
            },
          },
        );
      }
      if (event.event === "task_failed") {
        setActiveTask((prev) => prev && prev.task_id === event.task_id ? { ...prev, status: "failed" } : prev);
        refreshTaskData(activeTask.target);
        pushToast(
          "error",
          "安全检查失败",
          String(event.payload.message ?? event.payload.error ?? "请在高级控制台查看技术日志。"),
          {
            actionLabel: "查看技术日志",
            onAction: () => navigateToView("advanced"),
          },
        );
      }
      if (event.event === "task_stopped") {
        setActiveTask((prev) => prev && prev.task_id === event.task_id ? { ...prev, status: "stopped" } : prev);
        refreshTaskData(activeTask.target);
        pushToast("info", "安全检查已停止", "已保存的状态和报告不会被删除。");
      }
    });
    return () => source.close();
  }, [activeTask?.task_id]);

  async function handleCreateTask(command: TaskCommand, target: string, resume: boolean, options: TaskOptions): Promise<TaskRecord> {
    const task = await createTask(command, target, resume, options);
    setActiveTask(task);
    setSelectedTarget(task.target);
    setTaskEvents([]);
    pushToast("success", "安全检查已启动", formatTaskTitle(task.command, task.target));
    return task;
  }

  async function handleStopTask() {
    if (!activeTask) return;
    await stopTask(activeTask.task_id);
    setActiveTask((prev) => prev ? { ...prev, status: "stopped" } : prev);
    refreshTaskData(activeTask.target);
    pushToast("info", "停止请求已发送", "VulnClaw 正在结束当前任务。");
  }

  function openBoundaryForActiveTask() {
    if (activeTask?.target) {
      setSelectedTarget(activeTask.target);
    }
    navigateToView("boundary");
  }

  function openReports(target: string | null = selectedTarget, path?: string, openPreview = false) {
    if (target) {
      setSelectedTarget(target);
    }
    setReportFocus({ target, path, openPreview });
    navigateToView("reports");
  }

  function openSettings(section: SettingsSection = "basic") {
    setSettingsSection(section);
    navigateToView("settings");
  }

  function handleSelectView(view: AppView) {
    if (view === "settings") {
      setSettingsSection("basic");
    }
    navigateToView(view);
  }

  return (
    <AppShell
      activeView={activeView}
      activeNavView={activeView === "advanced" ? "settings" : activeView}
      nav={nav}
      meta={VIEW_META[activeView]}
      backendUnavailable={configQuery.isError}
      backendError={configQuery.error instanceof Error ? configQuery.error.message : undefined}
      onRetryBackend={() => void configQuery.refetch()}
      selectedTarget={selectedTarget}
      activeTask={activeTask}
      latestEvent={latestEvent}
      onSelectView={handleSelectView}
      onOpenAdvanced={() => navigateToView("advanced")}
      onOpenBoundary={openBoundaryForActiveTask}
      onOpenReports={() => openReports()}
      onOpenTarget={(target) => {
        setSelectedTarget(target);
        navigateToView("risk");
      }}
      onStopTask={() => setStopConfirmOpen(true)}
    >
      {activeView === "home" && (
        <HomePage
          selectedTarget={selectedTarget}
          activeTask={activeTask}
          latestEvent={latestEvent}
          taskEvents={taskEvents}
          onCreateTask={handleCreateTask}
          onOpenRisk={() => navigateToView("risk")}
          onOpenReports={() => openReports(activeTask?.target ?? selectedTarget)}
          onOpenBoundary={openBoundaryForActiveTask}
        />
      )}

      {activeView === "risk" && (
        <RiskResultsPage
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          onOpenHome={() => navigateToView("home")}
          onOpenReports={(path) => openReports(selectedTarget, path, Boolean(path))}
          onOpenBoundary={openBoundaryForActiveTask}
        />
      )}

      {activeView === "reports" && (
        <ReportsPage selectedTarget={selectedTarget} focus={reportFocus} />
      )}

      {activeView === "boundary" && (
        <SafetyBoundaryPage
          selectedTarget={selectedTarget}
          activeTask={activeTask}
          onOpenHome={() => navigateToView("home")}
          onOpenSettings={() => openSettings("boundary")}
          onSelectTarget={setSelectedTarget}
        />
      )}

      {activeView === "history" && (
        <HistoryPage
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          onOpenHome={() => navigateToView("home")}
          onOpenReports={(target) => {
            openReports(target);
          }}
          onOpenTarget={(target) => {
            setSelectedTarget(target);
            navigateToView("risk");
          }}
        />
      )}

      {activeView === "settings" && (
        <SettingsPage initialSection={settingsSection} onOpenAdvanced={() => navigateToView("advanced")} />
      )}

      {activeView === "advanced" && (
        <TaskConsolePage
          activeTask={activeTask}
          events={taskEvents}
          onTaskCreated={(task) => {
            setActiveTask(task);
            setSelectedTarget(task.target);
            setTaskEvents([]);
            navigateToView("advanced");
          }}
          onEvent={(event) => {
            setTaskEvents((prev) => [...prev.slice(-79), event]);
          }}
          onFocusTarget={(target) => {
            setSelectedTarget(target);
            navigateToView("risk");
          }}
        />
      )}

      <ConfirmDialog
        open={stopConfirmOpen}
        title="停止当前安全检查"
        copy="停止后当前任务不会继续执行，已经保存的目标状态和报告不会被删除。确认要停止吗？"
        tone="danger"
        confirmLabel="停止任务"
        onCancel={() => setStopConfirmOpen(false)}
        onConfirm={() => {
          setStopConfirmOpen(false);
          void handleStopTask();
        }}
      />
      <ToastHost toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))} />
    </AppShell>
  );
}
