// Load env BEFORE any NestJS imports so JwtModule + JwtStrategy see the same secret.
import * as dotenv from 'dotenv';
import { join } from 'path';
dotenv.config({ path: join(__dirname, '..', '.env') });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SeedService } from './seed/seed.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const seed = app.get(SeedService);
  await seed.run();

  const port = parseInt(process.env.PORT, 10) || 9001;
  await app.listen(port, '0.0.0.0');
  console.log(`[Axistra NestJS API] listening on http://0.0.0.0:${port}/api`);
}
bootstrap();
