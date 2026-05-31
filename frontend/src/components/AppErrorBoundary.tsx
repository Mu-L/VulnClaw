import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("VulnClaw Web UI crashed", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-fallback-page">
        <section className="app-fallback-card">
          <span className="pill">界面保护</span>
          <h1>VulnClaw 界面遇到问题</h1>
          <p>
            当前页面渲染时出现异常。已保存的目标状态、报告和任务记录不会因此删除，
            可以先刷新页面恢复界面，再从历史或报告中心继续查看结果。
          </p>
          <div className="app-fallback-actions">
            <button className="primary-btn" type="button" onClick={() => window.location.reload()}>
              刷新界面
            </button>
          </div>
          <details>
            <summary>查看技术错误</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </section>
      </main>
    );
  }
}
