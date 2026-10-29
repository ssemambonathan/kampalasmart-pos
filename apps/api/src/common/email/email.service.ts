import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../logging/app-logger.service';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailDeliveryResult {
  delivered: boolean;
  provider: string;
  detail: string;
}

/**
 * Email delivery abstraction. Only the development "outbox" provider is
 * implemented; it logs the content locally and never claims external delivery.
 * Production deployments must plug in a real transactional email provider
 * behind this interface (documented in docs/deployment.md).
 */
@Injectable()
export class EmailService {
  private readonly outbox: EmailMessage[] = [];
  private readonly provider: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.provider = config.get<string>('EMAIL_PROVIDER') || 'development-outbox';
  }

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    this.outbox.push(message);
    if (this.outbox.length > 100) this.outbox.shift();

    if (this.provider !== 'development-outbox') {
      this.logger.warn(
        `Email provider "${this.provider}" is not implemented; message was NOT delivered.`,
        'Email',
      );
      return {
        delivered: false,
        provider: this.provider,
        detail: 'No provider implementation is configured. Message not delivered.',
      };
    }

    this.logger.info('Email captured by development outbox (not delivered externally)', 'Email', {
      to: message.to,
      subject: message.subject,
      preview: message.text.slice(0, 500),
    });
    return {
      delivered: false,
      provider: 'development-outbox',
      detail: 'Captured locally; no external email was sent.',
    };
  }

  /** Test helper; not exposed over HTTP. */
  getOutbox(): ReadonlyArray<EmailMessage> {
    return this.outbox;
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }

  buildAppUrl(path: string): string {
    const origin = (this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000').split(',')[0];
    return `${origin?.trim()}${path}`;
  }
}
