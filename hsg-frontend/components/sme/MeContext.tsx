"use client";
/**
 * Loads GET /me once for the whole SME shell and shares it with every page.
 * Pages call useMe() to read the business name, KYB status and virtual account.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

interface MeState { me: Me | null; error: string | null; loading: boolean; reload: () => void }
const MeCtx = createContext<MeState>({ me: null, error: null, loading: true, reload: () => {} });

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<Me>("/me")
      .then(setMe)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "We couldn’t load your account."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return <MeCtx.Provider value={{ me, error, loading, reload: load }}>{children}</MeCtx.Provider>;
}

export const useMe = () => useContext(MeCtx);
