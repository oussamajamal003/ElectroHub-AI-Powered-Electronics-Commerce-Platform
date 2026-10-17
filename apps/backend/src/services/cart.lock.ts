import { Prisma } from '@prisma/client';

/** Lock before changing Cart intent. Payment paths lock existing Attempt/Work first. */
export async function lockCart(client: Prisma.TransactionClient, cartId: string) {
  await client.$queryRaw(Prisma.sql`SELECT "id" FROM "carts" WHERE "id" = ${cartId}::uuid FOR UPDATE`);
}

/** Resolve and lock a customer's Cart in one round trip for purchase transactions. */
export async function lockCartForUser(client: Prisma.TransactionClient, userId: string) {
  const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "carts" WHERE "userId" = ${userId}::uuid FOR UPDATE`);
  return rows[0]?.id ?? null;
}
