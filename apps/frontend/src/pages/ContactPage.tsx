import { useState, type FormEvent } from 'react';
import { Clock3, Mail, MapPin, Phone } from 'lucide-react';
import { SectionReveal, StaggerContainer, StaggerItem } from '@/components/motion/Motion';
import styles from './CompanyPages.module.scss';

const fields = ['Name', 'Email', 'Subject', 'Message'] as const;
type Field = typeof fields[number];
type FormValues = Record<Field, string>;
const initialValues: FormValues = { Name: '', Email: '', Subject: '', Message: '' };

export function ContactPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Partial<FormValues>>({});
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<FormValues> = {};
    for (const field of fields) {
      if (!values[field].trim()) nextErrors[field] = `${field} is required.`;
    }
    if (values.Email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.Email.trim())) nextErrors.Email = 'Enter a valid email address.';
    setErrors(nextErrors);
    setSubmitted(Object.keys(nextErrors).length === 0);
  }

  return <div className={styles.page}>
    <SectionReveal><section className={styles.hero}><h1>Let's talk</h1><p>Questions about ElectroHub? Explore the demo contact details below or try the form.</p></section></SectionReveal>
    <div className={styles.content}><div className={styles.contactLayout}>
      <section aria-labelledby="contact-options"><SectionReveal><h2 id="contact-options">Contact information</h2><p>These details are examples for this storefront demo.</p></SectionReveal><StaggerContainer className={styles.contactCards}>
        {[
          { title: 'Email', text: 'demo@example.com (example only)', icon: Mail },
          { title: 'Phone', text: '+1 (555) 010-0000 (example only)', icon: Phone },
          { title: 'Support Hours', text: 'Mon–Fri, 9:00–17:00 (example only)', icon: Clock3 },
          { title: 'Location', text: 'Online storefront demo; no physical office', icon: MapPin },
        ].map(({ title, text, icon: Icon }, index) => <StaggerItem key={title} index={index}><article className={styles.card}><Icon aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article></StaggerItem>)}
      </StaggerContainer></section>
      <SectionReveal><form className={styles.form} onSubmit={handleSubmit} noValidate><h2>Send a message</h2><p>This form is a demo and does not deliver messages.</p>
        {fields.map(field => <div className={styles.field} key={field}><label htmlFor={`contact-${field}`}>{field}</label>{field === 'Message' ? <textarea id={`contact-${field}`} value={values[field]} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `contact-${field}-error` : undefined} onChange={event => { setValues({ ...values, [field]: event.target.value }); setSubmitted(false); }} /> : <input id={`contact-${field}`} type={field === 'Email' ? 'email' : 'text'} value={values[field]} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `contact-${field}-error` : undefined} onChange={event => { setValues({ ...values, [field]: event.target.value }); setSubmitted(false); }} />}{errors[field] && <p className={styles.error} id={`contact-${field}-error`}>{errors[field]}</p>}</div>)}
        <button className={styles.submit} type="submit">Send Message</button>{submitted && <p role="status" className={styles.notice}>Contact submission is currently a demo and is not connected to a delivery service.</p>}
      </form></SectionReveal>
    </div></div>
  </div>;
}
