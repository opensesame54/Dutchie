import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './routes/auth';
import { groupsRouter } from './routes/groups';
import { expensesRouter } from './routes/expenses';
import { settlementsRouter, balancesRouter } from './routes/settlements';
import { friendsRouter } from './routes/friends';
import { activityRouter } from './routes/activity';
import { notificationsRouter } from './routes/notifications';
import { exportsRouter } from './routes/exports';
import { errorHandler, notFoundHandler } from './errors';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Behind Railway/Render's proxy, rate limiting needs the real client IP.
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'dutchie' }));

  app.use('/api/auth', authRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/settlements', settlementsRouter);
  app.use('/api/balances', balancesRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/exports', exportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
