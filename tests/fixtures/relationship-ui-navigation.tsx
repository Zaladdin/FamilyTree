import { createContext, useContext, type ReactNode } from "react";

type FixtureNavigation = {
  query: string;
  router: { replace: (href: string) => void; refresh: () => void };
};
const NavigationContext = createContext<FixtureNavigation | null>(null);

export function FixtureNavigationProvider({ value, children }: { value: FixtureNavigation; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

function useFixtureNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("This navigation shim is only for the isolated UI fixture.");
  return value;
}

export function usePathname() { return "/relationship-ui"; }
export function useSearchParams() { return new URLSearchParams(useFixtureNavigation().query); }
export function useRouter() { return useFixtureNavigation().router; }
