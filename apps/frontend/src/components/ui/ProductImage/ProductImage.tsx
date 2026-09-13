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
  fallbackText = 'Image unavailable',
  containerClassName = '',
  className = '',
  ...props
}: ProductImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleError = () => {
    setHasError(true);
  };

  const handleLoad = () => {
    setIsLoaded(true);
  };

  return (
    <div className={`${styles.container} ${containerClassName}`} data-testid="product-image-container">
      {!hasError ? (
        <img
          src={src}
          alt={alt}
          className={`${styles.image} ${isLoaded ? styles.loaded : ''} ${className}`}
          onError={handleError}
          onLoad={handleLoad}
          {...props}
        />
      ) : (
        <div className={styles.fallback} data-testid="product-image-fallback">
          <ImageIcon className={styles.fallbackIcon} />
          <span className={styles.fallbackText}>{fallbackText}</span>
        </div>
      )}
      {!isLoaded && !hasError && src && (
        <div className={styles.loadingSkeleton} data-testid="product-image-skeleton" />
      )}
    </div>
  );
}
