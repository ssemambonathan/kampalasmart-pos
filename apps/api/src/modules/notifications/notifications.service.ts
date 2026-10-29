import { Injectable } from '@nestjs/common';
import { Prisma, NotificationSeverity, NotificationType } from '@prisma/client';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { NotificationQueryDto } from './notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthUser, query: NotificationQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.NotificationWhereInput = {
      businessId: auth.businessId,
      AND: [
        { OR: [{ userId: auth.id }, { userId: null }] },
        ...(query.unreadOnly
          ? [
              {
                OR: [
                  { userId: auth.id, readAt: null },
                  { userId: null, reads: { none: { userId: auth.id } } },
                ],
              } satisfies Prisma.NotificationWhereInput,
            ]
          : []),
      ],
      ...(query.type ? { type: query.type as NotificationType } : {}),
      ...(query.severity ? { severity: query.severity as NotificationSeverity } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { body: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { reads: { where: { userId: auth.id }, select: { readAt: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: row.title,
        body: row.body,
        readAt:
          row.userId === auth.id
            ? row.readAt?.toISOString() ?? null
            : row.reads[0]?.readAt.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async unreadCount(auth: AuthUser) {
    const [personal, broadcast] = await Promise.all([
      this.prisma.notification.count({
        where: { businessId: auth.businessId, userId: auth.id, readAt: null },
      }),
      this.prisma.notification.count({
        where: {
          businessId: auth.businessId,
          userId: null,
          reads: { none: { userId: auth.id } },
        },
      }),
    ]);
    return { count: personal + broadcast };
  }

  async markRead(auth: AuthUser, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, businessId: auth.businessId },
      select: { id: true, userId: true, readAt: true },
    });
    if (!notification) throw ApiException.notFound('Notification not found.', 'NOTIFICATION_NOT_FOUND');
    if (notification.userId && notification.userId !== auth.id) {
      throw ApiException.notFound('Notification not found.', 'NOTIFICATION_NOT_FOUND');
    }
    if (notification.userId === auth.id) {
      if (!notification.readAt) {
        await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
      }
      return { success: true };
    }
    await this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId: auth.id } },
      create: { notificationId: id, userId: auth.id },
      update: {},
    });
    return { success: true };
  }

  async markAllRead(auth: AuthUser) {
    const personal = await this.prisma.notification.updateMany({
      where: { businessId: auth.businessId, userId: auth.id, readAt: null },
      data: { readAt: new Date() },
    });
    const unreadBroadcasts = await this.prisma.notification.findMany({
      where: {
        businessId: auth.businessId,
        userId: null,
        reads: { none: { userId: auth.id } },
      },
      select: { id: true },
      take: 500,
    });
    if (unreadBroadcasts.length) {
      await this.prisma.notificationRead.createMany({
        data: unreadBroadcasts.map((row) => ({ notificationId: row.id, userId: auth.id })),
        skipDuplicates: true,
      });
    }
    return { marked: personal.count + unreadBroadcasts.length };
  }
}
