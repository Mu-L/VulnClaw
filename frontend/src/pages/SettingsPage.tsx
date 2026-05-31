import { useEffect, useMemo, useState } from "react";
import { updateConfig } from "../api/web";
import { SectionCard } from "../components/SectionCard";
import { useConfigQuery, useMcpDiagnosticsQuery } from "../hooks/queries";
import { formatActionLabel, formatActionList, formatMcpExecutionMode, formatMcpHealth } from "../utils/taskLabels";
import { loadUiPreferences, saveUiPreferences, type UiPreferences } from "../utils/preferences";
import { parseOptionalPort } from "../utils/validation";

type SettingsSection = "basic" | "ai" | "checks" | "boundary" | "data" | "python" | "diagnostics";

const SECTIONS: Array<{ key: SettingsSection; title: string; copy: string }> = [
  { key: "basic", title: "基础设置", copy: "语言、体验和常用偏好" },
  { key: "ai", title: "AI 模型", copy: "服务商、模型和接口地址" },
  { key: "checks", title: "检查策略", copy: "轮次和持续检查参数" },
  { key: "boundary", title: "安全边界默认值", copy: "首页检查向导会自动带出" },
  { key: "data", title: "报告与数据", copy: "输出目录和交付物位置" },
  { key: "python", title: "本地脚本辅助", copy: "受控脚本能力和执行审计" },
  { key: "diagnostics", title: "高级诊断", copy: "MCP 工具链状态" },
];

const ACTION_OPTIONS = [
  { value: "recon", copy: "信息收集和基础资产发现。" },
  { value: "scan", copy: "服务入口识别与风险发现。" },
  { value: "exploit", copy: "验证利用动作，需要明确授权。" },
  { value: "persistent", copy: "多轮持续检查能力。" },
  { value: "post_exploitation", copy: "后渗透动作，默认建议禁止。" },
];

const PYTHON_MODES = [
  {
    value: "safe",
    label: "安全模式",
    copy: "阻止文件 I/O、网络访问和系统调用，适合普通检查。",
  },
  {
    value: "lab",
    label: "靶场模式",
    copy: "适合受控靶场或 CTF 环境，允许更多本地分析能力。",
  },
  {
    value: "trusted-local",
    label: "可信本地模式",
    copy: "保留完整本地能力，只建议在明确授权和可信机器上使用。",
  },
];

interface SettingsPageProps {
  initialSection?: SettingsSection;
  onOpenAdvanced: () => void;
}

