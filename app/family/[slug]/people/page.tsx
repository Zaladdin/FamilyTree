import { FamilySectionPage, type FamilySectionPageProps } from "@/components/family-section-page";

export const dynamic = "force-dynamic";

export default function FamilyPeoplePage(props: FamilySectionPageProps) {
  return <FamilySectionPage {...props} section="people" />;
}
