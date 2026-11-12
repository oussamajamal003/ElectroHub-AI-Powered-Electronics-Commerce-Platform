import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
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
  const cameraFileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [capturedFromCamera, setCapturedFromCamera] = useState(false);
  const [showCaptureFallback, setShowCaptureFallback] = useState(false);
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

  useEffect(() => () => {
    cameraRequestRef.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  function clearDialog() {
    cameraRequestRef.current += 1;
    stopCamera();
    setCameraOpen(false);
    setDialogOpen(false);
    setSelectedFile(null);
    setCapturedFromCamera(false);
    setShowCaptureFallback(false);
    setError('');
  }

  function chooseFile(file?: File) {
    if (!file) return;
    setError('');
    setStatus('');
    if (!ACCEPTED_TYPES.has(file.type)) { setSelectedFile(null); setError('Choose a JPEG, PNG, or WebP image.'); return; }
    if (file.size > MAX_FILE_BYTES) { setSelectedFile(null); setError('Choose an image that is 5 MB or smaller.'); return; }
    setSelectedFile(file);
    setCapturedFromCamera(false);
    setShowCaptureFallback(false);
    setDialogOpen(true);
    setCameraOpen(false);
  }

  async function openCamera() {
    const requestId = ++cameraRequestRef.current;
    setError('');
    setStatus('');
    setShowCaptureFallback(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Live camera access is unavailable here. Use your device camera or choose a photo.');
      setShowCaptureFallback(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      setSelectedFile(null);
      setCapturedFromCamera(false);
      setShowCaptureFallback(false);
      setCameraOpen(true);
      setDialogOpen(true);
    } catch {
      if (requestId !== cameraRequestRef.current) return;
      setStatus('Live camera access was unavailable or declined. Use your device camera or choose a photo.');
      setShowCaptureFallback(true);
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
    setCapturedFromCamera(true);
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
    <div className={styles.avatarWrap}>
      <Avatar src={photo.data?.url ?? undefined} alt={photo.data?.url ? `${displayName}'s profile photo` : undefined}
        initials={initials} className={`${styles.avatar} ${size === 'large' ? styles.avatarLarge : ''}`} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            type="button"
            variant="secondary"
            size="small"
            className={styles.editAvatar}
            aria-label={`Edit ${displayName}'s profile photo`}
            disabled={pending}
            icon={<Camera aria-hidden="true" />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={styles.actionMenu}>
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
            <ImagePlus aria-hidden="true" /> {hasPhoto ? 'Change photo' : 'Upload photo'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openCamera()}>
            <Camera aria-hidden="true" /> Take photo
          </DropdownMenuItem>
          {hasPhoto && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => void removePhoto()}>
              <Trash2 aria-hidden="true" /> Remove photo
            </DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className={styles.details}>
      <strong className={styles.title}>{hasPhoto ? 'Your profile photo' : 'Add a profile photo'}</strong>
      <p className={styles.help}>JPEG, PNG, or WebP up to 5 MB. Your photo is stored privately. Use the camera button to manage it.</p>
      {photo.isError && <p className={styles.help}>Your saved photo could not be loaded. You can replace it or try again.</p>}
      {error && !dialogOpen && <Alert variant="error">{error}</Alert>}
      {status && !dialogOpen && <p className={styles.status} role="status">{status}</p>}
      {showCaptureFallback && !dialogOpen && <Button type="button" variant="outline" size="small" onClick={() => cameraFileInput.current?.click()}>
        <Camera aria-hidden="true" /> Use device camera
      </Button>}
      {pending && <p className={styles.help} role="status">Saving your profile photo…</p>}
      <input ref={fileInput} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp"
        aria-label="Choose a profile photo" onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
      <input ref={cameraFileInput} className={styles.hiddenInput} type="file" accept="image/*" capture="user"
        aria-label="Take a profile photo with your device camera" onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
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
        {showCaptureFallback && status && <div className={styles.cameraFallback}>
          <p className={styles.status} role="status">{status}</p>
          <Button type="button" variant="outline" size="small" onClick={() => cameraFileInput.current?.click()}>
            <Camera aria-hidden="true" /> Use device camera
          </Button>
        </div>}
        {error && <Alert variant="error">{error}</Alert>}
        <div className={styles.dialogActions}>
          {cameraOpen ? <Button type="button" onClick={() => void capturePhoto()}>Capture photo</Button> : <>
            {capturedFromCamera && <Button type="button" variant="outline" disabled={pending} onClick={() => void openCamera()}>Retake</Button>}
            {!selectedFile && <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>Choose photo</Button>}
            {selectedFile && <Button type="button" disabled={pending} isLoading={pending} onClick={() => void savePhoto()}>Save photo</Button>}
          </>}
          <Button type="button" variant="ghost" disabled={pending} onClick={clearDialog}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
