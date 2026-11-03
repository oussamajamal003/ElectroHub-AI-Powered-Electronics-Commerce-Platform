import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { AdminCatalogService } from '../services/admin-catalog.service.js';
import { AdminInventoryService } from '../services/admin-inventory.service.js';
import { AdminOrderService } from '../services/admin-order.service.js';
import { AdminCustomerService } from '../services/admin-customer.service.js';
import { AdminDashboardService } from '../services/admin-dashboard.service.js';
import { categoryCreateSchema, categoryListSchema, categoryStatusSchema, categoryUpdateSchema, customerListSchema, customerStatusSchema,
  dashboardSchema, inventoryAdjustmentSchema, inventoryListSchema, inventoryThresholdSchema, orderListSchema, productCreateSchema,
  productListSchema, productUpdateSchema, statusChangeSchema, uuidSchema } from '../validators/admin.validator.js';

const catalog = new AdminCatalogService();
const inventory = new AdminInventoryService();
const orders = new AdminOrderService();
const customers = new AdminCustomerService();
const dashboard = new AdminDashboardService();

/** Validation errors name the offending fields only; submitted values are never echoed into responses or logs. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.slice(0, 20).map(issue => ({ field: issue.path.join('.') || null, message: issue.message }));
    throw Object.assign(new AppError('Check the highlighted fields and try again.', 400, 'VALIDATION_ERROR'), { fields });
  }
  return result.data;
}
const id = (req: Request, name = 'id') => {
  const result = uuidSchema.safeParse(req.params[name]);
  if (!result.success) throw new AppError('Not found.', 404, 'NOT_FOUND');
  return result.data;
};

type Handler = (req: Request, res: Response) => Promise<unknown>;
/** Errors carrying `fields` (validation) or `current` (inventory conflict) keep the standard envelope and add that safe detail. */
const action = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handler(req, res);
    if (!res.headersSent) res.json(result);
  } catch (error) {
    if (error instanceof AppError && ('fields' in error || 'current' in error)) {
      const extra = error as AppError & { fields?: unknown; current?: unknown };
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message, ...(extra.fields ? { fields: extra.fields } : {}) },
        ...(extra.current ? { data: extra.current } : {}) });
      return;
    }
    next(error);
  }
};
const actor = (req: Request) => req.user!.userId;
const noQuery = (req: Request) => parse(z.object({}).strict(), req.query);

export const adminController = {
  // Products
  listProducts: action(async req => catalog.listProducts(parse(productListSchema, req.query))),
  productOptions: action(async req => { noQuery(req); return { data: await catalog.options() }; }),
  getProduct: action(async req => ({ data: await catalog.getProduct(id(req)) })),
  createProduct: action(async (req, res) => { res.status(201); return { data: await catalog.createProduct(actor(req), parse(productCreateSchema, req.body)) }; }),
  updateProduct: action(async req => ({ data: await catalog.updateProduct(actor(req), id(req), parse(productUpdateSchema, req.body)) })),
  setProductStatus: action(async req => {
    const body = parse(statusChangeSchema, req.body);
    return { data: await catalog.setProductStatus(actor(req), id(req), body.status, body.expectedUpdatedAt) };
  }),
  // Categories
  listCategories: action(async req => catalog.listCategories(parse(categoryListSchema, req.query))),
  createCategory: action(async (req, res) => { res.status(201); return { data: await catalog.createCategory(actor(req), parse(categoryCreateSchema, req.body)) }; }),
  updateCategory: action(async req => ({ data: await catalog.updateCategory(actor(req), id(req), parse(categoryUpdateSchema, req.body)) })),
  setCategoryStatus: action(async req => {
    const body = parse(categoryStatusSchema, req.body);
    return { data: await catalog.setCategoryStatus(actor(req), id(req), body.isActive, body.expectedUpdatedAt) };
  }),
  deleteCategory: action(async (req, res) => { await catalog.deleteCategory(actor(req), id(req)); res.status(204).end(); }),
  // Inventory
  listInventory: action(async req => inventory.list(parse(inventoryListSchema, req.query))),
  adjustInventory: action(async req => ({ data: await inventory.adjust(actor(req), id(req, 'productId'), parse(inventoryAdjustmentSchema, req.body)) })),
  setThreshold: action(async req => {
    const body = parse(inventoryThresholdSchema, req.body);
    return { data: await inventory.setThreshold(actor(req), id(req, 'productId'), body.lowStockAt, body.expectedLowStockAt) };
  }),
  // Orders (read-only; fulfillment uses the existing /admin/orders/:ref/delivery API)
  listOrders: action(async req => orders.list(parse(orderListSchema, req.query))),
  getOrder: action(async req => { noQuery(req); return { data: await orders.detail(String(req.params.orderReference)) }; }),
  // Customers
  listCustomers: action(async req => customers.list(parse(customerListSchema, req.query))),
  getCustomer: action(async req => ({ data: await customers.detail(id(req, 'userId')) })),
  setCustomerStatus: action(async req => {
    const body = parse(customerStatusSchema, req.body);
    return { data: await customers.setStatus(actor(req), id(req, 'userId'), body.isActive, body.expectedUpdatedAt) };
  }),
  // Dashboard
  overview: action(async req => ({ data: await dashboard.overview(parse(dashboardSchema, req.query).days) })),
  alerts: action(async req => { noQuery(req); return { data: await dashboard.alerts() }; }),
};
