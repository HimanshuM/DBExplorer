import { X } from 'lucide-react';

type ClearableInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  onEnter?: () => void;
};

export function ClearableInput({
  value,
  onChange,
  placeholder = '',
  ariaLabel,
  title,
  disabled = false,
  className = '',
  inputClassName = '',
  onEnter,
}: ClearableInputProps) {
  return (
    <div className={`clearable-input ${className}`.trim()}>
      <input
        type="text"
        className={`clearable-input-field ${inputClassName}`.trim()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !disabled) {
            onEnter?.();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
      />
      <button
        type="button"
        className="clearable-input-button"
        onClick={() => onChange('')}
        disabled={disabled || value.length === 0}
        aria-label={`Clear ${ariaLabel}`}
        title="Clear"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
