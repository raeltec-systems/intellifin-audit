'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../src/design/Button';
export function NotificationRefresh(): React.JSX.Element {
  const router = useRouter(), [pending, start] = useTransition();
  return <div><p>New notifications may take a moment to appear. Refresh to check.</p><Button busy={pending} onClick={() => start(() => router.refresh())}>{pending ? 'Refreshing notifications…' : 'Refresh notifications'}</Button></div>;
}
