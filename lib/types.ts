export type Gender = "male" | "female";

export type FamilyRole = "owner" | "admin" | "editor" | "member" | "guest";

export type RelationshipType = "parent" | "spouse" | "sibling";
export type MediaAssetType = "photo" | "audio";
export type AuditAction =
  | "person_created"
  | "person_updated"
  | "media_added"
  | "media_deleted"
  | "media_cleanup_failed"
  | "person_archived"
  | "person_restored"
  | "story_added"
  | "story_updated"
  | "story_deleted"
  | "story_restored"
  | "member_added"
  | "member_role_changed"
  | "member_removed"
  | "invitation_created"
  | "invitation_updated"
  | "invitation_revoked";

export type FamilyStats = {
  people: number;
  photos: number;
  audio: number;
  stories: number;
  contributors: number;
};

export type AudioMemory = {
  title: string;
  narrator: string;
  duration: string;
  summary: string;
};

export type PersonMedia = {
  photos: number;
  audio: number;
  documents: number;
};

export type MediaAsset = {
  id: string;
  type: MediaAssetType;
  title: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type Story = {
  id: string;
  version?: number;
  deletedAt?: string;
  title: string;
  body: string;
  narrator?: string;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  action: AuditAction;
  actorName: string;
  personId?: string;
  personName?: string;
  message: string;
  createdAt: string;
};

export type FamilyPerson = {
  id: string;
  // Persisted cards include a version; read-only synthetic data may omit it.
  version?: number;
  firstName: string;
  lastName: string;
  middleName?: string;
  gender: Gender;
  birthDate: string;
  deathDate?: string;
  birthPlace: string;
  status: "living" | "deceased";
  isArchived: boolean;
  biography: string;
  note?: string;
  timeline: string[];
  media: PersonMedia;
  mediaAssets: MediaAsset[];
  stories: Story[];
  deletedStories?: Story[];
  memory?: AudioMemory;
};

export type FamilyRelationship = {
  id?: string;
  version?: number;
  origin?: "manual" | "spouse" | "sibling";
  sourcePersonId?: string;
  fromPersonId: string;
  toPersonId: string;
  type: RelationshipType;
};

export type FamilyMembership = {
  name: string;
  role: FamilyRole;
};

export type FamilyMemberView = {
  membershipId: string;
  name: string;
  email: string | null;
  role: FamilyRole;
  isViewer: boolean;
  createdAt: string;
};

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  editor: "Редактор",
  member: "Участник",
  guest: "Гость",
};

export type UserFamilySummary = {
  id: string;
  slug: string;
  title: string;
  surname: string;
  description: string;
  region: string;
  role: FamilyRole;
  stats: FamilyStats;
  updatedAt: string;
};

export type DigitizationTask = {
  title: string;
  owner: string;
  status: "planned" | "in_progress" | "ready";
};

export type Family = {
  id: string;
  slug: string;
  title: string;
  surname: string;
  description: string;
  region: string;
  coverQuote: string;
  stats: FamilyStats;
  memberships: FamilyMembership[];
  digitizationQueue: DigitizationTask[];
  people: FamilyPerson[];
  archivedPeople: FamilyPerson[];
  relationships: FamilyRelationship[];
  /** Full recorded graph, including archived endpoints, for relationship editing. */
  recordedRelationships?: FamilyRelationship[];
  parentSuppressions?: { fromPersonId: string; toPersonId: string }[];
  auditLog: AuditEntry[];
};

export type FocusRelatives = {
  parents: FamilyPerson[];
  spouses: FamilyPerson[];
  siblings: FamilyPerson[];
  children: FamilyPerson[];
};
