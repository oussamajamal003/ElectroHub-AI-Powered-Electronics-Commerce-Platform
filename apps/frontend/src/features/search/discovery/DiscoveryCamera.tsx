import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DiscoveryState } from './DiscoveryState';
import styles from './Discovery.module.scss';

type CameraStatus = 'starting' | 'live' | 'captured' | 'denied' | 'unsupported' | 'busy' | 'nofeed' | 'failed';
const FEED_TIMEOUT_MS = 8000;
const ERROR_COPY: Record<'denied' | 'unsupported' | 'busy' | 'nofeed' | 'failed', { title: string; text: string }> = {
  denied: { title: 'Camera access is blocked', text: 'Allow camera access for this site in your browser settings, then choose Retry camera. Or upload a photo instead.' },
  unsupported: { title: 'No camera available', text: 'No usable camera was found on this device or browser. Connect one and choose Retry camera, or upload a photo instead.' },
  busy: { title: 'The camera is in use', text: 'Another app or browser tab may be using it. Close it, then choose Retry camera. Or upload a photo instead.' },
  nofeed: { title: 'The camera sent no picture', text: 'The camera opened but no video arrived. Check for a privacy shutter or another app using it, try another camera if you have one, or upload a photo instead.' },
  failed: { title: 'The camera didn’t start', text: 'Something interrupted the camera. Try again, or upload a photo instead.' }
};
interface Props { onCapture: (file: File) => void; onUpload: () => void; onCancel: () => void }

const stopStream = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());

/** Mean luma (0-255) of a 32 x 24 sample of the frame, or null when the browser cannot read pixels back. */
// Measured on 156 real dev photos: 40 flags 8 (mostly products on black backgrounds), so it only advises a retake.
const DARK_LUMA = 40;
function meanLuma(source: HTMLVideoElement): number | null {
  try {
    const sample = document.createElement('canvas');
    sample.width = 32; sample.height = 24;
    const context = sample.getContext('2d');
    if (!context?.getImageData) return null;
    context.drawImage(source, 0, 0, 32, 24);
    const { data } = context.getImageData(0, 0, 32, 24);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    }
    return total / (data.length / 4);
  } catch { return null; }
}

/**
 * Live camera capture. The camera is requested only after the shopper asked for it (this component mounts on that
 * press), video only, and every track is stopped on capture, cancel and unmount — nothing records in the background.
 */
