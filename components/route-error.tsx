"use client";

import { useEffect, useId, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./route-state.module.css";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export function RouteError({ reset, family = false }: Pick<RouteErrorProps, "reset"> & { family?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  function retry() {
    startTransition(() => {
      // Refresh the Server Component payload as well as clearing the boundary.
      router.refresh();
      reset();
    });
  }

  return (
    <main className={styles.screen} aria-labelledby={titleId}>
      <section className={styles.card}>
        <Link className={styles.brand} href="/">Rodovo</Link>
        <div className={styles.symbol} aria-hidden="true">!</div>
        <h1 id={titleId} ref={titleRef} tabIndex={-1}>
          {family ? "Не удалось открыть семейный архив" : "Не удалось открыть страницу"}
        </h1>
        <p role="alert">
          Не получилось загрузить данные. Проверьте соединение и попробуйте снова.
        </p>
        <div className={styles.actions}>
          <button className="primary-button" type="button" disabled={isPending} onClick={retry}>
            {isPending ? "Пробуем снова…" : "Попробовать снова"}
          </button>
          <Link className="ghost-button" href="/families">К списку семей</Link>
        </div>
        <p className={styles.hint}>Если ошибка повторится, попробуйте открыть страницу позже.</p>
      </section>
    </main>
  );
}