export function SettingsPage({ initialSection = "basic", onOpenAdvanced }: SettingsPageProps) {
  const configQuery = useConfigQuery();
  const mcpQuery = useMcpDiagnosticsQuery();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [maxRounds, setMaxRounds] = useState(15);
  const [persistentRounds, setPersistentRounds] = useState(100);
  const [persistentCycles, setPersistentCycles] = useState(10);
  const [showThinking, setShowThinking] = useState(false);
  const [pythonExecuteEnabled, setPythonExecuteEnabled] = useState(true);
  const [pythonExecuteMode, setPythonExecuteMode] = useState("trusted-local");
  const [pythonExecuteMaxLines, setPythonExecuteMaxLines] = useState(50);
  const [pythonExecuteAuditEnabled, setPythonExecuteAuditEnabled] = useState(true);
  const [language, setLanguage] = useState<UiPreferences["language"]>("zh-CN");
  const [defaultCheckMode, setDefaultCheckMode] = useState<UiPreferences["defaultCheckMode"]>("standard");
  const [reportFormat, setReportFormat] = useState<UiPreferences["reportFormat"]>("markdown");
  const [showTechnicalLogs, setShowTechnicalLogs] = useState(false);
  const [defaultOnlyPort, setDefaultOnlyPort] = useState("");
  const [defaultOnlyHost, setDefaultOnlyHost] = useState("");
  const [defaultOnlyPath, setDefaultOnlyPath] = useState("");
  const [defaultBlockedHost, setDefaultBlockedHost] = useState("");
  const [defaultBlockedPath, setDefaultBlockedPath] = useState("");
  const [defaultAllowActions, setDefaultAllowActions] = useState<string[]>([]);
  const [defaultBlockActions, setDefaultBlockActions] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const preferences = loadUiPreferences();
    setLanguage(preferences.language);
    setDefaultCheckMode(preferences.defaultCheckMode);
    setReportFormat(preferences.reportFormat);
    setShowTechnicalLogs(preferences.showTechnicalLogs);
    setDefaultOnlyPort(preferences.defaultBoundary.onlyPort);
    setDefaultOnlyHost(preferences.defaultBoundary.onlyHost);
    setDefaultOnlyPath(preferences.defaultBoundary.onlyPath);
    setDefaultBlockedHost(preferences.defaultBoundary.blockedHost);
    setDefaultBlockedPath(preferences.defaultBoundary.blockedPath);
    setDefaultAllowActions(preferences.defaultBoundary.allowActions);
    setDefaultBlockActions(preferences.defaultBoundary.blockActions);
  }, []);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (!configQuery.data) return;
    setProvider(configQuery.data.provider);
    setModel(configQuery.data.model);
    setBaseUrl(configQuery.data.base_url);
    setOutputDir(configQuery.data.output_dir);
    setMaxRounds(configQuery.data.max_rounds);
    setPersistentRounds(configQuery.data.persistent_rounds_per_cycle);
    setPersistentCycles(configQuery.data.persistent_max_cycles);
    setShowThinking(configQuery.data.show_thinking);
    setPythonExecuteEnabled(configQuery.data.python_execute_enabled);
    setPythonExecuteMode(configQuery.data.python_execute_mode);
    setPythonExecuteMaxLines(configQuery.data.python_execute_max_lines);
    setPythonExecuteAuditEnabled(configQuery.data.python_execute_audit_enabled);
  }, [configQuery.data]);

  const activeMeta = useMemo(() => SECTIONS.find((section) => section.key === activeSection) ?? SECTIONS[0], [activeSection]);
  const saveButtonLabel = activeSection === "basic"
    ? "保存偏好"
    : activeSection === "boundary"
      ? "保存默认边界"
      : "保存设置";

  function saveLocalPreferences() {
    saveUiPreferences({
      language,
      defaultCheckMode,
      reportFormat,
      showTechnicalLogs,
      defaultBoundary: {
        onlyPort: defaultOnlyPort,
        onlyHost: defaultOnlyHost,
        onlyPath: defaultOnlyPath,
        blockedHost: defaultBlockedHost,
        blockedPath: defaultBlockedPath,
        allowActions: defaultAllowActions,
        blockActions: defaultBlockActions,
      },
    });
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      setStatus(null);

      if (activeSection === "basic" || activeSection === "boundary") {
        if (activeSection === "boundary") parseOptionalPort(defaultOnlyPort);
        saveLocalPreferences();
        setStatus(activeSection === "boundary" ? "安全边界默认值已保存" : "界面偏好已保存");
        return;
      }

      await updateConfig({
        provider,
        model,
        base_url: baseUrl,
        output_dir: outputDir,
        max_rounds: maxRounds,
        persistent_rounds_per_cycle: persistentRounds,
        persistent_max_cycles: persistentCycles,
        show_thinking: showThinking,
        python_execute_enabled: pythonExecuteEnabled,
        python_execute_mode: pythonExecuteMode,
        python_execute_max_lines: pythonExecuteMaxLines,
        python_execute_audit_enabled: pythonExecuteAuditEnabled,
      });
      await configQuery.refetch();
      setStatus("设置已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleDefaultAction(
    value: string,
    selected: string[],
    setSelected: (next: string[]) => void,
    oppositeSelected: string[],
    setOppositeSelected: (next: string[]) => void,
  ) {
    const isSelected = selected.includes(value);
    setSelected(isSelected ? selected.filter((item) => item !== value) : [...selected, value]);
    if (!isSelected) setOppositeSelected(oppositeSelected.filter((item) => item !== value));
  }

  return (
    <section className="settings-page">
      <aside className="settings-nav">
        {SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`settings-nav-item ${activeSection === section.key ? "active" : ""}`}
            onClick={() => setActiveSection(section.key)}
          >
            <strong>{section.title}</strong>
            <span>{section.copy}</span>
          </button>
        ))}
      </aside>

      <div className="settings-content">
        <SectionCard
          title={activeMeta.title}
          copy={activeMeta.copy}
          aside={<span className="status-badge">{configQuery.data?.api_key_configured ? "API Key 已配置" : "未配置 API Key"}</span>}
        >
          {activeSection === "basic" && (
            <div className="form-grid">
              <label className="field">
                <span>界面语言</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as UiPreferences["language"])}>
                  <option value="zh-CN">简体中文（当前完整支持）</option>
                  <option value="en-US">English（本地化预留）</option>
                </select>
                <small>
                  当前版本的 Web 界面以简体中文为主；选择 English 会先保存偏好，完整英文文案将在后续本地化中启用。
                </small>
              </label>
              <label className="field">
                <span>默认检查模式</span>
                <select value={defaultCheckMode} onChange={(event) => setDefaultCheckMode(event.target.value as UiPreferences["defaultCheckMode"])}>
                  <option value="quick">快速摸底</option>
                  <option value="standard">标准检查</option>
                  <option value="deep">深度验证</option>
                  <option value="continuous">持续检查</option>
                </select>
              </label>
              <label className="field">
                <span>默认报告格式</span>
                <select value={reportFormat} onChange={(event) => setReportFormat(event.target.value as UiPreferences["reportFormat"])}>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                </select>
              </label>
              <label className="check-row">
                <input checked={showTechnicalLogs} onChange={(event) => setShowTechnicalLogs(event.target.checked)} type="checkbox" />
                <span>默认显示技术日志入口</span>
              </label>
              <div className="inline-panel field-wide">
                <strong>说明</strong>
                <p className="inline-note">
                  这些 ToC 界面偏好保存在当前浏览器本地；AI、轮次、Python 执行等运行配置仍保存到 VulnClaw 后端配置。
                </p>
              </div>
            </div>
          )}

          {activeSection === "ai" && (
            <div className="form-grid">
              <label className="field">
                <span>模型服务商</span>
                <input value={provider} onChange={(event) => setProvider(event.target.value)} />
                <small>对应后端 provider，例如 openai。</small>
              </label>
              <label className="field">
                <span>模型名称</span>
                <input value={model} onChange={(event) => setModel(event.target.value)} />
                <small>例如 gpt-5.1、gpt-5.5 或你的兼容模型名。</small>
              </label>
              <label className="field field-wide">
                <span>接口地址</span>
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                <small>兼容 OpenAI API 的 Base URL；留空时使用后端默认配置。</small>
              </label>
            </div>
          )}

          {activeSection === "checks" && (
            <div className="form-grid">
              <label className="field">
                <span>最大轮次</span>
                <input type="number" value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>持续检查每周期轮次</span>
                <input type="number" value={persistentRounds} onChange={(event) => setPersistentRounds(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>持续检查最大周期</span>
                <input type="number" value={persistentCycles} onChange={(event) => setPersistentCycles(Number(event.target.value))} />
              </label>
              <label className="check-row field-wide">
                <input checked={showThinking} onChange={(event) => setShowThinking(event.target.checked)} type="checkbox" />
                <span>显示 AI 思考输出</span>
              </label>
              <div className="inline-panel field-wide">
                <strong>工具链概览</strong>
                <p className="inline-note">
                  普通检查会自动使用可用工具链；如需查看每个 MCP 服务的错误和调用统计，可进入高级诊断。
                </p>
              </div>
              <article className="stat">
                <span className="stat-label">MCP 服务</span>
                <strong>{mcpQuery.data?.total_services ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">可执行服务</span>
                <strong>{mcpQuery.data?.running_services ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">工具数量</span>
                <strong>{mcpQuery.data?.tool_count ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">nmap 可用性</span>
                <strong>随运行环境检测</strong>
              </article>
              <div className="inline-panel field-wide">
                <strong>保存说明</strong>
                <p className="inline-note">
                  检查策略会写入 VulnClaw 后端配置，影响后续任务运行；界面偏好和安全边界默认值则保存在当前浏览器本地。
                </p>
              </div>
            </div>
          )}

          {activeSection === "boundary" && (
            <div className="form-grid">
              <label className="field">
                <span>默认仅测端口</span>
                <input value={defaultOnlyPort} onChange={(event) => setDefaultOnlyPort(event.target.value)} inputMode="numeric" placeholder="例如 443" />
                <small>留空表示每次检查时由首页手动填写。</small>
              </label>
              <label className="field">
                <span>默认仅测主机</span>
                <input value={defaultOnlyHost} onChange={(event) => setDefaultOnlyHost(event.target.value)} placeholder="example.com" />
              </label>
              <label className="field field-wide">
                <span>默认仅测路径</span>
                <input value={defaultOnlyPath} onChange={(event) => setDefaultOnlyPath(event.target.value)} placeholder="/admin" />
              </label>
              <label className="field">
                <span>默认排除主机</span>
                <input value={defaultBlockedHost} onChange={(event) => setDefaultBlockedHost(event.target.value)} placeholder="staging.example.com" />
              </label>
              <label className="field">
                <span>默认排除路径</span>
                <input value={defaultBlockedPath} onChange={(event) => setDefaultBlockedPath(event.target.value)} placeholder="/internal" />
              </label>
              <div className="field field-wide">
                <span>默认允许动作</span>
                <div className="action-choice-grid">
                  {ACTION_OPTIONS.map((action) => (
                    <button
                      key={`settings-allow-${action.value}`}
                      type="button"
                      className={`action-choice ${defaultAllowActions.includes(action.value) ? "selected-item" : ""}`}
                      onClick={() => toggleDefaultAction(action.value, defaultAllowActions, setDefaultAllowActions, defaultBlockActions, setDefaultBlockActions)}
                    >
                      <strong>{formatActionLabel(action.value)}</strong>
                      <span>{action.copy}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field field-wide">
                <span>默认禁止动作</span>
                <div className="action-choice-grid">
                  {ACTION_OPTIONS.map((action) => (
                    <button
                      key={`settings-block-${action.value}`}
                      type="button"
                      className={`action-choice action-choice-block ${defaultBlockActions.includes(action.value) ? "selected-item" : ""}`}
                      onClick={() => toggleDefaultAction(action.value, defaultBlockActions, setDefaultBlockActions, defaultAllowActions, setDefaultAllowActions)}
                    >
                      <strong>{formatActionLabel(action.value)}</strong>
                      <span>{action.copy}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="scope-summary field-wide">
                <strong>首页会默认允许</strong>
                <span>{formatActionList(defaultAllowActions)}</span>
                <strong>首页会默认禁止</strong>
                <span>{formatActionList(defaultBlockActions)}</span>
              </div>
              <div className="inline-panel field-wide">
                <strong>为什么放在设置里</strong>
                <p className="inline-note">
                  如果你经常只测试同一个端口、主机或路径，可以在这里固化默认边界。首页仍然允许临时调整，但不会让授权范围只依赖一次性输入。
                </p>
              </div>
            </div>
          )}

          {activeSection === "data" && (
            <div className="form-grid">
              <label className="field field-wide">
                <span>输出目录</span>
                <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
              </label>
              <div className="inline-panel field-wide">
                <strong>报告默认位置</strong>
                <p className="inline-note">未显式指定时，报告由后端保存到 VulnClaw 用户配置目录的 sessions/report 文件中。</p>
              </div>
            </div>
          )}

          {activeSection === "python" && (
            <div className="form-grid">
              <label className="check-row">
                <input checked={pythonExecuteEnabled} onChange={(event) => setPythonExecuteEnabled(event.target.checked)} type="checkbox" />
                <span>启用本地脚本辅助</span>
              </label>
              <label className="check-row">
                <input checked={pythonExecuteAuditEnabled} onChange={(event) => setPythonExecuteAuditEnabled(event.target.checked)} type="checkbox" />
                <span>记录本地脚本执行审计</span>
              </label>
              <div className="field field-wide">
                <span>执行保护级别</span>
                <div className="mode-grid settings-mode-grid">
                  {PYTHON_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      className={`mode-card settings-mode-card ${pythonExecuteMode === mode.value ? "selected-item" : ""}`}
                      onClick={() => setPythonExecuteMode(mode.value)}
                    >
                      <strong>{mode.label}</strong>
                      <span>{mode.copy}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>最大输出行数</span>
                <input type="number" value={pythonExecuteMaxLines} onChange={(event) => setPythonExecuteMaxLines(Number(event.target.value))} />
              </label>
              <div className="inline-panel field-wide">
                <strong>安全说明</strong>
                <p className="inline-note">
                  这里控制的是高级脚本辅助能力。普通网站自测建议保持“安全模式”；只有在靶场、CTF 或可信本机授权环境中，才建议切换到更开放的模式。
                </p>
              </div>
            </div>
          )}

          {activeSection === "diagnostics" && (
            <div className="diagnostics-grid">
              <div className="inline-panel field-wide">
                <strong>需要原始任务参数或实时事件？</strong>
                <p className="inline-note">
                  普通检查流程会隐藏开发者控制台；排查任务、SSE 事件或约束参数时，可以进入高级任务控制台。
                </p>
                <button className="secondary-btn" onClick={onOpenAdvanced} type="button">
                  打开高级任务控制台
                </button>
              </div>
              <article className="stat">
                <span className="stat-label">MCP 服务</span>
                <strong>{mcpQuery.data?.total_services ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">运行中</span>
                <strong>{mcpQuery.data?.running_services ?? 0}</strong>
              </article>
              <article className="stat">
                <span className="stat-label">工具数</span>
                <strong>{mcpQuery.data?.tool_count ?? 0}</strong>
              </article>
              <div className="list list-scroll diagnostics-list">
                {mcpQuery.data?.services.map((service) => (
                  <div key={service.name} className="list-item">
                    <strong>{service.name}</strong>
                    <span>状态: {formatMcpHealth(service.health_status)} · 运行方式: {formatMcpExecutionMode(service.execution_mode)} · 工具数: {service.tool_count}</span>
                    <span className="muted-inline">
                      调用 {service.call_count} 次 · 成功 {service.success_count} 次 · 失败 {service.failure_count} 次
                    </span>
                    {service.error && <span className="danger-inline">{service.error}</span>}
                  </div>
                ))}
                {!mcpQuery.data?.services.length && <div className="empty-state">暂无 MCP 诊断数据。</div>}
              </div>
            </div>
          )}

          <div className="button-row">
            <button className="primary-btn" disabled={saving || activeSection === "diagnostics"} onClick={handleSave} type="button">
              {saving ? "保存中..." : saveButtonLabel}
            </button>
          </div>

          {status && <div className="success-box">{status}</div>}
          {error && <div className="error-box">{error}</div>}
        </SectionCard>
      </div>
    </section>
  );
}
