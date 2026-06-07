import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge middleware guards the app. It verifies the session JWT signature (jose
 * runs in the edge runtime) and redirects unauthenticated users to /login.
 * Fine-grained role checks happen in server components/actions via rbac.ts.
 */
const PUBLIC_PATHS = ["/login"];

async function isValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("ft_session")?.value;
  const authed = await isValid(token);

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (authed) return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }

  if (!authed) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals, static assets, and API exports
  // that handle their own auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|.*\\.(?:png|jpg|jpeg|svg|ico|webmanifest)$).*)",
  ],
};
