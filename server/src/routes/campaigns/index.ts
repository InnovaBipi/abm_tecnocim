import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import baseRouter from './base';
import emailsRouter from './emails';
import prospectsRouter from './prospects';

const router = Router();
router.use(authenticate);
router.use('/', baseRouter);
router.use('/', emailsRouter);
router.use('/', prospectsRouter);

export default router;
