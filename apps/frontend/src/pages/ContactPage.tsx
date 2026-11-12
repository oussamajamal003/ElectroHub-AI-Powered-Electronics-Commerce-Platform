import { toast } from '@/components/ui/Toast';
import { emailValidationError } from '@/lib/emailValidation';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import { sendContactMessage, useStorefrontProfile } from '@/features/storefront/api';
import { ApiError } from '@/lib/api';
import styles from './CompanyPages.module.scss';

const fields = ['Name', 'Email', 'Subject', 'Message'] as const;
type Field = typeof fields[number];
type FormValues = Record<Field, string>;
const initialValues: FormValues = { Name: '', Email: '', Subject: '', Message: '' };
/** Mirrors the server limits (the server stays authoritative). */
const LIMITS = { Name: 120, Email: 255, Subject: 160, Message: 5000 } as const;
const MIN_MESSAGE = 10;
const hasControl = (value: string, allowLineBreaks = false) => [...value].some(character => {
  const code = character.charCodeAt(0);
  return code === 0x7f || (code < 0x20 && !(allowLineBreaks && (code === 0x09 || code === 0x0a || code === 0x0d)));
});

export function validateContact(values: FormValues): Partial<FormValues> {
  const errors: Partial<FormValues> = {};
  for (const field of fields) {
    const value = values[field].trim();
    if (!value) { errors[field] = field === 'Email' ? emailValidationError(value) : `${field} is required.`; continue; }
    if (value.length > LIMITS[field]) errors[field] = `${field} must be ${LIMITS[field]} characters or fewer.`;
    else if (field !== 'Message' && hasControl(value)) errors[field] = `${field} must be a single line of text.`;
  }
  if (!errors.Email) {
    const emailError = emailValidationError(values.Email);
    if (emailError) errors.Email = emailError;
  }
  if (!errors.Message && hasControl(values.Message, true)) errors.Message = 'Remove unsupported characters from the message.';
  if (!errors.Message && values.Message.trim().length < MIN_MESSAGE) errors.Message = `Message must be at least ${MIN_MESSAGE} characters.`;
  return errors;
}

