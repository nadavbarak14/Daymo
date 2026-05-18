"use client";
export function SuggestionChips({ chips, onPick }: { chips: string[]; onPick: (chip: string) => void }) {
  if (chips.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.5rem 0" }}>
      {chips.map((c) => (
        <button key={c} onClick={() => onPick(c)} style={{
          padding: "0.5rem 0.75rem", borderRadius: "999px", border: "1px solid #ddd",
          background: "#fafafa", cursor: "pointer", fontSize: "0.875rem",
        }}>{c}</button>
      ))}
    </div>
  );
}
