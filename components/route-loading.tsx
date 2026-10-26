import styles from "./route-state.module.css";

export function RouteLoading({ family = false }: { family?: boolean }) {
  return (
    <main className={styles.screen} aria-label={family ? "Загрузка семейного архива" : "Загрузка страницы"}>
      <section className={styles.card}>
        <div className={styles.brand}>Rodovo</div>
        <h1>{family ? "Семейный архив" : "Открываем страницу"}</h1>
        <p role="status" aria-live="polite">
          {family ? "Загружаем семейный архив…" : "Загружаем страницу…"}
        </p>
        <div className={styles.skeleton} aria-hidden="true">
          <div className={styles.skeletonHeading} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonCards}>
            <div /><div /><div />
          </div>
        </div>
      </section>
    </main>
  );
}
