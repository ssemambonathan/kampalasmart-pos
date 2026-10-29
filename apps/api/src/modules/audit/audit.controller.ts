import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditQueryDto } from './audit.dto';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Search the immutable audit trail' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: AuditQueryDto) {
    return this.audit.list(auth, query);
  }

  @Get('actions')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Distinct audit actions with counts' })
  actions(@CurrentAuth() auth: AuthUser) {
    return this.audit.actions(auth);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.AUDIT_READ, PERMISSIONS.EXPORTS_DATA)
  @ApiOperation({ summary: 'Export filtered audit events as CSV' })
  export(@CurrentAuth() auth: AuthUser, @Query() query: AuditQueryDto) {
    return this.audit.exportCsv(auth, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Audit event detail with before/after snapshots' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.audit.get(auth, id);
  }
}
