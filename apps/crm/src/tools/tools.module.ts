import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { ToolTokenGuard } from './tool-token.guard.js';
import { ToolsController } from './tools.controller.js';
import { ToolsService } from './tools.service.js';

@Module({
  imports: [ContactsModule],
  controllers: [ToolsController],
  providers: [ToolsService, ToolTokenGuard],
})
export class ToolsModule {}
