import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(app.get(ConfigService).get('port'));
  console.log(
    `The Mindflayer Elder Brain is listening on: ${await app.getUrl()}`,
  );
}

bootstrap();
