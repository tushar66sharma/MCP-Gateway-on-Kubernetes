import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from './components/ui/Toast';
import { AuthProvider } from './lib/auth';
import { queryClient } from './lib/queryClient';
import { createRouter } from './router';

export function App() {
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
