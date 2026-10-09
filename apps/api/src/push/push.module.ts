/**
 * Notifications push Web (VAPID) : rappel de pesée et rappel de meal prep.
 * Entièrement facultatif : sans clés VAPID, le module reste inactif.
 */
import { APP_NAME } from '@bouffe/core';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, Post, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsObject, IsString, IsUrl } from 'class-validator';
import type { Model } from 'mongoose';
import webpush from 'web-push';
import { Public, UserId } from '../common/auth.js';
import { config } from '../config.js';
import { M, type PushSubscriptionDoc, type UserDoc } from '../db/schemas.js';

export class SubscribeDto {
  @IsUrl({ require_tld: false })
  endpoint: string;

  @IsObject()
  keys: { p256dh: string; auth: string };
}

export class UnsubscribeDto {
  @IsString()
  endpoint: string;
}

interface PushMessage {
  title: string;
  body: string;
  url: string;
}

const TIME_ZONE = process.env.REMINDERS_TIME_ZONE ?? 'Europe/Paris';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  readonly enabled = !!(config.vapid.publicKey && config.vapid.privateKey);

  constructor(
    @InjectModel(M.PushSubscription) private readonly subscriptions: Model<PushSubscriptionDoc>,
    @InjectModel(M.User) private readonly users: Model<UserDoc>,
  ) {
    if (this.enabled) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  }

  async subscribe(userId: string, dto: SubscribeDto): Promise<void> {
    await this.subscriptions.updateOne({ endpoint: dto.endpoint }, { $set: { userId, keys: dto.keys } }, { upsert: true });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.deleteOne({ userId, endpoint });
  }

  async send(userId: string, message: PushMessage): Promise<number> {
    if (!this.enabled) return 0;
    const subscriptions = await this.subscriptions.find({ userId });
    let sent = 0;
    for (const sub of subscriptions) {
      try {
        // Format attendu par le service worker Angular (ngsw).
        const payload = { notification: { title: message.title, body: message.body, icon: 'icons/icon-192.png', data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: message.url } } } } };
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await sub.deleteOne();
        else this.logger.warn(`Envoi push impossible (${status ?? 'erreur réseau'})`);
      }
    }
    return sent;
  }

  /** Jour de la semaine (0 = lundi) dans le fuseau des rappels. */
  private weekday(): number {
    const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TIME_ZONE }).format(new Date());
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name);
  }

  @Cron('0 8 * * *', { timeZone: TIME_ZONE })
  async weighInReminder(): Promise<void> {
    if (!this.enabled) return;
    const users = await this.users.find({ 'preferences.reminders.weighIn': true, 'preferences.weighDay': this.weekday() }).select('_id');
    for (const user of users) {
      await this.send(user.id, { title: 'Pesée du jour', body: 'À jeun, après le réveil : note ton poids pour suivre ta tendance.', url: '/progression' });
    }
  }

  @Cron('0 17 * * 0', { timeZone: TIME_ZONE })
  async mealPrepReminder(): Promise<void> {
    if (!this.enabled) return;
    const users = await this.users.find({ 'preferences.reminders.mealPrep': true }).select('_id');
    for (const user of users) {
      await this.send(user.id, { title: 'Meal prep', body: 'Génère ta semaine et prépare tes repas des 3 prochains jours.', url: '/programme' });
    }
  }
}

@ApiTags('notifications')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Clé publique VAPID nécessaire à l'abonnement du navigateur. */
  @Public()
  @Get('public-key')
  publicKey() {
    return { enabled: this.push.enabled, publicKey: config.vapid.publicKey || null };
  }

  @ApiBearerAuth()
  @Post('subscribe')
  @HttpCode(204)
  async subscribe(@UserId() userId: string, @Body() dto: SubscribeDto) {
    if (!this.push.enabled) throw new ServiceUnavailableException('Notifications push non configurées sur ce serveur.');
    await this.push.subscribe(userId, dto);
  }

  @ApiBearerAuth()
  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(@UserId() userId: string, @Body() dto: UnsubscribeDto) {
    await this.push.unsubscribe(userId, dto.endpoint);
  }

  /** Envoie une notification de test aux appareils abonnés. */
  @ApiBearerAuth()
  @Post('test')
  async test(@UserId() userId: string) {
    return { sent: await this.push.send(userId, { title: APP_NAME, body: 'Les notifications fonctionnent.', url: '/' }) };
  }
}

@Module({ controllers: [PushController], providers: [PushService] })
export class PushModule {}