export function DiscoveryCamera({ onCapture, onUpload, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [still, setStill] = useState<{ url: string; file: File; dark: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState('');
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [cameras, setCameras] = useState<string[]>([]);
  const fail = (kind: CameraStatus, name = '') => { stopStream(stream.current); stream.current = null; setDetail(name); setStatus(kind); };
  useEffect(() => {
    if (status !== 'starting') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach = () => undefined as void;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setStatus('unsupported'); return; }
    stopStream(stream.current); stream.current = null;
    const request = async (): Promise<MediaStream> => {
      const wide = { width: { ideal: 1280 } };
      // Desktop cameras report no facing direction, so only ask for the rear camera on touch devices; a chosen camera wins.
      const rear = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      const preferred: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId }, ...wide } : rear ? { facingMode: { ideal: 'environment' }, ...wide } : wide;
      try { return await navigator.mediaDevices.getUserMedia({ video: preferred, audio: false }); }
      catch (failure) {
        if (failure instanceof DOMException && failure.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        throw failure;
      }
    };
    request()
      .then(media => {
        if (cancelled) { stopStream(media); return; }
        stream.current = media;
        const element = video.current;
        if (!element) { fail('failed', 'NoVideoElement'); return; }
        element.srcObject = media;
        // 'live' only once a frame has really arrived; a stream that never delivers one is reported, not left black.
        // A muted track (OS privacy switch, shutter, blocked driver) opens fine but never sends pixels, so it is not ready either.
        const track = media.getVideoTracks?.()[0];
        const ready = () => { if (element.videoWidth > 0 && !track?.muted) { detach(); setStatus('live'); } };
        track?.addEventListener?.('unmute', ready);
        element.addEventListener('loadeddata', ready); element.addEventListener('playing', ready); element.addEventListener('resize', ready);
        detach = () => { clearTimeout(timer); track?.removeEventListener?.('unmute', ready); element.removeEventListener('loadeddata', ready); element.removeEventListener('playing', ready); element.removeEventListener('resize', ready); };
        timer = setTimeout(() => { if (!cancelled) { detach(); fail('nofeed'); } }, FEED_TIMEOUT_MS);
        element.play().catch(() => undefined);
        ready();
        navigator.mediaDevices.enumerateDevices?.().then(list => { if (!cancelled) setCameras(list.filter(d => d.kind === 'videoinput' && d.deviceId).map(d => d.deviceId)); }).catch(() => undefined);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        const name = failure instanceof DOMException ? failure.name : '';
        fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unsupported' : name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'failed', name);
      });
    return () => { cancelled = true; detach(); };
  }, [status, attempt, deviceId]);
  useEffect(() => {
    if (status !== 'live') return;
    const track = stream.current?.getVideoTracks?.()[0];
    if (!track?.addEventListener) return;
    const onEnded = () => fail('failed', 'TrackEnded');
    track.addEventListener('ended', onEnded);
    return () => track.removeEventListener('ended', onEnded);
  }, [status]);
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
    const luma = meanLuma(source);
    canvas.toBlob(blob => {
      if (!mounted.current) return;
      if (!blob) { setStatus('failed'); return; }
      stopStream(stream.current); stream.current = null;
      const file = new File([blob], `camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' });
      setStill({ url: URL.createObjectURL(file), file, dark: luma !== null && luma < DARK_LUMA });
      setStatus('captured');
    }, 'image/jpeg', 0.9);
  };
  const retake = () => { setStill(null); setStatus('starting'); setAttempt(value => value + 1); };
  const switchCamera = () => {
    const current = stream.current?.getVideoTracks?.()[0]?.getSettings().deviceId;
    const next = cameras[(Math.max(0, cameras.indexOf(current ?? deviceId ?? '')) + 1) % cameras.length];
    stopStream(stream.current); stream.current = null;
    setDeviceId(next); setStatus('starting'); setAttempt(value => value + 1);
  };
  const copy = status === 'denied' || status === 'unsupported' || status === 'busy' || status === 'nofeed' || status === 'failed'
    ? { ...ERROR_COPY[status], text: `${ERROR_COPY[status].text}${detail ? ` (${detail})` : ''}` }
    : null;
  const announcement = copy ? `${copy.title}. ${copy.text}` : status === 'starting' ? 'Waiting for camera permission…'
    : status === 'captured' ? `Photo captured.${still?.dark ? ' It looks dark; retaking it in brighter light gives better matches.' : ''} Retake it or choose Use this photo.` : 'Camera ready. Choose Take photo to capture.';
  return <section className={styles.camera} aria-label="Camera">
    <p role="status" aria-live="polite" aria-atomic="true" aria-label="Camera status" className={styles.srOnly}>{announcement}</p>
    {copy ? <DiscoveryState tone="visual" icon={<CameraOff size={20} />} title={copy.title} description={copy.text}
      action={<><Button type="button" size="small" onClick={onUpload}><Upload size={16} aria-hidden="true" />Upload a photo</Button>
        <Button type="button" size="small" variant="outline" onClick={retake}><RefreshCw size={16} aria-hidden="true" />Retry camera</Button>
        <Button type="button" size="small" variant="ghost" onClick={onCancel}>Back</Button></>} /> : <>
    <div className={styles.viewfinder}>
      <span className={`${styles.corner} ${styles.tl}`} /><span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} /><span className={`${styles.corner} ${styles.br}`} />
      {still ? <img src={still.url} alt="Captured photo" className={styles.cameraMedia} />
        : <video ref={video} className={styles.cameraMedia} playsInline muted aria-label="Live camera preview" />}
      {status === 'starting' && <p className={styles.cameraNote}>Starting the camera…</p>}
    </div>
    {status === 'live' && <p className={styles.meta}>Fit one product inside the corners, filling most of the frame, in good light.</p>}
    {(status === 'live' || status === 'starting') && cameras.length > 1 && <Button type="button" variant="outline" size="small" onClick={switchCamera}><RefreshCw size={16} aria-hidden="true" />Switch camera</Button>}
    {status === 'captured' && still?.dark && <p className={styles.meta}>This photo looks dark. For better matches, retake it in brighter light.</p>}
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
