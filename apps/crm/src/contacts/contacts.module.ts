import { Module } from '@nestjs/common';
import { DealsController } from '../deals/deals.controller.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';

@Module({
  controllers: [ContactsController, DealsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
