import { DealStage, UpdateDealRequest } from '@agentops/contracts';
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ContactsService } from '../contacts/contacts.service.js';

const DealsQuery = z.object({ stage: DealStage.optional() });

@Controller('deals')
export class DealsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(DealsQuery)) query: z.infer<typeof DealsQuery>) {
    return { deals: await this.contacts.listDeals({ stage: query.stage }) };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(UpdateDealRequest)) body: z.infer<typeof UpdateDealRequest>,
  ) {
    return { deal: await this.contacts.moveDealStage(id, body.stage) };
  }
}
