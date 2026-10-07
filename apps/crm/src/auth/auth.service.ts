import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { AuthUser, JwtPayload } from './auth.types.js';

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.Y5wW1qcJ1rN5XG9Qe9GxqFJZtD5K';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !ok) {
      throw new UnauthorizedException({
        error: { code: 'invalid_credentials', message: 'Invalid email or password' },
      });
    }
    const user: AuthUser = { id: row.id, email: row.email, name: row.name, role: row.role };
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    return { token: await this.jwt.signAsync(payload), user };
  }

  async me(id: number): Promise<AuthUser> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    if (!row) throw new NotFoundException({ error: { code: 'not_found', message: 'User not found' } });
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }
}
