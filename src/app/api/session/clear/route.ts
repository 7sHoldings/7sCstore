import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Clears the session cookie and redirects to /login. Used when a logged-in
 * cookie points to an account that no longer exists/active (e.g. after a data
 * wipe) — cookies can't be deleted during a Server Component render, so the
 * layout sends the browser here instead.
 */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete("ft_session");
  return res;
}
