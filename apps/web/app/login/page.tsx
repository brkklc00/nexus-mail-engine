import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-6">
      <h2 className="text-2xl font-semibold text-white">Nexus Admin Login</h2>
      <p className="mt-2 text-sm text-zinc-400">Secure session access for operations control center.</p>
      <div className="mt-6">
        <LoginForm />
      </div>
    </div>
  );
}
