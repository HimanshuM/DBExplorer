import { useEffect, useMemo, useState } from "react";

export type Option = {
  value: string;
  label: string;
};

type SelectProps = {
  options: Option[];
  value: string;
  disabled?: boolean;
  emptyLabel?: string;
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
};

export function Select({
  options,
  value,
  disabled = false,
  emptyLabel = 'Select',
  ariaLabel,
  className,
  onChange,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const selectedLabel = selectedOption?.label || emptyLabel;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  function selectValue(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div
      className={className ? `connection-menu ${className}` : 'connection-menu'}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="connection-menu-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !disabled) {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span>{selectedLabel}</span>
        <span className="connection-menu-chevron">⌄</span>
      </button>
      {open && (
        <div className="connection-menu-list" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                className={selected ? 'connection-menu-option selected' : 'connection-menu-option'}
                role="option"
                aria-selected={selected}
                onClick={() => selectValue(option.value)}
              >
                <span>{option.label}</span>
                {selected && <span className="connection-menu-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
