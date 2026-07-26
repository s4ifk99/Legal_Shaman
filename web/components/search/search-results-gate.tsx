"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/use-require-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

type SearchResultsGateProps = {
  query: string;
  isAuthenticated: boolean;
  children: React.ReactNode;
};

/**
 * Hides directory search results until the user signs in.
 * After auth, refreshes the page so SSR can load results.
 */
export function SearchResultsGate({
  query,
  isAuthenticated,
  children,
}: SearchResultsGateProps) {
  const router = useRouter();
  const { openAuthForSearch, user, loading, searchAuthRequired } = useRequireAuth();
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
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Create a free account to view results
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Sign up with your email and password to see directory matches for &ldquo;{query}&rdquo;.
          </p>
        </div>
        <Button type="button" onClick={() => openAuthForSearch(() => router.refresh())}>
          Create free account
        </Button>
      </CardContent>
    </Card>
  );
}
