import type { Metadata } from "next";
import { DemoSignIn } from "@/src/features/auth/DemoSignIn";

export const metadata: Metadata = {
  title: "Sign in | HML ConstructSync",
  description: "Sign in to manage requests, purchases, deliveries and site inventory.",
};

export default function SignInPage() {
  return <DemoSignIn />;
}
