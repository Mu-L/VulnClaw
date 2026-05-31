import { useEffect, useRef } from "react";

interface ReportPreviewDialogProps {
  open: boolean;
  title: string;
  path?: string;
  content?: string;
  kind?: string;
  loading: boolean;
  onDownload?: () => void;
  onClose: () => void;
}

interface ReportPreviewProps {
  content?: string;
  kind?: string;
  loading: boolean;
  expanded?: boolean;
}

export function ReportPreviewDialog({ open, title, path, content, kind, loading, onDownload, onClose }: ReportPreviewDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="report-dialog-header">
          <div>
            <span className="dialog-kicker">报告预览</span>
            <h3 id="report-preview-title">{title}</h3>
            {path && <p>{path}</p>}
          </div>
          <div className="report-dialog-actions">
            <button className="secondary-btn" disabled={!content || !onDownload} type="button" onClick={onDownload}>
              下载
            </button>
            <button ref={closeButtonRef} className="secondary-btn" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <ReportPreview content={content} kind={kind} loading={loading} expanded />
      </section>
    </div>
  );
}

export function ReportPreview({ content, kind, loading, expanded = false }: ReportPreviewProps) {
  return (
    <div className={`report-preview ${expanded ? "report-preview-expanded" : ""}`}>
      {content ? (
        kind === "html" ? (
          <iframe className="report-frame" sandbox="" srcDoc={content} title="HTML 报告预览" />
        ) : (
          <pre>{content}</pre>
        )
      ) : loading ? (
        <div className="empty-state">正在加载报告预览...</div>
      ) : (
        <div className="empty-state">选择一份报告进行预览。</div>
      )}
    </div>
  );
}
