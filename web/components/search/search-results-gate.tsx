"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/use-require-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";

type SearchResultsGateProps = {
  query: string;
  isAuthenticated: boolean;
  children: React.ReactNode;
};

/**
 * When search auth is required, hides results until sign-in.
 * When off (Nov Exp 2 default), results render for anonymous visitors;
 * save/notes still soft-wall via bookmark auth.
 */
export function SearchResultsGate({
  query,
  isAuthenticated,
  children,
}: SearchResultsGateProps) {
  const router = useRouter();
  const { openAuthForSearch, user, loading, searchAuthRequired } = useRequireAuth();
  const { t, fill } = useLocale();
  const gated =
    searchAuthRequired && query.trim().length >= 2 && !isAuthenticated && !user;

  useEffect(() => {
    if (gated && !loading) {
      openAuthForSearch(() => router.refresh());
    }
  }, [gated, loading, openAuthForSearch, router]);

  if (!gated) {
    return <>{children}</>;
  }

  return (
    <Card className="border-primary/20 bg-muted/30">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <Lock className="h-10 w-10 text-primary" />
        <div className="space-y-2">
          <h2 className="font-serif text-xl font-semibold text-foreground">{t.gateTitle}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{fill(t.gateBody, { query })}</p>
        </div>
        <Button type="button" onClick={() => openAuthForSearch(() => router.refresh())}>
          {t.gateButton}
        </Button>
      </CardContent>
    </Card>
  );
}
