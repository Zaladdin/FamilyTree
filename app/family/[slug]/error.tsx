"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

export default function FamilyErrorPage({ reset }: RouteErrorProps) {
  return <RouteError family reset={reset} />;
}
