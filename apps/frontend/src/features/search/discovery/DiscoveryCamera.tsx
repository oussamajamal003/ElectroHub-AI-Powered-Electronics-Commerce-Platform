import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DiscoveryState } from './DiscoveryState';
import styles from './Discovery.module.scss';

type CameraStatus = 'starting' | 'live' | 'captured' | 'denied' | 'unsupported' | 'failed';
interface Props { onCapture: (file: File) => void; onUpload: () => void; onCancel: () => void }

const stopStream = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());

/**
 * Live camera capture. The camera is requested only after the shopper asked for it (this component mounts on that
 * press), video only, and every track is stopped on capture, cancel and unmount — nothing records in the background.
 */
export function DiscoveryCamera({ onCapture, onUpload, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [still, setStill] = useState<{ url: string; file: File } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (status !== 'starting') return;
    let cancelled = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setStatus('unsupported'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then(media => {
        if (cancelled) { stopStream(media); return; }
        stream.current = media;
        if (video.current) { video.current.srcObject = media; void video.current.play().catch(() => undefined); }
        setStatus('live');
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        const name = failure instanceof DOMException ? failure.name : '';
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unsupported' : 'failed');
      });
    return () => { cancelled = true; };
  }, [status, attempt]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopStream(stream.current); stream.current = null; };
  }, []);
  useEffect(() => () => { if (still) URL.revokeObjectURL(still.url); }, [still]);
  const capture = () => {
    const source = video.current;
    if (!source || !source.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth; canvas.height = source.videoHeight;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    canvas.toBlob(blob => {
      if (!mounted.current) return;
      if (!blob) { setStatus('failed'); return; }
      stopStream(stream.current); stream.current = null;
      const file = new File([blob], `camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' });
      setStill({ url: URL.createObjectURL(file), file });
      setStatus('captured');
    }, 'image/jpeg', 0.9);
  };
  const retake = () => { setStill(null); setStatus('starting'); setAttempt(value => value + 1); };
  const copy = status === 'denied' || status === 'unsupported' || status === 'failed'
    ? status === 'denied'
      ? { title: 'Camera access is blocked', text: 'Allow camera access in your browser settings, or upload a photo instead.' }
      : status === 'unsupported'
        ? { title: 'No camera available', text: 'This device or browser can’t open a camera here. Upload a photo instead.' }
        : { title: 'The camera didn’t start', text: 'Something interrupted the camera. Try again, or upload a photo instead.' }
    : null;
  const announcement = copy ? `${copy.title}. ${copy.text}` : status === 'starting' ? 'Waiting for camera permission…'
    : status === 'captured' ? 'Photo captured. Retake it or choose Use this photo.' : 'Camera ready. Choose Take photo to capture.';
  return <section className={styles.camera} aria-label="Camera">
    <p role="status" aria-live="polite" aria-atomic="true" aria-label="Camera status" className={styles.srOnly}>{announcement}</p>
    {copy ? <DiscoveryState tone="visual" icon={<CameraOff size={20} />} title={copy.title} description={copy.text}
      action={<><Button type="button" size="small" onClick={onUpload}><Upload size={16} aria-hidden="true" />Upload a photo</Button>
        {status === 'failed' && <Button type="button" size="small" variant="outline" onClick={retake}>Try again</Button>}
        <Button type="button" size="small" variant="ghost" onClick={onCancel}>Back</Button></>} /> : <>
    <div className={styles.viewfinder}>
      <span className={`${styles.corner} ${styles.tl}`} /><span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} /><span className={`${styles.corner} ${styles.br}`} />
      {still ? <img src={still.url} alt="Captured photo" className={styles.cameraMedia} />
        : <video ref={video} className={styles.cameraMedia} playsInline muted aria-label="Live camera preview" />}
      {status === 'starting' && <p className={styles.cameraNote}>Waiting for camera permission…</p>}
    </div>
    <div className={styles.cameraBar}>
      {status === 'captured' && still ? <>
        <Button type="button" variant="outline" size="small" onClick={retake}><RefreshCw size={16} aria-hidden="true" />Retake</Button>
        <Button type="button" size="small" onClick={() => onCapture(still.file)}>Use this photo</Button>
      </> : <>
        <Button type="button" variant="ghost" size="small" onClick={onCancel}>Cancel</Button>
        <button type="button" className={styles.shutter} aria-label="Take photo" disabled={status !== 'live'} onClick={capture}><Camera size={22} aria-hidden="true" /></button>
        <Button type="button" variant="ghost" size="small" onClick={onUpload}><Upload size={16} aria-hidden="true" />Upload</Button>
      </>}
    </div>
    </>}
  </section>;
}
