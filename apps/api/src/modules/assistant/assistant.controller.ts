import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AskAssistantDto } from './assistant.dto';
import { AssistantService } from './assistant.service';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('capabilities')
  @ApiOperation({ summary: 'What the grounded rules-engine assistant can answer' })
  capabilities() {
    return this.assistant.capabilities();
  }

  @Post('ask')
  @RequirePermissions(PERMISSIONS.ASSISTANT_USE, PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Answer a business question from recorded data' })
  ask(@CurrentAuth() auth: AuthUser, @Body() dto: AskAssistantDto) {
    return this.assistant.ask(auth, dto);
  }
}
