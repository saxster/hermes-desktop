import { useState } from "react";

export function PillEditor({
  label,
  hint,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}): React.JSX.Element {
  const [input, setInput] = useState("");

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    const value = input.trim();
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setInput("");
  };

  return (
    <div className="settings-field">
      <label className="settings-field-label">{label}</label>
      {hint && (
        <div className="settings-field-hint inbox-settings-field-hint-mb6">
          {hint}
        </div>
      )}
      <div className="inbox-pill-input-container">
        {tags.map((tag, index) => (
          <span key={index} className="inbox-pill">
            {tag}
            <button
              type="button"
              className="inbox-pill-remove"
              onClick={() => onChange(tags.filter((_, item) => item !== index))}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          type="text"
          className="inbox-pill-input"
          placeholder={placeholder || "Type and press Enter..."}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
