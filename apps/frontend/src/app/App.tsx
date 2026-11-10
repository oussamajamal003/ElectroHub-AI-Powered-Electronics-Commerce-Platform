import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AppRoutes } from '../routes';
import { queryClient } from '@/lib/query';
import { ToastCenter } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <AppRoutes />
            <ToastCenter />
          </TooltipProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MotionConfig>
  );
}
