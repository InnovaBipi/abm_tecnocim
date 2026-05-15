import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import baseRouter from './base';
import stepsRouter from './steps';
import enrollmentRouter from './enrollment';

const router = Router();
router.use(authenticate);
router.use('/', baseRouter);
router.use('/', stepsRouter);
router.use('/', enrollmentRouter);

export default router;
