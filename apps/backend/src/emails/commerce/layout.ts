/**
 * Shared HTML shell for commerce emails. Table-based, inline critical styles, no images, no scripts, no forms.
 * The only `<style>` rules are progressive enhancements for narrow clients; the content stays readable without them.
 */
import { escapeHtml } from './escape.js';

export type StatusTone = 'success' | 'progress' | 'neutral';

export interface LayoutCta { label: string; url: string }

export interface LayoutOptions {
  preheader: string;
  statusLabel: string;
  statusTone: StatusTone;
  heading: string;
  reference: string;
  eventDateLabel: string;
  /** Trusted HTML built by the template builders; every dynamic value inside it must already be escaped. */
  bodyHtml: string;
  cta: LayoutCta;
}

export const FONT_STACK = `Poppins, 'Segoe UI', Arial, Helvetica, sans-serif`;
export const MONO_STACK = `'JetBrains Mono', Consolas, 'Courier New', monospace`;
const FOOTER_TEXT = 'You received this email because you placed an order with ElectroHub. '
  + 'You can find the latest information in Order Details.';

const TONE_STYLES: Readonly<Record<StatusTone, { background: string; color: string; icon: string }>> = {
  success: { background: '#F0FDF4', color: '#15803D', icon: '✓' },
  progress: { background: '#EFF6FF', color: '#1D4ED8', icon: '•' },
  neutral: { background: '#F1F5F9', color: '#334155', icon: '–' },
};

const MOBILE_STYLE = `@media only screen and (max-width:639px){`
  + `.eh-gutter{padding:12px !important}`
  + `.eh-inner{padding:20px !important}`
  + `.eh-h1{font-size:22px !important;line-height:30px !important}`
  + `}@media only screen and (max-width:479px){.eh-thumb{display:none !important}`
  + `.eh-cta,.eh-cta-cell{width:100% !important}`
  + `.eh-cta-cell{box-sizing:border-box !important}`
  + `.eh-cta-link{display:block !important;text-align:center !important}`
  + `}`;

/** Full HTML document for one commerce email. Plain-text fields are escaped here; `bodyHtml` is trusted pre-escaped markup. */
export function renderLayout(options: LayoutOptions): string {
  const tone = TONE_STYLES[options.statusTone];
  const url = escapeHtml(options.cta.url);
  const preheader = escapeHtml(options.preheader);
  const heading = escapeHtml(options.heading);
  const spacer = '&#847;&#8203;'.repeat(40);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${heading}</title>`,
    `<style>${MOBILE_STYLE}</style>`,
    '</head>',
    '<body style="margin:0;padding:0;background-color:#F8FAFC;-webkit-text-size-adjust:100%;">',
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#F8FAFC;">${preheader}${spacer}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;">',
    '<tr>',
    '<td class="eh-gutter" align="center" style="padding:24px;background-color:#F8FAFC;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
      + 'style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:3px solid #2563EB;">',
    '<tr>',
    '<td class="eh-inner" style="padding:32px;font-family:' + FONT_STACK + ';color:#0F172A;">',
    `<p style="margin:0 0 24px 0;font-family:${FONT_STACK};font-size:20px;line-height:28px;font-weight:700;color:#0F172A;">ElectroHub</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
      + `style="background-color:${tone.background};">`,
    '<tr>',
    '<td style="padding:12px 16px;font-family:' + FONT_STACK + ';">',
    `<p style="margin:0;font-size:14px;line-height:20px;font-weight:600;color:${tone.color};">`
      + `<span aria-hidden="true">${tone.icon}</span> ${escapeHtml(options.statusLabel)} · ${escapeHtml(options.eventDateLabel)}</p>`,
    '<p style="margin:8px 0 0 0;font-size:14px;line-height:20px;color:#334155;">Order reference</p>',
    `<p style="margin:2px 0 0 0;font-family:${MONO_STACK};font-size:14px;line-height:20px;color:#0F172A;word-break:break-all;">`
      + `${escapeHtml(options.reference)}</p>`,
    '</td>',
    '</tr>',
    '</table>',
    `<h1 class="eh-h1" style="margin:24px 0 16px 0;font-family:${FONT_STACK};font-size:24px;line-height:32px;font-weight:600;color:#0F172A;">${heading}</h1>`,
    options.bodyHtml,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="eh-cta" style="margin:24px 0 0 0;">',
    '<tr>',
    // Padding lives on the link so the whole 48px-high button is the touch target, not only its text.
    '<td class="eh-cta-cell" align="center" style="background-color:#2563EB;">',
    `<a class="eh-cta-link" href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:16px;line-height:20px;`
      + `font-weight:600;color:#FFFFFF;text-decoration:none;">${escapeHtml(options.cta.label)}</a>`,
    '</td>',
    '</tr>',
    '</table>',
    `<p style="margin:16px 0 0 0;font-size:14px;line-height:20px;color:#475569;">If the button does not work, copy this link into your browser:</p>`,
    `<p style="margin:4px 0 0 0;font-size:14px;line-height:20px;word-break:break-all;"><a href="${url}" `
      + `style="color:#1D4ED8;text-decoration:underline;word-break:break-all;">${url}</a></p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0 0;">',
    '<tr>',
    '<td style="padding:16px 0 0 0;border-top:1px solid #E2E8F0;font-family:' + FONT_STACK + ';font-size:14px;line-height:20px;color:#475569;">',
    FOOTER_TEXT,
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}