export function ContactPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Partial<FormValues>>({});
  const [submitted, setSubmitted] = useState(false);
  const [trap, setTrap] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const profileQuery = useStorefrontProfile();
  const { data: profile } = profileQuery;
  const contact = useMutation({ mutationFn: sendContactMessage, meta: { action: 'send your message' } });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (contact.isPending) return; // a double click or Enter-repeat never sends twice
    const nextErrors = validateContact(values);
    setErrors(nextErrors);
    const firstInvalid = fields.find(field => nextErrors[field]);
    if (firstInvalid) { formRef.current?.querySelector<HTMLElement>(`#contact-${firstInvalid}`)?.focus(); return; }
    try {
      await contact.mutateAsync({ name: values.Name.trim(), email: values.Email.trim(), subject: values.Subject.trim(), message: values.Message.trim(), website: trap });
      setSubmitted(true);
      setValues(initialValues);
      toast.success('Message sent', { description: 'We\'ll get back to you soon.', announce: false });
    } catch { setSubmitted(false); }
  }

  const change = (field: Field) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setValues(current => ({ ...current, [field]: value }));
    setSubmitted(false);
    if (errors[field]) setErrors(current => { const next = { ...current }; delete next[field]; return next; });
  };

  const address = [profile?.addressLine1, profile?.addressLine2, profile?.city, profile?.region, profile?.postalCode, profile?.country].filter(Boolean).join(', ');
  // Only what an administrator has actually saved is shown. Nothing is invented, and no empty card is rendered.
  const cards = [
    ...(profile?.supportEmail ? [{ title: 'Email', text: profile.supportEmail, href: `mailto:${profile.supportEmail}`, icon: Mail }] : []),
    ...(profile?.supportPhone ? [{ title: 'Phone', text: profile.supportPhone, href: `tel:${profile.supportPhone.replace(/[^+\d]/g, '')}`, icon: Phone }] : []),
    ...(address ? [{ title: 'Location', text: address, icon: MapPin }] : []),
    ...(profile?.businessHours ? [{ title: 'Business hours', text: profile.businessHours, icon: Clock }] : []),
  ];
  const profileReady = Boolean(profile);

  return <div className={styles.page}>
    <SectionReveal><section className={styles.hero}><h1>Let's talk</h1><p>Questions about {profile?.storeName ?? 'ElectroHub'}? Get in touch with our team.</p></section></SectionReveal>
    <div className={styles.content}><div className={styles.contactLayout}>
      <section aria-labelledby="contact-options"><SectionReveal><h2 id="contact-options">Contact information</h2><p>We’re here to help with orders, products and your account.</p>
        {profileQuery.isPending && <p role="status">Loading store contact details…</p>}
        {profileQuery.isError && !profileQuery.data && <p role="alert">Store contact details are temporarily unavailable. You can still send a message using the form.</p>}
        {profileReady && cards.length === 0 && <p className={styles.emptyNote}>Direct contact details have not been published yet. Send us a message with the form and our team will reply by email.</p>}
      </SectionReveal>{cards.length > 0 && <StaggerContainer className={styles.contactCards}>
        {cards.map(({ title, text, href, icon: Icon }, index) => <StaggerItem key={title} index={index}><article className={styles.card}><div className={styles.iconWrapper}><Icon aria-hidden="true" size={22} /></div><h3>{title}</h3><p>{href ? <a href={href}>{text}</a> : text}</p></article></StaggerItem>)}
      </StaggerContainer>}
        <SectionReveal><p className={styles.helpLinks}>Looking for answers first? <Link to="/about">About ElectroHub</Link> · <Link to="/products">Browse products</Link></p></SectionReveal>
      </section>
      <SectionReveal><form ref={formRef} className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={contact.isPending}><h2>Send a message</h2><p>Send a message to our support team. All fields are required.</p>
        {fields.map(field => {
          const id = `contact-${field}`;
          const describedBy = [errors[field] ? `${id}-error` : '', field === 'Message' ? `${id}-count` : ''].filter(Boolean).join(' ') || undefined;
          const common = { id, value: values[field], 'aria-invalid': !!errors[field], 'aria-required': true as const, 'aria-describedby': describedBy, maxLength: LIMITS[field], onChange: change(field), disabled: contact.isPending };
          return <div className={styles.field} key={field}><label htmlFor={id}>{field}</label>
            {field === 'Message' ? <textarea {...common} rows={6} /> : <input {...common} type={field === 'Email' ? 'email' : 'text'} autoComplete={field === 'Name' ? 'name' : field === 'Email' ? 'email' : 'off'} />}
            {field === 'Message' && <p className={styles.counter} id={`${id}-count`}>{values.Message.length} / {LIMITS.Message}</p>}
            {errors[field] && <p className={styles.error} id={`${id}-error`}>{errors[field]}</p>}</div>;
        })}
        {/* Honeypot: invisible and unreachable for people; automated form fillers that complete it are silently discarded server-side. */}
        <div className={styles.trap} aria-hidden="true"><label htmlFor="contact-website">Website</label><input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)} /></div>
        <button className={styles.submit} type="submit" disabled={contact.isPending}>{contact.isPending ? 'Sending…' : 'Send Message'}</button>
        {submitted && <p role="status" className={styles.notice}>Your message has been sent. Our team will reply to the email address you provided.</p>}
        {contact.isError && <p role="alert" className={styles.error}>{contact.error instanceof ApiError && (contact.error.status === 429 || contact.error.status === 503) ? contact.error.message : 'We could not send your message. Please try again.'}</p>}
      </form></SectionReveal>
    </div></div>
  </div>;
}
