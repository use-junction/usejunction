import NextAuth from "next-auth";
import authConfig from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico|lottie|wasm|mp4|webm)$).*)"],
};
