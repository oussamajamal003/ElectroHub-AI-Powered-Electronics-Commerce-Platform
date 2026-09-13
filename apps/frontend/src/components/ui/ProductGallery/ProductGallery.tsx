import { useState } from 'react';
import { ProductImage } from '../ProductImage';
import styles from './ProductGallery.module.scss';

export interface GalleryImage {
  id: string | number;
  src: string;
  alt: string;
}

export interface ProductGalleryProps {
  images: GalleryImage[];
  selectedIndex?: number;
  onSelectImage?: (index: number) => void;
  className?: string;
}

export function ProductGallery({
  images,
  selectedIndex,
  onSelectImage,
  className = '',
}: ProductGalleryProps) {
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0);

  const isControlled = selectedIndex !== undefined;
  const activeIndex = isControlled ? selectedIndex : internalSelectedIndex;

  const handleSelect = (index: number) => {
    if (!isControlled) {
      setInternalSelectedIndex(index);
    }
    onSelectImage?.(index);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect(index);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % images.length;
      handleSelect(nextIndex);
      document.getElementById(`gallery-thumb-${nextIndex}`)?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + images.length) % images.length;
      handleSelect(prevIndex);
      document.getElementById(`gallery-thumb-${prevIndex}`)?.focus();
    }
  };

  if (!images || images.length === 0) {
    return (
      <div className={`${styles.gallery} ${className}`} data-testid="product-gallery">
        <div className={styles.mainImage}>
          <ProductImage src="" alt="No image available" />
        </div>
      </div>
    );
  }

  const mainImage = images[activeIndex] || images[0];

  return (
    <div className={`${styles.gallery} ${className}`} data-testid="product-gallery">
      <div className={styles.mainImage}>
        <ProductImage 
          src={mainImage!.src} 
          alt={mainImage!.alt} 
          key={mainImage!.id} // Re-render image when active changes
        />
      </div>

      {images.length > 1 && (
        <div 
          className={styles.thumbnails} 
          role="tablist" 
          aria-label="Product thumbnails"
        >
          {images.map((image, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={image.id}
                id={`gallery-thumb-${index}`}
                role="tab"
                aria-selected={isActive}
                aria-label={`View ${image.alt}`}
                aria-controls="main-product-image"
                tabIndex={isActive ? 0 : -1}
                className={`${styles.thumbnailBtn} ${isActive ? styles.active : ''}`}
                onClick={() => handleSelect(index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              >
                <img 
                  src={image.src} 
                  alt="" 
                  className={styles.thumbnailImage} 
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
