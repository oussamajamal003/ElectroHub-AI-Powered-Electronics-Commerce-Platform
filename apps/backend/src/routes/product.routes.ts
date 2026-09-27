import { Router } from 'express';
import { productController, categoryController, brandController } from '../controllers/product.controller.js';

const router = Router();
router.get('/products', productController.list);
router.get('/products/:slug', productController.detail);
router.get('/categories', categoryController.list);
router.get('/categories/:slug', categoryController.detail);
router.get('/brands', brandController.list);
router.get('/brands/:slug', brandController.detail);

export default router;
