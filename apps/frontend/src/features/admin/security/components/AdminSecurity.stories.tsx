import type { Meta, StoryObj } from '@storybook/react-vite';
import { OtpCodeInput } from './OtpCodeInput';
import { TotpEnrollment } from './TotpEnrollment';
import { RecoveryCodesReveal } from './RecoveryCodesReveal';
import { PasskeySupportNotice } from './PasskeySupportNotice';

// Synthetic fixtures only: the secret, codes and URI below are not used by any real account.
const SYNTHETIC_SECRET = 'JBSWY3DPEHPK3PXP';
const SYNTHETIC_URI = `otpauth://totp/ElectroHub:admin@electrohub.example?secret=${SYNTHETIC_SECRET}&issuer=ElectroHub`;
const SYNTHETIC_CODES = ['AB12-CD34', 'EF56-GH78', 'IJ90-KL12', 'MN34-OP56', 'QR78-ST90', 'UV12-WX34', 'YZ56-AB78', 'CD90-EF12'];

const otpMeta = {
  title: 'Admin/Security/OtpCodeInput',
  component: OtpCodeInput,
  args: { id: 'story-otp', label: '6-digit code', value: '12', onChange: () => undefined },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof OtpCodeInput>;

export default otpMeta;
type OtpStory = StoryObj<typeof otpMeta>;

export const Default: OtpStory = {};
export const WithError: OtpStory = { args: { error: "That code isn't right. Check your authenticator app and try again." } };

export const TotpEnrollmentStory: StoryObj<typeof TotpEnrollment> = {
  name: 'Admin/Security/TotpEnrollment',
  render: () => <div style={{ maxWidth: 420 }}><TotpEnrollment otpauthUri={SYNTHETIC_URI} secret={SYNTHETIC_SECRET} /></div>,
};

export const RecoveryCodes: StoryObj<typeof RecoveryCodesReveal> = {
  name: 'Admin/Security/RecoveryCodesReveal',
  render: () => <div style={{ maxWidth: 420 }}><RecoveryCodesReveal codes={SYNTHETIC_CODES} onConfirmed={() => undefined} /></div>,
};

export const PasskeyUnsupported: StoryObj<typeof PasskeySupportNotice> = {
  name: 'Admin/Security/PasskeySupportNotice',
  args: { supported: false },
  render: (args) => <div style={{ maxWidth: 420 }}><PasskeySupportNotice {...args} /></div>,
};
