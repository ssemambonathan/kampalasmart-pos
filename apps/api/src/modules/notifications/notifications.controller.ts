import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { NotificationQueryDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'List notifications for the signed-in user and branch-wide alerts' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: NotificationQueryDto) {
    return this.notifications.list(auth, query);
  }

  @Get('unread-count')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Unread notification count' })
  unread(@CurrentAuth() auth: AuthUser) {
    return this.notifications.unreadCount(auth);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Mark all visible notifications as read for this user' })
  readAll(@CurrentAuth() auth: AuthUser) {
    return this.notifications.markAllRead(auth);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Mark one notification as read' })
  read(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(auth, id);
  }
}
