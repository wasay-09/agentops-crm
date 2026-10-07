import { CreateContactRequest, CreateNoteRequest, UpdateContactRequest } from '@agentops/contracts';
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ContactsService } from './contacts.service.js';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  async list(@Query('q') q?: string) {
    return { contacts: await this.contacts.list(typeof q === 'string' ? q : undefined) };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateContactRequest)) body: z.infer<typeof CreateContactRequest>,
  ) {
    return { contact: await this.contacts.create(body) };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return { contact: await this.contacts.get(id) };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(UpdateContactRequest)) body: z.infer<typeof UpdateContactRequest>,
  ) {
    return { contact: await this.contacts.update(id, body) };
  }

  @Post(':id/notes')
  async addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(CreateNoteRequest)) body: z.infer<typeof CreateNoteRequest>,
    @CurrentUser() user: AuthUser,
  ) {
    return { note: await this.contacts.addNote(id, body.body, user.name) };
  }
}
