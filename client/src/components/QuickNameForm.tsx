import { useState, type FormEvent } from "react";
import { Field, Sheet } from "./ui";

/**
 * A small sheet that asks for one name (new person, company or category) and saves it.
 * Replaces browser prompt dialogs, which installed apps on phones do not always show.
 */
export function QuickNameForm({
  title,
  label,
  placeholder,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  /** Saves the name; throws (or returns an error message) when it fails. */
  onSave: (name: string) => Promise<void | string>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError("");
    try {
      const msg = await onSave(n);
      if (msg) setError(msg);
      else onClose();
    } catch (err) {
      setError((err as Error).message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <Field label={label}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={80} required autoFocus />
        </Field>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
            Add
          </button>
        </div>
      </form>
    </Sheet>
  );
}
