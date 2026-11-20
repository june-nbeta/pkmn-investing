import { Navigation } from "@/components/Navigation";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const session = await getSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="page">
      <Navigation />
      <main className="main">
        <h1>Sign up</h1>
        <p>
          Creates a new account with its own fresh collection identity — your cards stay
          isolated to your account. Existing collections can only be claimed with a one-time
          operator-issued claim token.
        </p>

        <SignUpForm />
      </main>
    </div>
  );
}
