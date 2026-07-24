import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "./server/session";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("session")?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}
