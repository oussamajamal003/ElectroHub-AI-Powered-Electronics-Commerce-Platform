import { Prisma } from '@prisma/client';

/** All Cart writers take this lock before inspecting or changing intent. */
export async function lockCart(client: Prisma.TransactionClient, cartId: string) {
  await client.$queryRaw(Prisma.sql`SELECT "id" FROM "carts" WHERE "id" = ${cartId}::uuid FOR UPDATE`);
}
