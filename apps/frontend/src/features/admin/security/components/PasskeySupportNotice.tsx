import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Alert } from '@/components/ui/Alert';

export interface PasskeySupportNoticeProps {
  /** Injected in tests; defaults to the browser's own WebAuthn capability check. */
  supported?: boolean;
}

/** Renders nothing when passkeys work here; otherwise explains what to use instead (never a dead passkey button). */
export function PasskeySupportNotice({ supported }: PasskeySupportNoticeProps) {
  const available = supported ?? browserSupportsWebAuthn();
  if (available) return null;
  return (
    <Alert variant="info">
      Passkeys are not available in this browser. Use your authenticator app or a recovery code, or open the Admin Portal in a current
      version of Chrome, Edge, Firefox or Safari.
    </Alert>
  );
}
