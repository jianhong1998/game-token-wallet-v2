import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "./server/session";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const AUTH_ONLY_PATHS = new Set(["/login", "/register"]);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminPath) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("session")?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  if (AUTH_ONLY_PATHS.has(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}
