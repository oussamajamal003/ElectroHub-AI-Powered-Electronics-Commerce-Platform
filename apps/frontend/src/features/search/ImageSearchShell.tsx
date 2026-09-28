import { useEffect, useRef, useState } from 'react';
import { Image, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './SearchPage.module.scss';
export function ImageSearchShell() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setPreview(undefined); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const select = (selected?: File) => {
    if (!selected) return;
    if (!selected.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    setFile(selected); setError('');
  };
  return <section className={`${styles.dropzone} ${dragging ? styles.dragging : ''}`} aria-label="Image search file selection"
    onClick={event => { if (!(event.target instanceof Element) || !event.target.closest('button, input')) input.current?.click(); }}
    onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); select(event.dataTransfer.files[0]); }}>
    <input ref={input} type="file" accept="image/*" hidden aria-label="Choose image" onChange={event => { select(event.target.files?.[0]); event.target.value = ''; }} />
    {preview ? <img src={preview} alt="Selected image preview" className={styles.preview} onError={() => setPreview(undefined)} /> : <Image size={36} aria-hidden="true" />}
    <h2>{file ? file.name : 'Drag an image here or click to upload'}</h2>
    <p>{file ? 'Local preview only. Image matching is not available yet.' : 'Supports JPG, PNG, WEBP, and other image formats'}</p>
    <div className={styles.inlineActions}><Button type="button" variant="outline" onClick={() => input.current?.click()}><Upload size={18} /> {file ? 'Replace image' : 'Browse files'}</Button>
      {file && <Button type="button" variant="ghost" onClick={() => { setFile(null); setError(''); }}>Remove image</Button>}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
