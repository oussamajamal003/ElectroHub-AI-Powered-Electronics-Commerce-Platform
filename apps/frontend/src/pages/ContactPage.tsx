import { useState, type FormEvent } from 'react';
import { Info, Mail, MapPin, MessageSquare, Phone } from 'lucide-react';
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
    if (values.Email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.Email.trim())) nextErrors.Email = 'Enter a valid email address.';
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

  // Only configured store details are shown; nothing is invented when a value is missing.
  const showEmpty = !profileQuery.isPending && !(profileQuery.isError && !profileQuery.data) && cards.length === 0;
  const fieldControl = (field: Field) => {
    const shared = { id: `contact-${field}`, value: values[field], 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `contact-${field}-error` : undefined,
      required: true, onChange: (event: { target: { value: string } }) => { setValues({ ...values, [field]: event.target.value }); setSubmitted(false); } };
    return <div className={styles.field} key={field}><label htmlFor={`contact-${field}`}>{field}</label>
      {field === 'Message' ? <textarea {...shared} /> : <input {...shared} type={field === 'Email' ? 'email' : 'text'} autoComplete={field === 'Name' ? 'name' : field === 'Email' ? 'email' : 'off'} />}
      {errors[field] && <p className={styles.error} id={`contact-${field}-error`}>{errors[field]}</p>}</div>;
  };

  return <div className={styles.page}>
    <SectionReveal><section className={styles.hero}><h1>Let's talk</h1><p>Questions about {profile?.storeName ?? 'ElectroHub'}? Get in touch with our team.</p></section></SectionReveal>
    <div className={styles.content}><div className={`${styles.contactLayout} ${styles.contactLayoutPremium}`}>
      <section aria-labelledby="contact-options">
        <SectionReveal className={styles.contactIntro}><h2 id="contact-options">Contact information</h2><p>We’re here to help. Reach us directly or send a message with the form.</p>
          {profileQuery.isError && !profileQuery.data && <p role="alert">Store contact details are temporarily unavailable. You can still send a message using the form.</p>}
        </SectionReveal>
        {profileQuery.isPending && <div className={styles.contactMethods}>
          <p role="status" className={styles.srOnlyText}>Loading store contact details…</p>
          {[0, 1].map(item => <div key={item} className={`${styles.methodCard} ${styles.methodSkeleton}`} aria-hidden="true"><span className={styles.methodIcon} /><div><span /><span /></div></div>)}
        </div>}
        {cards.length > 0 && <StaggerContainer className={styles.contactMethods}>
          {cards.map(({ title, text, href, icon: Icon }, index) => <StaggerItem key={title} index={index}><article className={styles.methodCard}>
            <span className={styles.methodIcon}><Icon aria-hidden="true" size={22} /></span>
            <div><h3>{title}</h3>{href ? <p><a href={href}>{text}</a></p> : <address className={styles.methodAddress}>{text}</address>}</div>
          </article></StaggerItem>)}
        </StaggerContainer>}
        {showEmpty && <div className={styles.contactEmpty}>
          <span className={styles.methodIcon}><MessageSquare aria-hidden="true" size={22} /></span>
          <h3>Send us a message</h3>
          <p>Direct contact details have not been published yet. The form is the quickest way to reach our support team.</p>
        </div>}
        <div className={styles.contactNote}><Info aria-hidden="true" size={18} /><p>Messages sent with this form go to our support team. Please include your order number if your question is about an order.</p></div>
      </section>
      <SectionReveal><form className={`${styles.form} ${styles.formPremium}`} onSubmit={handleSubmit} noValidate aria-labelledby="contact-form-title"><h2 id="contact-form-title">Send a message</h2><p>Send a message to our support team. All fields are required.</p>
        <div className={styles.fieldRow}>{fieldControl('Name')}{fieldControl('Email')}</div>
        {fieldControl('Subject')}{fieldControl('Message')}
        <button className={styles.submit} type="submit" disabled={contact.isPending}>{contact.isPending ? 'Sending…' : 'Send Message'}</button>{submitted && <p role="status" className={styles.notice}>Your message has been sent.</p>}{contact.isError && <p role="alert" className={styles.error}>{contact.error instanceof ApiError ? contact.error.message : 'We could not send your message. Please try again.'}</p>}
      </form></SectionReveal>
    </div></div>
  </div>;
}
