import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** Validates (and strips/coerces) a request part with a zod schema from @agentops/contracts. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'validation_error', message: formatZodError(parsed.error) },
      });
    }
    return parsed.data;
  }
}
