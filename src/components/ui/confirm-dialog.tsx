"use client";

type Props = {
  open: boolean;
  title: string;
  body: string;
  cancelLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Shared confirmation dialog, reusing the same scrim/panel pattern as ScanProgressModal. */
export function ConfirmDialog({ open, title, body, cancelLabel = "Cancel", confirmLabel, destructive = false, onCancel, onConfirm }: Props) {
  if (!open) return null;
  return (
    <div className="ui-modal-scrim" role="presentation" onClick={onCancel}>
      <div className="ui-modal ui-confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <p className="ui-confirm-dialog-title">{title}</p>
        <p className="ui-confirm-dialog-body">{body}</p>
        <div className="ui-confirm-dialog-actions">
          <button type="button" className="dashboard-button dashboard-button-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={`dashboard-button ${destructive ? "dashboard-button-quiet-destructive" : "dashboard-button-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
