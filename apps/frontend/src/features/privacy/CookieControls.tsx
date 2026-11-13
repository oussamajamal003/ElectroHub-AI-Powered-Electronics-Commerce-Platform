import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog/Dialog';
import { OPEN_COOKIE_SETTINGS_EVENT, saveChoice, useChoiceStatus } from './consent';
import styles from './CookieControls.module.scss';

export function CookieControls({ locked }: { locked: boolean }) {
  const status = useChoiceStatus();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(false);
  const [notice, setNotice] = useState('');
  const choose = (analytics: boolean) => {
    const persisted = saveChoice(analytics);
    setOpen(false);
    setNotice(persisted ? 'Cookie preferences saved.' : 'Cookie preferences apply for this visit, but could not be saved on this device.');
  };
  const customize = () => { setSelected(status === 'accepted'); setOpen(true); };
  // Cookie Policy and account pages reopen this same dialog; there is no second consent manager.
  useEffect(() => {
    const reopen = () => { setSelected(status === 'accepted'); setOpen(true); };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
  }, [status]);
  const currentChoice = status === 'accepted' ? 'Optional analytics allowed' : status === 'rejected' ? 'Optional analytics rejected' : 'No choice saved yet';
  return <>
    <button type="button" className={styles.footerLink} data-footer-link onClick={customize}>Cookie Settings</button>
    <span className={styles.srOnly} role="status">{notice}</span>
    {status === 'unset' && !locked && <section className={styles.banner} aria-label="Cookie preferences">
      <div><strong>Your privacy matters</strong><p>We use essential storage for security and shopping. With your permission, we also use analytics to understand storefront visits, recommendations and image search. <Link className={styles.policyLink} to="/cookie-policy">Read the Cookie Policy</Link></p></div>
      {/* Accept and Reject carry equal visual weight: no dark pattern nudging toward consent. */}
      <div className={styles.actions}><Button onClick={() => choose(true)}>Accept all</Button><Button onClick={() => choose(false)}>Reject optional</Button><Button variant="outline" onClick={customize}>Customize</Button></div>
    </section>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className={styles.dialog}>
      <DialogTitle>Cookie Settings</DialogTitle><DialogDescription>Choose whether ElectroHub may use optional analytics. You can change this choice at any time.</DialogDescription>
      <p className={styles.current}>Current choice: <strong>{currentChoice}</strong></p>
      <div className={styles.category}><strong>Strictly necessary</strong><span>Always active</span><p>Security, sign-in, cart and checkout storage support services you request.</p></div>
      <div className={styles.category}><label><input type="checkbox" checked={selected} onChange={e => setSelected(e.target.checked)} /> <strong>Analytics</strong></label><p>ElectroHub measures visible storefront time, recommendation impressions and clicks, and image-search outcomes and selections to improve the service.</p></div>
      <p><Link className={styles.policyLink} to="/cookie-policy" onClick={() => setOpen(false)}>Read the Cookie Policy</Link></p>
      <div className={styles.actions}><Button variant="outline" onClick={() => choose(true)}>Accept all</Button><Button variant="outline" onClick={() => choose(false)}>Reject optional</Button><Button onClick={() => choose(selected)}>Save preferences</Button></div>
    </DialogContent></Dialog>
  </>;
}
