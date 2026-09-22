"use client";

import { useId, useState, type ReactNode } from "react";

export function PasswordField({
  label,
  labelExtra,
  autoComplete,
  placeholder,
  value,
  onChange,
  disabled,
  required,
  minLength,
  error,
}: {
  label: string;
  labelExtra?: ReactNode;
  autoComplete: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  minLength?: number;
  error?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="auth-field">
      <div className="auth-field-label-row">
        <label htmlFor={id}>{label}</label>
        {labelExtra}
      </div>
      <div className="auth-input-wrap">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          disabled={disabled}
          aria-invalid={error || undefined}
          className="auth-input auth-input-with-toggle"
        />
        <button
          type="button"
          className="auth-input-toggle"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
