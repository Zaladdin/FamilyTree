"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

export default function ErrorPage({ reset }: RouteErrorProps) {
  return <RouteError reset={reset} />;
}
