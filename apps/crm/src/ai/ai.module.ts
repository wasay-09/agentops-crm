import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { GatewayClient } from './gateway.client.js';

@Module({
  controllers: [AiController],
  providers: [GatewayClient],
})
export class AiModule {}
