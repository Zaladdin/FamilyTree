"use client";

type LifeState = { status: "living" | "deceased"; deathDate: string };

export function PersonLifeFields({ status, deathDate, onChange }: LifeState & { onChange: (state: LifeState) => void }) {
  return <div className="person-life-fields">
    <label className="person-life-toggle">
      <input type="checkbox" checked={status === "deceased"} onChange={(event) => onChange({ status: event.target.checked ? "deceased" : "living", deathDate: event.target.checked ? deathDate : "" })} />
      <span>Человек умер</span>
    </label>
    {status === "deceased" ? <label className="form-field">
      <span>Дата смерти</span>
      <input name="deathDate" placeholder="Год или ДД.ММ.ГГГГ" required value={deathDate} onChange={(event) => onChange({ status, deathDate: event.target.value })} />
    </label> : null}
  </div>;
}
