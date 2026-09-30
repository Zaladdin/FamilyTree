import Image from "next/image";

export function HeroTree() {
  return (
    <div className="landing-archive" aria-label="Иллюстрация семейного архива">
      <div className="landing-archive-backpage" aria-hidden="true">
        <span>Семейная книга</span>
        <span>Лица. Имена. Воспоминания.</span>
      </div>
      <figure className="landing-photo">
        <div className="landing-photo-image">
          <Image
            src="/images/family-memory.png"
            alt="Художественная иллюстрация: несколько поколений семьи на старой чёрно-белой фотографии"
            fill
            priority
            sizes="(max-width: 760px) 82vw, (max-width: 1100px) 43vw, 490px"
          />
        </div>
        <figcaption>
          <span>Одна семья. Целый мир.</span>
          <span className="landing-photo-index">№ 001</span>
        </figcaption>
      </figure>
      <svg className="landing-family-thread" viewBox="0 0 590 600" fill="none" aria-hidden="true">
        <path d="M566-15c-78 5-77 122-14 94C624 46 523 17 494 92c-21 55 48 123 38 219-8 86-127 87-221 113-88 24-39 89 31 56s-29-76-134-3C153 514 102 577-22 562" />
      </svg>
      <div className="landing-archive-note">
        <span className="landing-note-pin" aria-hidden="true" />
        <p>Мы — продолжение<br />тех, кого помним.</p>
        <span>Сохраните свою нить</span>
      </div>
      <span className="landing-image-disclaimer">Образ семейной памяти · иллюстрация</span>
    </div>
  );
}
