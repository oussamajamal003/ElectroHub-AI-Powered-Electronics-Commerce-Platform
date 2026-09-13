import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import styles from './StatsCard.module.scss';

export interface StatsCardProps {
  title: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StatsCard({
  title,
  value,
  trend,
  trendValue,
  icon,
  className = '',
}: StatsCardProps) {
  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <ArrowUpRight className={styles.trendIcon} />;
      case 'down':
        return <ArrowDownRight className={styles.trendIcon} />;
      case 'neutral':
        return <Minus className={styles.trendIcon} />;
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.statsCard} ${className}`} data-testid="stats-card">
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {icon && <div className={styles.iconWrapper}>{icon}</div>}
      </div>
      
      <div className={styles.content}>
        <div className={styles.value}>{value}</div>
        
        {trend && trendValue && (
          <div className={`${styles.trendContainer} ${styles[`trend-${trend}`]}`}>
            {getTrendIcon()}
            <span className={styles.trendValue}>{trendValue}</span>
          </div>
        )}
      </div>
    </div>
  );
}
