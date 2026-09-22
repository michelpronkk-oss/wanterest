import { AuthShell } from "@/components/auth/auth-shell";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";

export const dynamic = "force-dynamic";

export default function UpdatePasswordPage() {
  return (
    <main>
      <AuthShell eyebrow="SET NEW PASSWORD">
        <UpdatePasswordForm />
      </AuthShell>
    </main>
  );
}
