import type { Metadata } from "next";
import { DemoSignIn } from "@/src/features/auth/DemoSignIn";

export const metadata: Metadata = {
  title: "Demo sign-in | HML ConstructSync",
  description: "Choose a sample account to explore the ConstructSync prototype.",
};

export default function SignInPage() {
  return <DemoSignIn />;
}
