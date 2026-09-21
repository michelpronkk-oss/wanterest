"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  dark?: boolean;
  footer?: ReactNode;
  children: ReactNode;
};

export function Drawer({ open, onClose, title, dark = false, footer, children }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button className="ui-scrim" aria-label="Close panel" onClick={onClose} />
      <div className={`ui-drawer${dark ? " is-dark" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ui-drawer-header">
          <p className="ui-drawer-title">{title}</p>
          <button ref={closeButtonRef} className="ui-drawer-close" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ui-drawer-body">{children}</div>
        {footer ? <div className="ui-drawer-footer">{footer}</div> : null}
      </div>
    </>
  );
}
