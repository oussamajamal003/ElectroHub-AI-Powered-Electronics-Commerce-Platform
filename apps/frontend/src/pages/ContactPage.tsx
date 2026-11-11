import { emailValidationError } from '@/lib/emailValidation';
import { useState, type FormEvent } from 'react';
import { Mail, MapPin, Phone } from 'lucide-react';
import { SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import { sendContactMessage, useStorefrontProfile } from '@/features/storefront/api';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import styles from './CompanyPages.module.scss';

const fields = ['Name', 'Email', 'Subject', 'Message'] as const;
type Field = typeof fields[number];
type FormValues = Record<Field, string>;
const initialValues: FormValues = { Name: '', Email: '', Subject: '', Message: '' };

export function ContactPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Partial<FormValues>>({});
  const [submitted, setSubmitted] = useState(false);
  const profileQuery = useStorefrontProfile();
  const { data: profile } = profileQuery;
  const contact = useMutation({ mutationFn: sendContactMessage });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<FormValues> = {};
    for (const field of fields) {
      if (!values[field].trim()) nextErrors[field] = `${field} is required.`;
    }
    const emailError = emailValidationError(values.Email);
    if (emailError) nextErrors.Email = emailError;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try { await contact.mutateAsync({ name: values.Name.trim(), email: values.Email.trim(), subject: values.Subject.trim(), message: values.Message.trim() }); setSubmitted(true); }
    catch { setSubmitted(false); }
  }

  const address = [profile?.addressLine1, profile?.addressLine2, profile?.city, profile?.region, profile?.postalCode, profile?.country].filter(Boolean).join(', ');
  const cards = [
    ...(profile?.supportEmail ? [{ title: 'Email', text: profile.supportEmail, href: `mailto:${profile.supportEmail}`, icon: Mail }] : []),
    ...(profile?.supportPhone ? [{ title: 'Phone', text: profile.supportPhone, href: `tel:${profile.supportPhone.replace(/[^+\d]/g, '')}`, icon: Phone }] : []),
    ...(address ? [{ title: 'Location', text: address, icon: MapPin }] : []),
  ];

  return <div className={styles.page}>
    <SectionReveal><section className={styles.hero}><h1>Let's talk</h1><p>Questions about {profile?.storeName ?? 'ElectroHub'}? Get in touch with our team.</p></section></SectionReveal>
    <div className={styles.content}><div className={styles.contactLayout}>
      <section aria-labelledby="contact-options"><SectionReveal><h2 id="contact-options">Contact information</h2><p>We’re here to help.</p>
        {profileQuery.isPending && <p role="status">Loading store contact details…</p>}
        {profileQuery.isError && !profileQuery.data && <p role="alert">Store contact details are temporarily unavailable. You can still send a message using the form.</p>}
      </SectionReveal><StaggerContainer className={styles.contactCards}>
        {cards.map(({ title, text, href, icon: Icon }, index) => <StaggerItem key={title} index={index}><article className={styles.card}><Icon aria-hidden="true" /><h3>{title}</h3><p>{href ? <a href={href}>{text}</a> : text}</p></article></StaggerItem>)}
      </StaggerContainer></section>
      <SectionReveal><form className={styles.form} onSubmit={handleSubmit} noValidate><h2>Send a message</h2><p>Send a message to our support team.</p>
        {fields.map(field => <div className={styles.field} key={field}><label htmlFor={`contact-${field}`}>{field}</label>{field === 'Message' ? <textarea id={`contact-${field}`} value={values[field]} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `contact-${field}-error` : undefined} onChange={event => { setValues({ ...values, [field]: event.target.value }); setSubmitted(false); }} /> : <input id={`contact-${field}`} type={field === 'Email' ? 'email' : 'text'} value={values[field]} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `contact-${field}-error` : undefined} onChange={event => { setValues({ ...values, [field]: event.target.value }); setSubmitted(false); }} />}{errors[field] && <p className={styles.error} id={`contact-${field}-error`}>{errors[field]}</p>}</div>)}
        <button className={styles.submit} type="submit" disabled={contact.isPending}>{contact.isPending ? 'Sending…' : 'Send Message'}</button>{submitted && <p role="status" className={styles.notice}>Your message has been sent.</p>}{contact.isError && <p role="alert" className={styles.error}>{contact.error instanceof ApiError ? contact.error.message : 'We could not send your message. Please try again.'}</p>}
      </form></SectionReveal>
    </div></div>
  </div>;
}
