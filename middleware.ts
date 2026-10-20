import { NextResponse, type NextRequest } from "next/server";
import { isBlocked, isRestrictedRoute } from "@/lib/geo";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isRestrictedRoute(pathname)) return NextResponse.next();

  const country = request.headers.get("x-vercel-ip-country");
  const region = request.headers.get("x-vercel-ip-country-region");
  const production = process.env.VERCEL_ENV === "production";

  if (isBlocked(country, region, production)) {
    const url = request.nextUrl.clone();
    url.pathname = "/restricted";
    url.search = "";
    return NextResponse.rewrite(url, { status: 451 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/trade/:path*", "/vault/:path*", "/wars/:path*"],
};
