import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import {
  CreateUserDto,
  ResetUserPasswordDto,
  UpdateUserDto,
  UserQueryDto,
} from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'List team members with branch assignments' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: UserQueryDto) {
    return this.users.list(auth, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Invite a team member by creating their account' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateUserDto, @Req() req: Request) {
    return this.users.create(auth, dto, auditActor(auth, req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Team member detail' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.users.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Update role, status, profile or branch assignments' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.users.update(auth, id, dto, auditActor(auth, req));
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Set a new password and revoke active sessions' })
  resetPassword(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResetUserPasswordDto,
    @Req() req: Request,
  ) {
    return this.users.resetPassword(auth, id, dto, auditActor(auth, req));
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Clear a login lockout' })
  unlock(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.users.unlock(auth, id, auditActor(auth, req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Deactivate a team member while retaining history' })
  archive(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.users.archive(auth, id, auditActor(auth, req));
  }

  @Get(':id/sessions')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'List recent sign-in sessions' })
  sessions(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.users.sessions(auth, id);
  }

  @Delete(':id/sessions')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Revoke all sessions, or one specific session' })
  revokeSessions(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Query('sessionId') sessionId: string | undefined,
    @Req() req: Request,
  ) {
    return this.users.revokeSessions(auth, id, sessionId ?? null, auditActor(auth, req));
  }
}
