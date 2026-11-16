import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import styles from './ProductImage.module.scss';

export interface ProductImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackText?: string;
  containerClassName?: string;
}

export function ProductImage({
  src,
  alt,
  fallbackText,
  containerClassName = '',
  className = '',
  ...props
}: ProductImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const hasError = failedSource === src;
  const isLoaded = loadedSource === src;
  const description = typeof alt === 'string' ? alt.trim() : '';
  const unavailableText = fallbackText ?? (description ? `Photo unavailable: ${description}` : 'Photo unavailable');

  return (
    <div className={`${styles.container} ${containerClassName}`} data-testid="product-image-container">
      {!hasError && src ? (
        <img
          key={src}
          src={src}
          alt={description ? alt : ''}
          className={`${styles.image} ${isLoaded ? styles.loaded : ''} ${className}`}
          onError={() => setFailedSource(src)}
          onLoad={() => setLoadedSource(src)}
          {...props}
        />
      ) : (
        // An informative alt survives the fallback; decorative images (alt="") stay silent.
        <div className={styles.fallback} data-testid="product-image-fallback" {...(description ? { role: 'img', 'aria-label': description } : {})}>
          <ImageIcon className={styles.fallbackIcon} aria-hidden="true" />
          <span className={styles.fallbackText}>{unavailableText}</span>
        </div>
      )}
      {!isLoaded && !hasError && src && (
        <div className={styles.loadingSkeleton} data-testid="product-image-skeleton" />
      )}
    </div>
  );
}
