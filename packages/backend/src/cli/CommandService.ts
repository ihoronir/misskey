/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import { QueueService } from '@/core/QueueService.js';
import type { UsersRepository } from '@/models/_.js';
import { IsNull, Not } from 'typeorm';

async function sleep(ms = 250): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable()
export class CommandService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private metaService: MetaService,
		private queueService: QueueService,
	) {
	}

	@bindThis
	public async ping() {
		console.log('pong');
	}

	@bindThis
	public async resetCaptcha() {
		await this.metaService.update({
			enableHcaptcha: false,
			hcaptchaSiteKey: null,
			hcaptchaSecretKey: null,
			enableMcaptcha: false,
			mcaptchaSitekey: null,
			mcaptchaSecretKey: null,
			mcaptchaInstanceUrl: null,
			enableRecaptcha: false,
			recaptchaSiteKey: null,
			recaptchaSecretKey: null,
			enableTurnstile: false,
			turnstileSiteKey: null,
			turnstileSecretKey: null,
			enableTestcaptcha: false,
		});
	}

	@bindThis
	public async cleanupDeletedUsers() {
		const deletedUsers = await this.usersRepository.find({
			where: {
				isDeleted: true,
				host: Not(IsNull()),
			},
			select: ['id'],
		});

		console.log(`Found ${deletedUsers.length} deleted remote users`);

		for (const user of deletedUsers) {
			await this.queueService.createDeleteAccountJob(user, {
				soft: false,
			});
			console.log(`Queued deletion job for user ${user.id}`);
			await sleep(1000);
		}

		console.log('Cleanup completed');
	}
}
