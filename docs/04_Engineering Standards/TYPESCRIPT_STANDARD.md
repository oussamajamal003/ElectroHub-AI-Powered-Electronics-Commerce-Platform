# TypeScript Standard

## 1. Purpose

This document defines TypeScript standards for ElectroHub.

TypeScript is the primary language for:

```text
Frontend
Backend
Shared TypeScript tooling where applicable
```

The goal is to provide:

- Strong type safety.
- Predictable APIs.
- Maintainable domain models.
- Safer refactoring.
- Clear contracts.
- Reduced runtime errors.

---

## 2. Strict TypeScript

TypeScript should use strict checking.

Recommended configuration:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

The project should not weaken strictness simply to make compilation pass.

---

## 3. Avoid any

Avoid:

```ts
any
```

Prefer:

```ts
unknown
```

when the type is genuinely unknown, then narrow it safely.

---

## 4. Explicit Types

Use explicit types when they improve readability or define an important contract.

```ts
type ProductId = string;

interface Product {
  id: ProductId;
  name: string;
  price: number;
}
```

Do not add redundant annotations where TypeScript inference is already clear.

---

## 5. Interfaces and Types

Use `interface` or `type` according to purpose.

Interfaces are appropriate for object contracts.

```ts
interface Product {
  id: string;
  name: string;
}
```

Types are useful for unions.

```ts
type OrderStatus =
  | "Confirmed"
  | "Preparing"
  | "Out for Delivery"
  | "Delivered";
```

---

## 6. Domain Types

Important domain concepts should have explicit types.

Examples:

```text
User
Product
Category
Cart
Order
OrderItem
Payment
Delivery
Recommendation
```

Avoid passing loosely typed objects throughout the application.

---

## 7. API Contracts

API request and response types should be explicit.

```ts
interface CreateOrderRequest {
  shippingAddress: ShippingAddress;
  paymentMethodId: string;
}

interface CreateOrderResponse {
  orderId: string;
  status: OrderStatus;
}
```

Frontend and backend contracts should remain synchronized.

---

## 8. Runtime Validation

TypeScript types do not validate runtime input.

External input must be validated.

Frontend forms use:

```text
Zod
```

Backend requests must also be validated.

```text
Unknown Input
 ↓
Runtime Validation
 ↓
Typed Data
 ↓
Business Logic
```

---

## 9. Null and Undefined

Handle nullable values explicitly.

Avoid unsafe assumptions such as:

```ts
user!.email
```

unless the invariant is genuinely guaranteed.

Prefer explicit checks.

---

## 10. Type Narrowing

Use safe narrowing for unknown values.

```ts
if (typeof value === "string") {
  // value is string here
}
```

For complex data, use schemas or type guards.

---

## 11. Enums and Unions

Use string unions when a closed domain can be represented simply:

```ts
type PaymentStatus =
  | "pending"
  | "paid"
  | "failed";
```

Use enums only when they provide a clear project benefit.

---

## 12. Constants

Use typed constants for fixed application values.

```ts
const LOW_STOCK_THRESHOLD = 5;
```

Avoid magic numbers and strings throughout business logic.

---

## 13. Generics

Use generics when they provide meaningful type reuse.

```ts
interface ApiResponse<T> {
  data: T;
  message?: string;
}
```

Avoid overly complex generic types that reduce readability.

---

## 14. Functions

Important service functions should communicate their contracts.

```ts
async function createOrder(
  input: CreateOrderInput
): Promise<Order> {
  // ...
}
```

Avoid functions that accept broad untyped objects.

---

## 15. Error Types

For unknown caught errors:

```ts
catch (error: unknown) {
  // Safely inspect or convert the error.
}
```

Avoid:

```ts
catch (error: any)
```

without a justified exception.

---

## 16. API Error Contracts

API errors should use a predictable structure.

```ts
interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
```

Sensitive internal details must not be returned to clients.

---

## 17. React Types

React components should have explicit props contracts.

```ts
interface ProductCardProps {
  product: Product;
  onSelect?: (productId: string) => void;
}
```

Avoid broad props such as:

```ts
props: any
```

---

## 18. Event Types

Use appropriate React event types.

```ts
const handleSubmit = (
  event: React.FormEvent<HTMLFormElement>
) => {
  event.preventDefault();
};
```

Avoid `any` for DOM events.

---

## 19. Hooks

Custom hooks should expose clear typed contracts.

```ts
function useProduct(productId: string) {
  // typed query result
}
```

Hooks should not expose unnecessary internal implementation details.

---

## 20. React Query Types

Queries and mutations should be typed.

```ts
useQuery<Product[]>({
  queryKey: ["products"],
  queryFn: fetchProducts,
});
```

Mutation inputs and results should also be typed.

---

## 21. Form Types

React Hook Form should use Zod-derived types where appropriate.

```ts
type CheckoutForm = z.infer<typeof checkoutSchema>;
```

This keeps runtime validation and TypeScript types aligned.

---

## 22. Prisma Types

Prisma-generated types may be used in backend persistence code.

Do not expose database-specific types blindly through the public API.

Map persistence models to appropriate API/domain representations when needed.

---

## 23. DTOs

Use DTOs where API contracts should be separated from persistence models.

```text
Database Model
 ↓
Service
 ↓
DTO
 ↓
API Response
```

This prevents database implementation details from becoming public API contracts.

---

## 24. Type Assertions

Avoid unnecessary assertions:

```ts
value as Product
```

Prefer validation, type guards, narrowing, or correct typing at the source.

Assertions are acceptable when a verified invariant cannot reasonably be expressed to TypeScript.

---

## 25. Non-Null Assertions

Avoid:

```ts
value!
```

Use only when the invariant is guaranteed.

Repeated non-null assertions are a signal that the type model may need improvement.

---

## 26. Type-Safe Configuration

Environment variables should be validated at application startup.

Do not assume:

```ts
process.env.API_KEY
```

is present or correctly formatted.

Use a configuration layer with runtime validation.

---

## 27. Type-Safe External Integrations

External API responses should not automatically be trusted as typed data.

```text
External Response
 ↓
Runtime Validation
 ↓
Typed Result
 ↓
Application Logic
```

This is especially important for:

```text
Stripe
Brevo
Cloudinary
FastAPI
```

---

## 28. Shared Types

Shared types should only be centralized when there is a clear architectural benefit.

Avoid creating a large global type package that couples unrelated services.

---

## 29. TypeScript and Security

Types do not provide runtime security.

Always validate:

- User input.
- API requests.
- External responses.
- Uploaded files.
- Authentication data.

Type safety complements, but does not replace, security controls.

---

## 30. TypeScript and Testing

TypeScript compilation is one quality gate.

It does not replace tests.

Required validation includes:

```text
Type Check
+
Lint
+
Unit Tests
+
Integration Tests
+
E2E Tests
```

---

## 31. TypeScript Completion Criteria

TypeScript code is production-ready when:

- Strict mode is enabled.
- `any` is avoided.
- Runtime input is validated.
- API contracts are typed.
- Domain models are explicit.
- Nullable values are handled safely.
- Errors are typed/narrowed safely.
- React props are typed.
- React Query operations are typed.
- External responses are validated.
- Configuration is validated.
- Type checking passes without errors.

---

## 32. TypeScript Principle

> **Use TypeScript to make contracts explicit, prevent invalid states where possible, and make unsafe assumptions visible during development.**
