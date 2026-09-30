"use client";

import { useEffect, useRef } from "react";
import type { FamilyPerson, Story } from "@/lib/types";

export function PersonStories({ person, canEdit, onEdit, onDelete, onRestore, focusRevision = 0 }: {
  person: FamilyPerson;
  canEdit: boolean;
  onEdit?: (story: Story) => void;
  onDelete?: (story: Story) => void;
  onRestore?: (story: Story) => void;
  focusRevision?: number;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedRevision = useRef(focusRevision);
  useEffect(() => {
    if (focusRevision === lastFocusedRevision.current) return;
    lastFocusedRevision.current = focusRevision;
    headingRef.current?.focus();
  }, [focusRevision]);
  const stories = person.stories.filter((story) => !story.deletedAt);
  const deletedStories = canEdit ? person.deletedStories ?? [] : [];
  return <div className="story-section">
    <div className="media-header"><h3 ref={headingRef} tabIndex={-1}>Истории и легенды</h3><span>{stories.length}</span></div>
    <div className="story-list">
      {stories.length ? stories.map((story) => <article className="story-card" key={story.id}>
        <div className="story-card-header"><strong>{story.title}</strong>{story.narrator ? <small>{story.narrator}</small> : null}</div>
        <p className="user-text">{story.body}</p>
        {canEdit ? <div className="form-actions story-actions">
          {onEdit ? <button className="secondary-button" type="button" aria-label={`Редактировать историю: ${story.title}`} onClick={() => onEdit(story)}>Редактировать</button> : null}
          {onDelete ? <button className="ghost-button" type="button" aria-label={`Удалить историю: ${story.title}`} onClick={() => onDelete(story)}>Удалить</button> : null}
        </div> : null}
      </article>) : <div className="empty-media">Для этого человека текстовые истории еще не добавлены.</div>}
    </div>
    {deletedStories.length ? <details className="deleted-stories">
      <summary>Удалённые истории ({deletedStories.length})</summary>
      <div className="story-list">{deletedStories.map((story) => <article className="story-card" key={story.id}>
        <div className="story-card-header"><strong>{story.title}</strong>{story.narrator ? <small>{story.narrator}</small> : null}</div>
        <p className="user-text">{story.body}</p>
        {onRestore ? <div className="form-actions story-actions"><button className="secondary-button" type="button" aria-label={`Восстановить историю: ${story.title}`} onClick={() => onRestore(story)}>Восстановить</button></div> : null}
      </article>)}</div>
    </details> : null}
  </div>;
}
