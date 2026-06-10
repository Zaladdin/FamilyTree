const previewMembers = [
  { name: "Магомед", years: "1932-2004", className: "node-top-left" },
  { name: "Залиха", years: "1938-2011", className: "node-top-right" },
  { name: "Ахмед", years: "1964-", className: "node-center-left" },
  { name: "Амина", years: "1967-", className: "node-center-right" },
  { name: "Тимур", years: "1991-", className: "node-bottom-left" },
  { name: "Лейла", years: "2026-", className: "node-bottom-right" },
];

export function HeroTree() {
  return (
    <section className="hero-visual" aria-label="Предпросмотр дерева семьи">
      <div className="auth-card">
        <div className="eyebrow">Вход в семью</div>
        <h2>Семья Ахмедовых</h2>
        <p>Войдите в архив рода, чтобы добавить фото, истории и новые ветви.</p>
        <div className="auth-fields">
          <div>email@example.com</div>
          <div>Пароль</div>
        </div>
      </div>

      <div className="tree-preview">
        <div className="tree-lines tree-line-vertical" />
        <div className="tree-lines tree-line-horizontal" />
        {previewMembers.map((member) => (
          <article className={`tree-node ${member.className}`} key={member.name}>
            <strong>{member.name}</strong>
            <span>{member.years}</span>
          </article>
        ))}
      </div>

      <article className="memory-card">
        <div className="eyebrow">Голос памяти</div>
        <h3>История прадеда Магомеда</h3>
        <p>
          Когда открывают карточку человека, можно услышать рассказ семьи о его
          жизни, характере и событиях того времени.
        </p>
        <div className="audio-bar">
          <span className="audio-dot" />
          <span>00:42 / 03:18</span>
        </div>
      </article>
    </section>
  );
}
