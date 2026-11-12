import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { z } from 'zod';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/DropdownMenu';
import { acquireDeliverySocket, releaseDeliverySocket } from '@/features/delivery/realtime/deliverySocket';
import styles from './CustomerNotifications.module.scss';

const itemSchema = z.object({ id: z.string().uuid(), type: z.literal('ORDER_OUT_FOR_DELIVERY'),
  orderReference: z.string().regex(/^ORD-[0-9A-F-]{36}$/), occurredAt: z.string().datetime(), readAt: z.string().datetime().nullable() });
const pageSchema = z.object({ items: z.array(itemSchema), unreadCount: z.number().int().nonnegative(), nextBefore: z.string().nullable() });
const eventSchema = itemSchema.omit({ readAt: true }).extend({ v: z.literal(1) });

/** Mounted only for a verified customer. Socket messages are hints; counts and read state always come from REST. */
export function CustomerNotifications({ userId }: { userId: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ['customer-notifications', userId] as const;
  const query = useInfiniteQuery({ queryKey: key, initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => pageSchema.parse((await apiClient<{ data: unknown }>(
      '/api/notifications' + (pageParam ? '?before=' + encodeURIComponent(pageParam) : ''), { signal })).data),
    getNextPageParam: page => page.nextBefore ?? undefined, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const read = useMutation({ mutationFn: (id: string) => apiClient(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  useEffect(() => {
    const socket = acquireDeliverySocket(userId);
    const reconcile = () => { void client.invalidateQueries({ queryKey: ['customer-notifications', userId] }); };
    const receive = (value: unknown) => {
      const event = eventSchema.safeParse(value);
      if (!event.success) return;
      reconcile();
      void client.invalidateQueries({ queryKey: queryKeys.delivery.snapshot(userId, event.data.orderReference) });
      void client.invalidateQueries({ queryKey: queryKeys.orders.detail(userId, event.data.orderReference) });
    };
    socket.on('notification:created', receive);
    socket.on('connect', reconcile);
    reconcile();
    return () => {
      socket.off('notification:created', receive); socket.off('connect', reconcile); releaseDeliverySocket(socket);
      void client.cancelQueries({ queryKey: ['customer-notifications', userId] });
      client.removeQueries({ queryKey: ['customer-notifications', userId] });
    };
  }, [client, userId]);
  const items = [...new Map(query.data?.pages.flatMap(page => page.items).map(item => [item.id, item]) ?? []).values()];
  const count = query.data?.pages[0]?.unreadCount;
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><button type="button" className={styles.bell}
      aria-label={count === undefined ? 'Notifications' : `Notifications, ${count} unread`}>
      <Bell size={20} aria-hidden="true" />{Boolean(count) && <span className={styles.badge} aria-hidden="true">{count! > 99 ? '99+' : count}</span>}
    </button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className={styles.panel} aria-label="Notifications">
      <DropdownMenuLabel>Notifications</DropdownMenuLabel>
      {query.isPending && <p role="status">Loading notifications…</p>}
      {(query.isError || read.isError) && <><p role="alert">Unable to update notifications. Please try again.</p>
        <DropdownMenuItem onSelect={event => { event.preventDefault(); read.reset(); void query.refetch(); }}>Retry</DropdownMenuItem></>}
      {!query.isPending && !query.isError && !items.length && <p>No notifications yet.</p>}
      {items.map(item => <div key={item.id} className={styles.row}>
        <DropdownMenuItem asChild><Link to={`/orders/${item.orderReference}/tracking`} className={styles.link}>
          <span>Your order {item.orderReference} is out for delivery.</span>
          <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time>
          <span>{item.readAt ? 'Read' : 'Unread'}</span>
        </Link></DropdownMenuItem>
        {!item.readAt && <DropdownMenuItem disabled={read.isPending} onSelect={event => { event.preventDefault(); read.mutate(item.id); }}>Mark as read</DropdownMenuItem>}
      </div>)}
      {query.hasNextPage && <DropdownMenuItem disabled={query.isFetchingNextPage} onSelect={event => { event.preventDefault(); void query.fetchNextPage(); }}>Load older notifications</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
