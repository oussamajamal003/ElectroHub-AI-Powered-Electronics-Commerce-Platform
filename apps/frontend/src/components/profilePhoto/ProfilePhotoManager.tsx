import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { ApiError } from '@/lib/api';
import { useProfilePhoto, useProfilePhotoMutations } from '@/features/profilePhoto/queries';
import type { ProfilePhotoScope } from '@/features/profilePhoto/api';
import styles from './ProfilePhotoManager.module.scss';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface Props {
  scope: ProfilePhotoScope;
  userId: string;
  sessionVerified: boolean;
  initials: string;
  displayName: string;
  size?: 'regular' | 'large';
}

export function ProfilePhotoManager({ scope, userId, sessionVerified, initials, displayName, size = 'regular' }: Props) {
  const photo = useProfilePhoto(scope, userId, sessionVerified);
  const { upload, remove } = useProfilePhotoMutations(scope, userId);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const pending = upload.isPending || remove.isPending;
  const hasPhoto = Boolean(photo.data?.url);

  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(undefined); return; }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach(track => track.stop()); }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  function clearDialog() {
    stopCamera();
    setCameraOpen(false);
    setDialogOpen(false);
    setSelectedFile(null);
    setError('');
  }

  function chooseFile(file?: File) {
    if (!file) return;
    setError('');
    setStatus('');
    if (!ACCEPTED_TYPES.has(file.type)) { setSelectedFile(null); setError('Choose a JPEG, PNG, or WebP image.'); return; }
    if (file.size > MAX_FILE_BYTES) { setSelectedFile(null); setError('Choose an image that is 5 MB or smaller.'); return; }
    setSelectedFile(file);
  }

  async function openCamera() {
    setError('');
    setStatus('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera access is unavailable here. Choose a photo from your device instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setSelectedFile(null);
      setCameraOpen(true);
      setDialogOpen(true);
    } catch {
      setStatus('Camera access was unavailable or declined. Choose a photo from your device instead.');
    }
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('The camera is not ready yet. Please wait a moment and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) { setError('The camera photo could not be captured. Please try again.'); return; }
    setSelectedFile(new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' }));
    stopCamera();
    setCameraOpen(false);
    setError('');
  }

  async function savePhoto() {
    if (!selectedFile || pending) return;
    setError('');
    try {
      await upload.mutateAsync(selectedFile);
      clearDialog();
      setStatus('Profile photo saved.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The photo could not be saved. Try again.');
    }
  }

  async function removePhoto() {
    if (pending) return;
    setError('');
    try {
      await remove.mutateAsync();
      setStatus('Profile photo removed.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The photo could not be removed. Try again.');
    }
  }

  return <section className={styles.manager} aria-label="Profile photo">
    <Avatar src={photo.data?.url ?? undefined} alt={photo.data?.url ? `${displayName}'s profile photo` : undefined}
      initials={initials} className={`${styles.avatar} ${size === 'large' ? styles.avatarLarge : ''}`} />
    <div className={styles.details}>
      <strong className={styles.title}>{hasPhoto ? 'Your profile photo' : 'Add a profile photo'}</strong>
      <p className={styles.help}>JPEG, PNG, or WebP up to 5 MB. Your photo is stored privately.</p>
      {photo.isError && <p className={styles.help}>Your saved photo could not be loaded. You can replace it or try again.</p>}
      <div className={styles.actions}>
        <Button type="button" variant="outline" size="small" disabled={pending} onClick={() => { setError(''); setStatus(''); setSelectedFile(null); setDialogOpen(true); setCameraOpen(false); fileInput.current?.click(); }}>
          <ImagePlus aria-hidden="true" /> {hasPhoto ? 'Replace photo' : 'Upload photo'}
        </Button>
        <Button type="button" variant="outline" size="small" disabled={pending} onClick={() => void openCamera()}>
          <Camera aria-hidden="true" /> Take photo
        </Button>
        {hasPhoto && <Button type="button" variant="ghost" size="small" disabled={pending} onClick={() => void removePhoto()}>
          <Trash2 aria-hidden="true" /> Remove photo
        </Button>}
      </div>
      {status && <p className={styles.status} role="status">{status}</p>}
      <input ref={fileInput} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp" capture="user"
        aria-label="Choose a profile photo" onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
    </div>

    <Dialog open={dialogOpen} onOpenChange={open => { if (!open) clearDialog(); }}>
      <DialogContent className={styles.dialog} aria-describedby="profile-photo-dialog-description">
        <DialogTitle>{cameraOpen ? 'Take a photo' : 'Preview profile photo'}</DialogTitle>
        <DialogDescription id="profile-photo-dialog-description">
          {cameraOpen ? 'Center your face in the frame, then capture your photo.' : 'Your photo is cropped to a square before it is saved.'}
        </DialogDescription>
        {cameraOpen ? <video ref={video => {
          videoRef.current = video;
          // The Radix portal mounts the video after the camera request resolves. Attach the stream as soon as this node exists.
          if (video && streamRef.current) video.srcObject = streamRef.current;
        }} className={styles.camera} autoPlay muted playsInline aria-label="Live camera preview" /> :
          <Avatar src={previewUrl} alt="Profile photo preview" initials={initials} className={`${styles.preview} ${size === 'large' ? styles.previewLarge : ''}`} />}
        {error && <Alert variant="error">{error}</Alert>}
        <div className={styles.dialogActions}>
          {cameraOpen ? <Button type="button" onClick={() => void capturePhoto()}>Capture photo</Button> : <>
            {!selectedFile && <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>Choose photo</Button>}
            {selectedFile && <Button type="button" disabled={pending} isLoading={pending} onClick={() => void savePhoto()}>Save photo</Button>}
          </>}
          <Button type="button" variant="ghost" disabled={pending} onClick={clearDialog}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
