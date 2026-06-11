"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Stores the viewer's IANA timezone in a `vtz` cookie so server components can
 * compute "today"/"yesterday" in the viewer's local time (not the server's).
 * Refreshes once when the cookie is first set so the initial render is correct.
 */
export default function TzCookie() {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      const had = document.cookie.split("; ").some((c) => c.startsWith("vtz="));
      const current = document.cookie.split("; ").find((c) => c.startsWith("vtz="))?.split("=")[1];
      document.cookie = `vtz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      if (!had || decodeURIComponent(current || "") !== tz) router.refresh();
    } catch {
      /* ignore */
    }
  }, [router]);
  return null;
}
