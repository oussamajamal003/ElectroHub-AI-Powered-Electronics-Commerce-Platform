import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AppRoutes } from '../routes';
import { queryClient } from '@/lib/query';
import { ToastCenter } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ThemeProvider } from '@/features/theme';

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={400} skipDelayDuration={200}>
              <AppRoutes />
              <ToastCenter />
            </TooltipProvider>
          </QueryClientProvider>
        </MotionConfig>
      </ThemeProvider>
    </BrowserRouter>
  );
}
