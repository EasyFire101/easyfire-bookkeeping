import { EnsureAuthNotAuthenticated } from "@/components/Guards/EnsureAuthNotAuthenticated";
import { Authentication } from "./Authentication";

export function AuthenticationPage() {
  return (
    <EnsureAuthNotAuthenticated>
      <Authentication />
    </EnsureAuthNotAuthenticated>
  );
}
