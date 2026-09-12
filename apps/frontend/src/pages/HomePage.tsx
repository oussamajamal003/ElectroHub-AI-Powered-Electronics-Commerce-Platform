import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/Dialog';

/**
 * Home Page — Foundation placeholder.
 * Will be replaced with the actual home page implementation.
 */
export function HomePage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>ElectroHub</h1>
      <p>AI-Powered Electronics Commerce Platform</p>
      
      <div style={{ marginTop: '2rem' }}>
        <Dialog>
          <DialogTrigger asChild>
            <button
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer'
              }}
            >
              Open Foundation Dialog
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Frontend Foundation</DialogTitle>
            <DialogDescription>
              This dialog demonstrates the integration of Radix UI primitives,
              Framer Motion animations, Lucide icons, and SCSS modules following 
              the ElectroHub styling standards.
            </DialogDescription>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
